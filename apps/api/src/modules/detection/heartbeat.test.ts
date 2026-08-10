import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { EvidenceEvent } from "@gridproof/shared-types";
import { HEARTBEAT_GAP_MS, detectHeartbeatGapCandidates, heartbeatGapKey } from "./heartbeat.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const otherZoneId = "1d4b0b0a-2f2f-4c1e-9a63-0f6f9a1b2c3d";
const start = Date.parse("2026-08-09T10:00:00.000Z");

function beat(input: {
  minute: number;
  deviceId?: string;
  status?: EvidenceEvent["status"];
  source?: EvidenceEvent["source"];
  zone?: string;
}): EvidenceEvent {
  const source = input.source ?? "sensor";
  const observedAt = new Date(start + input.minute * 60 * 1000).toISOString();
  const deviceId = input.deviceId ?? "esp32-ogb-a-1";

  return {
    id: randomUUID(),
    providerId: randomUUID(),
    zoneId: input.zone ?? zoneId,
    idempotencyKey: `${deviceId}-${observedAt}`,
    source,
    status: input.status ?? "grid_up",
    voltage: source === "sensor" ? 230 : undefined,
    rawPayload: source === "sensor" ? { deviceId } : { reporterWallet: `0x${deviceId}` },
    observedAt,
    receivedAt: observedAt
  };
}

/** Minute offsets for a node reporting every minute across the given inclusive range. */
function steadyBeats(fromMinute: number, toMinute: number, deviceId?: string): EvidenceEvent[] {
  const events: EvidenceEvent[] = [];
  for (let minute = fromMinute; minute <= toMinute; minute += 1) {
    events.push(beat({ minute, deviceId }));
  }
  return events;
}

describe("detectHeartbeatGapCandidates", () => {
  it("produces exactly one candidate for one clear gap in seeded telemetry", () => {
    // Steady minute beats for 10 minutes, 20 minutes of silence, then beats resume.
    const evidence = [...steadyBeats(0, 10), ...steadyBeats(30, 35)];

    const candidates = detectHeartbeatGapCandidates(zoneId, evidence, {
      now: new Date(start + 35 * 60 * 1000)
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.status).toBe("outage");
    expect(candidates[0]?.windowStart).toBe("2026-08-09T10:10:00.000Z");
    expect(candidates[0]?.windowEnd).toBe("2026-08-09T10:30:00.000Z");
    expect(candidates[0]?.evidenceEventIds).toHaveLength(2);
  });

  it("reports an open gap when the zone is still silent now", () => {
    const candidates = detectHeartbeatGapCandidates(zoneId, steadyBeats(0, 5), {
      now: new Date(start + 20 * 60 * 1000)
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.windowStart).toBe("2026-08-09T10:05:00.000Z");
    expect(candidates[0]?.windowEnd).toBe("2026-08-09T10:20:00.000Z");
    expect(candidates[0]?.evidenceEventIds).toHaveLength(1);
  });

  it("finds each of several separate gaps exactly once", () => {
    const evidence = [...steadyBeats(0, 2), ...steadyBeats(20, 22), ...steadyBeats(40, 42)];

    const candidates = detectHeartbeatGapCandidates(zoneId, evidence, {
      now: new Date(start + 42 * 60 * 1000)
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.windowStart)).toEqual([
      "2026-08-09T10:02:00.000Z",
      "2026-08-09T10:22:00.000Z"
    ]);
  });

  const table: Array<{
    name: string;
    evidence: EvidenceEvent[];
    nowMinute: number;
    expected: number;
  }> = [
    {
      name: "unbroken minute beats leave no gap",
      evidence: steadyBeats(0, 30),
      nowMinute: 30,
      expected: 0
    },
    {
      name: "silence exactly at the threshold is not yet a gap",
      evidence: [beat({ minute: 0 }), beat({ minute: 6 })],
      nowMinute: 6,
      expected: 0
    },
    {
      name: "silence one minute past the threshold is a gap",
      evidence: [beat({ minute: 0 }), beat({ minute: 7 })],
      nowMinute: 7,
      expected: 1
    },
    {
      name: "a zone never heard from produces no candidate",
      evidence: [],
      nowMinute: 60,
      expected: 0
    },
    {
      name: "reporter submissions are not heartbeats",
      evidence: [beat({ minute: 0, source: "reporter" }), beat({ minute: 30, source: "reporter" })],
      nowMinute: 30,
      expected: 0
    },
    {
      name: "unknown-status readings still prove the node is alive",
      evidence: [beat({ minute: 0 }), beat({ minute: 5, status: "unknown" }), beat({ minute: 10 })],
      nowMinute: 10,
      expected: 0
    },
    {
      name: "another zone's beats never close this zone's gap",
      evidence: [beat({ minute: 0 }), beat({ minute: 10, zone: otherZoneId })],
      nowMinute: 10,
      expected: 1
    },
    {
      name: "a second node still reporting means the zone is not dark",
      evidence: [...steadyBeats(0, 3), ...steadyBeats(0, 30, "esp32-ogb-a-2")],
      nowMinute: 30,
      expected: 0
    },
    {
      name: "out-of-order evidence is sorted before gap detection",
      evidence: [beat({ minute: 20 }), beat({ minute: 0 }), beat({ minute: 21 })],
      nowMinute: 21,
      expected: 1
    }
  ];

  it.each(table)("$name", ({ evidence, nowMinute, expected }) => {
    const candidates = detectHeartbeatGapCandidates(zoneId, evidence, {
      now: new Date(start + nowMinute * 60 * 1000)
    });

    expect(candidates).toHaveLength(expected);
  });

  describe("confidence banding", () => {
    it("escalates a single silent node rather than auto-approving it", () => {
      // One device, very long silence: could equally be a dead node, so it must not
      // reach the >=0.85 auto-approve band.
      const candidates = detectHeartbeatGapCandidates(zoneId, steadyBeats(0, 5), {
        now: new Date(start + 120 * 60 * 1000)
      });

      expect(candidates[0]?.confidence).toBeGreaterThanOrEqual(0.5);
      expect(candidates[0]?.confidence).toBeLessThan(0.85);
    });

    it("auto-approves when several nodes go silent together for a long time", () => {
      const evidence = [
        ...steadyBeats(0, 5, "esp32-ogb-a-1"),
        ...steadyBeats(0, 5, "esp32-ogb-a-2"),
        ...steadyBeats(0, 5, "esp32-ogb-a-3")
      ];

      const candidates = detectHeartbeatGapCandidates(zoneId, evidence, {
        now: new Date(start + 30 * 60 * 1000)
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("keeps a barely-overrun gap in the escalation band even with corroboration", () => {
      const evidence = [
        beat({ minute: 0, deviceId: "esp32-ogb-a-1" }),
        beat({ minute: 0, deviceId: "esp32-ogb-a-2" }),
        beat({ minute: 7, deviceId: "esp32-ogb-a-1" })
      ];

      const candidates = detectHeartbeatGapCandidates(zoneId, evidence, {
        now: new Date(start + 7 * 60 * 1000)
      });

      expect(candidates[0]?.confidence).toBeLessThan(0.85);
    });

    it("never exceeds the deterministic confidence cap", () => {
      const evidence = Array.from({ length: 12 }, (_, index) =>
        beat({ minute: 0, deviceId: `esp32-ogb-a-${index}` })
      );

      const candidates = detectHeartbeatGapCandidates(zoneId, evidence, {
        now: new Date(start + 120 * 60 * 1000)
      });

      expect(candidates[0]?.confidence).toBeLessThanOrEqual(0.95);
    });
  });

  it("derives a stable dedupe key so repeated sweeps do not duplicate a gap", () => {
    const evidence = [...steadyBeats(0, 5), ...steadyBeats(20, 25)];
    const options = { now: new Date(start + 25 * 60 * 1000) };

    const first = detectHeartbeatGapCandidates(zoneId, evidence, options);
    const second = detectHeartbeatGapCandidates(zoneId, evidence, options);

    expect(first[0]?.id).not.toBe(second[0]?.id);
    expect(heartbeatGapKey(first[0]!)).toBe(heartbeatGapKey(second[0]!));
  });

  it("keys an open gap by when the silence started, so it survives growing and closing", () => {
    const beats = steadyBeats(0, 5);

    // Two sweeps while the zone is still dark: the window keeps growing.
    const earlySweep = detectHeartbeatGapCandidates(zoneId, beats, {
      now: new Date(start + 15 * 60 * 1000)
    });
    const laterSweep = detectHeartbeatGapCandidates(zoneId, beats, {
      now: new Date(start + 40 * 60 * 1000)
    });
    // A sweep after the beats resume sees the same silence, now closed.
    const closedSweep = detectHeartbeatGapCandidates(zoneId, [...beats, ...steadyBeats(45, 46)], {
      now: new Date(start + 46 * 60 * 1000)
    });

    expect(earlySweep[0]?.windowEnd).not.toBe(laterSweep[0]?.windowEnd);
    expect(heartbeatGapKey(earlySweep[0]!)).toBe(heartbeatGapKey(laterSweep[0]!));
    expect(heartbeatGapKey(closedSweep[0]!)).toBe(heartbeatGapKey(earlySweep[0]!));
  });

  it("honours a caller-supplied gap threshold", () => {
    const evidence = [beat({ minute: 0 }), beat({ minute: 3 })];

    expect(detectHeartbeatGapCandidates(zoneId, evidence, { now: new Date(start + 3 * 60 * 1000) })).toHaveLength(0);
    expect(
      detectHeartbeatGapCandidates(zoneId, evidence, {
        now: new Date(start + 3 * 60 * 1000),
        gapMs: 2 * 60 * 1000
      })
    ).toHaveLength(1);
  });

  it("exposes the documented six-minute default threshold", () => {
    expect(HEARTBEAT_GAP_MS).toBe(6 * 60 * 1000);
  });
});
