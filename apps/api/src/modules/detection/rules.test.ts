import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { EvidenceEvent } from "@gridproof/shared-types";
import { CONFLICT_CONFIDENCE_CEILING, detectCandidateFromEvidence, scoreCrossSourceAgreement } from "./rules.js";

const baseEvidence: EvidenceEvent = {
  id: "6a670093-7823-44e1-80e4-ac608f9e75bd",
  providerId: "2084fca3-725c-4a2d-b521-bc82de112c64",
  zoneId: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  idempotencyKey: "esp32-ogb-a-1-2026-08-09T10:00:00Z",
  source: "sensor",
  status: "grid_down",
  voltage: 0,
  rawPayload: {},
  observedAt: "2026-08-09T10:00:00.000Z",
  receivedAt: "2026-08-09T10:00:03.000Z"
};

const reporterId = "b1c2d3e4-5f60-4a71-8b92-c3d4e5f60718";
const secondSensorId = "c2d3e4f5-6071-4b82-9ca3-d4e5f6071829";
const thirdSensorId = "d3e4f506-7182-4c93-adb4-e5f60718293a";

function sensorEvidence(overrides: Partial<EvidenceEvent> & { deviceId?: string } = {}): EvidenceEvent {
  const { deviceId = "esp32-ogb-a-1", ...rest } = overrides;
  return { ...baseEvidence, rawPayload: { deviceId }, ...rest };
}

function reporterEvidence(overrides: Partial<EvidenceEvent> & { wallet?: string } = {}): EvidenceEvent {
  const { wallet = "0xa11ce00000000000000000000000000000000001", ...rest } = overrides;
  return {
    ...baseEvidence,
    id: reporterId,
    source: "reporter",
    voltage: undefined,
    rawPayload: { reporterWallet: wallet },
    ...rest
  };
}

describe("detectCandidateFromEvidence", () => {
  it("turns a zero-voltage sensor reading into a high-confidence outage candidate", () => {
    const candidate = detectCandidateFromEvidence(baseEvidence);

    expect(candidate?.status).toBe("outage");
    expect(candidate?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(candidate?.evidenceEventIds).toEqual([baseEvidence.id]);
  });

  it("turns a reporter restoration into an ambiguous candidate", () => {
    const candidate = detectCandidateFromEvidence({
      ...baseEvidence,
      source: "reporter",
      status: "grid_up",
      voltage: undefined
    });

    expect(candidate?.status).toBe("restored");
    expect(candidate?.confidence).toBeLessThan(0.85);
  });

  it("does not create a candidate for unknown evidence", () => {
    const candidate = detectCandidateFromEvidence({ ...baseEvidence, status: "unknown" });

    expect(candidate).toBeNull();
  });

  it("raises confidence and provenance when an independent source agrees", () => {
    const corroborating = reporterEvidence({ id: reporterId, status: "grid_down" });

    const candidate = detectCandidateFromEvidence(sensorEvidence({ status: "grid_down" }), {
      recentEvidence: [corroborating]
    });

    expect(candidate?.confidence).toBeGreaterThan(0.95);
    expect(candidate?.evidenceEventIds).toEqual([baseEvidence.id, reporterId]);
  });

  it("holds a contested reading in the escalation band instead of auto-approving it", () => {
    const candidate = detectCandidateFromEvidence(sensorEvidence({ status: "grid_down", voltage: 0 }), {
      recentEvidence: [reporterEvidence({ id: reporterId, status: "grid_up" })]
    });

    // The sensor alone would score 0.95 and commit straight to chain.
    expect(candidate?.confidence).toBeLessThanOrEqual(CONFLICT_CONFIDENCE_CEILING);
    expect(candidate?.confidence).toBeGreaterThanOrEqual(0.5);
    expect(candidate?.evidenceEventIds).toEqual([baseEvidence.id]);
  });
});

describe("scoreCrossSourceAgreement", () => {
  const table: Array<{
    name: string;
    subject: EvidenceEvent;
    recent: EvidenceEvent[];
    agreeing: number;
    conflicting: number;
    crossSource: boolean;
  }> = [
    {
      name: "no other evidence yields no signal",
      subject: sensorEvidence({ status: "grid_down" }),
      recent: [],
      agreeing: 0,
      conflicting: 0,
      crossSource: false
    },
    {
      name: "a human agreeing with a sensor is cross-source corroboration",
      subject: sensorEvidence({ status: "grid_down" }),
      recent: [reporterEvidence({ id: reporterId, status: "grid_down" })],
      agreeing: 1,
      conflicting: 0,
      crossSource: true
    },
    {
      name: "a second sensor agreeing is same-source corroboration",
      subject: sensorEvidence({ status: "grid_down" }),
      recent: [sensorEvidence({ id: secondSensorId, deviceId: "esp32-ogb-a-2", status: "grid_down" })],
      agreeing: 1,
      conflicting: 0,
      crossSource: false
    },
    {
      name: "repeat readings from the same device are one witness, not many",
      subject: sensorEvidence({ status: "grid_down" }),
      recent: [
        sensorEvidence({ id: secondSensorId, status: "grid_down", observedAt: "2026-08-09T10:01:00.000Z" }),
        sensorEvidence({ id: thirdSensorId, status: "grid_down", observedAt: "2026-08-09T10:02:00.000Z" })
      ],
      agreeing: 0,
      conflicting: 0,
      crossSource: false
    },
    {
      name: "opposite statuses conflict",
      subject: sensorEvidence({ status: "grid_down" }),
      recent: [reporterEvidence({ id: reporterId, status: "grid_up" })],
      agreeing: 0,
      conflicting: 1,
      crossSource: false
    },
    {
      name: "unknown-status evidence neither agrees nor conflicts",
      subject: sensorEvidence({ status: "grid_down" }),
      recent: [reporterEvidence({ id: reporterId, status: "unknown" })],
      agreeing: 0,
      conflicting: 0,
      crossSource: false
    },
    {
      name: "evidence outside the agreement window is ignored",
      subject: sensorEvidence({ status: "grid_down" }),
      recent: [reporterEvidence({ id: reporterId, status: "grid_down", observedAt: "2026-08-09T11:00:00.000Z" })],
      agreeing: 0,
      conflicting: 0,
      crossSource: false
    },
    {
      name: "another zone's evidence is ignored",
      subject: sensorEvidence({ status: "grid_down" }),
      recent: [
        reporterEvidence({
          id: reporterId,
          status: "grid_down",
          zoneId: "1d4b0b0a-2f2f-4c1e-9a63-0f6f9a1b2c3d"
        })
      ],
      agreeing: 0,
      conflicting: 0,
      crossSource: false
    },
    {
      name: "agreement and conflict are counted independently",
      subject: sensorEvidence({ status: "grid_down" }),
      recent: [
        sensorEvidence({ id: secondSensorId, deviceId: "esp32-ogb-a-2", status: "grid_down" }),
        reporterEvidence({ id: reporterId, status: "grid_up" })
      ],
      agreeing: 1,
      conflicting: 1,
      crossSource: false
    }
  ];

  it.each(table)("$name", ({ subject, recent, agreeing, conflicting, crossSource }) => {
    const score = scoreCrossSourceAgreement(subject, recent);

    expect(score.agreeing).toBe(agreeing);
    expect(score.conflicting).toBe(conflicting);
    expect(score.crossSource).toBe(crossSource);
  });

  it("caps the corroboration bonus so agreement cannot run away", () => {
    const crowd = Array.from({ length: 10 }, (_, index) =>
      sensorEvidence({ id: randomUUID(), deviceId: `esp32-ogb-a-${index + 2}`, status: "grid_down" })
    );

    const score = scoreCrossSourceAgreement(sensorEvidence({ status: "grid_down" }), crowd);

    expect(score.agreeing).toBe(10);
    expect(score.bonus).toBeLessThanOrEqual(0.16);
  });

  it("orders supporting evidence deterministically", () => {
    const later = reporterEvidence({ id: reporterId, status: "grid_down", observedAt: "2026-08-09T10:04:00.000Z" });
    const earlier = sensorEvidence({
      id: secondSensorId,
      deviceId: "esp32-ogb-a-2",
      status: "grid_down",
      observedAt: "2026-08-09T10:01:00.000Z"
    });

    const forward = scoreCrossSourceAgreement(sensorEvidence({ status: "grid_down" }), [later, earlier]);
    const reversed = scoreCrossSourceAgreement(sensorEvidence({ status: "grid_down" }), [earlier, later]);

    expect(forward.supportingEvidenceIds).toEqual([secondSensorId, reporterId]);
    expect(reversed.supportingEvidenceIds).toEqual(forward.supportingEvidenceIds);
  });
});
