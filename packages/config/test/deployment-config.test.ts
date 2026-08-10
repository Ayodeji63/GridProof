import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { gridproofDefaults } from "../src/index.js";

describe("GridProof shared configuration", () => {
  it("keeps demo-critical runtime defaults inside safe bounds", () => {
    expect(gridproofDefaults.apiPort).toBe(4000);
    expect(gridproofDefaults.webPort).toBe(5173);
    expect(gridproofDefaults.epochDurationSeconds).toBeGreaterThan(0);
    expect(gridproofDefaults.agentTimeoutMs).toBeGreaterThan(0);
    expect(gridproofDefaults.escalateConfidenceThreshold).toBeGreaterThanOrEqual(0);
    expect(gridproofDefaults.approveConfidenceThreshold).toBeLessThanOrEqual(1);
    expect(gridproofDefaults.escalateConfidenceThreshold).toBeLessThan(gridproofDefaults.approveConfidenceThreshold);
  });
});

describe("Render deployment blueprint", () => {
  const blueprint = readFileSync(path.resolve("../../infrastructure/render.yaml"), "utf8");

  it("declares the production API service and health check", () => {
    const apiService = serviceBlock(blueprint, "gridproof-api");

    expect(apiService).toContain("runtime: docker");
    expect(apiService).toContain("plan: free");
    expect(apiService).toContain("dockerfilePath: ./infrastructure/docker/api.Dockerfile");
    expect(apiService).toContain("healthCheckPath: /api/v1/health");
    expect(envValue(apiService, "NODE_ENV")).toBe("production");
    expect(envValue(apiService, "GRIDPROOF_EVIDENCE_MODE")).toBe("hybrid");
  });

  it("keeps API production fail-closed secrets present as unsynced Render env vars", () => {
    const apiService = serviceBlock(blueprint, "gridproof-api");

    for (const key of [
      "CORS_ORIGINS",
      "DATABASE_URL",
      "REDIS_URL",
      "SUPABASE_JWT_SECRET",
      "GRIDPROOF_AUTH_INVITE_CODE",
      "TELEMETRY_HMAC_SECRET",
      "WHATSAPP_WEBHOOK_SECRET",
      "RELAYER_PRIVATE_KEY",
      "BOTCHAIN_RPC_URL",
      "BOTCHAIN_CHAIN_ID",
      "BOTCHAIN_UPTIME_ATTESTATION_ADDRESS"
    ]) {
      expect(envEntry(apiService, key), `${key} should be configured by Render secrets`).toContain("sync: false");
    }
  });

  it("declares the agent worker with queue, database, and LLM configuration", () => {
    const workerService = serviceBlock(blueprint, "gridproof-agent-worker");

    expect(workerService).toContain("runtime: docker");
    expect(workerService).toContain("dockerfilePath: ./infrastructure/docker/agent-worker.Dockerfile");
    expect(workerService).toContain("healthCheckPath: /health");
    expect(envValue(workerService, "NODE_ENV")).toBe("production");
    expect(envEntry(workerService, "DATABASE_URL")).toContain("sync: false");
    expect(envEntry(workerService, "REDIS_URL")).toContain("sync: false");
    expect(envEntry(workerService, "LLM_BASE_URL")).toContain("sync: false");
    expect(envEntry(workerService, "LLM_API_KEY")).toContain("sync: false");
  });
});

function serviceBlock(blueprint: string, serviceName: string): string {
  const marker = `    name: ${serviceName}`;
  const markerIndex = blueprint.indexOf(marker);
  expect(markerIndex, `expected ${serviceName} in render.yaml`).toBeGreaterThanOrEqual(0);

  const blockStart = blueprint.lastIndexOf("\n  - type:", markerIndex);
  expect(blockStart, `expected ${serviceName} to be a Render service`).toBeGreaterThanOrEqual(0);

  const nextServiceIndex = blueprint.indexOf("\n  - type:", markerIndex + marker.length);
  return blueprint.slice(blockStart, nextServiceIndex === -1 ? undefined : nextServiceIndex);
}

function envEntry(service: string, key: string): string {
  const marker = `      - key: ${key}`;
  const markerIndex = service.indexOf(marker);
  expect(markerIndex, `expected ${key} in Render service env`).toBeGreaterThanOrEqual(0);

  const nextEntryIndex = service.indexOf("\n      - key:", markerIndex + marker.length);
  return service.slice(markerIndex, nextEntryIndex === -1 ? undefined : nextEntryIndex);
}

function envValue(service: string, key: string): string | undefined {
  const entry = envEntry(service, key);
  return entry.match(/\n        value: (.+)/)?.[1]?.trim();
}
