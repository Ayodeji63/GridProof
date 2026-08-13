import { randomUUID } from "node:crypto";
import { verifyMessage } from "ethers";
import type {
  AgentDecision,
  DemoScenario,
  DemoSimulation,
  DemoSimulationRequest,
  DemoWalletChallengeResponse
} from "@gridproof/shared-types";
import { appendAuditLog, listMemoryAuditLogs } from "../audit/service.js";
import { isDatabaseConfigured, query } from "../../lib/db.js";
import { counters } from "../../lib/metrics.js";
import { upsertTelemetryEvidence } from "../ingestion/store.js";
import { processCandidatePipeline } from "../pipeline/service.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEMO_DEVICE_ID = "gridproof-judge-lab-01";
const DEMO_PROVIDER_WALLET = "0xdE00000000000000000000000000000000000001";
const memoryChallenges = new Map<string, DemoChallenge>();
const memoryRuns = new Map<string, DemoRunRecord>();

type DemoChallenge = {
  nonce: string;
  walletAddress: string;
  message: string;
  expiresAt: string;
  used: boolean;
};

type DemoRunRecord = {
  id: string;
  initiatedBy: string;
  scenario: DemoScenario;
  zoneId: string;
  evidenceId: string;
  candidateId: string;
  policyDecision: AgentDecision;
  telemetry: DemoSimulation["telemetry"];
  createdAt: string;
  allowChainWrite: boolean;
};

export function createDemoWalletChallenge(walletAddress: string): DemoWalletChallengeResponse {
  const nonce = randomUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const message = [
    "GridProof Judge Demo",
    "",
    "Authorize one synthetic telemetry simulation.",
    "This signature does not submit a blockchain transaction or transfer funds.",
    `Wallet: ${walletAddress.toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt}`
  ].join("\n");

  memoryChallenges.set(nonce, { nonce, walletAddress: walletAddress.toLowerCase(), message, expiresAt, used: false });
  return { nonce, message, expiresAt };
}

export async function runDemoSimulation(input: DemoSimulationRequest): Promise<DemoSimulation> {
  consumeChallenge(input);

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const reading = readingFor(input.scenario);
  const allowChainWrite = process.env.GRIDPROOF_DEMO_ALLOW_CHAIN_WRITE === "true";
  const ingest = await upsertTelemetryEvidence({
    deviceId: DEMO_DEVICE_ID,
    providerWallet: DEMO_PROVIDER_WALLET,
    zoneId: input.zoneId,
    idempotencyKey: `judge-demo:${id}`,
    observedAt: createdAt,
    status: reading.status,
    voltage: reading.voltage,
    currentAmps: reading.currentAmps,
    signature: `demo:${id}`
  });

  counters.evidenceIngested += 1;
  if (!ingest.candidateEvent) {
    throw Object.assign(new Error("The selected scenario did not produce a candidate event"), {
      statusCode: 500,
      code: "DEMO_CANDIDATE_MISSING"
    });
  }

  counters.candidatesDetected += 1;
  const pipeline = await processCandidatePipeline(ingest.candidateEvent, ingest.evidenceEvent, {
    simulation: { runId: id, initiatedBy: input.walletAddress.toLowerCase(), allowChainWrite }
  });
  const run: DemoRunRecord = {
    id,
    initiatedBy: input.walletAddress.toLowerCase(),
    scenario: input.scenario,
    zoneId: input.zoneId,
    evidenceId: ingest.evidenceEvent.id,
    candidateId: ingest.candidateEvent.id,
    policyDecision: pipeline.decision,
    telemetry: {
      evidenceId: ingest.evidenceEvent.id,
      deviceId: DEMO_DEVICE_ID,
      status: reading.status,
      voltage: reading.voltage,
      currentAmps: reading.currentAmps,
      observedAt: createdAt
    },
    createdAt,
    allowChainWrite
  };
  memoryRuns.set(id, run);

  await appendAuditLog({
    action: "demo.simulation_started",
    before: null,
    after: {
      runId: id,
      initiatedBy: run.initiatedBy,
      scenario: run.scenario,
      zoneId: run.zoneId,
      evidenceEventId: run.evidenceId,
      candidateEventId: run.candidateId,
      chainMode: allowChainWrite ? "live" : "preview"
    }
  });

  return simulationFromRun(run);
}

export async function getDemoSimulation(id: string): Promise<DemoSimulation> {
  const run = memoryRuns.get(id) ?? await databaseRun(id);
  if (!run) {
    throw Object.assign(new Error("Demo simulation not found"), { statusCode: 404, code: "DEMO_NOT_FOUND" });
  }
  return simulationFromRun(run);
}

export function clearDemoStore(): void {
  memoryChallenges.clear();
  memoryRuns.clear();
}

function consumeChallenge(input: DemoSimulationRequest): void {
  const challenge = memoryChallenges.get(input.nonce);
  if (!challenge || challenge.used || Date.parse(challenge.expiresAt) <= Date.now()) {
    throw Object.assign(new Error("Wallet authorization expired; connect and sign again"), {
      statusCode: 401,
      code: "DEMO_AUTH_EXPIRED"
    });
  }
  if (challenge.walletAddress !== input.walletAddress.toLowerCase()) {
    throw Object.assign(new Error("Wallet address does not match the authorization challenge"), {
      statusCode: 401,
      code: "DEMO_WALLET_MISMATCH"
    });
  }

  let recovered: string;
  try {
    recovered = verifyMessage(challenge.message, input.signature).toLowerCase();
  } catch {
    throw Object.assign(new Error("Wallet signature could not be verified"), {
      statusCode: 401,
      code: "DEMO_BAD_SIGNATURE"
    });
  }
  if (recovered !== challenge.walletAddress) {
    throw Object.assign(new Error("Wallet signature does not match the connected address"), {
      statusCode: 401,
      code: "DEMO_BAD_SIGNATURE"
    });
  }

  challenge.used = true;
}

function readingFor(scenario: DemoScenario): {
  status: "grid_up" | "grid_down";
  voltage: number;
  currentAmps: number;
} {
  if (scenario === "confirmed_outage") return { status: "grid_down", voltage: 0, currentAmps: 0 };
  if (scenario === "restoration") return { status: "grid_up", voltage: 10_700, currentAmps: 42 };
  return { status: "grid_down", voltage: 72, currentAmps: 3.2 };
}

async function simulationFromRun(run: DemoRunRecord): Promise<DemoSimulation> {
  const aiDecision = await findAiDecision(run.candidateId);
  const chain = await findChainState(run.zoneId, run.candidateId, run.allowChainWrite);
  const agentState = run.policyDecision.decision === "escalate"
    ? aiDecision ? "complete" : "queued"
    : "not_required";
  const stage = chain.status === "confirmed"
    ? "chain_confirmed"
    : chain.status === "failed"
      ? "chain_failed"
      : chain.status === "pending"
        ? "chain_pending"
        : chain.status === "preview"
          ? "proof_preview"
          : agentState === "complete"
            ? "ai_complete"
            : agentState === "queued"
              ? "ai_queued"
              : "telemetry_accepted";

  return {
    id: run.id,
    initiatedBy: run.initiatedBy,
    scenario: run.scenario,
    zoneId: run.zoneId,
    createdAt: run.createdAt,
    stage,
    telemetry: run.telemetry,
    candidate: {
      id: run.candidateId,
      status: run.policyDecision.reasoningTrace.candidateStatus === "restored" ? "restored" : scenarioCandidate(run.scenario),
      confidence: run.policyDecision.confidence
    },
    policyDecision: decisionView(run.policyDecision),
    aiDecision: aiDecision ? decisionView(aiDecision) : null,
    agentState,
    chain
  };
}

function scenarioCandidate(scenario: DemoScenario): "outage" | "restored" {
  return scenario === "restoration" ? "restored" : "outage";
}

function decisionView(decision: AgentDecision): DemoSimulation["policyDecision"] {
  return {
    agentName: decision.agentName,
    decision: decision.decision,
    confidence: decision.confidence,
    hypothesis: decision.hypothesis,
    createdAt: decision.createdAt
  };
}

async function findAiDecision(candidateId: string): Promise<AgentDecision | null> {
  if (!isDatabaseConfigured()) return null;
  const result = await query<AgentDecisionRow>(
    `
      select id, candidate_event_id, agent_name, confidence, decision, hypothesis,
             supporting_evidence_ids, notification_draft, reasoning_trace, created_at
      from agent_decisions
      where candidate_event_id = $1 and agent_name = 'ai-evidence-verification-agent'
      limit 1
    `,
    [candidateId]
  );
  const row = result.rows[0];
  return row ? mapDecision(row) : null;
}

async function findChainState(
  zoneId: string,
  candidateId: string,
  allowChainWrite: boolean
): Promise<DemoSimulation["chain"]> {
  if (!allowChainWrite) {
    const previewed = await hasProofPreview(candidateId);
    return { mode: "preview", status: previewed ? "preview" : "not_requested", txHash: null, explorerUrl: null };
  }
  if (!isDatabaseConfigured()) return { mode: "live", status: "not_requested", txHash: null, explorerUrl: null };

  const result = await query<{ status: "pending" | "confirmed" | "failed"; tx_hash: string | null; explorer_url: string | null }>(
    `
      select cc.status, cc.tx_hash, cc.explorer_url
      from candidate_events c
      join epoch_scores es on es.zone_id = c.zone_id
        and es.epoch_start = date_trunc('hour', c.window_end)
      join chain_commitments cc on cc.epoch_score_id = es.id
      where c.id = $1 and c.zone_id = $2
      limit 1
    `,
    [candidateId, zoneId]
  );
  const row = result.rows[0];
  return {
    mode: "live",
    status: row?.status ?? "not_requested",
    txHash: row?.tx_hash ?? null,
    explorerUrl: row?.explorer_url ?? null
  };
}

async function hasProofPreview(candidateId: string): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    return listMemoryAuditLogs("demo.proof_previewed").some((log) => log.after?.candidateEventId === candidateId);
  }
  const result = await query<{ exists: boolean }>(
    `select exists(
       select 1 from audit_logs
       where action = 'demo.proof_previewed' and after->>'candidateEventId' = $1
     ) as exists`,
    [candidateId]
  );
  return result.rows[0]?.exists ?? false;
}

async function databaseRun(id: string): Promise<DemoRunRecord | null> {
  if (!isDatabaseConfigured()) return null;
  const audit = await query<{ after: Record<string, unknown>; created_at: Date }>(
    `select after, created_at from audit_logs where action = 'demo.simulation_started' and after->>'runId' = $1 limit 1`,
    [id]
  );
  const row = audit.rows[0];
  if (!row) return null;
  const candidateId = stringField(row.after, "candidateEventId");
  const evidenceId = stringField(row.after, "evidenceEventId");
  const zoneId = stringField(row.after, "zoneId");
  const initiatedBy = stringField(row.after, "initiatedBy");
  const scenario = stringField(row.after, "scenario") as DemoScenario;
  if (!candidateId || !evidenceId || !zoneId || !initiatedBy) return null;

  const details = await query<DatabaseRunRow>(
    `
      select e.raw_payload->>'deviceId' as device_id, e.status, e.voltage,
             e.raw_payload->>'currentAmps' as current_amps, e.observed_at,
             d.id, d.candidate_event_id, d.agent_name, d.confidence, d.decision, d.hypothesis,
             d.supporting_evidence_ids, d.notification_draft, d.reasoning_trace, d.created_at
      from evidence_events e
      join agent_decisions d on d.candidate_event_id = $2 and d.agent_name = 'evidence-verification-agent'
      where e.id = $1
      limit 1
    `,
    [evidenceId, candidateId]
  );
  const detail = details.rows[0];
  if (!detail) return null;

  return {
    id,
    initiatedBy,
    scenario,
    zoneId,
    evidenceId,
    candidateId,
    policyDecision: mapDecision(detail),
    telemetry: {
      evidenceId,
      deviceId: detail.device_id,
      status: detail.status,
      voltage: Number(detail.voltage ?? 0),
      currentAmps: Number(detail.current_amps ?? 0),
      observedAt: detail.observed_at.toISOString()
    },
    createdAt: row.created_at.toISOString(),
    allowChainWrite: stringField(row.after, "chainMode") === "live"
  };
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

type AgentDecisionRow = {
  id: string;
  candidate_event_id: string;
  agent_name: string;
  confidence: string;
  decision: AgentDecision["decision"];
  hypothesis: string;
  supporting_evidence_ids: string[];
  notification_draft: string | null;
  reasoning_trace: Record<string, unknown>;
  created_at: Date;
};

type DatabaseRunRow = AgentDecisionRow & {
  device_id: string;
  status: "grid_up" | "grid_down";
  voltage: string | null;
  current_amps: string | null;
  observed_at: Date;
};

function mapDecision(row: AgentDecisionRow): AgentDecision {
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
