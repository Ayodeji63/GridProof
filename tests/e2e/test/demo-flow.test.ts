import { createHmac } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../apps/api/src/app.js";
import { clearRateLimitStore } from "../../../apps/api/src/middleware/rate-limit.js";
import { clearAuditLogStore, listMemoryAuditLogs } from "../../../apps/api/src/modules/audit/service.js";
import { clearAuthStore } from "../../../apps/api/src/modules/auth/service.js";
import { clearEvidenceStore } from "../../../apps/api/src/modules/ingestion/store.js";
import { clearJobQueueStore } from "../../../apps/api/src/modules/jobs/queue.js";
import { attachNotifications, clearNotificationStore } from "../../../apps/api/src/modules/notifications/service.js";
import { clearPipelineStore } from "../../../apps/api/src/modules/pipeline/service.js";
import { clearProviderStore } from "../../../apps/api/src/modules/providers/store.js";
import { resetMetrics } from "../../../apps/api/src/lib/metrics.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const reporterWallet = "0x1111111111111111111111111111111111111111";
const sensorWallet = "0x2222222222222222222222222222222222222222";
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
describe("GridProof demo end-to-end API flow", () => {
  let detachNotifications: (() => void) | null = null;
  let previousDatabaseUrl: string | undefined;

  beforeEach(() => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    clearStores();
    resetMetrics();
    detachNotifications = attachNotifications();
  });

  afterEach(() => {
    detachNotifications?.();
    detachNotifications = null;
    clearStores();
    resetMetrics();

    if (previousDatabaseUrl) {
      process.env.DATABASE_URL = previousDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it("runs the demo loop from provider registration to proof, review, notifications, audit, and operations counters", async () => {
    const app = createApp();

    const health = await request(app).get("/api/v1/health");

    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    const reporterSession = await request(app)
      .post("/api/v1/auth/register")
      .send({ phoneOrEmail: "reporter@gridproof.test", role: "reporter" });

    expect(reporterSession.status).toBe(201);
    expect(reporterSession.body).toMatchObject({
      user: {
        role: "reporter",
        phoneOrEmail: "reporter@gridproof.test"
      }
    });

    const providerRegistration = await request(app)
      .post("/api/v1/providers")
      .set("Authorization", `Bearer ${reporterSession.body.token}`)
      .send({
        walletAddress: reporterWallet,
        providerType: "reporter",
        zoneId
      });

    expect(providerRegistration.status).toBe(201);
    expect(providerRegistration.body.provider).toMatchObject({
      walletAddress: reporterWallet.toLowerCase(),
      providerType: "reporter",
      zoneId,
      active: true
    });
    expect(providerRegistration.body.chainRegistration).toMatchObject({
      configured: false,
      mode: "wallet_self_service",
      providerTypeId: 1,
      registerCall: {
        functionName: "register",
        args: [`0x${"a".repeat(64)}`, 1]
      }
    });

    const outageEvidence = await request(app)
      .post("/api/v1/ingest/telemetry")
      .send({
        deviceId: "esp32-demo-node-1",
        providerWallet: sensorWallet,
        zoneId,
        idempotencyKey: "e2e-esp32-demo-node-1-down",
        observedAt: isoMinutesFromNow(0),
        status: "grid_down",
        voltage: 0,
        signature: "f".repeat(64)
      });

    expect(outageEvidence.status).toBe(202);
    expect(outageEvidence.body.candidateEvent).toMatchObject({
      zoneId,
      status: "outage",
      confidence: 0.95
    });

    const pendingProof = await request(app).get(`/api/v1/chain/proof/${zoneId}/latest`);

    expect(pendingProof.status).toBe(200);
    expect(pendingProof.body.epochScore).toMatchObject({
      zoneId,
      uptimeBps: 0
    });
    expect(pendingProof.body.commitment).toMatchObject({
      status: "pending",
      txHash: null
    });

    const alertsAfterOutage = await request(app).get("/api/v1/alerts");

    expect(alertsAfterOutage.status).toBe(200);
    expect(alertsAfterOutage.body.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateEventId: outageEvidence.body.candidateEvent.id,
          status: "outage",
          decision: "approve"
        })
      ])
    );

    await waitFor(async () => {
      const notifications = await request(app)
        .get("/api/v1/admin/notifications")
        .set("Authorization", `Bearer ${reviewerToken}`);
      expect(notifications.body.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "chain_committed",
            audience: "operator",
            title: "Proof queued for BOT Chain submission"
          })
        ])
      );
    });

    const restorationEvidence = await request(app)
      .post("/api/v1/ingest/report")
      .set("Authorization", `Bearer ${reporterSession.body.token}`)
      .send({
        reporterWallet,
        zoneId,
        idempotencyKey: "e2e-reporter-demo-restored",
        observedAt: isoMinutesFromNow(1),
        status: "grid_up",
        note: "Power is restored at the demo feeder."
      });

    expect(restorationEvidence.status).toBe(202);
    expect(restorationEvidence.body.candidateEvent).toMatchObject({
      zoneId,
      status: "restored",
      confidence: 0.65
    });

    const reviewQueue = await request(app)
      .get("/api/v1/admin/review-queue")
      .set("Authorization", `Bearer ${reviewerToken}`);

    expect(reviewQueue.status).toBe(200);
    const reviewItem = reviewQueue.body.items.find(
      (item: { candidateEventId: string }) => item.candidateEventId === restorationEvidence.body.candidateEvent.id
    );
    expect(reviewItem).toMatchObject({
      decision: "escalate",
      candidate: {
        status: "restored"
      }
    });

    await waitFor(async () => {
      const notifications = await request(app)
        .get("/api/v1/admin/notifications")
        .set("Authorization", `Bearer ${reviewerToken}`);
      expect(notifications.body.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "review_required",
            audience: "reviewer"
          })
        ])
      );
    });

    const approval = await request(app)
      .post(`/api/v1/admin/review/${reviewItem.id}/decision`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ decision: "approve", note: "Demo reviewer confirmed the restoration report." });

    expect(approval.status).toBe(200);
    expect(approval.body.epochScore).toMatchObject({
      zoneId,
      uptimeBps: 5000
    });
    expect(approval.body.commitment).toMatchObject({
      status: "pending",
      txHash: null
    });

    const history = await request(app).get(`/api/v1/zones/${zoneId}/history`);

    expect(history.status).toBe(200);
    expect(history.body.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: outageEvidence.body.candidateEvent.id, status: "outage" }),
        expect.objectContaining({ id: restorationEvidence.body.candidateEvent.id, status: "restored" })
      ])
    );
    expect(history.body.epochScores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          zoneId,
          uptimeBps: 5000
        })
      ])
    );

    const latestProof = await request(app).get(`/api/v1/chain/proof/${zoneId}/latest`);

    expect(latestProof.status).toBe(200);
    expect(latestProof.body.epochScore.uptimeBps).toBe(5000);
    expect(latestProof.body.commitment.status).toBe("pending");

    const chainSubmission = await request(app)
      .post("/api/v1/chain/submit-pending")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(chainSubmission.status).toBe(200);
    expect(chainSubmission.body).toMatchObject({
      submitted: 0,
      reason: "DATABASE_URL is not configured"
    });

    const metrics = await request(app).get("/api/v1/metrics");

    expect(metrics.status).toBe(200);
    expect(metrics.body.counters).toMatchObject({
      evidenceIngested: 2,
      candidatesDetected: 2,
      agentDecisions: 2,
      chainSubmissions: 2,
      failures: 0
    });

    expect(listMemoryAuditLogs("provider.registered")).toHaveLength(1);
    expect(listMemoryAuditLogs("agent_decision.created")).toHaveLength(2);
    expect(listMemoryAuditLogs("review.decision_resolved")[0]?.after?.decision).toMatchObject({
      id: reviewItem.id,
      decision: "approve"
    });
    expect(listMemoryAuditLogs("chain_commitment.queued")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ after: expect.objectContaining({ source: "agent_auto_approval" }) }),
        expect.objectContaining({ after: expect.objectContaining({ source: "review_approval" }) })
      ])
    );
    expect(listMemoryAuditLogs("chain_submission.skipped")[0]?.after).toMatchObject({
      reason: "DATABASE_URL is not configured"
    });
  });
});

function clearStores(): void {
  clearEvidenceStore();
  clearJobQueueStore();
  clearNotificationStore();
  clearPipelineStore();
  clearProviderStore();
  clearRateLimitStore();
  clearAuditLogStore();
  clearAuthStore();
}

async function waitFor(assertion: () => Promise<void>): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

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
