import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { domainEvents } from "../../lib/events.js";
import { counters, resetMetrics } from "../../lib/metrics.js";
import { clearAuditLogStore, listMemoryAuditLogs } from "../audit/service.js";
import { HEARTBEAT_GAP_MS } from "../detection/heartbeat.js";
import { clearEvidenceStore, listMemoryCandidates, upsertTelemetryEvidence } from "../ingestion/store.js";
import { clearPipelineStore } from "./service.js";
import {
  CHAIN_INDEX_INTERVAL_MS,
  CHAIN_SUBMIT_INTERVAL_MS,
  HEARTBEAT_SWEEP_INTERVAL_MS,
  isChainSweepConfigured,
  runHeartbeatSweep,
  startScheduler
} from "./scheduler.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const otherZoneId = "1d4b0b0a-2f2f-4c1e-9a63-0f6f9a1b2c3d";
const start = Date.parse("2026-08-09T10:00:00.000Z");

const relayerEnv = {
  BOTCHAIN_RPC_URL: "https://rpc.invalid",
  RELAYER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  BOTCHAIN_NODE_REGISTRY_ADDRESS: "0x1111111111111111111111111111111111111111",
  BOTCHAIN_UPTIME_ATTESTATION_ADDRESS: "0x2222222222222222222222222222222222222222",
  BOTCHAIN_REPUTATION_ESCROW_ADDRESS: "0x3333333333333333333333333333333333333333"
} satisfies NodeJS.ProcessEnv;

/** Ingest one sensor heartbeat, going through the real in-memory ingestion path. */
async function beat(minute: number, options: { deviceId?: string; zone?: string } = {}): Promise<void> {
  const deviceId = options.deviceId ?? "esp32-ogb-a-1";
  const observedAt = new Date(start + minute * 60 * 1000).toISOString();

  await upsertTelemetryEvidence({
    deviceId,
    providerWallet: `0x${deviceId.replace(/[^0-9a-f]/gi, "").padEnd(40, "0").slice(0, 40)}`,
    zoneId: options.zone ?? zoneId,
    idempotencyKey: `${deviceId}-${observedAt}`,
    observedAt,
    status: "grid_up",
    voltage: 230,
    signature: "f".repeat(64)
  });
}

function at(minute: number): Date {
  return new Date(start + minute * 60 * 1000);
}

/** Gap candidates for a zone, excluding the per-reading candidates ingestion creates. */
function outageCandidates(zone: string) {
  return listMemoryCandidates(zone).filter((candidate) => candidate.status === "outage");
}

describe("scheduler", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    clearEvidenceStore();
    clearPipelineStore();
    clearAuditLogStore();
    resetMetrics();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    clearEvidenceStore();
    clearPipelineStore();
    clearAuditLogStore();
    resetMetrics();
  });

  describe("runHeartbeatSweep", () => {
    it("turns sensor silence into a candidate with no inbound request", async () => {
      for (let minute = 0; minute <= 3; minute += 1) await beat(minute);

      const detected: string[] = [];
      const unsubscribe = domainEvents.on("candidate.detected", (candidate) => {
        detected.push(candidate.id);
      });

      const result = await runHeartbeatSweep(at(20));
      unsubscribe();

      expect(result).toMatchObject({ zones: 1, candidates: 1, newCandidates: 1 });
      expect(detected).toHaveLength(1);
      expect(counters.candidatesDetected).toBe(1);
    });

    it("runs the pipeline exactly once per gap across repeated sweeps", async () => {
      for (let minute = 0; minute <= 3; minute += 1) await beat(minute);

      const first = await runHeartbeatSweep(at(10));
      const second = await runHeartbeatSweep(at(14));
      const third = await runHeartbeatSweep(at(18));

      expect(first.newCandidates).toBe(1);
      // The gap is still open and its window keeps growing, but it is the same silence.
      expect(second).toMatchObject({ candidates: 1, newCandidates: 0 });
      expect(third).toMatchObject({ candidates: 1, newCandidates: 0 });
      expect(counters.candidatesDetected).toBe(1);
    });

    it("still detects a gap once when the sweep first sees it already closed", async () => {
      for (let minute = 0; minute <= 3; minute += 1) await beat(minute);
      for (let minute = 12; minute <= 14; minute += 1) await beat(minute);

      const first = await runHeartbeatSweep(at(14));
      const second = await runHeartbeatSweep(at(15));

      expect(first.newCandidates).toBe(1);
      expect(second.newCandidates).toBe(0);
    });

    it("escalates a single silent node for review instead of committing it", async () => {
      for (let minute = 0; minute <= 3; minute += 1) await beat(minute);

      const reviews: string[] = [];
      const unsubscribe = domainEvents.on("review.required", (payload) => {
        reviews.push(payload.candidateEventId);
      });

      await runHeartbeatSweep(at(20));
      unsubscribe();

      expect(reviews).toHaveLength(1);
      expect(listMemoryAuditLogs("agent_review.queued")).toHaveLength(1);
      expect(listMemoryAuditLogs("chain_commitment.queued")).toHaveLength(0);
    });

    it("queues a chain commitment when several nodes go dark together", async () => {
      for (const deviceId of ["esp32-ogb-a-1", "esp32-ogb-a-2", "esp32-ogb-a-3"]) {
        for (let minute = 0; minute <= 5; minute += 1) await beat(minute, { deviceId });
      }

      const committed: string[] = [];
      const unsubscribe = domainEvents.on("chain.committed", (payload) => {
        committed.push(payload.status);
      });

      const result = await runHeartbeatSweep(at(20));
      unsubscribe();

      expect(result.newCandidates).toBe(1);
      expect(committed).toEqual(["pending"]);
      expect(listMemoryAuditLogs("chain_commitment.queued")).toHaveLength(1);
    });

    it("sweeps every zone independently", async () => {
      for (let minute = 0; minute <= 3; minute += 1) {
        await beat(minute);
        await beat(minute, { deviceId: "esp32-ogb-b-1", zone: otherZoneId });
      }

      const result = await runHeartbeatSweep(at(20));

      expect(result.zones).toBe(2);
      expect(result.newCandidates).toBe(2);
      // Each zone's own beats also produce "restored" candidates on ingest, so count
      // only the outage candidates the sweep is responsible for.
      expect(outageCandidates(zoneId)).toHaveLength(1);
      expect(outageCandidates(otherZoneId)).toHaveLength(1);
    });

    it("does nothing when no sensor evidence exists", async () => {
      const result = await runHeartbeatSweep(at(20));

      expect(result).toEqual({ zones: 0, candidates: 0, newCandidates: 0 });
      expect(counters.candidatesDetected).toBe(0);
    });

    it("ignores evidence older than the sweep lookback", async () => {
      await beat(0);

      // Well past three gap-lengths, so the beat has aged out of the sweep window.
      const result = await runHeartbeatSweep(new Date(start + 4 * HEARTBEAT_GAP_MS));

      expect(result).toEqual({ zones: 0, candidates: 0, newCandidates: 0 });
    });

    it("reports rather than throws when the evidence source fails", async () => {
      // A DATABASE_URL with no reachable server drives the store down its SQL path.
      process.env.DATABASE_URL = "postgres://gridproof:gridproof@127.0.0.1:1/gridproof";

      await expect(runHeartbeatSweep(at(20))).resolves.toEqual({ zones: 0, candidates: 0, newCandidates: 0 });
    });
  });
});
describe("isChainSweepConfigured", () => {
  const cases: Array<{ name: string; env: NodeJS.ProcessEnv; expected: boolean }> = [
    { name: "no database and no relayer", env: {}, expected: false },
    { name: "database but no relayer", env: { DATABASE_URL: "postgres://localhost/gridproof" }, expected: false },
    { name: "relayer but no database", env: { ...relayerEnv }, expected: false },
    {
      name: "partial relayer env is not enough",
      env: { DATABASE_URL: "postgres://localhost/gridproof", BOTCHAIN_RPC_URL: relayerEnv.BOTCHAIN_RPC_URL },
      expected: false
    },
    {
      name: "database and full relayer env",
      env: { DATABASE_URL: "postgres://localhost/gridproof", ...relayerEnv },
      expected: true
    }
  ];

  it.each(cases)("$name", ({ env, expected }) => {
    expect(isChainSweepConfigured(env)).toBe(expected);
  });
});

describe("startScheduler", () => {
  it("starts the heartbeat sweep but skips chain sweeps without their dependencies", () => {
    const scheduler = startScheduler({});
    try {
      expect(scheduler.chainSweepsEnabled).toBe(false);
    } finally {
      scheduler.stopAll();
    }
  });

  it("starts the chain sweeps once a database and relayer are configured", () => {
    const scheduler = startScheduler({ DATABASE_URL: "postgres://localhost/gridproof", ...relayerEnv });
    try {
      expect(scheduler.chainSweepsEnabled).toBe(true);
    } finally {
      scheduler.stopAll();
    }
  });

  it("does not append a skip audit entry merely by starting", async () => {
    clearAuditLogStore();
    const scheduler = startScheduler({});
    scheduler.stopAll();

    expect(listMemoryAuditLogs("chain_submission.skipped")).toHaveLength(0);
    expect(listMemoryAuditLogs("chain_index.skipped")).toHaveLength(0);
  });

  it("is idempotent to stop, including per-sweep and repeated calls", () => {
    const scheduler = startScheduler({});

    expect(() => {
      scheduler.stopHeartbeatSweep();
      scheduler.stopChainSubmit();
      scheduler.stopChainIndex();
      scheduler.stopAll();
      scheduler.stopAll();
    }).not.toThrow();
  });

  it("leaves the process free to exit by unrefing its timers", () => {
    // An unref'd timer is excluded from the active-resource list, which is exactly
    // what lets a process holding one exit. Compare against a baseline because the
    // test runner keeps timers of its own.
    const activeTimers = () => process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

    const before = activeTimers();
    const scheduler = startScheduler({ DATABASE_URL: "postgres://localhost/gridproof", ...relayerEnv });
    try {
      expect(scheduler.chainSweepsEnabled).toBe(true);
      expect(activeTimers()).toBe(before);
    } finally {
      scheduler.stopAll();
    }
  });

  it("uses intervals that match the detection threshold and chain cadence", () => {
    expect(HEARTBEAT_SWEEP_INTERVAL_MS).toBe(HEARTBEAT_GAP_MS);
    expect(CHAIN_SUBMIT_INTERVAL_MS).toBe(2 * 60 * 1000);
    expect(CHAIN_INDEX_INTERVAL_MS).toBe(30 * 1000);
    // Confirmations must be indexed at least as often as they are submitted.
    expect(CHAIN_INDEX_INTERVAL_MS).toBeLessThanOrEqual(CHAIN_SUBMIT_INTERVAL_MS);
  });
});
