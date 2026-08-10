import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./api-client.js";

const epochScore = {
  id: "f2f0e092-c6a4-4745-88d3-a673523c444b",
  zoneId: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  epochStart: "2026-08-09T12:00:00.000Z",
  uptimeBps: 5000,
  evidenceHash: `0x${"e".repeat(64)}`,
  createdAt: "2026-08-09T12:01:00.000Z"
};
const provider = {
  id: "2084fca3-725c-4a2d-b521-bc82de112c64",
  userId: null,
  walletAddress: "0x1111111111111111111111111111111111111111",
  providerType: "reporter",
  zoneId: epochScore.zoneId,
  reputationCache: 0,
  active: true,
  lastSeenAt: null
} as const;
const notification = {
  id: "60455448-ba24-4e5d-8cf9-d1057e1777cf",
  kind: "chain_committed",
  audience: "public",
  channel: "webhook",
  title: "Proof confirmed on BOT Chain",
  message: "Zone commitment confirmed.",
  payload: {
    zoneId: epochScore.zoneId,
    txHash: `0x${"f".repeat(64)}`,
    status: "confirmed"
  },
  status: "sent",
  attempts: 1,
  lastError: null,
  createdAt: "2026-08-09T12:03:00.000Z",
  sentAt: "2026-08-09T12:03:01.000Z"
} as const;
const alert = {
  id: "4f80f256-d4a8-4e51-8d58-ff7b8a605fd2",
  candidateEventId: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
  zoneId: epochScore.zoneId,
  status: "outage",
  confidence: 0.95,
  decision: "approve",
  hypothesis: "Candidate outage passed deterministic confidence threshold.",
  supportingEvidenceIds: ["6a670093-7823-44e1-80e4-ac608f9e75bd"],
  createdAt: "2026-08-09T12:03:00.000Z",
  candidateCreatedAt: "2026-08-09T12:02:00.000Z"
} as const;
const reporterIngestResponse = {
  accepted: true,
  duplicate: false,
  evidenceEvent: {
    id: "6a670093-7823-44e1-80e4-ac608f9e75bd",
    providerId: provider.id,
    zoneId: epochScore.zoneId,
    idempotencyKey: "web-report:0x1111111111111111111111111111111111111111:2026-08-09T12:03:00.000Z",
    source: "reporter",
    status: "grid_down",
    rawPayload: {
      reporterWallet: provider.walletAddress,
      note: "Power is out near the transformer."
    },
    observedAt: "2026-08-09T12:03:00.000Z",
    receivedAt: "2026-08-09T12:03:01.000Z"
  },
  candidateEvent: {
    id: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
    zoneId: epochScore.zoneId,
    status: "outage",
    confidence: 0.65,
    windowStart: "2026-08-09T12:03:00.000Z",
    windowEnd: "2026-08-09T12:03:00.000Z",
    evidenceEventIds: ["6a670093-7823-44e1-80e4-ac608f9e75bd"],
    createdAt: "2026-08-09T12:03:01.000Z"
  }
} as const;
const zoneHistory = {
  zone: {
    id: epochScore.zoneId,
    zoneKey: `0x${"a".repeat(64)}`,
    name: "Ogbomoso Feeder A",
    discosFeederCode: "IBEDC-OGB-A",
    region: "Oyo",
    centroid: { lat: 8.133, lng: 4.25 }
  },
  candidates: [reporterIngestResponse.candidateEvent],
  epochScores: [epochScore],
  trend: "declining"
} as const;

describe("apiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and validates the current auth user", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: {
            id: "7af7b612-2b58-4ed4-87bc-a2eb02225729",
            role: "reviewer",
            phoneOrEmail: "reviewer@gridproof.test",
            createdAt: "2026-08-09T12:00:00.000Z"
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "reviewer.jwt")
    });

    const response = await apiClient.authMe();

    expect(response.user?.role).toBe("reviewer");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/auth/me",
      { headers: { Authorization: "Bearer reviewer.jwt" } }
    );
  });

  it("registers and logs in demo auth sessions", async () => {
    const session = {
      user: {
        id: "7af7b612-2b58-4ed4-87bc-a2eb02225729",
        role: "reporter",
        phoneOrEmail: "reporter@gridproof.test",
        createdAt: "2026-08-09T12:00:00.000Z"
      },
      token: "header.payload.signature",
      expiresAt: "2026-08-09T13:00:00.000Z"
    } as const;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(session), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(session), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const registration = await apiClient.authRegister({ phoneOrEmail: "reporter@gridproof.test", role: "reporter" });
    const login = await apiClient.authLogin({ phoneOrEmail: "reporter@gridproof.test" });

    expect(registration.token).toBe("header.payload.signature");
    expect(login.user.role).toBe("reporter");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:4000/api/v1/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ phoneOrEmail: "reporter@gridproof.test", role: "reporter" })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:4000/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ phoneOrEmail: "reporter@gridproof.test" })
      })
    );
  });

  it("fetches and validates proof responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ epochScore, commitment: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const proof = await apiClient.proof(epochScore.zoneId, "latest");

    expect(proof.epochScore?.uptimeBps).toBe(5000);
    expect(fetchMock).toHaveBeenCalledWith(`http://localhost:4000/api/v1/chain/proof/${epochScore.zoneId}/latest`);
  });

  it("fetches and validates metrics responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          uptimeSeconds: 125,
          counters: {
            evidenceIngested: 3,
            candidatesDetected: 2,
            agentDecisions: 1,
            chainSubmissions: 1,
            failures: 0
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiClient.metrics();

    expect(response.counters.evidenceIngested).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/api/v1/metrics");
  });

  it("fetches and validates deployment readiness responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          service: "gridproof-api",
          status: "not_ready",
          timestamp: "2026-08-09T12:00:00.000Z",
          checks: [
            {
              name: "database",
              status: "fail",
              required: true,
              message: "DATABASE_URL is required for durable evidence, reviews, proofs, audits, and demo seed data.",
              missingEnv: ["DATABASE_URL"]
            }
          ]
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiClient.readiness();

    expect(response.status).toBe("not_ready");
    expect(response.checks[0]?.missingEnv).toEqual(["DATABASE_URL"]);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/api/v1/readiness");
  });

  it("throws a useful error for failed API responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));

    await expect(apiClient.reviewQueue()).rejects.toThrow("GridProof API request failed: 503");
  });

  it("attaches a stored bearer token when calling protected endpoints", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "reviewer.jwt")
    });

    await apiClient.reviewQueue();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/admin/review-queue",
      { headers: { Authorization: "Bearer reviewer.jwt" } }
    );
  });

  it("fetches and validates notification outbox responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ notifications: [notification] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "reviewer.jwt")
    });

    const response = await apiClient.notifications();

    expect(response.notifications[0]?.title).toBe("Proof confirmed on BOT Chain");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/admin/notifications",
      { headers: { Authorization: "Bearer reviewer.jwt" } }
    );
  });

  it("fetches and validates public alert responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ alerts: [alert] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiClient.alerts();

    expect(response.alerts[0]?.hypothesis).toContain("deterministic");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/api/v1/alerts");
  });

  it("fetches and validates zone history responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(zoneHistory), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiClient.zoneHistory(epochScore.zoneId);

    expect(response.zone.name).toBe("Ogbomoso Feeder A");
    expect(response.candidates[0]?.status).toBe("outage");
    expect(response.epochScores[0]?.uptimeBps).toBe(5000);
    expect(response.trend).toBe("declining");
    expect(fetchMock).toHaveBeenCalledWith(`http://localhost:4000/api/v1/zones/${epochScore.zoneId}/history`);
  });

  it("posts reporter evidence and validates ingest responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(reporterIngestResponse), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "reporter.jwt")
    });

    const requestBody = {
      reporterWallet: provider.walletAddress,
      zoneId: provider.zoneId,
      idempotencyKey: reporterIngestResponse.evidenceEvent.idempotencyKey,
      observedAt: reporterIngestResponse.evidenceEvent.observedAt,
      status: "grid_down" as const,
      note: "Power is out near the transformer."
    };
    const response = await apiClient.submitReport(requestBody);

    expect(response.candidateEvent?.status).toBe("outage");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/ingest/report",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer reporter.jwt"
        }),
        body: JSON.stringify(requestBody)
      })
    );
  });

  it("fetches providers and posts provider registrations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ providers: [provider] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ provider, duplicate: false, chainRegistration: providerChainRegistration(provider.walletAddress) }), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const providers = await apiClient.providers();
    const registration = await apiClient.registerProvider({
      walletAddress: provider.walletAddress,
      providerType: provider.providerType,
      zoneId: provider.zoneId
    });

    expect(providers.providers[0]?.id).toBe(provider.id);
    expect(registration.duplicate).toBe(false);
    expect(registration.chainRegistration.registerCall.args).toEqual([`0x${"a".repeat(64)}`, 1]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://localhost:4000/api/v1/providers");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:4000/api/v1/providers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          walletAddress: provider.walletAddress,
          providerType: provider.providerType,
          zoneId: provider.zoneId
        })
      })
    );
  });

  it("posts reviewer decisions and validates the response", async () => {
    const reviewId = "4f80f256-d4a8-4e51-8d58-ff7b8a605fd2";
    const candidateId = "c04ac0c9-73b8-49f0-97fd-52c77a38bd77";
    const evidenceId = "6a670093-7823-44e1-80e4-ac608f9e75bd";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          accepted: true,
          reviewId,
          decision: {
            id: reviewId,
            candidateEventId: candidateId,
            agentName: "deterministic-policy-gate",
            confidence: 0.65,
            decision: "approve",
            hypothesis: "Reviewer confirmed the evidence.",
            supportingEvidenceIds: [evidenceId],
            reasoningTrace: { source: "deterministic" },
            createdAt: "2026-08-09T12:02:00.000Z"
          },
          epochScore,
          commitment: null
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiClient.resolveReview(reviewId, {
      decision: "approve",
      note: "Confirmed by reviewer."
    });

    expect(result.epochScore?.uptimeBps).toBe(5000);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:4000/api/v1/admin/review/${reviewId}/decision`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ decision: "approve", note: "Confirmed by reviewer." })
      })
    );
  });
});

function providerChainRegistration(walletAddress: string) {
  return {
    configured: true,
    mode: "wallet_self_service",
    chainId: "12345",
    contractAddress: "0x9999999999999999999999999999999999999999",
    explorerUrl: `https://explorer.botchain.test/address/${walletAddress}`,
    providerWallet: walletAddress,
    providerType: "reporter",
    providerTypeId: 1,
    zoneId: epochScore.zoneId,
    zoneKey: `0x${"a".repeat(64)}`,
    registerCall: {
      to: "0x9999999999999999999999999999999999999999",
      functionName: "register",
      args: [`0x${"a".repeat(64)}`, 1],
      data: `0x${"1".repeat(8)}`
    },
    onChain: null,
    reason: "Provider must call NodeRegistry.register from their own wallet."
  } as const;
}
