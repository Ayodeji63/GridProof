import { describe, expect, it } from "vitest";
import { DEMO_NATIONAL_ZONES } from "@gridproof/shared-types";
import { calculateFeederMetrics, rollupByDisco } from "./Dashboard.js";

describe("calculateFeederMetrics", () => {
  it("uses every tracked feeder as the denominator and does not invent missing readings", () => {
    const metrics = calculateFeederMetrics([
      { latestUptimeBps: 9200, latestVoltage: 230, latestCurrentAmps: 14 },
      { latestUptimeBps: 8700, latestVoltage: 0, latestCurrentAmps: 0 },
      { latestUptimeBps: null, latestVoltage: null, latestCurrentAmps: null },
      { latestUptimeBps: 9000, latestVoltage: 215 }
    ]);

    expect(metrics.total).toBe(4);
    expect(metrics.darAtTarget).toEqual({ count: 2, percentage: 50 });
    expect(metrics.darBelowTarget).toEqual({ count: 1, percentage: 25 });
    expect(metrics.activeVoltage).toEqual({ count: 2, percentage: 50 });
    expect(metrics.activeCurrent).toEqual({ count: 1, percentage: 25 });
    expect(metrics.currentReported).toBe(2);
  });
});

describe("rollupByDisco", () => {
  it("returns a row for all 11 DisCos, with zeroed coverage for absent ones", () => {
    const rollups = rollupByDisco([], {});
    expect(rollups).toHaveLength(11);
    expect(rollups.every((rollup) => rollup.zoneCount === 0)).toBe(true);
    expect(rollups[0]?.code).toBe("AEDC");
    expect(rollups[10]?.code).toBe("YEDC");
  });

  it("aggregates the national demo zones across every DisCo", () => {
    const statusByZoneId = Object.fromEntries(
      DEMO_NATIONAL_ZONES.map((zone) => [zone.id, zone.latestStatus] as const)
    );
    const rollups = rollupByDisco(DEMO_NATIONAL_ZONES, statusByZoneId);

    for (const rollup of rollups) {
      expect(rollup.zoneCount).toBeGreaterThan(0);
    }

    const ibedc = rollups.find((rollup) => rollup.code === "IBEDC");
    expect(ibedc?.zoneCount).toBe(3);
    expect(ibedc?.zonesDown).toBe(1);

    const kano = rollups.find((rollup) => rollup.code === "KEDCO");
    expect(kano?.zonesDown).toBe(0);
    expect(kano?.averageUptimeBps).toBeGreaterThan(0);
  });

  it("treats a feeder code that is not a DisCo as unassigned rather than crashing", () => {
    const zones = [
      {
        id: "z-1",
        discosFeederCode: "TOTALLY-BOGUS-1",
        latestUptimeBps: 9000
      }
    ];
    const rollups = rollupByDisco(zones, {});
    const total = rollups.reduce((sum, rollup) => sum + rollup.zoneCount, 0);
    expect(total).toBe(0);
  });
});
