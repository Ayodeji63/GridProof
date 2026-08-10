import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { CandidateEvent } from "@gridproof/shared-types";
import {
  clearEvidenceStore,
  listMemoryCandidates,
  listMemoryEvidence,
  listSweepEvidenceByZone,
  recordGapCandidate,
  upsertReporterEvidence,
  upsertTelemetryEvidence
} from "./store.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const otherZoneId = "1d4b0b0a-2f2f-4c1e-9a63-0f6f9a1b2c3d";
const walletAddress = "0x1111111111111111111111111111111111111111";
const observedAt = "2026-08-09T10:00:00.000Z";

describe("ingestion store", () => {
  afterEach(() => {
    clearEvidenceStore();
    delete process.env.DATABASE_URL;
  });

  it("stores high-confidence telemetry and returns the same candidate on duplicate ingest", async () => {
    const input = {
      deviceId: "esp32-ogb-a",
      providerWallet: walletAddress,
      zoneId,
      idempotencyKey: "esp32-ogb-a-2026-08-09T10:00:00Z",
      observedAt,
      status: "grid_down" as const,
      voltage: 0,
      signature: "f".repeat(64)
    };

    const first = await upsertTelemetryEvidence(input);
    const second = await upsertTelemetryEvidence(input);

    expect(first.duplicate).toBe(false);
    expect(first.evidenceEvent).toMatchObject({
      source: "sensor",
      status: "grid_down",
      voltage: 0,
      rawPayload: {
        deviceId: "esp32-ogb-a",
        providerWallet: walletAddress
      }
    });
    expect(first.candidateEvent).toMatchObject({
      zoneId,
      status: "outage",
      confidence: 0.95,
      evidenceEventIds: [first.evidenceEvent.id]
    });
    expect(second.duplicate).toBe(true);
    expect(second.evidenceEvent).toEqual(first.evidenceEvent);
    expect(second.candidateEvent).toEqual(first.candidateEvent);
    expect(listMemoryEvidence(zoneId)).toHaveLength(1);
    expect(listMemoryCandidates(zoneId)).toHaveLength(1);
  });

  it("stores ambiguous reporter restoration evidence for reviewer escalation", async () => {
    const result = await upsertReporterEvidence({
      reporterWallet: walletAddress,
      zoneId,
      idempotencyKey: "reporter-ogb-a-restored-2026-08-09T10:00:00Z",
      observedAt,
      status: "grid_up",
      note: "Power just came back."
    });

    expect(result.duplicate).toBe(false);
    expect(result.evidenceEvent).toMatchObject({
      source: "reporter",
      status: "grid_up",
      rawPayload: {
        reporterWallet: walletAddress,
        note: "Power just came back."
      }
    });
    expect(result.candidateEvent).toMatchObject({
      zoneId,
      status: "restored",
      confidence: 0.65,
      evidenceEventIds: [result.evidenceEvent.id]
    });
  });

  it("accepts unknown evidence without creating candidates", async () => {
    const result = await upsertTelemetryEvidence({
      deviceId: "esp32-ogb-a",
      providerWallet: walletAddress,
      zoneId,
      idempotencyKey: "esp32-ogb-a-unknown-2026-08-09T10:00:00Z",
      observedAt,
      status: "unknown",
      signature: "f".repeat(64)
    });

    expect(result.duplicate).toBe(false);
    expect(result.candidateEvent).toBeNull();
    expect(listMemoryEvidence(zoneId)).toHaveLength(1);
    expect(listMemoryCandidates(zoneId)).toHaveLength(0);
  });
});

describe("heartbeat sweep store", () => {
  const start = Date.parse(observedAt);

  afterEach(() => {
    clearEvidenceStore();
    delete process.env.DATABASE_URL;
  });

  async function ingest(input: {
    minute: number;
    deviceId?: string;
    zone?: string;
    source?: "sensor" | "reporter";
  }): Promise<string> {
    const deviceId = input.deviceId ?? "esp32-ogb-a-1";
    const at = new Date(start + input.minute * 60 * 1000).toISOString();
    const idempotencyKey = `${input.source ?? "sensor"}-${deviceId}-${at}`;

    const result =
      input.source === "reporter"
        ? await upsertReporterEvidence({
            reporterWallet: walletAddress,
            zoneId: input.zone ?? zoneId,
            idempotencyKey,
            observedAt: at,
            status: "grid_down",
            note: "Lights are out."
          })
        : await upsertTelemetryEvidence({
            deviceId,
            providerWallet: walletAddress,
            zoneId: input.zone ?? zoneId,
            idempotencyKey,
            observedAt: at,
            status: "grid_up",
            voltage: 230,
            signature: "f".repeat(64)
          });

    return result.evidenceEvent.id;
  }

  function gapCandidate(overrides: Partial<CandidateEvent> = {}): CandidateEvent {
    return {
      id: randomUUID(),
      zoneId,
      status: "outage",
      confidence: 0.7,
      windowStart: observedAt,
      windowEnd: new Date(start + 20 * 60 * 1000).toISOString(),
      evidenceEventIds: [],
      createdAt: new Date(start + 20 * 60 * 1000).toISOString(),
      ...overrides
    };
  }

  describe("listSweepEvidenceByZone", () => {
    it("groups recent sensor evidence by zone", async () => {
      await ingest({ minute: 0 });
      await ingest({ minute: 1, deviceId: "esp32-ogb-a-2" });
      await ingest({ minute: 0, zone: otherZoneId, deviceId: "esp32-ogb-b-1" });

      const byZone = await listSweepEvidenceByZone(60 * 60 * 1000, new Date(start + 5 * 60 * 1000));

      expect(byZone.size).toBe(2);
      expect(byZone.get(zoneId)).toHaveLength(2);
      expect(byZone.get(otherZoneId)).toHaveLength(1);
    });

    it("excludes reporter submissions, which are not heartbeats", async () => {
      await ingest({ minute: 0, source: "reporter" });

      const byZone = await listSweepEvidenceByZone(60 * 60 * 1000, new Date(start + 5 * 60 * 1000));

      expect(byZone.size).toBe(0);
    });

    it("excludes evidence older than the lookback window", async () => {
      await ingest({ minute: 0 });
      await ingest({ minute: 50 });

      const byZone = await listSweepEvidenceByZone(30 * 60 * 1000, new Date(start + 60 * 60 * 1000));

      expect(byZone.get(zoneId)).toHaveLength(1);
    });

    it("returns nothing when no evidence has been received", async () => {
      const byZone = await listSweepEvidenceByZone(60 * 60 * 1000, new Date(start));

      expect(byZone.size).toBe(0);
    });
  });

  describe("recordGapCandidate", () => {
    it("records a gap once and reports every later attempt as already known", async () => {
      const first = await recordGapCandidate(gapCandidate());
      const second = await recordGapCandidate(gapCandidate());

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(listMemoryCandidates(zoneId)).toHaveLength(1);
    });

    it("treats a growing open gap as the same silence", async () => {
      // Same windowStart, later windowEnd: the sweep re-observing an open gap.
      const first = await recordGapCandidate(gapCandidate());
      const later = await recordGapCandidate(
        gapCandidate({ windowEnd: new Date(start + 90 * 60 * 1000).toISOString() })
      );

      expect(first).not.toBeNull();
      expect(later).toBeNull();
    });

    it("records a genuinely separate later gap", async () => {
      await recordGapCandidate(gapCandidate());
      const second = await recordGapCandidate(
        gapCandidate({ windowStart: new Date(start + 60 * 60 * 1000).toISOString() })
      );

      expect(second).not.toBeNull();
      expect(listMemoryCandidates(zoneId)).toHaveLength(2);
    });

    it("keeps the same silence distinct across zones", async () => {
      const first = await recordGapCandidate(gapCandidate());
      const other = await recordGapCandidate(gapCandidate({ zoneId: otherZoneId }));

      expect(first).not.toBeNull();
      expect(other).not.toBeNull();
    });
  });
});
