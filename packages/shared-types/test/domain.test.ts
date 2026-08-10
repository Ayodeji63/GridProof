import { describe, expect, it } from "vitest";
import {
  evidenceEventSchema,
  telemetryIngestRequestSchema,
  zoneSchema
} from "../src/index.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const providerId = "2084fca3-725c-4a2d-b521-bc82de112c64";
const now = "2026-08-09T10:00:00.000Z";

describe("shared domain schemas", () => {
  it("accepts a valid zone with an on-chain bytes32 key", () => {
    const parsed = zoneSchema.parse({
      id: zoneId,
      zoneKey: `0x${"a".repeat(64)}`,
      name: "Ogbomoso Feeder A",
      discosFeederCode: "IBEDC-OGB-A",
      region: "Oyo",
      centroid: { lat: 8.133, lng: 4.25 }
    });

    expect(parsed.name).toBe("Ogbomoso Feeder A");
  });

  it("rejects impossible uptime evidence status values", () => {
    expect(() =>
      evidenceEventSchema.parse({
        id: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
        providerId,
        zoneId,
        idempotencyKey: "sensor-1-2026-08-09T10:00:00Z",
        source: "sensor",
        status: "maybe",
        rawPayload: {},
        observedAt: now,
        receivedAt: now
      })
    ).toThrow();
  });

  it("validates telemetry ingest requests before the API stores them", () => {
    const parsed = telemetryIngestRequestSchema.parse({
      deviceId: "esp32-ogb-a-1",
      providerWallet: "0x1111111111111111111111111111111111111111",
      zoneId,
      idempotencyKey: "esp32-ogb-a-1-2026-08-09T10:00:00Z",
      observedAt: now,
      status: "grid_down",
      voltage: 0,
      signature: "f".repeat(64)
    });

    expect(parsed.status).toBe("grid_down");
  });
});
