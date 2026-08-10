import { afterEach, describe, expect, it, vi } from "vitest";
import type { CandidateEvent } from "@gridproof/shared-types";
import { orchestrateCandidateReview } from "../src/orchestrator.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const providerId = "2084fca3-725c-4a2d-b521-bc82de112c64";

const candidate: CandidateEvent = {
  id: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
  zoneId,
  status: "outage",
  confidence: 0.62,
  windowStart: "2026-08-09T09:45:00.000Z",
  windowEnd: "2026-08-09T10:00:00.000Z",
  evidenceEventIds: ["6a670093-7823-44e1-80e4-ac608f9e75bd"],
  createdAt: "2026-08-09T10:01:00.000Z"
};

describe("orchestrateCandidateReview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("escalates instead of approving when the LLM layer fails", async () => {
    const result = await orchestrateCandidateReview(
      { candidate, evidence: [], providers: [] },
      {
        baseUrl: "http://127.0.0.1:1",
        apiKey: "test",
        model: "offline",
        timeoutMs: 50
      },
      {
        baseUrl: "http://127.0.0.1:1",
        apiKey: "test",
        model: "offline",
        timeoutMs: 50
      }
    );

    expect(result.outcome).toBe("escalate");
  });

  it("adds read-only tool context to the LLM prompt when a tool query is provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    hypothesis: "Conflicting reporter data needs human interpretation.",
                    confidence: 0.7,
                    supportingEvidenceIds: candidate.evidenceEventIds
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    decision: "escalate",
                    finalConfidence: 0.7,
                    notificationDraft: "Reviewer should inspect conflicting reports."
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await orchestrateCandidateReview(
      { candidate, evidence: [], providers: [] },
      { baseUrl: "http://llm.test", apiKey: "test", model: "analysis" },
      { baseUrl: "http://llm.test", apiKey: "test", model: "verification" },
      async (sql, values = []) => {
        if (sql.includes("left join lateral")) {
          return {
            rows: [
              {
                id: providerId,
                user_id: null,
                wallet_address: "0x1111111111111111111111111111111111111111",
                provider_type: "sensor",
                zone_id: zoneId,
                reputation_cache: 6,
                active: true,
                recent_evidence_count: 1,
                last_evidence_at: candidate.windowStart,
                latest_status: "grid_down"
              }
            ].filter((row) => row.id === values[0])
          };
        }

        if (sql.includes("count(*)::int")) {
          return {
            rows: [
              {
                sample_size: 1,
                grid_up_count: 0,
                grid_down_count: 1,
                unknown_count: 0,
                average_voltage: "0",
                first_observed_at: candidate.windowStart,
                last_observed_at: candidate.windowStart
              }
            ]
          };
        }

        return {
          rows: [
            {
              id: candidate.evidenceEventIds[0],
              provider_id: providerId,
              zone_id: zoneId,
              idempotency_key: "esp32-ogb-a-2026-08-09T09:45:00Z",
              source: "sensor",
              status: "grid_down",
              voltage: "0",
              confidence_hint: null,
              raw_payload: { deviceId: "esp32-ogb-a" },
              observed_at: candidate.windowStart,
              received_at: "2026-08-09T09:45:01.000Z"
            }
          ]
        };
      }
    );

    expect(result.outcome).toBe("agent_decision");
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const userMessage = firstRequest.messages.find((message: { role: string }) => message.role === "user");
    expect(userMessage.content).toContain("toolContext");
    expect(userMessage.content).toContain("historicalBaseline");
    expect(userMessage.content).toContain("providerMetadata");
  });
});
