import { describe, expect, it } from "vitest";
import { DEMO_NATIONAL_ZONES, DISCOS, discoCodeFromFeederCode, discoSchema, getDisco } from "../src/index.js";

describe("DisCo registry", () => {
  it("contains exactly the 11 successor distribution companies", () => {
    expect(DISCOS).toHaveLength(11);
    expect(DISCOS.map((disco) => disco.code)).toEqual([
      "AEDC",
      "BEDC",
      "EEDC",
      "EKEDC",
      "IBEDC",
      "IKEDC",
      "JED",
      "KAEDCO",
      "KEDCO",
      "PHED",
      "YEDC"
    ]);
  });

  it("has schema-valid entries with centroids inside Nigeria's bounding box", () => {
    for (const disco of DISCOS) {
      expect(() => discoSchema.parse(disco)).not.toThrow();
      expect(disco.centroid.lat).toBeGreaterThan(4);
      expect(disco.centroid.lat).toBeLessThan(14);
      expect(disco.centroid.lng).toBeGreaterThan(2);
      expect(disco.centroid.lng).toBeLessThan(15);
    }
  });

  it("resolves a DisCo by code and rejects unknown codes", () => {
    expect(getDisco("IBEDC").headquarters).toBe("Ibadan");
    // @ts-expect-error exercising the runtime guard with an invalid code
    expect(() => getDisco("NOPE")).toThrow(/Unknown DisCo code/);
  });

  describe("discoCodeFromFeederCode", () => {
    it("extracts the DisCo prefix from a feeder code", () => {
      expect(discoCodeFromFeederCode("IBEDC-OGB-A")).toBe("IBEDC");
      expect(discoCodeFromFeederCode("PHED-PHC-1")).toBe("PHED");
    });

    it("is case-insensitive and tolerates surrounding whitespace", () => {
      expect(discoCodeFromFeederCode("  ikedc-ikj-1 ")).toBe("IKEDC");
    });

    it("returns null for unrecognised or malformed codes", () => {
      expect(discoCodeFromFeederCode("UNKNOWN-XYZ-1")).toBeNull();
      expect(discoCodeFromFeederCode("")).toBeNull();
      expect(discoCodeFromFeederCode("---")).toBeNull();
    });
  });
});

describe("DEMO_NATIONAL_ZONES", () => {
  it("covers every one of the 11 DisCos", () => {
    const covered = new Set(DEMO_NATIONAL_ZONES.map((zone) => discoCodeFromFeederCode(zone.discosFeederCode)));
    expect(covered.size).toBe(11);
    for (const disco of DISCOS) {
      expect(covered).toContain(disco.code);
    }
  });

  it("maps every feeder code to a known DisCo", () => {
    for (const zone of DEMO_NATIONAL_ZONES) {
      expect(discoCodeFromFeederCode(zone.discosFeederCode)).not.toBeNull();
    }
  });

  it("uses unique zone ids and zone keys", () => {
    expect(new Set(DEMO_NATIONAL_ZONES.map((zone) => zone.id)).size).toBe(DEMO_NATIONAL_ZONES.length);
    expect(new Set(DEMO_NATIONAL_ZONES.map((zone) => zone.zoneKey)).size).toBe(DEMO_NATIONAL_ZONES.length);
  });

  it("keeps the original Ogbomoso feeder ids so existing demo links stay valid", () => {
    expect(DEMO_NATIONAL_ZONES[0]?.id).toBe("8a27f3e2-2608-4a88-b8db-efce68be2a59");
    expect(DEMO_NATIONAL_ZONES[1]?.id).toBe("378b2fae-55dd-488f-aefd-c9bc17f8d4ff");
  });

  it("emits bytes32-shaped zone keys", () => {
    for (const zone of DEMO_NATIONAL_ZONES) {
      expect(zone.zoneKey).toMatch(/^0x[a-f0-9]{64}$/);
    }
  });

  it("reports null uptime only for zones with unknown status", () => {
    for (const zone of DEMO_NATIONAL_ZONES) {
      if (zone.latestUptimeBps === null) expect(zone.latestStatus).toBe("unknown");
    }
  });
});
