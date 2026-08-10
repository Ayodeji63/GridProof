import { describe, expect, it, vi } from "vitest";

import { verifyDeployment, type CheckResult } from "../../scripts/verify-deployment.ts";

type JsonBody = Record<string, unknown>;

const apiBaseUrl = "https://api.gridproof.example/api/v1";
const webUrl = "https://gridproof.example";
const workerUrl = "https://worker.gridproof.example";
const zoneId = "11111111-1111-4111-8111-111111111111";
const epoch = "2026-08-09T10:00:00.000Z";

describe("verifyDeployment", () => {
  it("passes the full public API, proof, web, and worker deployment smoke check", async () => {
    const fetchImpl = fetchFromRoutes({
      [`${apiBaseUrl}/health`]: json({ ok: true, service: "gridproof-api", timestamp: "2026-08-09T10:00:00.000Z" }),
      [`${apiBaseUrl}/metrics`]: json({
        counters: {
          evidenceIngested: 12,
          candidatesDetected: 4,
          agentDecisions: 3,
          chainSubmissions: 2,
          failures: 0
        }
      }),
      [`${apiBaseUrl}/readiness`]: json(readiness("gridproof-api", "ready")),
      [`${apiBaseUrl}/zones`]: json({ zones: [] }),
      [`${apiBaseUrl}/providers`]: json({ providers: [] }),
      [`${apiBaseUrl}/chain/proof/${zoneId}/${encodeURIComponent(epoch)}`]: json(proof("confirmed")),
      [webUrl]: html("<!doctype html><html><body><div id=\"root\"></div></body></html>"),
      [`${workerUrl}/health`]: json({ ok: true, service: "gridproof-agent-worker", ready: true }),
      [`${workerUrl}/readiness`]: json(readiness("gridproof-agent-worker", "ready"))
    });

    const checks = await verifyDeployment({
      env: {
        GRIDPROOF_API_BASE_URL: "https://api.gridproof.example",
        GRIDPROOF_WEB_URL: `${webUrl}/`,
        GRIDPROOF_WORKER_BASE_URL: `${workerUrl}/`,
        GRIDPROOF_PROOF_ZONE_ID: zoneId,
        GRIDPROOF_PROOF_EPOCH: epoch,
        GRIDPROOF_REQUIRE_CONFIRMED_PROOF: "true"
      },
      fetchImpl
    });

    expect(statuses(checks)).toEqual({
      api_health: "pass",
      api_metrics: "pass",
      api_readiness: "pass",
      api_zones: "pass",
      api_providers: "pass",
      api_proof: "pass",
      web_frontend: "pass",
      worker_health: "pass",
      worker_readiness: "pass"
    });
    expect(fetchImpl).toHaveBeenCalledWith(`${apiBaseUrl}/readiness`, expect.objectContaining({
      headers: expect.objectContaining({
        accept: "application/json,text/html;q=0.9,*/*;q=0.1",
        "user-agent": "gridproof-deployment-verifier/0.1.0"
      })
    }));
  });

  it("keeps API checks strict while warning when optional public web and worker URLs are omitted", async () => {
    const checks = await verifyDeployment({
      env: { GRIDPROOF_API_BASE_URL: apiBaseUrl },
      fetchImpl: fetchFromRoutes({
        [`${apiBaseUrl}/health`]: json({ ok: true, service: "gridproof-api", timestamp: "2026-08-09T10:00:00.000Z" }),
        [`${apiBaseUrl}/metrics`]: json({
          counters: {
            evidenceIngested: 0,
            candidatesDetected: 0,
            agentDecisions: 0,
            chainSubmissions: 0,
            failures: 0
          }
        }),
        [`${apiBaseUrl}/readiness`]: json(readiness("gridproof-api", "ready")),
        [`${apiBaseUrl}/zones`]: json({ zones: [] }),
        [`${apiBaseUrl}/providers`]: json({ providers: [] })
      })
    });

    expect(statuses(checks)).toMatchObject({
      api_health: "pass",
      api_readiness: "pass",
      api_proof: "warn",
      web_url: "warn",
      worker_health: "warn"
    });
  });

  it("accepts a pending proof during rehearsals when confirmed proof is not required", async () => {
    const checks = await verifyDeployment({
      env: {
        GRIDPROOF_API_BASE_URL: apiBaseUrl,
        GRIDPROOF_PROOF_ZONE_ID: zoneId
      },
      fetchImpl: fetchFromRoutes({
        [`${apiBaseUrl}/health`]: json({ ok: true, service: "gridproof-api", timestamp: "2026-08-09T10:00:00.000Z" }),
        [`${apiBaseUrl}/metrics`]: json({
          counters: {
            evidenceIngested: 1,
            candidatesDetected: 1,
            agentDecisions: 1,
            chainSubmissions: 1,
            failures: 0
          }
        }),
        [`${apiBaseUrl}/readiness`]: json(readiness("gridproof-api", "ready")),
        [`${apiBaseUrl}/zones`]: json({ zones: [] }),
        [`${apiBaseUrl}/providers`]: json({ providers: [] }),
        [`${apiBaseUrl}/chain/proof/${zoneId}/latest`]: json(proof("pending"))
      })
    });

    expect(byName(checks, "api_proof")).toMatchObject({
      status: "pass",
      detail: `Pending proof for epoch ${epoch}; confirmed transaction not required for this run.`
    });
  });

  it("fails pending proof data when final deployment requires a confirmed BOT Chain transaction", async () => {
    const checks = await verifyDeployment({
      env: {
        GRIDPROOF_API_BASE_URL: apiBaseUrl,
        GRIDPROOF_PROOF_ZONE_ID: zoneId,
        GRIDPROOF_REQUIRE_CONFIRMED_PROOF: "true"
      },
      fetchImpl: fetchFromRoutes({
        [`${apiBaseUrl}/health`]: json({ ok: true, service: "gridproof-api", timestamp: "2026-08-09T10:00:00.000Z" }),
        [`${apiBaseUrl}/metrics`]: json({
          counters: {
            evidenceIngested: 1,
            candidatesDetected: 1,
            agentDecisions: 1,
            chainSubmissions: 1,
            failures: 0
          }
        }),
        [`${apiBaseUrl}/readiness`]: json(readiness("gridproof-api", "ready")),
        [`${apiBaseUrl}/zones`]: json({ zones: [] }),
        [`${apiBaseUrl}/providers`]: json({ providers: [] }),
        [`${apiBaseUrl}/chain/proof/${zoneId}/latest`]: json(proof("pending"))
      })
    });

    expect(byName(checks, "api_proof")).toMatchObject({
      status: "fail",
      detail: "Expected a confirmed BOT Chain proof but commitment is pending."
    });
  });

  it("fails degraded readiness by default and reports only missing env names", async () => {
    const checks = await verifyDeployment({
      env: { GRIDPROOF_API_BASE_URL: apiBaseUrl },
      fetchImpl: fetchFromRoutes({
        [`${apiBaseUrl}/health`]: json({ ok: true, service: "gridproof-api", timestamp: "2026-08-09T10:00:00.000Z" }),
        [`${apiBaseUrl}/metrics`]: json({
          counters: {
            evidenceIngested: 1,
            candidatesDetected: 1,
            agentDecisions: 1,
            chainSubmissions: 0,
            failures: 0
          }
        }),
        [`${apiBaseUrl}/readiness`]: json(
          readiness("gridproof-api", "degraded", [
            {
              name: "bot_chain_relayer",
              status: "fail",
              missingEnv: ["BOTCHAIN_RPC_URL", "RELAYER_PRIVATE_KEY"]
            }
          ]),
          503
        ),
        [`${apiBaseUrl}/zones`]: json({ zones: [] }),
        [`${apiBaseUrl}/providers`]: json({ providers: [] })
      })
    });

    const apiReadiness = byName(checks, "api_readiness");
    expect(apiReadiness.status).toBe("fail");
    expect(apiReadiness.detail).toContain("BOTCHAIN_RPC_URL");
    expect(apiReadiness.detail).toContain("RELAYER_PRIVATE_KEY");
    expect(apiReadiness.detail).not.toContain("super-secret-relayer-key");
  });

  it("allows degraded API and worker readiness only when rehearsal override is explicit", async () => {
    const checks = await verifyDeployment({
      env: {
        GRIDPROOF_API_BASE_URL: apiBaseUrl,
        GRIDPROOF_WORKER_BASE_URL: workerUrl,
        GRIDPROOF_ALLOW_DEGRADED_READINESS: "true"
      },
      fetchImpl: fetchFromRoutes({
        [`${apiBaseUrl}/health`]: json({ ok: true, service: "gridproof-api", timestamp: "2026-08-09T10:00:00.000Z" }),
        [`${apiBaseUrl}/metrics`]: json({
          counters: {
            evidenceIngested: 1,
            candidatesDetected: 1,
            agentDecisions: 1,
            chainSubmissions: 0,
            failures: 0
          }
        }),
        [`${apiBaseUrl}/readiness`]: json(
          readiness("gridproof-api", "degraded", [
            { name: "notifications", status: "warn", message: "Webhook disabled for rehearsal." }
          ]),
          503
        ),
        [`${apiBaseUrl}/zones`]: json({ zones: [] }),
        [`${apiBaseUrl}/providers`]: json({ providers: [] }),
        [`${workerUrl}/health`]: json({ ok: true, service: "gridproof-agent-worker", ready: true }),
        [`${workerUrl}/readiness`]: json(
          readiness("gridproof-agent-worker", "degraded", [
            { name: "llm", status: "warn", missingEnv: ["LLM_API_KEY"] }
          ]),
          503
        )
      })
    });

    expect(statuses(checks)).toMatchObject({
      api_readiness: "warn",
      worker_readiness: "warn"
    });
  });

  it("fails the public frontend check when deployed HTML still references localhost API config", async () => {
    const checks = await verifyDeployment({
      env: {
        GRIDPROOF_API_BASE_URL: apiBaseUrl,
        GRIDPROOF_WEB_URL: webUrl
      },
      fetchImpl: fetchFromRoutes({
        [`${apiBaseUrl}/health`]: json({ ok: true, service: "gridproof-api", timestamp: "2026-08-09T10:00:00.000Z" }),
        [`${apiBaseUrl}/metrics`]: json({
          counters: {
            evidenceIngested: 0,
            candidatesDetected: 0,
            agentDecisions: 0,
            chainSubmissions: 0,
            failures: 0
          }
        }),
        [`${apiBaseUrl}/readiness`]: json(readiness("gridproof-api", "ready")),
        [`${apiBaseUrl}/zones`]: json({ zones: [] }),
        [`${apiBaseUrl}/providers`]: json({ providers: [] }),
        [webUrl]: html("<!doctype html><div id=\"root\"></div><script>window.API='http://localhost:4000'</script>")
      })
    });

    expect(byName(checks, "web_frontend")).toMatchObject({
      status: "fail",
      detail: "Frontend HTML references localhost API configuration."
    });
  });

  it("requires a public API base URL before running smoke checks", async () => {
    await expect(verifyDeployment({ env: {}, fetchImpl: fetchFromRoutes({}) })).rejects.toThrow(
      "GRIDPROOF_API_BASE_URL is required"
    );
  });
});

function json(body: JsonBody, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function readiness(
  service: "gridproof-api" | "gridproof-agent-worker",
  status: "ready" | "degraded" | "not_ready",
  extraChecks: Array<Record<string, unknown>> = []
): JsonBody {
  return {
    ok: status === "ready",
    service,
    status,
    timestamp: "2026-08-09T10:00:00.000Z",
    checks: [
      { name: "runtime", status: "pass" },
      ...extraChecks
    ]
  };
}

function proof(status: "pending" | "confirmed" | "failed"): JsonBody {
  return {
    epochScore: {
      id: "22222222-2222-4222-8222-222222222222",
      zoneId,
      epochStart: epoch,
      uptimeBps: 9675,
      evidenceHash: `0x${"a".repeat(64)}`,
      createdAt: "2026-08-09T10:01:00.000Z"
    },
    commitment: {
      id: "33333333-3333-4333-8333-333333333333",
      epochScoreId: "22222222-2222-4222-8222-222222222222",
      txHash: status === "confirmed" ? `0x${"b".repeat(64)}` : null,
      blockNumber: status === "confirmed" ? 12345 : null,
      status,
      explorerUrl: status === "confirmed" ? `https://explorer.botchain.example/tx/0x${"b".repeat(64)}` : null,
      createdAt: "2026-08-09T10:02:00.000Z",
      confirmedAt: status === "confirmed" ? "2026-08-09T10:03:00.000Z" : null
    }
  };
}

function fetchFromRoutes(routes: Record<string, Response>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const response = routes[url];
    if (!response) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return response.clone();
  }) as unknown as typeof fetch;
}

function statuses(checks: CheckResult[]): Record<string, CheckResult["status"]> {
  return Object.fromEntries(checks.map((check) => [check.name, check.status]));
}

function byName(checks: CheckResult[], name: string): CheckResult {
  const check = checks.find((candidate) => candidate.name === name);
  if (!check) throw new Error(`Missing check ${name}`);
  return check;
}
