import { createHash, randomUUID } from "node:crypto";
import type {
  CandidateEvent,
  EvidenceEvent,
  ReporterIngestRequest,
  TelemetryIngestRequest,
  Zone
} from "@gridproof/shared-types";
import { isDatabaseConfigured, query } from "../../lib/db.js";
import { heartbeatGapKey } from "../detection/heartbeat.js";
import { AGREEMENT_WINDOW_MS, detectCandidateFromEvidence } from "../detection/rules.js";

type EvidenceRow = {
  id: string;
  provider_id: string;
  zone_id: string;
  idempotency_key: string;
  source: "sensor" | "reporter";
  status: "grid_up" | "grid_down" | "unknown";
  voltage: string | null;
  confidence_hint: string | null;
  raw_payload: Record<string, unknown>;
  observed_at: Date;
  received_at: Date;
};

const evidenceByIdempotencyKey = new Map<string, EvidenceEvent>();
const candidatesByKey = new Map<string, CandidateEvent>();

export type IngestStoreResult = {
  duplicate: boolean;
  evidenceEvent: EvidenceEvent;
  candidateEvent: CandidateEvent | null;
};

export async function upsertTelemetryEvidence(input: TelemetryIngestRequest): Promise<IngestStoreResult> {
  if (isDatabaseConfigured()) {
    return upsertDatabaseEvidence({
      zoneId: input.zoneId,
      providerWallet: input.providerWallet,
      source: "sensor",
      idempotencyKey: input.idempotencyKey,
      status: input.status,
      voltage: input.voltage,
      rawPayload: {
        deviceId: input.deviceId,
        providerWallet: input.providerWallet,
        ...(input.currentAmps === undefined ? {} : { currentAmps: input.currentAmps })
      },
      observedAt: input.observedAt
    });
  }

  const existing = evidenceByIdempotencyKey.get(input.idempotencyKey);
  if (existing) return { duplicate: true, evidenceEvent: existing, candidateEvent: findMemoryCandidate(existing) };

  const now = new Date().toISOString();
  const evidenceEvent: EvidenceEvent = {
    id: randomUUID(),
    providerId: randomUUID(),
    zoneId: input.zoneId,
    idempotencyKey: input.idempotencyKey,
    source: "sensor",
    status: input.status,
    voltage: input.voltage,
    currentAmps: input.currentAmps,
    rawPayload: {
      deviceId: input.deviceId,
      providerWallet: input.providerWallet,
      ...(input.currentAmps === undefined ? {} : { currentAmps: input.currentAmps })
    },
    observedAt: input.observedAt,
    receivedAt: now
  };

  evidenceByIdempotencyKey.set(input.idempotencyKey, evidenceEvent);
  const candidateEvent = storeMemoryCandidate(evidenceEvent);
  return { duplicate: false, evidenceEvent, candidateEvent };
}

export async function upsertReporterEvidence(input: ReporterIngestRequest): Promise<IngestStoreResult> {
  if (isDatabaseConfigured()) {
    return upsertDatabaseEvidence({
      zoneId: input.zoneId,
      providerWallet: input.reporterWallet,
      source: "reporter",
      idempotencyKey: input.idempotencyKey,
      status: input.status,
      rawPayload: {
        reporterWallet: input.reporterWallet,
        note: input.note
      },
      observedAt: input.observedAt
    });
  }

  const existing = evidenceByIdempotencyKey.get(input.idempotencyKey);
  if (existing) return { duplicate: true, evidenceEvent: existing, candidateEvent: findMemoryCandidate(existing) };

  const now = new Date().toISOString();
  const evidenceEvent: EvidenceEvent = {
    id: randomUUID(),
    providerId: randomUUID(),
    zoneId: input.zoneId,
    idempotencyKey: input.idempotencyKey,
    source: "reporter",
    status: input.status,
    rawPayload: {
      reporterWallet: input.reporterWallet,
      note: input.note
    },
    observedAt: input.observedAt,
    receivedAt: now
  };

  evidenceByIdempotencyKey.set(input.idempotencyKey, evidenceEvent);
  const candidateEvent = storeMemoryCandidate(evidenceEvent);
  return { duplicate: false, evidenceEvent, candidateEvent };
}

export function clearEvidenceStore(): void {
  evidenceByIdempotencyKey.clear();
  candidatesByKey.clear();
}

/**
 * Records a heartbeat-gap candidate, keyed by the silence itself rather than by a
 * single evidence row.
 *
 * Returns the candidate only when it was newly recorded, so a repeating sweep runs
 * the pipeline exactly once per gap. In database mode the unique `candidate_key`
 * index is what enforces that, which keeps the sweep idempotent across restarts and
 * across concurrent API instances rather than relying on process memory.
 */
export async function recordGapCandidate(candidate: CandidateEvent): Promise<CandidateEvent | null> {
  const key = heartbeatGapKey(candidate);

  if (!isDatabaseConfigured()) {
    if (candidatesByKey.has(key)) return null;
    candidatesByKey.set(key, candidate);
    return candidate;
  }

  const insert = await query(
    `
      insert into candidate_events (
        id,
        candidate_key,
        zone_id,
        status,
        confidence,
        window_start,
        window_end,
        evidence_event_ids,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], $9)
      on conflict (candidate_key) do nothing
    `,
    [
      candidate.id,
      key,
      candidate.zoneId,
      candidate.status,
      candidate.confidence,
      candidate.windowStart,
      candidate.windowEnd,
      candidate.evidenceEventIds,
      candidate.createdAt
    ]
  );

  return insert.rowCount === 0 ? null : candidate;
}

/**
 * Recent sensor evidence grouped by zone, for the heartbeat-gap sweep.
 *
 * Bounded by `lookbackMs` and a row cap so the sweep stays cheap on a busy network.
 * Reporter submissions are excluded: they are not heartbeats.
 */
export async function listSweepEvidenceByZone(
  lookbackMs: number,
  now: Date = new Date()
): Promise<Map<string, EvidenceEvent[]>> {
  const sinceMs = now.getTime() - lookbackMs;

  if (!isDatabaseConfigured()) {
    return groupEvidenceByZone(
      Array.from(evidenceByIdempotencyKey.values()).filter(
        (event) => event.source === "sensor" && Date.parse(event.observedAt) >= sinceMs
      )
    );
  }

  const result = await query<EvidenceRow>(
    `
      select id, provider_id, zone_id, idempotency_key, source, status, voltage,
             confidence_hint, raw_payload, observed_at, received_at
      from evidence_events
      where source = 'sensor'
        and observed_at >= $1
      order by observed_at asc
      limit 5000
    `,
    [new Date(sinceMs).toISOString()]
  );

  return groupEvidenceByZone(result.rows.map(mapEvidenceRow));
}

function groupEvidenceByZone(events: EvidenceEvent[]): Map<string, EvidenceEvent[]> {
  const byZone = new Map<string, EvidenceEvent[]>();
  for (const event of events) {
    const existing = byZone.get(event.zoneId);
    if (existing) existing.push(event);
    else byZone.set(event.zoneId, [event]);
  }
  return byZone;
}

export function listMemoryCandidates(zoneId?: string): CandidateEvent[] {
  return Array.from(candidatesByKey.values()).filter((candidate) => !zoneId || candidate.zoneId === zoneId);
}

export function listMemoryEvidence(zoneId?: string): EvidenceEvent[] {
  return Array.from(evidenceByIdempotencyKey.values()).filter((event) => !zoneId || event.zoneId === zoneId);
}

async function upsertDatabaseEvidence(input: {
  zoneId: string;
  providerWallet: string;
  source: "sensor" | "reporter";
  idempotencyKey: string;
  status: "grid_up" | "grid_down" | "unknown";
  voltage?: number;
  rawPayload: Record<string, unknown>;
  observedAt: string;
}): Promise<IngestStoreResult> {
  await ensureZone(input.zoneId);
  const providerId = await ensureProvider(input.providerWallet, input.source, input.zoneId);

  const insert = await query<{ id: string }>(
    `
      insert into evidence_events (
        provider_id,
        zone_id,
        idempotency_key,
        source,
        status,
        voltage,
        raw_payload,
        observed_at
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      on conflict (idempotency_key) do nothing
      returning id
    `,
    [
      providerId,
      input.zoneId,
      input.idempotencyKey,
      input.source,
      input.status,
      input.voltage ?? null,
      JSON.stringify(input.rawPayload),
      input.observedAt
    ]
  );

  const duplicate = insert.rowCount === 0;
  const evidenceEvent = await findEvidenceByIdempotencyKey(input.idempotencyKey);
  const candidateEvent = duplicate ? await findDatabaseCandidate(evidenceEvent) : await storeDatabaseCandidate(evidenceEvent);

  return { duplicate, evidenceEvent, candidateEvent };
}

async function ensureZone(zoneId: string): Promise<void> {
  await query(
    `
      insert into zones (id, zone_key, name, discos_feeder_code, region, centroid_lat, centroid_lng)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (id) do nothing
    `,
    [
      zoneId,
      bytes32From(`zone:${zoneId}`),
      `Zone ${zoneId.slice(0, 8)}`,
      `DEMO-${zoneId.slice(0, 8)}`,
      "Demo",
      8.133,
      4.25
    ]
  );
}

async function ensureProvider(walletAddress: string, providerType: "sensor" | "reporter", zoneId: string): Promise<string> {
  const result = await query<{ id: string }>(
    `
      insert into providers (wallet_address, provider_type, zone_id, active)
      values ($1, $2, $3, true)
      on conflict (wallet_address) do update
      set zone_id = excluded.zone_id,
          provider_type = excluded.provider_type,
          active = true,
          updated_at = now()
      returning id
    `,
    [walletAddress.toLowerCase(), providerType, zoneId]
  );

  const row = result.rows[0];
  if (!row) throw new Error("Failed to resolve provider");
  return row.id;
}

async function findEvidenceByIdempotencyKey(idempotencyKey: string): Promise<EvidenceEvent> {
  const result = await query<EvidenceRow>(
    `
      select id, provider_id, zone_id, idempotency_key, source, status, voltage,
             confidence_hint, raw_payload, observed_at, received_at
      from evidence_events
      where idempotency_key = $1
    `,
    [idempotencyKey]
  );

  const row = result.rows[0];
  if (!row) throw new Error(`Evidence event not found for idempotency key ${idempotencyKey}`);
  return mapEvidenceRow(row);
}

async function storeDatabaseCandidate(evidenceEvent: EvidenceEvent): Promise<CandidateEvent | null> {
  const candidate = detectCandidateFromEvidence(evidenceEvent, {
    recentEvidence: await findRecentZoneEvidence(evidenceEvent)
  });
  if (!candidate) return null;

  const candidateKey = candidateKeyFor(evidenceEvent);
  await query(
    `
      insert into candidate_events (
        id,
        candidate_key,
        zone_id,
        status,
        confidence,
        window_start,
        window_end,
        evidence_event_ids,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], $9)
      on conflict (candidate_key) do nothing
    `,
    [
      candidate.id,
      candidateKey,
      candidate.zoneId,
      candidate.status,
      candidate.confidence,
      candidate.windowStart,
      candidate.windowEnd,
      candidate.evidenceEventIds,
      candidate.createdAt
    ]
  );

  return findDatabaseCandidate(evidenceEvent);
}

/**
 * Recent evidence for the same zone, used only for deterministic cross-source
 * agreement scoring. Bounded so a busy zone cannot make ingestion unbounded.
 */
async function findRecentZoneEvidence(evidenceEvent: EvidenceEvent): Promise<EvidenceEvent[]> {
  const result = await query<EvidenceRow>(
    `
      select id, provider_id, zone_id, idempotency_key, source, status, voltage,
             confidence_hint, raw_payload, observed_at, received_at
      from evidence_events
      where zone_id = $1
        and id <> $2
        and observed_at between $3::timestamptz - ($4 || ' milliseconds')::interval
                            and $3::timestamptz + ($4 || ' milliseconds')::interval
      order by observed_at desc
      limit 50
    `,
    [evidenceEvent.zoneId, evidenceEvent.id, evidenceEvent.observedAt, String(AGREEMENT_WINDOW_MS)]
  );

  return result.rows.map(mapEvidenceRow);
}

async function findDatabaseCandidate(evidenceEvent: EvidenceEvent): Promise<CandidateEvent | null> {
  const result = await query<{
    id: string;
    zone_id: string;
    status: "outage" | "restored";
    confidence: string;
    window_start: Date;
    window_end: Date;
    evidence_event_ids: string[];
    created_at: Date;
  }>(
    `
      select id, zone_id, status, confidence, window_start, window_end, evidence_event_ids, created_at
      from candidate_events
      where candidate_key = $1
    `,
    [candidateKeyFor(evidenceEvent)]
  );

  const row = result.rows[0];
  if (!row) return null;
  return mapCandidateRow(row);
}

function storeMemoryCandidate(evidenceEvent: EvidenceEvent): CandidateEvent | null {
  const candidate = detectCandidateFromEvidence(evidenceEvent, {
    recentEvidence: listMemoryEvidence(evidenceEvent.zoneId)
  });
  if (!candidate) return null;

  const key = candidateKeyFor(evidenceEvent);
  candidatesByKey.set(key, candidate);
  return candidate;
}

function findMemoryCandidate(evidenceEvent: EvidenceEvent): CandidateEvent | null {
  return candidatesByKey.get(candidateKeyFor(evidenceEvent)) ?? null;
}

function candidateKeyFor(evidenceEvent: EvidenceEvent): string {
  return `${evidenceEvent.zoneId}:${evidenceEvent.status}:${evidenceEvent.idempotencyKey}`;
}

function bytes32From(value: string): string {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function mapEvidenceRow(row: {
  id: string;
  provider_id: string;
  zone_id: string;
  idempotency_key: string;
  source: "sensor" | "reporter";
  status: "grid_up" | "grid_down" | "unknown";
  voltage: string | null;
  confidence_hint: string | null;
  raw_payload: Record<string, unknown>;
  observed_at: Date;
  received_at: Date;
}): EvidenceEvent {
  return {
    id: row.id,
    providerId: row.provider_id,
    zoneId: row.zone_id,
    idempotencyKey: row.idempotency_key,
    source: row.source,
    status: row.status,
    voltage: row.voltage == null ? undefined : Number(row.voltage),
    currentAmps: currentAmpsFromRawPayload(row.raw_payload),
    confidenceHint: row.confidence_hint == null ? undefined : Number(row.confidence_hint),
    rawPayload: row.raw_payload,
    observedAt: row.observed_at.toISOString(),
    receivedAt: row.received_at.toISOString()
  };
}

function currentAmpsFromRawPayload(rawPayload: Record<string, unknown>): number | undefined {
  const value = rawPayload.currentAmps;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function mapCandidateRow(row: {
  id: string;
  zone_id: string;
  status: "outage" | "restored";
  confidence: string;
  window_start: Date;
  window_end: Date;
  evidence_event_ids: string[];
  created_at: Date;
}): CandidateEvent {
  return {
    id: row.id,
    zoneId: row.zone_id,
    status: row.status,
    confidence: Number(row.confidence),
    windowStart: row.window_start.toISOString(),
    windowEnd: row.window_end.toISOString(),
    evidenceEventIds: row.evidence_event_ids,
    createdAt: row.created_at.toISOString()
  };
}
