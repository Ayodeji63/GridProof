import { describe, expect, it } from "vitest";
import { workerReadinessSnapshot } from "../src/readiness.js";

describe("agent worker readiness", () => {
  it("fails closed when demo-critical worker configuration is missing", () => {
    const readiness = workerReadinessSnapshot({}, false, new Date("2026-08-09T12:00:00.000Z"));

    expect(readiness.ok).toBe(false);
    expect(readiness.status).toBe("not_ready");
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "worker_runtime",
          status: "fail"
        }),
        expect.objectContaining({
          name: "database",
          status: "fail",
          missingEnv: ["DATABASE_URL"]
        }),
        expect.objectContaining({
          name: "llm_proxy",
          status: "fail",
          missingEnv: ["LLM_BASE_URL", "LLM_API_KEY"]
        })
      ])
    );
  });

  it("reports ready without exposing configured secret values", () => {
    const readiness = workerReadinessSnapshot({
      DATABASE_URL: "postgres://gridproof:secret@db.gridproof.test:5432/gridproof",
      REDIS_URL: "rediss://default:secret@redis.gridproof.test:6379",
      LLM_BASE_URL: "https://llm.gridproof.test",
      LLM_API_KEY: "llm-secret",
      LLM_ANALYSIS_MODEL: "fast-free-model",
      LLM_VERIFICATION_MODEL: "strong-free-model"
    }, true, new Date("2026-08-09T12:00:00.000Z"));
    const serialized = JSON.stringify(readiness);

    expect(readiness.ok).toBe(true);
    expect(readiness.status).toBe("ready");
    expect(readiness.checks.every((check) => check.status === "pass")).toBe(true);
    expect(serialized).not.toContain("llm-secret");
    expect(serialized).not.toContain("db.gridproof.test");
    expect(serialized).not.toContain("redis.gridproof.test");
    expect(serialized).not.toContain("llm.gridproof.test");
  });
});
