import { createHmac } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { clearRateLimitStore } from "../src/middleware/rate-limit.js";
import { clearAuditLogStore, listMemoryAuditLogs } from "../src/modules/audit/service.js";
import { clearAuthStore } from "../src/modules/auth/service.js";
import { clearEvidenceStore } from "../src/modules/ingestion/store.js";
import { AGENT_REVIEW_QUEUE, clearJobQueueStore, listMemoryJobs } from "../src/modules/jobs/queue.js";
import { clearNotificationStore } from "../src/modules/notifications/service.js";
import { clearPipelineStore } from "../src/modules/pipeline/service.js";
import { clearProviderStore } from "../src/modules/providers/store.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const wallet = "0x1111111111111111111111111111111111111111";
const observedAt = isoMinutesFromNow(0);
const reviewerToken = signJwt({
  sub: "7af7b612-2b58-4ed4-87bc-a2eb02225729",
  email: "reviewer@gridproof.test",
  app_metadata: { role: "reviewer" }
});
const adminToken = signJwt({
  sub: "f6abb3f0-e8fa-4518-8de0-87b40dd186aa",
  email: "admin@gridproof.test",
  app_metadata: { role: "admin" }
});
const reporterToken = signJwt({
  sub: "c9674aa0-5116-476e-9c26-92b7692893b7",
  email: "reporter@gridproof.test",
  app_metadata: { role: "reporter" }
});
const publicToken = signJwt({
  sub: "ef37931b-93ef-44f9-b5e3-8356394a0b90",
  email: "public@gridproof.test",
  app_metadata: { role: "public" }
});
const originalNodeEnv = process.env.NODE_ENV;

describe("GridProof API", () => {
  afterEach(() => {
    clearEvidenceStore();
    clearJobQueueStore();
    clearNotificationStore();
    clearPipelineStore();
    clearProviderStore();
    clearRateLimitStore();
    clearAuditLogStore();
    clearAuthStore();
    delete process.env.TELEMETRY_HMAC_SECRET;
    delete process.env.INGEST_RATE_LIMIT_MAX;
    delete process.env.INGEST_RATE_LIMIT_WINDOW_MS;
    delete process.env.INGEST_MAX_EVENT_AGE_MS;
    delete process.env.INGEST_MAX_CLOCK_SKEW_MS;
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    delete process.env.NOTIFICATION_WEBHOOK_TOKEN;
    delete process.env.NOTIFICATION_WEBHOOK_TIMEOUT_MS;
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    delete process.env.REDIS_URL;
    delete process.env.JOB_QUEUE_USE_REDIS_FOR_TESTS;
    delete process.env.AGENT_REVIEW_QUEUE_ATTEMPTS;
    delete process.env.AGENT_REVIEW_QUEUE_BACKOFF_MS;
    delete process.env.GRIDPROOF_AUTH_INVITE_CODE;
    delete process.env.GRIDPROOF_EVIDENCE_MODE;
    delete process.env.GRIDPROOF_DEMO_ENABLED;
    delete process.env.GRIDPROOF_DEMO_ALLOW_CHAIN_WRITE;
    delete process.env.CORS_ORIGIN;
    delete process.env.CORS_ORIGINS;
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_JWT_SECRET;
    delete process.env.BOTCHAIN_RPC_URL;
    delete process.env.BOTCHAIN_CHAIN_ID;
    delete process.env.BOTCHAIN_EXPLORER_BASE_URL;
    delete process.env.BOTCHAIN_NODE_REGISTRY_ADDRESS;
    delete process.env.BOTCHAIN_UPTIME_ATTESTATION_ADDRESS;
    delete process.env.BOTCHAIN_REPUTATION_ESCROW_ADDRESS;
    delete process.env.RELAYER_PRIVATE_KEY;
    delete process.env.SENTRY_DSN;
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("returns health", async () => {
    const response = await request(createApp()).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.service).toBe("gridproof-api");
  });

  it("returns process metrics", async () => {
    const response = await request(createApp()).get("/api/v1/metrics");

    expect(response.status).toBe(200);
    expect(response.body.uptimeSeconds).toEqual(expect.any(Number));
    expect(response.body.counters).toMatchObject({
      evidenceIngested: expect.any(Number),
      candidatesDetected: expect.any(Number),
      agentDecisions: expect.any(Number),
      chainSubmissions: expect.any(Number),
      failures: expect.any(Number)
    });
  });

  it("returns a redacted deployment readiness checklist", async () => {
    const response = await request(createApp()).get("/api/v1/readiness");

    expect(response.status).toBe(503);
    expect(response.body.ok).toBe(false);
    expect(response.body.service).toBe("gridproof-api");
    expect(response.body.status).toBe("not_ready");
    expect(response.body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "database",
          status: "fail",
          missingEnv: ["DATABASE_URL"]
        }),
        expect.objectContaining({
          name: "bot_chain_relayer",
          status: "fail",
          missingEnv: expect.arrayContaining(["BOTCHAIN_RPC_URL", "RELAYER_PRIVATE_KEY"])
        })
      ])
    );
  });

  it("returns ready readiness when production demo env categories are configured without leaking values", async () => {
    process.env.CORS_ORIGINS = "https://gridproof.example";
    process.env.DATABASE_URL = "postgres://gridproof:secret@db.gridproof.test:5432/gridproof";
    process.env.REDIS_URL = "rediss://default:secret@redis.gridproof.test:6379";
    process.env.SUPABASE_JWT_SECRET = "supabase-secret";
    process.env.GRIDPROOF_AUTH_INVITE_CODE = "invite-secret";
    process.env.GRIDPROOF_EVIDENCE_MODE = "hybrid";
    process.env.TELEMETRY_HMAC_SECRET = "telemetry-secret";
    process.env.WHATSAPP_WEBHOOK_SECRET = "webhook-secret";
    process.env.BOTCHAIN_RPC_URL = "https://rpc.botchain.test";
    process.env.BOTCHAIN_CHAIN_ID = "3636";
    process.env.BOTCHAIN_EXPLORER_BASE_URL = "https://explorer.botchain.test";
    process.env.BOTCHAIN_NODE_REGISTRY_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.BOTCHAIN_UPTIME_ATTESTATION_ADDRESS = "0x2222222222222222222222222222222222222222";
    process.env.BOTCHAIN_REPUTATION_ESCROW_ADDRESS = "0x3333333333333333333333333333333333333333";
    process.env.RELAYER_PRIVATE_KEY = "0xsupersecret";
    process.env.NOTIFICATION_WEBHOOK_URL = "https://notifications.gridproof.test/webhook";
    process.env.SENTRY_DSN = "https://public@sentry.gridproof.test/1";

    const response = await request(createApp()).get("/api/v1/readiness");
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.status).toBe("ready");
    expect(response.body.checks.every((check: { status: string }) => check.status === "pass")).toBe(true);
    expect(serialized).not.toContain("supabase-secret");
    expect(serialized).not.toContain("invite-secret");
    expect(serialized).not.toContain("telemetry-secret");
    expect(serialized).not.toContain("webhook-secret");
    expect(serialized).not.toContain("0xsupersecret");
    expect(serialized).not.toContain("rpc.botchain.test");
    expect(serialized).not.toContain("db.gridproof.test");
  });

  it("only returns browser CORS headers for configured frontend origins", async () => {
    process.env.CORS_ORIGINS = "https://gridproof.example,https://demo.gridproof.example";
    const app = createApp();

    const allowed = await request(app)
      .options("/api/v1/health")
      .set("Origin", "https://gridproof.example")
      .set("Access-Control-Request-Method", "GET");
    const denied = await request(app)
      .options("/api/v1/health")
      .set("Origin", "https://attacker.example")
      .set("Access-Control-Request-Method", "GET");

    expect(allowed.headers["access-control-allow-origin"]).toBe("https://gridproof.example");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns anonymous auth state before Supabase auth is configured", async () => {
    const response = await request(createApp()).get("/api/v1/auth/me");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user: null });
  });

  it("returns the current authenticated user from a Supabase-compatible JWT", async () => {
    const response = await request(createApp()).get("/api/v1/auth/me").set("Authorization", `Bearer ${reviewerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe("reviewer");
    expect(response.body.user.phoneOrEmail).toBe("reviewer@gridproof.test");
  });

  it("registers reporter sessions and returns a reusable bearer token", async () => {
    const app = createApp();
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ phoneOrEmail: "Reporter@GridProof.test", role: "reporter" });

    expect(registration.status).toBe(201);
    expect(registration.body.user).toMatchObject({
      role: "reporter",
      phoneOrEmail: "reporter@gridproof.test"
    });
    expect(registration.body.token).toEqual(expect.any(String));
    expect(registration.body.expiresAt).toEqual(expect.any(String));
    expect(listMemoryAuditLogs("user.registered")[0]?.after?.user).toMatchObject({
      role: "reporter",
      phoneOrEmail: "reporter@gridproof.test"
    });

    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${registration.body.token}`);

    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(registration.body.user.id);
    expect(me.body.user.role).toBe("reporter");
  });

  it("logs in previously registered demo users", async () => {
    const app = createApp();
    await request(app).post("/api/v1/auth/register").send({ phoneOrEmail: "+2348012345678", role: "reporter" });

    const login = await request(app).post("/api/v1/auth/login").send({ phoneOrEmail: "+2348012345678" });

    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({
      role: "reporter",
      phoneOrEmail: "+2348012345678"
    });
    expect(login.body.token).toEqual(expect.any(String));
  });

  it("requires an invite code for reviewer and admin registration", async () => {
    const forbidden = await request(createApp())
      .post("/api/v1/auth/register")
      .send({ phoneOrEmail: "reviewer@gridproof.test", role: "reviewer" });

    process.env.GRIDPROOF_AUTH_INVITE_CODE = "demo-invite";
    const allowed = await request(createApp())
      .post("/api/v1/auth/register")
      .send({ phoneOrEmail: "reviewer@gridproof.test", role: "reviewer", inviteCode: "demo-invite" });

    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("INVITE_REQUIRED");
    expect(allowed.status).toBe(201);
    expect(allowed.body.user.role).toBe("reviewer");
  });

  it("returns structured 404 errors for unknown routes", async () => {
    const response = await request(createApp()).get("/api/v1/missing-route");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns structured validation errors for malformed reporter reports", async () => {
    const response = await request(createApp())
      .post("/api/v1/ingest/report")
      .set("Authorization", `Bearer ${reporterToken}`)
      .send({ status: "grid_down" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("requires reporter auth for web reporter ingestion", async () => {
    const unauthenticated = await request(createApp())
      .post("/api/v1/ingest/report")
      .send({
        reporterWallet: wallet,
        zoneId,
        idempotencyKey: "reporter-auth-required",
        observedAt,
        status: "grid_down",
        note: "No power here."
      });
    const publicUser = await request(createApp())
      .post("/api/v1/ingest/report")
      .set("Authorization", `Bearer ${publicToken}`)
      .send({
        reporterWallet: wallet,
        zoneId,
        idempotencyKey: "reporter-auth-forbidden",
        observedAt,
        status: "grid_down",
        note: "No power here."
      });

    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe("UNAUTHENTICATED");
    expect(publicUser.status).toBe(403);
    expect(publicUser.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects telemetry whose observedAt is implausibly far in the future", async () => {
    const response = await request(createApp())
      .post("/api/v1/ingest/telemetry")
      .send({
        deviceId: "esp32-ogb-a-future",
        providerWallet: wallet,
        zoneId,
        idempotencyKey: "esp32-ogb-a-future-2026-08-09T10:00:00Z",
        observedAt: isoMinutesFromNow(10),
        status: "grid_down",
        voltage: 0,
        signature: "f".repeat(64)
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("OBSERVED_AT_OUT_OF_RANGE");
    expect(response.body.error.message).toContain("future");
  });

  it("rejects reporter evidence outside the accepted event age window", async () => {
    const response = await request(createApp())
      .post("/api/v1/ingest/report")
      .set("Authorization", `Bearer ${reporterToken}`)
      .send({
        reporterWallet: wallet,
        zoneId,
        idempotencyKey: "reporter-ogb-a-too-old-2026-08-09T10:00:00Z",
        observedAt: isoHoursFromNow(-25),
        status: "grid_down",
        note: "Found this yesterday, but only sending now."
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("OBSERVED_AT_OUT_OF_RANGE");
    expect(response.body.error.message).toContain("older");
  });

  it("rejects telemetry when the configured HMAC signature does not match", async () => {
    process.env.TELEMETRY_HMAC_SECRET = "test-secret";

    const response = await request(createApp())
      .post("/api/v1/ingest/telemetry")
      .send({
        deviceId: "esp32-ogb-a-bad-sig",
        providerWallet: wallet,
        zoneId,
        idempotencyKey: "esp32-ogb-a-bad-sig-2026-08-09T10:00:00Z",
        observedAt,
        status: "grid_down",
        voltage: 0,
        signature: "0".repeat(64)
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("BAD_SIGNATURE");
  });

  it("fails closed for production telemetry when the HMAC secret is not configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGINS = "https://gridproof.example";

    const response = await request(createApp())
      .post("/api/v1/ingest/telemetry")
      .send({
        deviceId: "esp32-prod-no-secret",
        providerWallet: wallet,
        zoneId,
        idempotencyKey: "esp32-prod-no-secret-2026-08-09T10:00:00Z",
        observedAt,
        status: "grid_down",
        voltage: 0,
        signature: "f".repeat(64)
      });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("TELEMETRY_HMAC_SECRET_REQUIRED");
  });

  it("disables reporter ingestion while running in sensor-only mode", async () => {
    process.env.GRIDPROOF_EVIDENCE_MODE = "sensor";

    const response = await request(createApp())
      .post("/api/v1/ingest/report")
      .send({
        reporterWallet: wallet,
        zoneId,
        idempotencyKey: "reporter-disabled-in-sensor-mode",
        observedAt,
        status: "grid_down",
        note: "No power here."
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("EVIDENCE_SOURCE_DISABLED");
    expect(response.body.error.message).toContain("GRIDPROOF_EVIDENCE_MODE=sensor");
  });

  it("disables sensor telemetry while running in reporter-only mode", async () => {
    process.env.GRIDPROOF_EVIDENCE_MODE = "reporter";

    const response = await request(createApp())
      .post("/api/v1/ingest/telemetry")
      .send({
        deviceId: "esp32-disabled-in-reporter-mode",
        providerWallet: wallet,
        zoneId,
        idempotencyKey: "esp32-disabled-in-reporter-mode",
        observedAt,
        status: "grid_down",
        voltage: 0,
        signature: "f".repeat(64)
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("EVIDENCE_SOURCE_DISABLED");
    expect(response.body.error.message).toContain("GRIDPROOF_EVIDENCE_MODE=reporter");
  });

  it("fails ingestion loudly when the evidence mode configuration is invalid", async () => {
    process.env.GRIDPROOF_EVIDENCE_MODE = "hardware";

    const response = await request(createApp())
      .post("/api/v1/ingest/telemetry")
      .send({
        deviceId: "esp32-invalid-mode",
        providerWallet: wallet,
        zoneId,
        idempotencyKey: "esp32-invalid-mode",
        observedAt,
        status: "grid_down",
        voltage: 0,
        signature: "f".repeat(64)
      });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("EVIDENCE_MODE_INVALID");
  });

  it("reports why chain submission is skipped when no database is configured", async () => {
    const response = await request(createApp())
      .post("/api/v1/chain/submit-pending")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.submitted).toBe(0);
    expect(response.body.reason).toContain("DATABASE_URL");
    expect(listMemoryAuditLogs("chain_submission.skipped")[0]?.after?.reason).toContain("DATABASE_URL");
  });

  it("requires an admin role to trigger pending chain submissions", async () => {
    const unauthenticated = await request(createApp()).post("/api/v1/chain/submit-pending").send({});
    const reporter = await request(createApp())
      .post("/api/v1/chain/submit-pending")
      .set("Authorization", `Bearer ${reporterToken}`)
      .send({});

    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe("UNAUTHENTICATED");
    expect(reporter.status).toBe(403);
    expect(reporter.body.error.code).toBe("FORBIDDEN");
  });

  it("reports why chain confirmation indexing is skipped when no database is configured", async () => {
    const response = await request(createApp())
      .post("/api/v1/chain/index-confirmations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.confirmed).toBe(0);
    expect(response.body.reason).toContain("DATABASE_URL");
    expect(listMemoryAuditLogs("chain_index.skipped")[0]?.after?.reason).toContain("DATABASE_URL");
  });

  it("registers and lists evidence providers for a zone", async () => {
    const response = await request(createApp())
      .post("/api/v1/providers")
      .set("Authorization", `Bearer ${reporterToken}`)
      .send({
        walletAddress: "0x4444444444444444444444444444444444444444",
        providerType: "reporter",
        zoneId
      });

    expect(response.status).toBe(201);
    expect(response.body.duplicate).toBe(false);
    expect(response.body.provider).toMatchObject({
      walletAddress: "0x4444444444444444444444444444444444444444",
      providerType: "reporter",
      zoneId,
      active: true,
      reputationCache: 0
    });
    expect(response.body.chainRegistration).toMatchObject({
      configured: false,
      mode: "wallet_self_service",
      providerWallet: "0x4444444444444444444444444444444444444444",
      providerTypeId: 1,
      zoneId,
      zoneKey: `0x${"a".repeat(64)}`,
      registerCall: {
        to: null,
        functionName: "register",
        args: [`0x${"a".repeat(64)}`, 1],
        data: null
      }
    });

    const listing = await request(createApp()).get("/api/v1/providers");

    expect(listing.status).toBe(200);
    expect(listing.body.providers).toEqual([response.body.provider]);
    expect(listMemoryAuditLogs("provider.registered")[0]?.after?.provider).toMatchObject({
      id: response.body.provider.id,
      walletAddress: "0x4444444444444444444444444444444444444444"
    });
  });

  it("deduplicates unchanged provider registrations by wallet address", async () => {
    const body = {
      walletAddress: "0x5555555555555555555555555555555555555555",
      providerType: "sensor",
      zoneId
    } as const;

    const first = await request(createApp()).post("/api/v1/providers").set("Authorization", `Bearer ${adminToken}`).send(body);
    const second = await request(createApp()).post("/api/v1/providers").set("Authorization", `Bearer ${adminToken}`).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.provider.id).toBe(first.body.provider.id);
    expect(listMemoryAuditLogs("provider.registered")).toHaveLength(1);
  });

  it("requires reporter-or-higher auth for provider registration", async () => {
    const body = {
      walletAddress: "0x6666666666666666666666666666666666666666",
      providerType: "reporter",
      zoneId
    };

    const unauthenticated = await request(createApp()).post("/api/v1/providers").send(body);
    const publicUser = await request(createApp())
      .post("/api/v1/providers")
      .set("Authorization", `Bearer ${publicToken}`)
      .send(body);

    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe("UNAUTHENTICATED");
    expect(publicUser.status).toBe(403);
    expect(publicUser.body.error.code).toBe("FORBIDDEN");
  });

  it("requires an admin role to index chain confirmations", async () => {
    const unauthenticated = await request(createApp()).post("/api/v1/chain/index-confirmations").send({});
    const reporter = await request(createApp())
      .post("/api/v1/chain/index-confirmations")
      .set("Authorization", `Bearer ${reporterToken}`)
      .send({});

    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe("UNAUTHENTICATED");
    expect(reporter.status).toBe(403);
    expect(reporter.body.error.code).toBe("FORBIDDEN");
  });

  it("deduplicates telemetry events by idempotency key", async () => {
    process.env.TELEMETRY_HMAC_SECRET = "test-secret";
    const idempotencyKey = "esp32-ogb-a-1-2026-08-09T10:00:00Z";
    const body = {
      deviceId: "esp32-ogb-a-1",
      providerWallet: wallet,
      zoneId,
      idempotencyKey,
      observedAt,
      status: "grid_down",
      voltage: 0
    };

    const signature = createHmac("sha256", process.env.TELEMETRY_HMAC_SECRET)
      .update([body.deviceId, wallet, zoneId, idempotencyKey, observedAt, body.status, body.voltage].join("."))
      .digest("hex");

    const first = await request(createApp()).post("/api/v1/ingest/telemetry").send({ ...body, signature });
    const second = await request(createApp()).post("/api/v1/ingest/telemetry").send({ ...body, signature });

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(first.body.evidenceEvent.id).toBe(second.body.evidenceEvent.id);
    expect(second.body.duplicate).toBe(true);
  });

  it("rate-limits telemetry by device identity", async () => {
    process.env.INGEST_RATE_LIMIT_MAX = "1";
    process.env.INGEST_RATE_LIMIT_WINDOW_MS = "60000";

    const first = await request(createApp())
      .post("/api/v1/ingest/telemetry")
      .send({
        deviceId: "esp32-rate-limited",
        providerWallet: wallet,
        zoneId,
        idempotencyKey: "esp32-rate-limited-2026-08-09T10:00:00Z",
        observedAt,
        status: "grid_down",
        voltage: 0,
        signature: "f".repeat(64)
      });
    const second = await request(createApp())
      .post("/api/v1/ingest/telemetry")
      .send({
        deviceId: "esp32-rate-limited",
        providerWallet: wallet,
        zoneId,
        idempotencyKey: "esp32-rate-limited-2026-08-09T10:01:00Z",
        observedAt: isoMinutesFromNow(1),
        status: "grid_down",
        voltage: 0,
        signature: "f".repeat(64)
      });

    expect(first.status).toBe(202);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("RATE_LIMITED");
    expect(second.headers["retry-after"]).toBeDefined();
  });

  it("rate-limits reporter ingest by reporter wallet", async () => {
    process.env.INGEST_RATE_LIMIT_MAX = "1";
    process.env.INGEST_RATE_LIMIT_WINDOW_MS = "60000";

    const first = await request(createApp())
      .post("/api/v1/ingest/report")
      .set("Authorization", `Bearer ${reporterToken}`)
      .send({
        reporterWallet: "0x2222222222222222222222222222222222222222",
        zoneId,
        idempotencyKey: "reporter-rate-limited-2026-08-09T10:00:00Z",
        observedAt,
        status: "grid_up",
        note: "Power is back."
      });
    const second = await request(createApp())
      .post("/api/v1/ingest/report")
      .set("Authorization", `Bearer ${reporterToken}`)
      .send({
        reporterWallet: "0x2222222222222222222222222222222222222222",
        zoneId,
        idempotencyKey: "reporter-rate-limited-2026-08-09T10:01:00Z",
        observedAt: isoMinutesFromNow(1),
        status: "grid_down",
        note: "Power dropped again."
      });

    expect(first.status).toBe(202);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("RATE_LIMITED");
  });

  it("ingests WhatsApp webhook reports into the same reporter evidence pipeline", async () => {
    const response = await request(createApp())
      .post("/api/v1/ingest/whatsapp-webhook")
      .send({
        source: "whatsapp_cloud",
        messageId: "wamid-gridproof-restored-1",
        fromPhone: "+2348012345678",
        reporterWallet: wallet,
        zoneId,
        observedAt,
        text: "Power is back on my street"
      });

    expect(response.status).toBe(202);
    expect(response.body.evidenceEvent.source).toBe("reporter");
    expect(response.body.evidenceEvent.status).toBe("grid_up");
    expect(response.body.evidenceEvent.idempotencyKey).toBe("whatsapp:whatsapp_cloud:wamid-gridproof-restored-1");
    expect(response.body.evidenceEvent.rawPayload.note).toContain("+2348012345678");
    expect(response.body.candidateEvent.status).toBe("restored");
  });

  it("verifies WhatsApp webhook signatures when a webhook secret is configured", async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = "webhook-secret";
    const body = {
      source: "whatsapp_cloud",
      messageId: "wamid-gridproof-signed-1",
      fromPhone: "+2348012345678",
      reporterWallet: wallet,
      zoneId,
      observedAt,
      text: "No light on my street"
    };
    const signature = createHmac("sha256", process.env.WHATSAPP_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest("hex");

    const accepted = await request(createApp())
      .post("/api/v1/ingest/whatsapp-webhook")
      .set("X-Hub-Signature-256", `sha256=${signature}`)
      .send(body);
    const rejected = await request(createApp())
      .post("/api/v1/ingest/whatsapp-webhook")
      .set("X-Hub-Signature-256", `sha256=${"0".repeat(64)}`)
      .send({ ...body, messageId: "wamid-gridproof-signed-2" });

    expect(accepted.status).toBe(202);
    expect(accepted.body.evidenceEvent.status).toBe("grid_down");
    expect(rejected.status).toBe(401);
    expect(rejected.body.error.code).toBe("BAD_WEBHOOK_SIGNATURE");
  });

  it("fails closed for production WhatsApp webhooks when the webhook secret is not configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGINS = "https://gridproof.example";

    const response = await request(createApp())
      .post("/api/v1/ingest/whatsapp-webhook")
      .send({
        source: "whatsapp_cloud",
        messageId: "wamid-gridproof-prod-no-secret-1",
        fromPhone: "+2348012345678",
        reporterWallet: wallet,
        zoneId,
        observedAt,
        text: "No power here"
      });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("WHATSAPP_WEBHOOK_SECRET_REQUIRED");
  });

  it("deduplicates WhatsApp webhook reports by provider message id", async () => {
    const body = {
      messageId: "wamid-gridproof-duplicate-1",
      fromPhone: "+2348012345678",
      reporterWallet: wallet,
      zoneId,
      observedAt,
      text: "No power here"
    };

    const first = await request(createApp()).post("/api/v1/ingest/whatsapp-webhook").send(body);
    const second = await request(createApp()).post("/api/v1/ingest/whatsapp-webhook").send(body);

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.evidenceEvent.id).toBe(first.body.evidenceEvent.id);
  });

  it("rejects malformed WhatsApp webhook reports with structured validation errors", async () => {
    const response = await request(createApp())
      .post("/api/v1/ingest/whatsapp-webhook")
      .send({
        messageId: "short",
        text: ""
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rate-limits WhatsApp webhook reports by reporter identity", async () => {
    process.env.INGEST_RATE_LIMIT_MAX = "1";
    process.env.INGEST_RATE_LIMIT_WINDOW_MS = "60000";
    const reporterWallet = "0x3333333333333333333333333333333333333333";

    const first = await request(createApp())
      .post("/api/v1/ingest/whatsapp-webhook")
      .send({
        messageId: "wamid-rate-limit-1",
        fromPhone: "+2348099999999",
        reporterWallet,
        zoneId,
        observedAt,
        text: "No light"
      });
    const second = await request(createApp())
      .post("/api/v1/ingest/whatsapp-webhook")
      .send({
        messageId: "wamid-rate-limit-2",
        fromPhone: "+2348099999999",
        reporterWallet,
        zoneId,
        observedAt: isoMinutesFromNow(1),
        text: "Still no light"
      });

    expect(first.status).toBe(202);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("RATE_LIMITED");
  });

  it("accepts unknown telemetry without creating a candidate or fabricated proof", async () => {
    const noCandidateZoneId = "22222222-2222-4222-8222-222222222222";
    const response = await request(createApp())
      .post("/api/v1/ingest/telemetry")
      .send({
        deviceId: "esp32-ogb-a-unknown",
        providerWallet: wallet,
        zoneId: noCandidateZoneId,
        idempotencyKey: "esp32-ogb-a-unknown-2026-08-09T10:05:00Z",
        observedAt: isoMinutesFromNow(1),
        status: "unknown",
        signature: "f".repeat(64)
      });

    expect(response.status).toBe(202);
    expect(response.body.candidateEvent).toBeNull();

    const proof = await request(createApp()).get(`/api/v1/chain/proof/${noCandidateZoneId}/latest`);

    expect(proof.status).toBe(200);
    expect(proof.body.epochScore).toBeNull();
    expect(proof.body.commitment).toBeNull();
  });

  it("routes high-confidence sensor evidence into a pending proof", async () => {
    const idempotencyKey = "esp32-ogb-a-2-2026-08-09T10:10:00Z";
    const response = await request(createApp())
      .post("/api/v1/ingest/telemetry")
      .send({
        deviceId: "esp32-ogb-a-2",
        providerWallet: wallet,
        zoneId,
        idempotencyKey,
        observedAt: isoMinutesFromNow(1),
        status: "grid_down",
        voltage: 0,
        signature: "f".repeat(64)
      });

    expect(response.status).toBe(202);
    expect(response.body.candidateEvent.status).toBe("outage");
    expect(response.body.candidateEvent.confidence).toBe(0.95);

    const proof = await request(createApp()).get(`/api/v1/chain/proof/${zoneId}/latest`);

    expect(proof.status).toBe(200);
    expect(proof.body.epochScore.uptimeBps).toBe(0);
    expect(proof.body.commitment.status).toBe("pending");

    const history = await request(createApp()).get(`/api/v1/zones/${zoneId}/history`);

    expect(history.status).toBe(200);
    expect(history.body.zone.id).toBe(zoneId);
    expect(history.body.candidates[0]).toMatchObject({
      id: response.body.candidateEvent.id,
      status: "outage",
      evidenceEventIds: [response.body.evidenceEvent.id]
    });
    expect(history.body.epochScores[0]).toMatchObject({
      zoneId,
      uptimeBps: 0
    });
    expect(history.body.trend).toBe("stable");
    expect(listMemoryAuditLogs("agent_decision.created")[0]?.after?.decision).toMatchObject({
      candidateEventId: response.body.candidateEvent.id,
      decision: "approve"
    });
    expect(listMemoryAuditLogs("chain_commitment.queued")[0]?.after?.source).toBe("agent_auto_approval");

    const alerts = await request(createApp()).get("/api/v1/alerts");

    expect(alerts.status).toBe(200);
    expect(alerts.body.alerts[0]).toMatchObject({
      candidateEventId: response.body.candidateEvent.id,
      zoneId,
      status: "outage",
      decision: "approve",
      hypothesis: "Candidate outage passed deterministic confidence threshold.",
      supportingEvidenceIds: [response.body.evidenceEvent.id]
    });
  });

  it("routes ambiguous reporter evidence into the review queue", async () => {
    await request(createApp())
      .post("/api/v1/ingest/telemetry")
      .send({
        deviceId: "esp32-ogb-a-3",
        providerWallet: wallet,
        zoneId,
        idempotencyKey: "esp32-ogb-a-3-2026-08-09T10:10:00Z",
        observedAt: isoMinutesFromNow(1),
        status: "grid_down",
        voltage: 0,
        signature: "f".repeat(64)
      });

    const response = await request(createApp())
      .post("/api/v1/ingest/report")
      .set("Authorization", `Bearer ${reporterToken}`)
      .send({
        reporterWallet: wallet,
        zoneId,
        idempotencyKey: "reporter-ogb-a-1-2026-08-09T10:15:00Z",
        observedAt: isoMinutesFromNow(2),
        status: "grid_up",
        note: "Power appears restored from my house."
      });

    expect(response.status).toBe(202);
    expect(response.body.candidateEvent.confidence).toBe(0.65);

    const reviewQueue = await request(createApp())
      .get("/api/v1/admin/review-queue")
      .set("Authorization", `Bearer ${reviewerToken}`);

    expect(reviewQueue.status).toBe(200);
    expect(reviewQueue.body.items[0].decision).toBe("escalate");
    expect(reviewQueue.body.items[0].candidate.status).toBe("restored");
    expect(listMemoryJobs(AGENT_REVIEW_QUEUE)[0]).toMatchObject({
      queueName: AGENT_REVIEW_QUEUE,
      name: "candidate-review",
      backend: "memory",
      data: {
        candidate: {
          id: response.body.candidateEvent.id,
          status: "restored"
        },
        evidence: [
          {
            id: response.body.evidenceEvent.id,
            source: "reporter"
          }
        ],
        providers: []
      }
    });
    expect(listMemoryAuditLogs("agent_review.queued")[0]?.after).toMatchObject({
      queueName: AGENT_REVIEW_QUEUE,
      backend: "memory",
      candidateEventId: response.body.candidateEvent.id
    });

    const reviewId = reviewQueue.body.items[0].id;
    const approval = await request(createApp())
      .post(`/api/v1/admin/review/${reviewId}/decision`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ decision: "approve", note: "Confirmed by reviewer." });

    expect(approval.status).toBe(200);
    expect(approval.body.epochScore.uptimeBps).toBe(5000);
    const reviewAudit = listMemoryAuditLogs("review.decision_resolved")[0];
    expect(reviewAudit?.actorUserId).toBe("7af7b612-2b58-4ed4-87bc-a2eb02225729");
    expect(reviewAudit?.before?.decision).toMatchObject({
      id: reviewId,
      decision: "escalate"
    });
    expect(reviewAudit?.after?.decision).toMatchObject({
      id: reviewId,
      decision: "approve"
    });
    expect(reviewAudit?.after?.reviewer).toMatchObject({
      id: "7af7b612-2b58-4ed4-87bc-a2eb02225729",
      role: "reviewer",
      phoneOrEmail: "reviewer@gridproof.test"
    });
    expect(
      listMemoryAuditLogs("chain_commitment.queued").some((item) => item.after?.source === "review_approval")
    ).toBe(true);
  });

  it("rejects ambiguous reviewer items without creating a commitment", async () => {
    const report = await request(createApp())
      .post("/api/v1/ingest/report")
      .set("Authorization", `Bearer ${reporterToken}`)
      .send({
        reporterWallet: wallet,
        zoneId,
        idempotencyKey: "reporter-ogb-a-reject-2026-08-09T11:15:00Z",
        observedAt: isoMinutesFromNow(1),
        status: "grid_down",
        note: "Lights flickered, not certain."
      });

    expect(report.status).toBe(202);

    const reviewQueue = await request(createApp())
      .get("/api/v1/admin/review-queue")
      .set("Authorization", `Bearer ${reviewerToken}`);
    const reviewItem = reviewQueue.body.items.find(
      (item: { candidate: { evidenceEventIds: string[] } }) =>
        item.candidate.evidenceEventIds.includes(report.body.evidenceEvent.id)
    );

    expect(reviewItem).toBeDefined();

    const rejection = await request(createApp())
      .post(`/api/v1/admin/review/${reviewItem.id}/decision`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ decision: "reject", note: "Insufficient evidence." });

    expect(rejection.status).toBe(200);
    expect(rejection.body.decision.decision).toBe("reject");
    expect(rejection.body.epochScore).toBeNull();
    expect(rejection.body.commitment).toBeNull();
  });

  it("role-gates reviewer queue access", async () => {
    const unauthenticated = await request(createApp()).get("/api/v1/admin/review-queue");
    const reporter = await request(createApp())
      .get("/api/v1/admin/review-queue")
      .set("Authorization", `Bearer ${reporterToken}`);
    const admin = await request(createApp())
      .get("/api/v1/admin/review-queue")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(unauthenticated.status).toBe(401);
    expect(reporter.status).toBe(403);
    expect(admin.status).toBe(200);
  });

  it("role-gates reviewer decision access", async () => {
    const unauthenticated = await request(createApp())
      .post("/api/v1/admin/review/a216864f-a58c-453f-a99e-8038cf314942/decision")
      .send({ decision: "approve", note: "Looks valid." });
    const reporter = await request(createApp())
      .post("/api/v1/admin/review/a216864f-a58c-453f-a99e-8038cf314942/decision")
      .set("Authorization", `Bearer ${reporterToken}`)
      .send({ decision: "approve", note: "Looks valid." });

    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe("UNAUTHENTICATED");
    expect(reporter.status).toBe(403);
    expect(reporter.body.error.code).toBe("FORBIDDEN");
  });

  it("role-gates notification outbox access", async () => {
    const unauthenticated = await request(createApp()).get("/api/v1/admin/notifications");
    const reporter = await request(createApp()).get("/api/v1/admin/notifications").set("Authorization", `Bearer ${reporterToken}`);
    const reviewer = await request(createApp())
      .get("/api/v1/admin/notifications")
      .set("Authorization", `Bearer ${reviewerToken}`);

    expect(unauthenticated.status).toBe(401);
    expect(reporter.status).toBe(403);
    expect(reviewer.status).toBe(200);
    expect(reviewer.body.notifications).toEqual([]);
  });
});

function signJwt(payload: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const body = base64UrlJson({
    iat: now,
    exp: now + 60 * 60,
    ...payload
  });
  const signature = createHmac("sha256", "gridproof-local-dev-jwt-secret")
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function isoMinutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function isoHoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
