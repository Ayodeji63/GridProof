import { createHash, randomUUID } from "node:crypto";
import type { AgentDecision, AlertItem, CandidateEvent, ChainCommitment, EpochScore, EvidenceEvent, User } from "@gridproof/shared-types";
import { blockNumberFromDatabase } from "../../lib/db-values.js";
import { domainEvents } from "../../lib/events.js";
import { counters } from "../../lib/metrics.js";
import { isDatabaseConfigured, query } from "../../lib/db.js";
import { appendAuditLog, listMemoryAuditLogs } from "../audit/service.js";
import { enqueueAgentReviewJob } from "../jobs/queue.js";

const AUTO_APPROVE_THRESHOLD = 0.85;
const ESCALATE_THRESHOLD = 0.5;
const EPOCH_DURATION_MS = 60 * 60 * 1000;

const memoryDecisions = new Map<string, AgentDecision>();
const memoryCandidatesById = new Map<string, CandidateEvent>();
const memoryEpochScoresByKey = new Map<string, EpochScore>();
const memoryCommitmentsByEpochScore = new Map<string, ChainCommitment>();

export type PipelineResult = {
  decision: AgentDecision;
  epochScore: EpochScore | null;
  commitment: ChainCommitment | null;
};

export type PipelineOptions = {
  simulation?: {
    runId: string;
    initiatedBy: string;
    allowChainWrite: boolean;
  };
};

export async function processCandidatePipeline(
  candidate: CandidateEvent,
  evidence?: EvidenceEvent,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const decision = decisionForCandidate(candidate);

  if (isDatabaseConfigured()) {
    const storedDecision = await upsertDatabaseDecision(decision);
    await auditAgentDecision(storedDecision, candidate, evidence);
    counters.agentDecisions += 1;

    if (storedDecision.decision === "approve") {
      if (options.simulation && !options.simulation.allowChainWrite) {
        await auditSimulationProofPreview(candidate, storedDecision, options.simulation);
        return { decision: storedDecision, epochScore: null, commitment: null };
      }
      const epochScore = await recomputeDatabaseEpochScore(candidate);
      const commitment = await upsertDatabasePendingCommitment(epochScore);
      await auditChainQueued(epochScore, commitment, "agent_auto_approval");
      counters.chainSubmissions += 1;
      domainEvents.emit("chain.committed", { zoneId: candidate.zoneId, txHash: commitment.txHash ?? "", status: commitment.status });
      return { decision: storedDecision, epochScore, commitment };
    }

    if (storedDecision.decision === "escalate") {
      await queueAgentReview(candidate, evidence, options.simulation);
      domainEvents.emit("review.required", {
        candidateEventId: candidate.id,
        reason: storedDecision.hypothesis
      });
    }

    return { decision: storedDecision, epochScore: null, commitment: null };
  }

  memoryDecisions.set(candidate.id, decision);
  memoryCandidatesById.set(candidate.id, candidate);
  await auditAgentDecision(decision, candidate, evidence);
  counters.agentDecisions += 1;

  if (decision.decision === "approve") {
    if (options.simulation && !options.simulation.allowChainWrite) {
      await auditSimulationProofPreview(candidate, decision, options.simulation);
      return { decision, epochScore: null, commitment: null };
    }
    const epochScore = recomputeMemoryEpochScore(candidate);
    const commitment = pendingCommitmentForEpochScore(epochScore);
    memoryEpochScoresByKey.set(epochKey(epochScore.zoneId, epochScore.epochStart), epochScore);
    memoryCommitmentsByEpochScore.set(epochScore.id, commitment);
    await auditChainQueued(epochScore, commitment, "agent_auto_approval");
    counters.chainSubmissions += 1;
    domainEvents.emit("chain.committed", { zoneId: candidate.zoneId, txHash: commitment.txHash ?? "", status: commitment.status });
    return { decision, epochScore, commitment };
  }

  if (decision.decision === "escalate") {
    await queueAgentReview(candidate, evidence, options.simulation);
    domainEvents.emit("review.required", {
      candidateEventId: candidate.id,
      reason: decision.hypothesis
    });
  }

  return { decision, epochScore: null, commitment: null };
}

export async function listReviewItems(): Promise<Array<AgentDecision & { candidate: CandidateEvent }>> {
  if (!isDatabaseConfigured()) {
    const candidates = await import("../ingestion/store.js").then((module) => module.listMemoryCandidates());
    return candidates
      .map((candidate) => {
        const decision = memoryDecisions.get(candidate.id);
        return decision?.decision === "escalate" ? { ...decision, candidate } : null;
      })
      .filter((item): item is AgentDecision & { candidate: CandidateEvent } => item !== null);
  }

  const result = await query<DecisionWithCandidateRow>(
    `
      select d.id as decision_id, d.candidate_event_id, d.agent_name, d.confidence as decision_confidence,
             d.decision, d.hypothesis, d.supporting_evidence_ids, d.notification_draft,
             d.reasoning_trace, d.created_at as decision_created_at,
             c.id as candidate_id, c.zone_id, c.status, c.confidence as candidate_confidence,
             c.window_start, c.window_end, c.evidence_event_ids, c.created_at as candidate_created_at
      from agent_decisions d
      join candidate_events c on c.id = d.candidate_event_id
      where d.decision = 'escalate'
      order by d.created_at desc
    `
  );

  return result.rows.map(mapDecisionWithCandidateRow);
}

export async function listAlertItems(limit = 50): Promise<AlertItem[]> {
  if (!isDatabaseConfigured()) {
    return Array.from(memoryDecisions.values())
      .map((decision) => {
        const candidate = memoryCandidatesById.get(decision.candidateEventId);
        return candidate ? alertFromDecision(decision, candidate, memoryReviewForDecision(decision.id)) : null;
      })
      .filter((alert): alert is AlertItem => alert !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  const result = await query<DecisionWithCandidateRow>(
    `
      select d.id as decision_id, d.candidate_event_id, d.agent_name, d.confidence as decision_confidence,
             d.decision, d.hypothesis, d.supporting_evidence_ids, d.notification_draft,
             d.reasoning_trace, d.created_at as decision_created_at,
             c.id as candidate_id, c.zone_id, c.status, c.confidence as candidate_confidence,
             c.window_start, c.window_end, c.evidence_event_ids, c.created_at as candidate_created_at,
             review.initial_decision, review.review_note, review.reviewed_at
      from agent_decisions d
      join candidate_events c on c.id = d.candidate_event_id
      left join lateral (
        select al.before->'decision'->>'decision' as initial_decision,
               al.after->>'note' as review_note,
               al.created_at as reviewed_at
        from audit_logs al
        where al.action = 'review.decision_resolved'
          and al.after->'decision'->>'id' = d.id::text
        order by al.created_at desc
        limit 1
      ) review on true
      order by d.created_at desc
      limit $1
    `,
    [limit]
  );

  return result.rows.map((row) => {
    const item = mapDecisionWithCandidateRow(row);
    return alertFromDecision(item, item.candidate, reviewFromDecisionRow(row));
  });
}

export async function resolveReviewDecision(
  decisionId: string,
  reviewDecision: "approve" | "reject",
  note: string,
  reviewer?: Pick<User, "id" | "role" | "phoneOrEmail">
): Promise<PipelineResult> {
  const reviewedAt = new Date().toISOString();

  if (!isDatabaseConfigured()) {
    const current = Array.from(memoryDecisions.values()).find((decision) => decision.id === decisionId);
    if (!current) throw Object.assign(new Error("Review item not found"), { statusCode: 404, code: "REVIEW_NOT_FOUND" });

    const updated = {
      ...current,
      decision: reviewDecision,
      hypothesis: `${current.hypothesis} Reviewer note: ${note}`,
      reasoningTrace: {
        ...current.reasoningTrace,
        review: { initialDecision: current.decision, decision: reviewDecision, note, reviewedAt }
      }
    } satisfies AgentDecision;
    memoryDecisions.set(current.candidateEventId, updated);
    await auditReviewDecision(current, updated, note, reviewer);

    const candidate = await import("../ingestion/store.js").then((module) =>
      module.listMemoryCandidates().find((item) => item.id === current.candidateEventId)
    );
    if (!candidate) return { decision: updated, epochScore: null, commitment: null };
    memoryCandidatesById.set(candidate.id, candidate);

    if (reviewDecision === "approve") {
      const epochScore = recomputeMemoryEpochScore(candidate);
      const commitment = pendingCommitmentForEpochScore(epochScore);
      memoryEpochScoresByKey.set(epochKey(epochScore.zoneId, epochScore.epochStart), epochScore);
      memoryCommitmentsByEpochScore.set(epochScore.id, commitment);
      await auditChainQueued(epochScore, commitment, "review_approval");
      counters.chainSubmissions += 1;
      domainEvents.emit("chain.committed", { zoneId: candidate.zoneId, txHash: commitment.txHash ?? "", status: commitment.status });
      return { decision: updated, epochScore, commitment };
    }

    return { decision: updated, epochScore: null, commitment: null };
  }

  const beforeResult = await query<AgentDecisionRow>(
    `
      select id, candidate_event_id, agent_name, confidence, decision, hypothesis,
             supporting_evidence_ids, notification_draft, reasoning_trace, created_at
      from agent_decisions
      where id = $1
    `,
    [decisionId]
  );
  const beforeDecision = beforeResult.rows[0] ? mapDecisionRow(beforeResult.rows[0]) : null;
  if (!beforeDecision) {
    throw Object.assign(new Error("Review item not found"), { statusCode: 404, code: "REVIEW_NOT_FOUND" });
  }

  const updated = await query<AgentDecisionRow>(
    `
      update agent_decisions
      set decision = $2,
          hypothesis = hypothesis || ' Reviewer note: ' || $3,
          notification_draft = $3,
          reasoning_trace = reasoning_trace || $4::jsonb
      where id = $1
      returning id, candidate_event_id, agent_name, confidence, decision, hypothesis,
                supporting_evidence_ids, notification_draft, reasoning_trace, created_at
    `,
    [
      decisionId,
      reviewDecision,
      note,
      JSON.stringify({
        review: { initialDecision: beforeDecision.decision, decision: reviewDecision, note, reviewedAt }
      })
    ]
  );

  const decision = updated.rows[0];
  if (!decision) throw Object.assign(new Error("Review item not found"), { statusCode: 404, code: "REVIEW_NOT_FOUND" });

  const mappedDecision = mapDecisionRow(decision);
  await auditReviewDecision(beforeDecision, mappedDecision, note, reviewer);
  if (mappedDecision.decision !== "approve") {
    return { decision: mappedDecision, epochScore: null, commitment: null };
  }

  const candidate = await findDatabaseCandidate(mappedDecision.candidateEventId);
  const epochScore = await recomputeDatabaseEpochScore(candidate);
  const commitment = await upsertDatabasePendingCommitment(epochScore);
  await auditChainQueued(epochScore, commitment, "review_approval");
  counters.chainSubmissions += 1;
  domainEvents.emit("chain.committed", { zoneId: candidate.zoneId, txHash: commitment.txHash ?? "", status: commitment.status });
  return { decision: mappedDecision, epochScore, commitment };
}

export function listMemoryEpochScores(zoneId?: string): EpochScore[] {
  return Array.from(memoryEpochScoresByKey.values()).filter((score) => !zoneId || score.zoneId === zoneId);
}

export function listMemoryCommitments(): ChainCommitment[] {
  return Array.from(memoryCommitmentsByEpochScore.values());
}

export function clearPipelineStore(): void {
  memoryDecisions.clear();
  memoryCandidatesById.clear();
  memoryEpochScoresByKey.clear();
  memoryCommitmentsByEpochScore.clear();
}

async function upsertDatabaseDecision(decision: AgentDecision): Promise<AgentDecision> {
  const result = await query<AgentDecisionRow>(
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
      returning id, candidate_event_id, agent_name, confidence, decision, hypothesis,
                supporting_evidence_ids, notification_draft, reasoning_trace, created_at
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

  const row = result.rows[0];
  if (!row) throw new Error("Failed to store agent decision");
  return mapDecisionRow(row);
}

async function recomputeDatabaseEpochScore(candidate: CandidateEvent): Promise<EpochScore> {
  const epochStart = floorToEpoch(candidate.windowEnd);
  const epochEnd = new Date(new Date(epochStart).getTime() + EPOCH_DURATION_MS).toISOString();
  const approved = await query<{
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
      select c.id, c.zone_id, c.status, c.confidence, c.window_start,
             c.window_end, c.evidence_event_ids, c.created_at
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

  const approvedCandidates = approved.rows.map((row) => ({
    id: row.id,
    zoneId: row.zone_id,
    status: row.status,
    confidence: Number(row.confidence),
    windowStart: row.window_start.toISOString(),
    windowEnd: row.window_end.toISOString(),
    evidenceEventIds: row.evidence_event_ids,
    createdAt: row.created_at.toISOString()
  }));
  const epochScore = epochScoreForApprovedCandidates(candidate.zoneId, epochStart, approvedCandidates);
  const result = await query<{
    id: string;
    zone_id: string;
    epoch_start: Date;
    uptime_bps: number;
    evidence_hash: string;
    created_at: Date;
  }>(
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

  const row = result.rows[0];
  if (!row) throw new Error("Failed to store epoch score");
  return {
    id: row.id,
    zoneId: row.zone_id,
    epochStart: row.epoch_start.toISOString(),
    uptimeBps: row.uptime_bps,
    evidenceHash: row.evidence_hash,
    createdAt: row.created_at.toISOString()
  };
}

async function upsertDatabasePendingCommitment(epochScore: EpochScore): Promise<ChainCommitment> {
  const commitment = pendingCommitmentForEpochScore(epochScore);
  const result = await query<{
    id: string;
    epoch_score_id: string;
    tx_hash: string | null;
    block_number: string | null;
    status: "pending" | "confirmed" | "failed";
    explorer_url: string | null;
    created_at: Date;
    confirmed_at: Date | null;
  }>(
    `
      insert into chain_commitments (id, epoch_score_id, tx_hash, block_number, status, explorer_url, created_at, confirmed_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (epoch_score_id) do update
      set status = excluded.status
      returning id, epoch_score_id, tx_hash, block_number, status, explorer_url, created_at, confirmed_at
    `,
    [
      commitment.id,
      epochScore.id,
      commitment.txHash,
      commitment.blockNumber,
      commitment.status,
      commitment.explorerUrl,
      commitment.createdAt,
      commitment.confirmedAt
    ]
  );

  const row = result.rows[0];
  if (!row) throw new Error("Failed to store chain commitment");
  return {
    id: row.id,
    epochScoreId: row.epoch_score_id,
    txHash: row.tx_hash,
    blockNumber: blockNumberFromDatabase(row.block_number),
    status: row.status,
    explorerUrl: row.explorer_url,
    createdAt: row.created_at.toISOString(),
    confirmedAt: row.confirmed_at?.toISOString() ?? null
  };
}

async function findDatabaseCandidate(candidateId: string): Promise<CandidateEvent> {
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
      where id = $1
    `,
    [candidateId]
  );

  const row = result.rows[0];
  if (!row) throw Object.assign(new Error("Candidate not found"), { statusCode: 404, code: "CANDIDATE_NOT_FOUND" });
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

function decisionForCandidate(candidate: CandidateEvent): AgentDecision {
  const decision = decisionForConfidence(candidate.confidence);

  return {
    id: randomUUID(),
    candidateEventId: candidate.id,
    agentName: "deterministic-policy-gate",
    confidence: candidate.confidence,
    decision,
    hypothesis: hypothesisFor(candidate, decision),
    supportingEvidenceIds: candidate.evidenceEventIds,
    notificationDraft: decision === "approve" ? "Evidence approved for epoch commitment." : undefined,
    reasoningTrace: {
      source: "deterministic",
      approveAt: AUTO_APPROVE_THRESHOLD,
      escalateAt: ESCALATE_THRESHOLD,
      candidateStatus: candidate.status
    },
    createdAt: new Date().toISOString()
  };
}

function alertFromDecision(
  decision: AgentDecision,
  candidate: CandidateEvent,
  review: AlertItem["review"]
): AlertItem {
  return {
    id: decision.id,
    candidateEventId: candidate.id,
    zoneId: candidate.zoneId,
    status: candidate.status,
    confidence: decision.confidence,
    decision: decision.decision,
    hypothesis: review ? initialHypothesis(decision.hypothesis, review.note) : decision.hypothesis,
    supportingEvidenceIds: decision.supportingEvidenceIds,
    review,
    createdAt: decision.createdAt,
    candidateCreatedAt: candidate.createdAt
  };
}

function initialHypothesis(hypothesis: string, reviewNote: string): string {
  const suffix = ` Reviewer note: ${reviewNote}`;
  return hypothesis.endsWith(suffix) ? hypothesis.slice(0, -suffix.length) : hypothesis;
}

function memoryReviewForDecision(decisionId: string): AlertItem["review"] {
  const audit = listMemoryAuditLogs("review.decision_resolved")
    .find((item) => nestedString(item.after, "decision", "id") === decisionId);
  if (!audit) return null;

  const initialDecision = nestedString(audit.before, "decision", "decision");
  const decision = nestedString(audit.after, "decision", "decision");
  const note = directString(audit.after, "note");
  if (!isAgentDecision(initialDecision) || (decision !== "approve" && decision !== "reject") || !note) return null;

  return { initialDecision, decision, note, reviewedAt: audit.createdAt };
}

function reviewFromDecisionRow(row: DecisionWithCandidateRow): AlertItem["review"] {
  const tracedReview = reviewFromReasoningTrace(row.reasoning_trace);
  if (tracedReview) return tracedReview;

  if (
    isAgentDecision(row.initial_decision) &&
    (row.decision === "approve" || row.decision === "reject") &&
    row.review_note &&
    row.reviewed_at
  ) {
    return {
      initialDecision: row.initial_decision,
      decision: row.decision,
      note: row.review_note,
      reviewedAt: row.reviewed_at.toISOString()
    };
  }

  // Older/demo reviews can lack an audit row (for example, when a synthetic
  // reviewer user is not present for the audit-log foreign key). The decision
  // row still carries the review note. Only treat it as a review when the final
  // decision differs from the deterministic confidence gate, so an ordinary
  // auto-approval notification is never mislabeled as human review.
  const initialDecision = decisionForConfidence(Number(row.decision_confidence));
  if (
    initialDecision === row.decision ||
    (row.decision !== "approve" && row.decision !== "reject") ||
    !row.notification_draft
  ) return null;

  return {
    initialDecision,
    decision: row.decision,
    note: row.notification_draft,
    reviewedAt: null
  };
}

function reviewFromReasoningTrace(trace: Record<string, unknown>): AlertItem["review"] {
  const value = trace.review;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const review = value as Record<string, unknown>;
  const initialDecision = typeof review.initialDecision === "string" ? review.initialDecision : null;
  const decision = typeof review.decision === "string" ? review.decision : null;
  const note = typeof review.note === "string" ? review.note : null;
  const reviewedAt = typeof review.reviewedAt === "string" ? review.reviewedAt : null;

  if (
    !isAgentDecision(initialDecision) ||
    (decision !== "approve" && decision !== "reject") ||
    !note ||
    !reviewedAt
  ) return null;

  return { initialDecision, decision, note, reviewedAt };
}

function decisionForConfidence(confidence: number): AgentDecision["decision"] {
  return confidence >= AUTO_APPROVE_THRESHOLD
    ? "approve"
    : confidence >= ESCALATE_THRESHOLD
      ? "escalate"
      : "reject";
}

function isAgentDecision(value: string | null): value is AgentDecision["decision"] {
  return value === "approve" || value === "escalate" || value === "reject";
}

function directString(value: Record<string, unknown> | null, key: string): string | null {
  const field = value?.[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function nestedString(value: Record<string, unknown> | null, objectKey: string, fieldKey: string): string | null {
  const nested = value?.[objectKey];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return null;
  const field = (nested as Record<string, unknown>)[fieldKey];
  return typeof field === "string" && field.length > 0 ? field : null;
}

async function auditAgentDecision(
  decision: AgentDecision,
  candidate: CandidateEvent,
  evidence?: EvidenceEvent
): Promise<void> {
  await appendAuditLog({
    action: "agent_decision.created",
    before: null,
    after: {
      decision,
      candidate: {
        id: candidate.id,
        zoneId: candidate.zoneId,
        status: candidate.status,
        confidence: candidate.confidence
      },
      evidenceEventId: evidence?.id ?? null
    }
  });
}

async function queueAgentReview(
  candidate: CandidateEvent,
  evidence?: EvidenceEvent,
  simulation?: PipelineOptions["simulation"]
): Promise<void> {
  const queuedJob = await enqueueAgentReviewJob({
    candidate,
    evidence: evidence ? [evidence] : [],
    providers: [],
    ...(simulation ? { simulation } : {})
  });

  await appendAuditLog({
    action: "agent_review.queued",
    before: null,
    after: {
      jobId: queuedJob.id,
      queueName: queuedJob.queueName,
      backend: queuedJob.backend,
      candidateEventId: candidate.id
    }
  });
}

async function auditSimulationProofPreview(
  candidate: CandidateEvent,
  decision: AgentDecision,
  simulation: NonNullable<PipelineOptions["simulation"]>
): Promise<void> {
  await appendAuditLog({
    action: "demo.proof_previewed",
    before: null,
    after: {
      runId: simulation.runId,
      initiatedBy: simulation.initiatedBy,
      candidateEventId: candidate.id,
      decisionId: decision.id,
      reason: "Synthetic demo chain writes are disabled"
    }
  });
}

async function auditReviewDecision(
  before: AgentDecision | null,
  after: AgentDecision,
  note: string,
  reviewer?: Pick<User, "id" | "role" | "phoneOrEmail">
): Promise<void> {
  await appendAuditLog({
    actorUserId: reviewer?.id ?? null,
    action: "review.decision_resolved",
    before: before ? { decision: before } : null,
    after: {
      decision: after,
      note,
      reviewer: reviewer
        ? {
            id: reviewer.id,
            role: reviewer.role,
            phoneOrEmail: reviewer.phoneOrEmail
          }
        : null
    }
  });
}

async function auditChainQueued(
  epochScore: EpochScore,
  commitment: ChainCommitment,
  source: "agent_auto_approval" | "review_approval"
): Promise<void> {
  await appendAuditLog({
    action: "chain_commitment.queued",
    before: null,
    after: {
      source,
      epochScore,
      commitment
    }
  });
}

function hypothesisFor(candidate: CandidateEvent, decision: "approve" | "escalate" | "reject"): string {
  if (decision === "approve") {
    return `Candidate ${candidate.status} passed deterministic confidence threshold.`;
  }

  if (decision === "escalate") {
    return `Candidate ${candidate.status} is plausible but below auto-approval confidence; reviewer confirmation required.`;
  }

  return `Candidate ${candidate.status} fell below the minimum confidence threshold.`;
}

function recomputeMemoryEpochScore(candidate: CandidateEvent): EpochScore {
  const epochStart = floorToEpoch(candidate.windowEnd);
  const epochEndTs = new Date(epochStart).getTime() + EPOCH_DURATION_MS;
  const approvedCandidates = Array.from(memoryCandidatesById.values())
    .filter((item) => {
      const decision = memoryDecisions.get(item.id);
      const windowEndTs = new Date(item.windowEnd).getTime();
      return (
        item.zoneId === candidate.zoneId &&
        decision?.decision === "approve" &&
        windowEndTs >= new Date(epochStart).getTime() &&
        windowEndTs < epochEndTs
      );
    })
    .sort((a, b) => a.windowEnd.localeCompare(b.windowEnd) || a.id.localeCompare(b.id));

  return epochScoreForApprovedCandidates(candidate.zoneId, epochStart, approvedCandidates);
}

function epochScoreForApprovedCandidates(zoneId: string, epochStart: string, approvedCandidates: CandidateEvent[]): EpochScore {
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

function epochKey(zoneId: string, epochStart: string): string {
  return `${zoneId}:${epochStart}`;
}

type AgentDecisionRow = {
  id: string;
  candidate_event_id: string;
  agent_name: string;
  confidence: string;
  decision: "approve" | "escalate" | "reject";
  hypothesis: string;
  supporting_evidence_ids: string[];
  notification_draft: string | null;
  reasoning_trace: Record<string, unknown>;
  created_at: Date;
};

type DecisionWithCandidateRow = AgentDecisionRow & {
  decision_id: string;
  decision_confidence: string;
  decision_created_at: Date;
  candidate_id: string;
  zone_id: string;
  status: "outage" | "restored";
  candidate_confidence: string;
  window_start: Date;
  window_end: Date;
  evidence_event_ids: string[];
  candidate_created_at: Date;
  initial_decision: string | null;
  review_note: string | null;
  reviewed_at: Date | null;
};

function mapDecisionRow(row: AgentDecisionRow): AgentDecision {
  return {
    id: row.id,
    candidateEventId: row.candidate_event_id,
    agentName: row.agent_name,
    confidence: Number(row.confidence),
    decision: row.decision,
    hypothesis: row.hypothesis,
    supportingEvidenceIds: row.supporting_evidence_ids,
    notificationDraft: row.notification_draft ?? undefined,
    reasoningTrace: row.reasoning_trace,
    createdAt: row.created_at.toISOString()
  };
}

function mapDecisionWithCandidateRow(row: DecisionWithCandidateRow): AgentDecision & { candidate: CandidateEvent } {
  return {
    id: row.decision_id,
    candidateEventId: row.candidate_event_id,
    agentName: row.agent_name,
    confidence: Number(row.decision_confidence),
    decision: row.decision,
    hypothesis: row.hypothesis,
    supportingEvidenceIds: row.supporting_evidence_ids,
    notificationDraft: row.notification_draft ?? undefined,
    reasoningTrace: row.reasoning_trace,
    createdAt: row.decision_created_at.toISOString(),
    candidate: {
      id: row.candidate_id,
      zoneId: row.zone_id,
      status: row.status,
      confidence: Number(row.candidate_confidence),
      windowStart: row.window_start.toISOString(),
      windowEnd: row.window_end.toISOString(),
      evidenceEventIds: row.evidence_event_ids,
      createdAt: row.candidate_created_at.toISOString()
    }
  };
}
