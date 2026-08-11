import { describe, expect, it } from "vitest";
import {
  alertsResponseSchema,
  authLoginRequestSchema,
  ingestResponseSchema,
  authRegisterRequestSchema,
  authSessionResponseSchema,
  notificationsResponseSchema,
  proofParamsSchema,
  readinessResponseSchema,
  providersResponseSchema,
  reviewDecisionResponseSchema,
  reviewDecisionRequestSchema,
  reviewQueueResponseSchema,
  registerProviderResponseSchema,
  whatsappWebhookRequestSchema,
  zoneHistoryResponseSchema
} from "../src/index.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const providerId = "2084fca3-725c-4a2d-b521-bc82de112c64";
const evidenceId = "6a670093-7823-44e1-80e4-ac608f9e75bd";
const candidateId = "c04ac0c9-73b8-49f0-97fd-52c77a38bd77";
const decisionId = "4f80f256-d4a8-4e51-8d58-ff7b8a605fd2";
const now = "2026-08-09T10:00:00.000Z";

const candidate = {
  id: candidateId,
  zoneId,
  status: "outage",
  confidence: 0.95,
  windowStart: "2026-08-09T09:45:00.000Z",
  windowEnd: now,
  evidenceEventIds: [evidenceId],
  createdAt: now
} as const;

describe("shared API schemas", () => {
  it("accepts ingest responses with no candidate for unknown evidence", () => {
    const parsed = ingestResponseSchema.parse({
      accepted: true,
      duplicate: false,
      evidenceEvent: {
        id: evidenceId,
        providerId,
        zoneId,
        idempotencyKey: "esp32-ogb-a-unknown-2026-08-09T10:00:00Z",
        source: "sensor",
        status: "unknown",
        rawPayload: {},
        observedAt: now,
        receivedAt: now
      },
      candidateEvent: null
    });

    expect(parsed.candidateEvent).toBeNull();
  });

  it("allows proof lookup by bytes32 zone key and latest epoch alias", () => {
    const parsed = proofParamsSchema.parse({
      zoneId: `0x${"a".repeat(64)}`,
      epoch: "latest"
    });

    expect(parsed.epoch).toBe("latest");
  });

  it("rejects empty reviewer notes", () => {
    expect(() =>
      reviewDecisionRequestSchema.parse({
        decision: "approve",
        note: ""
      })
    ).toThrow();
  });

  it("validates reviewer queue items with embedded candidates", () => {
    const parsed = reviewQueueResponseSchema.parse({
      items: [
        {
          id: decisionId,
          candidateEventId: candidate.id,
          agentName: "deterministic-policy-gate",
          confidence: 0.65,
          decision: "escalate",
          hypothesis: "Reporter evidence needs human confirmation.",
          supportingEvidenceIds: [evidenceId],
          reasoningTrace: { source: "deterministic" },
          createdAt: now,
          candidate
        }
      ]
    });

    expect(parsed.items[0]?.candidate.status).toBe("outage");
  });

  it("validates reviewer decision responses after approve or reject", () => {
    const parsed = reviewDecisionResponseSchema.parse({
      accepted: true,
      reviewId: decisionId,
      decision: {
        id: decisionId,
        candidateEventId: candidate.id,
        agentName: "deterministic-policy-gate",
        confidence: 0.65,
        decision: "reject",
        hypothesis: "Reviewer rejected insufficient evidence.",
        supportingEvidenceIds: [evidenceId],
        reasoningTrace: { source: "deterministic" },
        createdAt: now
      },
      epochScore: null,
      commitment: null
    });

    expect(parsed.decision.decision).toBe("reject");
  });

  it("validates zone history trend responses", () => {
    const parsed = zoneHistoryResponseSchema.parse({
      zone: {
        id: zoneId,
        zoneKey: `0x${"a".repeat(64)}`,
        name: "Ogbomoso Feeder A",
        discosFeederCode: "IBEDC-OGB-A",
        region: "Oyo",
        centroid: { lat: 8.133, lng: 4.25 }
      },
      candidates: [candidate],
      epochScores: [],
      trend: "improving"
    });

    expect(parsed.trend).toBe("improving");
  });

  it("validates WhatsApp reporter webhook payloads", () => {
    const parsed = whatsappWebhookRequestSchema.parse({
      messageId: "wamid-demo-1",
      fromPhone: "+2348012345678",
      reporterWallet: "0x1111111111111111111111111111111111111111",
      zoneId,
      text: "Power is back in my area"
    });

    expect(parsed.source).toBe("demo");
    expect(parsed.status).toBeUndefined();
  });

  it("validates provider listing and registration responses", () => {
    const provider = {
      id: providerId,
      userId: null,
      walletAddress: "0x1111111111111111111111111111111111111111",
      providerType: "reporter",
      zoneId,
      reputationCache: 0,
      active: true,
      lastSeenAt: null
    } as const;

    expect(providersResponseSchema.parse({ providers: [provider] }).providers[0]?.walletAddress).toBe(
      provider.walletAddress
    );
    expect(registerProviderResponseSchema.parse({
      provider,
      duplicate: false,
      chainRegistration: providerChainRegistration(provider.walletAddress, "reporter")
    }).chainRegistration.registerCall.args).toEqual([`0x${"a".repeat(64)}`, 1]);
  });

  it("validates auth registration, login, and session responses", () => {
    const register = authRegisterRequestSchema.parse({
      phoneOrEmail: "reporter@gridproof.test"
    });
    const login = authLoginRequestSchema.parse({
      phoneOrEmail: "reporter@gridproof.test"
    });
    const session = authSessionResponseSchema.parse({
      user: {
        id: "7af7b612-2b58-4ed4-87bc-a2eb02225729",
        role: "reporter",
        phoneOrEmail: "reporter@gridproof.test",
        createdAt: now
      },
      token: "header.payload.signature",
      expiresAt: now
    });

    expect(register.role).toBe("reporter");
    expect(login.phoneOrEmail).toBe("reporter@gridproof.test");
    expect(session.user.role).toBe("reporter");
  });

  it("validates notification outbox responses", () => {
    const parsed = notificationsResponseSchema.parse({
      notifications: [
        {
          id: "60455448-ba24-4e5d-8cf9-d1057e1777cf",
          kind: "chain_committed",
          audience: "public",
          channel: "webhook",
          title: "Proof confirmed on BOT Chain",
          message: "Zone 8a27 chain commitment is confirmed.",
          payload: {
            zoneId,
            txHash: `0x${"f".repeat(64)}`,
            status: "confirmed"
          },
          status: "sent",
          attempts: 1,
          lastError: null,
          createdAt: now,
          sentAt: now
        }
      ]
    });

    expect(parsed.notifications[0]?.kind).toBe("chain_committed");
  });

  it("validates deployment readiness responses without secret values", () => {
    const parsed = readinessResponseSchema.parse({
      ok: false,
      service: "gridproof-api",
      status: "not_ready",
      timestamp: now,
      checks: [
        {
          name: "bot_chain_relayer",
          status: "fail",
          required: true,
          message: "BOT Chain relayer configuration is incomplete; on-chain proof submission cannot run.",
          missingEnv: ["BOTCHAIN_RPC_URL", "RELAYER_PRIVATE_KEY"]
        },
        {
          name: "observability",
          status: "warn",
          required: false,
          message: "Sentry DSN is not configured; rely on platform logs and /metrics during the demo.",
          missingEnv: ["SENTRY_DSN"]
        }
      ]
    });

    expect(parsed.status).toBe("not_ready");
    expect(JSON.stringify(parsed)).not.toContain("super-secret");
  });

  it("validates public alert feed responses", () => {
    const parsed = alertsResponseSchema.parse({
      alerts: [
        {
          id: decisionId,
          candidateEventId: candidate.id,
          zoneId,
          status: "outage",
          confidence: 0.95,
          decision: "approve",
          hypothesis: "Candidate outage passed deterministic confidence threshold.",
          supportingEvidenceIds: [evidenceId],
          review: null,
          createdAt: now,
          candidateCreatedAt: candidate.createdAt
        }
      ]
    });

    expect(parsed.alerts[0]?.decision).toBe("approve");
  });
});

function providerChainRegistration(walletAddress: string, providerType: "sensor" | "reporter") {
  const providerTypeId = providerType === "sensor" ? 0 : 1;
  return {
    configured: true,
    mode: "wallet_self_service",
    chainId: "12345",
    contractAddress: "0x9999999999999999999999999999999999999999",
    explorerUrl: `https://explorer.botchain.test/address/${walletAddress}`,
    providerWallet: walletAddress,
    providerType,
    providerTypeId,
    zoneId,
    zoneKey: `0x${"a".repeat(64)}`,
    registerCall: {
      to: "0x9999999999999999999999999999999999999999",
      functionName: "register",
      args: [`0x${"a".repeat(64)}`, providerTypeId],
      data: `0x${"1".repeat(8)}`
    },
    onChain: null,
    reason: "Provider must call NodeRegistry.register from their own wallet."
  } as const;
}
