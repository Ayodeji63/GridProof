import { afterEach, describe, expect, it, vi } from "vitest";
import type { CandidateEvent } from "@gridproof/shared-types";
import {
  agentDecisionFromResult,
  persistOrchestrationResult
} from "../src/result-sink.js";

const candidate: CandidateEvent = {
  id: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
  zoneId: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  status: "outage",
  confidence: 0.62,
  windowStart: "2026-08-09T09:45:00.000Z",
  windowEnd: "2026-08-09T10:00:00.000Z",
  evidenceEventIds: ["6a670093-7823-44e1-80e4-ac608f9e75bd"],
  createdAt: "2026-08-09T10:01:00.000Z"
};

const input = {
  candidate,
  evidence: [],
  providers: []
};

describe("agent-worker result sink", () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("maps successful AI verification into an AgentDecision", () => {
    const decision = agentDecisionFromResult(input, {
      outcome: "agent_decision",
      analysis: {
        hypothesis: "Two reporter events and one sensor heartbeat indicate a likely outage.",
        confidence: 0.91,
        supportingEvidenceIds: candidate.evidenceEventIds
      },
      decision: {
        decision: "approve",
        finalConfidence: 0.91,
        notificationDraft: "Outage evidence approved."
      }
    });

    expect(decision).toMatchObject({
      candidateEventId: candidate.id,
      agentName: "ai-evidence-verification-agent",
      confidence: 0.91,
      decision: "approve",
      hypothesis: "Two reporter events and one sensor heartbeat indicate a likely outage.",
      supportingEvidenceIds: candidate.evidenceEventIds,
      notificationDraft: "Outage evidence approved."
    });
    expect(decision.reasoningTrace.verification).toMatchObject({ finalConfidence: 0.91 });
  });

  it("maps worker failures into an escalation decision", () => {
    const decision = agentDecisionFromResult(input, {
      outcome: "escalate",
      reason: "LLM request failed with 503"
    });

    expect(decision.decision).toBe("escalate");
    expect(decision.hypothesis).toContain("LLM request failed with 503");
    expect(decision.supportingEvidenceIds).toEqual(candidate.evidenceEventIds);
  });

  it("skips persistence safely when DATABASE_URL is absent", async () => {
    const result = await persistOrchestrationResult(input, {
      outcome: "escalate",
      reason: "offline"
    });

    expect(result.persisted).toBe(false);
    expect(result.reason).toContain("DATABASE_URL");
    expect(result.decision.decision).toBe("escalate");
  });

  it("upserts decisions through the supplied query function", async () => {
    const query = vi.fn(async () => ({ rowCount: 1, rows: [] }));
    const result = await persistOrchestrationResult(
      input,
      {
        outcome: "agent_decision",
        analysis: {
          hypothesis: "Evidence is internally consistent.",
          confidence: 0.88,
          supportingEvidenceIds: []
        },
        decision: {
          decision: "approve",
          finalConfidence: 0.88,
          notificationDraft: "Approved for commitment."
        }
      },
      query
    );

    expect(result.persisted).toBe(true);
    const decisionUpsert = query.mock.calls.find(([text]) => text.includes("insert into agent_decisions"));
    expect(decisionUpsert).toBeDefined();
    const values = decisionUpsert?.[1] as unknown[];
    expect(values[1]).toBe(candidate.id);
    expect(values[2]).toBe("ai-evidence-verification-agent");
    expect(values[6]).toEqual(candidate.evidenceEventIds);
  });

  it("queues an epoch score and pending chain commitment when AI approves a candidate", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("from candidate_events")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: candidate.id,
              zone_id: candidate.zoneId,
              status: candidate.status,
              confidence: "0.91",
              evidence_event_ids: candidate.evidenceEventIds
            }
          ]
        };
      }

      if (text.includes("returning id, zone_id, epoch_start")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "f2f0e092-c6a4-4745-88d3-a673523c444b",
              zone_id: candidate.zoneId,
              epoch_start: new Date("2026-08-09T10:00:00.000Z"),
              uptime_bps: 0,
              evidence_hash: `0x${"e".repeat(64)}`,
              created_at: new Date("2026-08-09T10:02:00.000Z")
            }
          ]
        };
      }

      if (text.includes("returning id, epoch_score_id")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "0d823346-2b42-463e-9d37-3ad4c323b237",
              epoch_score_id: "f2f0e092-c6a4-4745-88d3-a673523c444b",
              tx_hash: null,
              block_number: null,
              status: "pending",
              explorer_url: null,
              created_at: new Date("2026-08-09T10:02:01.000Z"),
              confirmed_at: null
            }
          ]
        };
      }

      return { rowCount: 1, rows: [] };
    });

    const result = await persistOrchestrationResult(
      input,
      {
        outcome: "agent_decision",
        analysis: {
          hypothesis: "Evidence is strong enough to approve.",
          confidence: 0.91,
          supportingEvidenceIds: candidate.evidenceEventIds
        },
        decision: {
          decision: "approve",
          finalConfidence: 0.91,
          notificationDraft: "Approved for commitment."
        }
      },
      query
    );

    expect(result.persisted).toBe(true);
    expect(result.epochScore).toMatchObject({
      zoneId: candidate.zoneId,
      uptimeBps: 0,
      evidenceHash: `0x${"e".repeat(64)}`
    });
    expect(result.commitment).toMatchObject({
      epochScoreId: "f2f0e092-c6a4-4745-88d3-a673523c444b",
      status: "pending",
      txHash: null
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into epoch_scores"), expect.any(Array));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into chain_commitments"), expect.any(Array));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into audit_logs"),
      expect.arrayContaining(["chain_commitment.queued"])
    );
  });

  it("does not queue chain artifacts when AI rejects a candidate", async () => {
    const query = vi.fn(async () => ({ rowCount: 1, rows: [] }));
    const result = await persistOrchestrationResult(
      input,
      {
        outcome: "agent_decision",
        analysis: {
          hypothesis: "Evidence is too weak.",
          confidence: 0.21,
          supportingEvidenceIds: candidate.evidenceEventIds
        },
        decision: {
          decision: "reject",
          finalConfidence: 0.21,
          notificationDraft: "Rejected."
        }
      },
      query
    );

    expect(result.persisted).toBe(true);
    expect(result.epochScore).toBeNull();
    expect(result.commitment).toBeNull();
    expect(query.mock.calls.some(([text]) => text.includes("insert into epoch_scores"))).toBe(false);
    expect(query.mock.calls.some(([text]) => text.includes("insert into chain_commitments"))).toBe(false);
  });
});
