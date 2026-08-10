import type { CandidateEvent, ChainCommitment, EpochScore, ProofResponse, ZonesResponse, ZoneHistoryResponse } from "@gridproof/shared-types";
import { isDatabaseConfigured, query } from "../../lib/db.js";
import { computeZoneHealthTrend } from "../detection/trend.js";
import { listMemoryCandidates } from "../ingestion/store.js";
import { listMemoryCommitments, listMemoryEpochScores } from "../pipeline/service.js";
import { demoCandidate, demoCommitment, demoEpochScore, demoZone, demoZones } from "./demo-data.js";

export async function listZones(): Promise<ZonesResponse["zones"]> {
  if (!isDatabaseConfigured()) return demoZones;

  const result = await query<{
    id: string;
    zone_key: string;
    name: string;
    discos_feeder_code: string;
    region: string;
    centroid_lat: string;
    centroid_lng: string;
    latest_status: "grid_up" | "grid_down" | "unknown" | null;
    latest_uptime_bps: number | null;
  }>(`
    select z.id, z.zone_key, z.name, z.discos_feeder_code, z.region,
           z.centroid_lat, z.centroid_lng,
           latest.status as latest_status,
           latest_score.uptime_bps as latest_uptime_bps
    from zones z
    left join lateral (
      select status
      from evidence_events
      where zone_id = z.id
      order by observed_at desc
      limit 1
    ) latest on true
    left join lateral (
      select uptime_bps
      from epoch_scores
      where zone_id = z.id
      order by epoch_start desc
      limit 1
    ) latest_score on true
    order by z.name asc
  `);

  return result.rows.map((row) => ({
    id: row.id,
    zoneKey: row.zone_key,
    name: row.name,
    discosFeederCode: row.discos_feeder_code,
    region: row.region,
    centroid: {
      lat: Number(row.centroid_lat),
      lng: Number(row.centroid_lng)
    },
    latestStatus: row.latest_status ?? "unknown",
    latestUptimeBps: row.latest_uptime_bps
  }));
}

export async function getZoneHistory(zoneId: string): Promise<ZoneHistoryResponse> {
  if (!isDatabaseConfigured()) {
    const epochScores = [...listMemoryEpochScores(zoneId), ...(demoEpochScore.zoneId === zoneId ? [demoEpochScore] : [])];
    return {
      zone: demoZone.id === zoneId ? demoZone : demoZone,
      candidates: [...listMemoryCandidates(zoneId), demoCandidate].filter((candidate) => candidate.zoneId === zoneId),
      epochScores,
      trend: computeZoneHealthTrend(epochScores)
    };
  }

  const zoneResult = await query<{
    id: string;
    zone_key: string;
    name: string;
    discos_feeder_code: string;
    region: string;
    centroid_lat: string;
    centroid_lng: string;
  }>(
    `
      select id, zone_key, name, discos_feeder_code, region, centroid_lat, centroid_lng
      from zones
      where id = $1
    `,
    [zoneId]
  );

  const zone = zoneResult.rows[0];
  if (!zone) {
    throw Object.assign(new Error("Zone not found"), {
      statusCode: 404,
      code: "ZONE_NOT_FOUND"
    });
  }

  const candidateRows = await query<{
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
      where zone_id = $1
      order by window_start desc
      limit 50
    `,
    [zoneId]
  );

  const epochRows = await query<{
    id: string;
    zone_id: string;
    epoch_start: Date;
    uptime_bps: number;
    evidence_hash: string;
    created_at: Date;
  }>(
    `
      select id, zone_id, epoch_start, uptime_bps, evidence_hash, created_at
      from epoch_scores
      where zone_id = $1
      order by epoch_start desc
      limit 50
    `,
    [zoneId]
  );

  const epochScores = epochRows.rows.map(mapEpochScore);

  return {
    zone: {
      id: zone.id,
      zoneKey: zone.zone_key,
      name: zone.name,
      discosFeederCode: zone.discos_feeder_code,
      region: zone.region,
      centroid: {
        lat: Number(zone.centroid_lat),
        lng: Number(zone.centroid_lng)
      }
    },
    candidates: candidateRows.rows.map(mapCandidate),
    epochScores,
    trend: computeZoneHealthTrend(epochScores)
  };
}

export async function getProof(zoneId: string, epoch: string): Promise<ProofResponse> {
  if (!isDatabaseConfigured()) {
    const memoryScores = listMemoryEpochScores(zoneId).sort((left, right) => right.epochStart.localeCompare(left.epochStart));
    const demoScore =
      zoneId === demoEpochScore.zoneId && (epoch === "latest" || epoch === demoEpochScore.epochStart) ? demoEpochScore : null;
    const epochScore = epoch === "latest"
      ? memoryScores[0] ?? demoScore
      : memoryScores.find((score) => score.epochStart === epoch) ?? demoScore;
    if (!epochScore) return { epochScore: null, commitment: null };

    const commitment =
      listMemoryCommitments().find((item) => item.epochScoreId === epochScore.id) ??
      (epochScore.id === demoEpochScore.id ? demoCommitment : null);
    return { epochScore, commitment };
  }

  const values = epoch === "latest" ? [zoneId] : [zoneId, epoch];
  const where = epoch === "latest" ? "where es.zone_id = $1" : "where es.zone_id = $1 and es.epoch_start = $2";
  const result = await query<{
    epoch_id: string;
    zone_id: string;
    epoch_start: Date;
    uptime_bps: number;
    evidence_hash: string;
    epoch_created_at: Date;
    commitment_id: string | null;
    tx_hash: string | null;
    block_number: number | null;
    status: "pending" | "confirmed" | "failed" | null;
    explorer_url: string | null;
    commitment_created_at: Date | null;
    confirmed_at: Date | null;
  }>(
    `
      select es.id as epoch_id, es.zone_id, es.epoch_start, es.uptime_bps, es.evidence_hash,
             es.created_at as epoch_created_at,
             cc.id as commitment_id, cc.tx_hash, cc.block_number, cc.status, cc.explorer_url,
             cc.created_at as commitment_created_at, cc.confirmed_at
      from epoch_scores es
      left join chain_commitments cc on cc.epoch_score_id = es.id
      ${where}
      order by es.epoch_start desc
      limit 1
    `,
    values
  );

  const row = result.rows[0];
  if (!row) return { epochScore: null, commitment: null };

  const epochScore: EpochScore = {
    id: row.epoch_id,
    zoneId: row.zone_id,
    epochStart: row.epoch_start.toISOString(),
    uptimeBps: row.uptime_bps,
    evidenceHash: row.evidence_hash,
    createdAt: row.epoch_created_at.toISOString()
  };

  const commitment: ChainCommitment | null = row.commitment_id && row.status && row.commitment_created_at
    ? {
        id: row.commitment_id,
        epochScoreId: row.epoch_id,
        txHash: row.tx_hash,
        blockNumber: row.block_number,
        status: row.status,
        explorerUrl: row.explorer_url,
        createdAt: row.commitment_created_at.toISOString(),
        confirmedAt: row.confirmed_at?.toISOString() ?? null
      }
    : null;

  return { epochScore, commitment };
}

function mapCandidate(row: {
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

function mapEpochScore(row: {
  id: string;
  zone_id: string;
  epoch_start: Date;
  uptime_bps: number;
  evidence_hash: string;
  created_at: Date;
}): EpochScore {
  return {
    id: row.id,
    zoneId: row.zone_id,
    epochStart: row.epoch_start.toISOString(),
    uptimeBps: row.uptime_bps,
    evidenceHash: row.evidence_hash,
    createdAt: row.created_at.toISOString()
  };
}
