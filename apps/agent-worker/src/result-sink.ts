import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { AgentDecision, CandidateEvent, ChainCommitment, EpochScore } from "@gridproof/shared-types";
import type { OrchestrationInput, OrchestrationResult } from "./orchestrator.js";

let pool: Pool | null = null;
const EPOCH_DURATION_MS = 60 * 60 * 1000;

export type PersistResult =
  | {
      persisted: true;
      decision: AgentDecision;
      epochScore: EpochScore | null;
      commitment: ChainCommitment | null;
    }
  | {
      persisted: false;
      decision: AgentDecision;
      reason: string;
    };

export type QueryResultLike<T = unknown> = {
  rows?: T[];
  rowCount?: number | null;
};

export type QueryFn = <T = unknown>(text: string, values: unknown[]) => Promise<QueryResultLike<T>>;

export async function persistOrchestrationResult(
  input: OrchestrationInput,
  result: OrchestrationResult,
  queryFn?: QueryFn
): Promise<PersistResult> {
  const decision = agentDecisionFromResult(input, result);
  const execute = queryFn ?? defaultQuery;

  if (!queryFn && !process.env.DATABASE_URL) {
    return { persisted: false, decision, reason: "DATABASE_URL is not configured" };
  }

  await execute(
    `
      insert into agent_decisions (
        id, candidate_event_id, agent_name, confidence, decision, hypothesis,
        supporting_evidence_ids, notification_draft, reasoning_trace, created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9::jsonb, $10)
      on conflict (candidate_event_id, agent_name) do update
      set confidence = excluded.confidence,
          decision = excluded.decision,
          hypothesis = excluded.hypothesis,
          supporting_evidence_ids = excluded.supporting_evidence_ids,
          notification_draft = excluded.notification_draft,
          reasoning_trace = excluded.reasoning_trace
    `,
    [
      decision.id,
      decision.candidateEventId,
      decision.agentName,
      decision.confidence,
      decision.decision,
      decision.hypothesis,
      decision.supportingEvidenceIds,
      decision.notificationDraft ?? null,
      JSON.stringify(decision.reasoningTrace),
      decision.createdAt
    ]
  );
  await auditAgentDecision(input, decision, execute);

  if (decision.decision !== "approve") {
    return { persisted: true, decision, epochScore: null, commitment: null };
  }

  const { epochScore, commitment } = await queueApprovedDecisionForChain(input.candidate, execute);
  await auditChainQueued(epochScore, commitment, execute);

  return { persisted: true, decision, epochScore, commitment };
}

export async function closeResultSink(): Promise<void> {
  const current = pool;
  pool = null;
  await current?.end();
}

export function agentDecisionFromResult(input: OrchestrationInput, result: OrchestrationResult): AgentDecision {
  const now = new Date().toISOString();
  const candidate = input.candidate;

  if (result.outcome === "agent_decision") {
    const supportingEvidenceIds =
      result.analysis.supportingEvidenceIds.length > 0 ? result.analysis.supportingEvidenceIds : candidate.evidenceEventIds;
    return {
      id: randomUUID(),
      candidateEventId: candidate.id,
      agentName: "ai-evidence-verification-agent",
      confidence: result.decision.finalConfidence,
      decision: result.decision.decision,
      hypothesis: result.analysis.hypothesis,
      supportingEvidenceIds,
      notificationDraft: result.decision.notificationDraft,
      reasoningTrace: {
        source: "agent-worker",
        analysis: result.analysis,
        verification: result.decision,
        candidateStatus: candidate.status
      },
      createdAt: now
    };
  }

  return {
    id: randomUUID(),
    candidateEventId: candidate.id,
    agentName: "ai-evidence-verification-agent",
    confidence: candidate.confidence,
    decision: "escalate",
    hypothesis: `Agent worker escalated candidate: ${result.reason}`,
    supportingEvidenceIds: candidate.evidenceEventIds,
    notificationDraft: result.reason,
    reasoningTrace: {
      source: "agent-worker",
      failureMode: "escalate",
      reason: result.reason,
      candidateStatus: candidate.status
    },
    createdAt: now
  };
}

async function defaultQuery<T = unknown>(text: string, values: unknown[]): Promise<QueryResultLike<T>> {
  const current = getPool();
  return current.query(text, values) as unknown as Promise<QueryResultLike<T>>;
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL
  });
  return pool;
}

async function queueApprovedDecisionForChain(
  candidate: CandidateEvent,
  execute: QueryFn
): Promise<{ epochScore: EpochScore; commitment: ChainCommitment }> {
  const epochStart = floorToEpoch(candidate.windowEnd);
  const epochEnd = new Date(new Date(epochStart).getTime() + EPOCH_DURATION_MS).toISOString();
  const approved = await execute<ApprovedCandidateRow>(
    `
      select c.id, c.zone_id, c.status, c.confidence, c.evidence_event_ids
      from candidate_events c
      join agent_decisions d on d.candidate_event_id = c.id
      where c.zone_id = $1
        and c.window_end >= $2
        and c.window_end < $3
        and d.decision = 'approve'
      order by c.window_end asc, c.id asc
    `,
    [candidate.zoneId, epochStart, epochEnd]
  );
  const approvedCandidates = (approved.rows ?? []).map((row) => ({
    id: row.id,
    zoneId: row.zone_id,
    status: row.status,
    confidence: Number(row.confidence),
    evidenceEventIds: row.evidence_event_ids
  }));
  const fallbackCandidates = approvedCandidates.length > 0
    ? approvedCandidates
    : [{
        id: candidate.id,
        zoneId: candidate.zoneId,
        status: candidate.status,
        confidence: candidate.confidence,
        evidenceEventIds: candidate.evidenceEventIds
      }];
  const epochScore = epochScoreForApprovedCandidates(candidate.zoneId, epochStart, fallbackCandidates);
  const storedEpochScore = await upsertEpochScore(epochScore, execute);
  const commitment = await upsertPendingCommitment(pendingCommitmentForEpochScore(storedEpochScore), execute);

  return { epochScore: storedEpochScore, commitment };
}

async function upsertEpochScore(epochScore: EpochScore, execute: QueryFn): Promise<EpochScore> {
  const result = await execute<EpochScoreRow>(
    `
      insert into epoch_scores (id, zone_id, epoch_start, uptime_bps, evidence_hash, created_at)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (zone_id, epoch_start) do update
      set uptime_bps = excluded.uptime_bps,
          evidence_hash = excluded.evidence_hash
      returning id, zone_id, epoch_start, uptime_bps, evidence_hash, created_at
    `,
    [
      epochScore.id,
      epochScore.zoneId,
      epochScore.epochStart,
      epochScore.uptimeBps,
      epochScore.evidenceHash,
      epochScore.createdAt
    ]
  );
  const row = result.rows?.[0];
  if (!row) return epochScore;

  return {
    id: row.id,
    zoneId: row.zone_id,
    epochStart: dateToIso(row.epoch_start),
    uptimeBps: row.uptime_bps,
    evidenceHash: row.evidence_hash,
    createdAt: dateToIso(row.created_at)
  };
}

async function upsertPendingCommitment(commitment: ChainCommitment, execute: QueryFn): Promise<ChainCommitment> {
  const result = await execute<ChainCommitmentRow>(
    `
      insert into chain_commitments (id, epoch_score_id, tx_hash, block_number, status, explorer_url, created_at, confirmed_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (epoch_score_id) do update
      set status = excluded.status
      returning id, epoch_score_id, tx_hash, block_number, status, explorer_url, created_at, confirmed_at
    `,
    [
      commitment.id,
      commitment.epochScoreId,
      commitment.txHash,
      commitment.blockNumber,
      commitment.status,
      commitment.explorerUrl,
      commitment.createdAt,
      commitment.confirmedAt
    ]
  );
  const row = result.rows?.[0];
  if (!row) return commitment;

  return {
    id: row.id,
    epochScoreId: row.epoch_score_id,
    txHash: row.tx_hash,
    blockNumber: row.block_number,
    status: row.status,
    explorerUrl: row.explorer_url,
    createdAt: dateToIso(row.created_at),
    confirmedAt: row.confirmed_at ? dateToIso(row.confirmed_at) : null
  };
}

async function auditAgentDecision(input: OrchestrationInput, decision: AgentDecision, execute: QueryFn): Promise<void> {
  await execute(
    `
      insert into audit_logs (id, actor_user_id, subject_provider_id, action, before, after, created_at)
      values ($1, null, null, $2, null, $3::jsonb, $4)
    `,
    [
      randomUUID(),
      "agent_decision.created",
      JSON.stringify({
        decision,
        candidate: {
          id: input.candidate.id,
          zoneId: input.candidate.zoneId,
          status: input.candidate.status,
          confidence: input.candidate.confidence
        },
        evidenceEventIds: input.evidence.map((event) => event.id)
      }),
      new Date().toISOString()
    ]
  );
}

async function auditChainQueued(epochScore: EpochScore, commitment: ChainCommitment, execute: QueryFn): Promise<void> {
  await execute(
    `
      insert into audit_logs (id, actor_user_id, subject_provider_id, action, before, after, created_at)
      values ($1, null, null, $2, null, $3::jsonb, $4)
    `,
    [
      randomUUID(),
      "chain_commitment.queued",
      JSON.stringify({
        source: "ai_worker_approval",
        epochScore,
        commitment
      }),
      new Date().toISOString()
    ]
  );
}

function epochScoreForApprovedCandidates(
  zoneId: string,
  epochStart: string,
  approvedCandidates: Array<Pick<CandidateEvent, "id" | "zoneId" | "status" | "confidence" | "evidenceEventIds">>
): EpochScore {
  const upVotes = approvedCandidates.filter((item) => item.status === "restored").length;
  const totalVotes = approvedCandidates.length;
  const uptimeBps = totalVotes === 0 ? 0 : Math.round((upVotes / totalVotes) * 10_000);
  const evidenceHash = `0x${createHash("sha256").update(JSON.stringify({
    zoneId,
    epochStart,
    approvedCandidates: approvedCandidates.map((item) => ({
      id: item.id,
      status: item.status,
      confidence: item.confidence,
      evidenceEventIds: item.evidenceEventIds
    }))
  })).digest("hex")}`;

  return {
    id: stableUuid(`epoch:${zoneId}:${epochStart}`),
    zoneId,
    epochStart,
    uptimeBps,
    evidenceHash,
    createdAt: new Date().toISOString()
  };
}

function pendingCommitmentForEpochScore(epochScore: EpochScore): ChainCommitment {
  return {
    id: stableUuid(`commitment:${epochScore.id}`),
    epochScoreId: epochScore.id,
    txHash: null,
    blockNumber: null,
    status: "pending",
    explorerUrl: null,
    createdAt: new Date().toISOString(),
    confirmedAt: null
  };
}

function floorToEpoch(isoDate: string): string {
  const timestamp = new Date(isoDate).getTime();
  return new Date(Math.floor(timestamp / EPOCH_DURATION_MS) * EPOCH_DURATION_MS).toISOString();
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function dateToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

type ApprovedCandidateRow = {
  id: string;
  zone_id: string;
  status: "outage" | "restored";
  confidence: string | number;
  evidence_event_ids: string[];
};

type EpochScoreRow = {
  id: string;
  zone_id: string;
  epoch_start: Date | string;
  uptime_bps: number;
  evidence_hash: string;
  created_at: Date | string;
};

type ChainCommitmentRow = {
  id: string;
  epoch_score_id: string;
  tx_hash: string | null;
  block_number: number | null;
  status: "pending" | "confirmed" | "failed";
  explorer_url: string | null;
  created_at: Date | string;
  confirmed_at: Date | string | null;
};
