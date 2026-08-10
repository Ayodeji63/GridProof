import { z } from "zod";
import {
  evidenceEventSchema,
  isoDateTimeSchema,
  providerSchema,
  uuidSchema,
  type CandidateEvent,
  type EvidenceEvent,
  type Provider
} from "@gridproof/shared-types";

export type AgentToolQueryResult<T = unknown> = {
  rows?: T[];
};

export type AgentToolQuery = <T = unknown>(
  text: string,
  values?: readonly unknown[]
) => Promise<AgentToolQueryResult<T>>;

const rangeSchema = z.object({
  start: isoDateTimeSchema,
  end: isoDateTimeSchema
});

export const telemetryWindowInputSchema = z.object({
  zoneId: uuidSchema,
  range: rangeSchema,
  limit: z.number().int().positive().max(500).default(200)
});
export type TelemetryWindowInput = z.input<typeof telemetryWindowInputSchema>;

export const telemetryWindowOutputSchema = z.object({
  zoneId: uuidSchema,
  range: rangeSchema,
  events: z.array(evidenceEventSchema)
});
export type TelemetryWindowOutput = z.infer<typeof telemetryWindowOutputSchema>;

export const historicalBaselineInputSchema = z.object({
  zoneId: uuidSchema,
  asOf: isoDateTimeSchema,
  windowDays: z.number().int().positive().max(90).default(7)
});
export type HistoricalBaselineInput = z.input<typeof historicalBaselineInputSchema>;

export const historicalBaselineOutputSchema = z.object({
  zoneId: uuidSchema,
  sampleSize: z.number().int().nonnegative(),
  statusCounts: z.object({
    gridUp: z.number().int().nonnegative(),
    gridDown: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative()
  }),
  averageVoltage: z.number().nonnegative().nullable(),
  firstObservedAt: isoDateTimeSchema.nullable(),
  lastObservedAt: isoDateTimeSchema.nullable()
});
export type HistoricalBaselineOutput = z.infer<typeof historicalBaselineOutputSchema>;

export const providerMetadataInputSchema = z.object({
  providerId: uuidSchema,
  asOf: isoDateTimeSchema,
  windowDays: z.number().int().positive().max(90).default(7)
});
export type ProviderMetadataInput = z.input<typeof providerMetadataInputSchema>;

export const providerMetadataOutputSchema = z.object({
  provider: providerSchema,
  recentEvidenceCount: z.number().int().nonnegative(),
  lastEvidenceAt: isoDateTimeSchema.nullable(),
  latestStatus: evidenceEventSchema.shape.status.nullable()
});
export type ProviderMetadataOutput = z.infer<typeof providerMetadataOutputSchema>;

export const conflictingReportsInputSchema = z.object({
  zoneId: uuidSchema,
  range: rangeSchema
});
export type ConflictingReportsInput = z.infer<typeof conflictingReportsInputSchema>;

export const reportConflictGroupSchema = z.object({
  status: evidenceEventSchema.shape.status,
  count: z.number().int().nonnegative(),
  evidenceEventIds: z.array(uuidSchema)
});

export const conflictingReportsOutputSchema = z.object({
  zoneId: uuidSchema,
  range: rangeSchema,
  hasConflict: z.boolean(),
  reports: z.array(evidenceEventSchema),
  statusGroups: z.array(reportConflictGroupSchema)
});
export type ConflictingReportsOutput = z.infer<typeof conflictingReportsOutputSchema>;

export const agentToolContextSchema = z.object({
  telemetryWindow: telemetryWindowOutputSchema,
  historicalBaseline: historicalBaselineOutputSchema,
  conflictingReports: conflictingReportsOutputSchema,
  providerMetadata: z.array(providerMetadataOutputSchema)
});
export type AgentToolContext = z.infer<typeof agentToolContextSchema>;

export async function getTelemetryWindow(
  query: AgentToolQuery,
  input: TelemetryWindowInput
): Promise<TelemetryWindowOutput> {
  const parsed = telemetryWindowInputSchema.parse(input);
  const result = await query<EvidenceEventRow>(
    `
      select id, provider_id, zone_id, idempotency_key, source, status, voltage,
             confidence_hint, raw_payload, observed_at, received_at
      from evidence_events
      where zone_id = $1
        and observed_at >= $2
        and observed_at <= $3
      order by observed_at asc, received_at asc, id asc
      limit $4
    `,
    [parsed.zoneId, parsed.range.start, parsed.range.end, parsed.limit]
  );

  return telemetryWindowOutputSchema.parse({
    zoneId: parsed.zoneId,
    range: parsed.range,
    events: (result.rows ?? []).map(mapEvidenceRow)
  });
}

export async function getHistoricalBaseline(
  query: AgentToolQuery,
  input: HistoricalBaselineInput
): Promise<HistoricalBaselineOutput> {
  const parsed = historicalBaselineInputSchema.parse(input);
  const result = await query<HistoricalBaselineRow>(
    `
      select
        count(*)::int as sample_size,
        count(*) filter (where status = 'grid_up')::int as grid_up_count,
        count(*) filter (where status = 'grid_down')::int as grid_down_count,
        count(*) filter (where status = 'unknown')::int as unknown_count,
        avg(voltage) as average_voltage,
        min(observed_at) as first_observed_at,
        max(observed_at) as last_observed_at
      from evidence_events
      where zone_id = $1
        and observed_at >= ($2::timestamptz - ($3::text || ' days')::interval)
        and observed_at < $2::timestamptz
    `,
    [parsed.zoneId, parsed.asOf, parsed.windowDays]
  );
  const row = result.rows?.[0];

  return historicalBaselineOutputSchema.parse({
    zoneId: parsed.zoneId,
    sampleSize: toNumber(row?.sample_size ?? 0),
    statusCounts: {
      gridUp: toNumber(row?.grid_up_count ?? 0),
      gridDown: toNumber(row?.grid_down_count ?? 0),
      unknown: toNumber(row?.unknown_count ?? 0)
    },
    averageVoltage: row?.average_voltage == null ? null : toNumber(row.average_voltage),
    firstObservedAt: row?.first_observed_at == null ? null : toIso(row.first_observed_at),
    lastObservedAt: row?.last_observed_at == null ? null : toIso(row.last_observed_at)
  });
}

export async function getProviderMetadata(
  query: AgentToolQuery,
  input: ProviderMetadataInput
): Promise<ProviderMetadataOutput> {
  const parsed = providerMetadataInputSchema.parse(input);
  const result = await query<ProviderMetadataRow>(
    `
      select
        p.id,
        p.user_id,
        p.wallet_address,
        p.provider_type,
        p.zone_id,
        p.reputation_cache,
        p.active,
        stats.recent_evidence_count,
        stats.last_evidence_at,
        stats.latest_status
      from providers p
      left join lateral (
        select
          count(*)::int as recent_evidence_count,
          max(observed_at) as last_evidence_at,
          (array_agg(status order by observed_at desc, received_at desc))[1] as latest_status
        from evidence_events e
        where e.provider_id = p.id
          and e.observed_at >= ($2::timestamptz - ($3::text || ' days')::interval)
          and e.observed_at <= $2::timestamptz
      ) stats on true
      where p.id = $1
    `,
    [parsed.providerId, parsed.asOf, parsed.windowDays]
  );
  const row = result.rows?.[0];
  if (!row) {
    throw new Error(`Provider metadata not found for ${parsed.providerId}`);
  }

  return providerMetadataOutputSchema.parse({
    provider: {
      id: row.id,
      userId: row.user_id ?? null,
      walletAddress: row.wallet_address,
      providerType: row.provider_type,
      zoneId: row.zone_id,
      reputationCache: toNumber(row.reputation_cache),
      active: row.active,
      lastSeenAt: row.last_evidence_at == null ? null : toIso(row.last_evidence_at)
    },
    recentEvidenceCount: toNumber(row.recent_evidence_count ?? 0),
    lastEvidenceAt: row.last_evidence_at == null ? null : toIso(row.last_evidence_at),
    latestStatus: row.latest_status ?? null
  });
}

export async function getConflictingReports(
  query: AgentToolQuery,
  input: ConflictingReportsInput
): Promise<ConflictingReportsOutput> {
  const parsed = conflictingReportsInputSchema.parse(input);
  const result = await query<EvidenceEventRow>(
    `
      select id, provider_id, zone_id, idempotency_key, source, status, voltage,
             confidence_hint, raw_payload, observed_at, received_at
      from evidence_events
      where zone_id = $1
        and source = 'reporter'
        and observed_at >= $2
        and observed_at <= $3
      order by observed_at asc, received_at asc, id asc
    `,
    [parsed.zoneId, parsed.range.start, parsed.range.end]
  );
  const reports = (result.rows ?? []).map(mapEvidenceRow);
  const statusGroups = groupReportsByStatus(reports);

  return conflictingReportsOutputSchema.parse({
    zoneId: parsed.zoneId,
    range: parsed.range,
    hasConflict: statusGroups.filter((group) => group.count > 0 && group.status !== "unknown").length > 1,
    reports,
    statusGroups
  });
}

export async function collectAgentToolContext(
  query: AgentToolQuery,
  candidate: CandidateEvent,
  providers: Provider[] = []
): Promise<AgentToolContext> {
  const range = {
    start: candidate.windowStart,
    end: candidate.windowEnd
  };
  const [telemetryWindow, historicalBaseline, conflictingReports] = await Promise.all([
    getTelemetryWindow(query, { zoneId: candidate.zoneId, range }),
    getHistoricalBaseline(query, { zoneId: candidate.zoneId, asOf: candidate.windowEnd }),
    getConflictingReports(query, { zoneId: candidate.zoneId, range })
  ]);
  const providerIds = unique([
    ...providers.map((provider) => provider.id),
    ...telemetryWindow.events.map((event) => event.providerId),
    ...conflictingReports.reports.map((event) => event.providerId)
  ]);
  const providerMetadata = await Promise.all(
    providerIds.map((providerId) =>
      getProviderMetadata(query, {
        providerId,
        asOf: candidate.windowEnd
      })
    )
  );

  return agentToolContextSchema.parse({
    telemetryWindow,
    historicalBaseline,
    conflictingReports,
    providerMetadata
  });
}

function groupReportsByStatus(reports: EvidenceEvent[]): ConflictingReportsOutput["statusGroups"] {
  const groups = new Map<EvidenceEvent["status"], string[]>();
  for (const report of reports) {
    const current = groups.get(report.status) ?? [];
    current.push(report.id);
    groups.set(report.status, current);
  }

  return Array.from(groups.entries()).map(([status, evidenceEventIds]) => ({
    status,
    count: evidenceEventIds.length,
    evidenceEventIds
  }));
}

function mapEvidenceRow(row: EvidenceEventRow): EvidenceEvent {
  return evidenceEventSchema.parse({
    id: row.id,
    providerId: row.provider_id,
    zoneId: row.zone_id,
    idempotencyKey: row.idempotency_key,
    source: row.source,
    status: row.status,
    voltage: row.voltage == null ? null : toNumber(row.voltage),
    confidenceHint: row.confidence_hint == null ? null : toNumber(row.confidence_hint),
    rawPayload: row.raw_payload,
    observedAt: toIso(row.observed_at),
    receivedAt: toIso(row.received_at)
  });
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

type EvidenceEventRow = {
  id: string;
  provider_id: string;
  zone_id: string;
  idempotency_key: string;
  source: "sensor" | "reporter";
  status: "grid_up" | "grid_down" | "unknown";
  voltage: string | number | null;
  confidence_hint: string | number | null;
  raw_payload: Record<string, unknown>;
  observed_at: string | Date;
  received_at: string | Date;
};

type HistoricalBaselineRow = {
  sample_size: string | number;
  grid_up_count: string | number;
  grid_down_count: string | number;
  unknown_count: string | number;
  average_voltage: string | number | null;
  first_observed_at: string | Date | null;
  last_observed_at: string | Date | null;
};

type ProviderMetadataRow = {
  id: string;
  user_id: string | null;
  wallet_address: string;
  provider_type: "sensor" | "reporter";
  zone_id: string;
  reputation_cache: string | number;
  active: boolean;
  recent_evidence_count: string | number | null;
  last_evidence_at: string | Date | null;
  latest_status: "grid_up" | "grid_down" | "unknown" | null;
};
