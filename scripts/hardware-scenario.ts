/**
 * Constant demo scenario for the GridProof hardware simulator.
 *
 * This module is the *data*: a fixed cast of meters, wallets and readings that
 * exercises every branch of the pipeline. It performs no I/O so the scenario can
 * be diffed, unit-checked, and reasoned about without a running API.
 *
 * Everything here mirrors `hardware.ino` byte for byte — the signing string, the
 * `<DevEUI>-<unixSeconds>` idempotency key, second-precision `...Z` timestamps,
 * whole-volt readings, and the rule that an offline meter *omits* `voltage`
 * rather than sending null.
 *
 * ## The one non-obvious rule
 *
 * Events are split into two time bands, and which band an event belongs to is
 * decided by its *expected decision*, not by narrative convenience:
 *
 * - **sealed** — inside the previous whole hour. That epoch has fully elapsed,
 *   so `UptimeAttestation.commitEpoch` accepts it (`EpochMath.isPastEpoch`).
 *   Every reading expected to **approve** lives here, because an approval mints
 *   an epoch score plus a pending chain commitment.
 * - **live** — the last ~11 minutes. Anything here is expected to **escalate**
 *   or produce no candidate at all. Escalations never mint a commitment.
 *
 * The reason is a hard chain constraint: a commitment for the *current* hour
 * cannot be committed until that hour ends, and the API's 2-minute chain sweep
 * will try anyway and mark it `failed`. Keeping approvals in the sealed hour
 * means every commitment this scenario produces is immediately committable.
 */

import { createHash, createHmac } from "node:crypto";
import { DEMO_NATIONAL_ZONES } from "../packages/shared-types/src/demo-zones.js";

/** Mirrors `evidenceStatusSchema`; declared locally so this file has no runtime deps. */
export type EvidenceStatus = "grid_up" | "grid_down" | "unknown";
export type CandidateStatus = "outage" | "restored";
export type Decision = "approve" | "escalate" | "reject";
export type Band = "sealed" | "live";

/**
 * 11 kV distribution feeder, line-to-line. The firmware reports the *minimum* of
 * V_L12/V_L23/V_L31 in whole volts, so a healthy reading is ~10.7 kV — not the
 * 230 V a socket would show. Detection only needs `>= 180` for the 0.9 rung
 * (`detection/rules.ts`), but sending a plausible feeder voltage keeps the demo
 * honest against anyone reading the raw evidence payloads.
 */
export const HEALTHY_LINE_VOLTAGE_V = 10_700;
/** Below `GRIDPROOF_DOWN_VOLTAGE_V` (5) in the firmware, and the 0.95 rung in detection. */
export const DEAD_LINE_VOLTAGE_V = 0;
/** Residual bus voltage on a dead feeder: still <= 5, still `grid_down`. */
export const RESIDUAL_LINE_VOLTAGE_V = 3;

/** The two DevEUIs burned into `hardware.ino` (`DEV_EUI[2]`), meter 0 and meter 1. */
export const FIRMWARE_DEV_EUI = ["a84041ed485a0b9f", "a84041911d5a0b87"] as const;

/** Wallets already present in `scripts/seed-demo-data.ts` for zone index 0. */
const SEEDED_SENSOR_WALLET = "0x54509b12aB6Ad9D0F3590eD241980433ffCCFe2C";
const SEEDED_REPORTER_WALLET = "0x3cfFEC3f8fdaE6Dff40A1CA2FbFc8dcF003669D4";

export type ScenarioZone = {
  index: number;
  id: string;
  zoneKey: string;
  name: string;
  discosFeederCode: string;
  discoCode: string;
  baselineStatus: EvidenceStatus;
};

type EventCommon = {
  /** Act label, e.g. `S2`. Stable across runs so output can be scripted against. */
  act: string;
  title: string;
  band: Band;
  /** Offset from the band anchor. Negative for the live band (before now). */
  offsetSeconds: number;
  zoneIndex: number;
  expect: Expectation;
};

export type Expectation = {
  /** `none` means the deterministic engine raises no candidate at all. */
  candidate: CandidateStatus | "none";
  /** Exact value the detection ladder should produce, when it is pinned. */
  confidence?: number;
  decision?: Decision;
  why: string;
};

export type SensorEvent = EventCommon & {
  kind: "sensor";
  meter: 0 | 1;
  status: EvidenceStatus;
  /** Omitted entirely when the meter is offline — the schema rejects an explicit null. */
  voltage?: number;
};

export type ReporterEvent = EventCommon & {
  kind: "reporter";
  status: EvidenceStatus;
  note: string;
};

export type WhatsAppEvent = EventCommon & {
  kind: "whatsapp";
  /** Status is *inferred* from this text by the webhook, never sent explicitly. */
  text: string;
  fromPhone: string;
};

export type ScenarioEvent = SensorEvent | ReporterEvent | WhatsAppEvent;

/** An event with its band anchor applied, ready to send. */
export type ResolvedEvent = {
  event: ScenarioEvent;
  zone: ScenarioZone;
  observedAtUnix: number;
  observedAt: string;
};

export type Scenario = {
  /** Start of the previous whole hour — the epoch the chain leg commits. */
  sealedEpochStart: Date;
  liveAnchor: Date;
  zones: ScenarioZone[];
  events: ResolvedEvent[];
};

export function zoneAt(index: number): ScenarioZone {
  const zone = DEMO_NATIONAL_ZONES[index];
  if (!zone) {
    throw new Error(`Scenario references zone index ${index}, but only ${DEMO_NATIONAL_ZONES.length} demo zones exist`);
  }

  const discoCode = zone.discosFeederCode.split("-")[0] ?? "UNKNOWN";
  return {
    index,
    id: zone.id,
    zoneKey: zone.zoneKey,
    name: zone.name,
    discosFeederCode: zone.discosFeederCode,
    discoCode,
    baselineStatus: zone.latestStatus
  };
}

export const SCENARIO_ZONES: ScenarioZone[] = DEMO_NATIONAL_ZONES.map((_zone, index) => zoneAt(index));

/**
 * Zone 0 reuses the two DevEUIs from the real firmware so a demo can point at
 * either the simulator or the physical box without changing anything downstream.
 * Every other meter id is derived by hash: constant across runs, and unique per
 * (zone, meter) so `evidenceSourceIdentity` treats two meters as two witnesses.
 */
export function devEuiFor(zoneIndex: number, meter: 0 | 1): string {
  if (zoneIndex === 0) return FIRMWARE_DEV_EUI[meter];
  const digest = createHash("sha256").update(`gridproof-sim:deveui:${zoneIndex}:${meter}`).digest("hex");
  return `a84041${digest.slice(0, 10)}`;
}

/** `0x5e<zone>0000...` — readable at a glance and stable, unlike a hash. */
export function sensorWalletFor(zoneIndex: number): string {
  if (zoneIndex === 0) return SEEDED_SENSOR_WALLET;
  return `0x5e${zoneIndex.toString(16).padStart(2, "0")}${"0".repeat(36)}`;
}

export function reporterWalletFor(zoneIndex: number): string {
  if (zoneIndex === 0) return SEEDED_REPORTER_WALLET;
  return `0x7e${zoneIndex.toString(16).padStart(2, "0")}${"0".repeat(36)}`;
}

/** `strftime("%Y-%m-%dT%H:%M:%SZ")` in the firmware — seconds, no milliseconds. */
export function firmwareTimestamp(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 19)}Z`;
}

/** `makeIdempotencyKey`: `<DevEUI>-<unixSeconds>`, 27 chars, over the 12-char floor. */
export function idempotencyKeyFor(deviceId: string, unixSeconds: number): string {
  return `${deviceId}-${unixSeconds}`;
}

export type TelemetrySignatureInput = {
  deviceId: string;
  providerWallet: string;
  zoneId: string;
  idempotencyKey: string;
  observedAt: string;
  status: string;
  voltage?: number;
};

/**
 * The exact 7-field, dot-separated string the firmware builds and the API
 * re-derives (`ingestion/routes.ts:237`). An absent voltage collapses to an
 * empty field — the trailing separator stays.
 */
export function telemetrySigningString(input: TelemetrySignatureInput): string {
  return [
    input.deviceId,
    input.providerWallet.toLowerCase(),
    input.zoneId,
    input.idempotencyKey,
    input.observedAt,
    input.status,
    input.voltage ?? ""
  ].join(".");
}

export function signTelemetry(input: TelemetrySignatureInput, secret: string): string {
  return createHmac("sha256", secret).update(telemetrySigningString(input)).digest("hex");
}

/** Voltage the firmware would report for a given status, or undefined when offline. */
function voltageForBaseline(status: EvidenceStatus): number | undefined {
  if (status === "grid_up") return HEALTHY_LINE_VOLTAGE_V;
  if (status === "grid_down") return DEAD_LINE_VOLTAGE_V;
  return undefined;
}

function baselineExpectation(status: EvidenceStatus): Expectation {
  if (status === "grid_up") {
    return {
      candidate: "restored",
      confidence: 0.9,
      decision: "approve",
      why: "sensor grid_up with voltage >= 180 is the 0.9 rung, above the 0.85 auto-approve threshold"
    };
  }
  if (status === "grid_down") {
    return {
      candidate: "outage",
      confidence: 0.95,
      decision: "approve",
      why: "sensor grid_down with voltage <= 5 is the 0.95 rung"
    };
  }
  return {
    candidate: "none",
    why: "status unknown raises no candidate, but the reading still counts as a heartbeat"
  };
}

const MINUTE = 60;

/**
 * Act S1 — national baseline. One reading per zone from meter 0, using the
 * status each zone carries in the shared demo fixture so the simulated map
 * reproduces the curated national picture (and so all 11 DisCos light up).
 */
const NATIONAL_BASELINE: SensorEvent[] = SCENARIO_ZONES.map((zone) => ({
  kind: "sensor",
  act: "S1",
  title: `National baseline — ${zone.discosFeederCode} ${zone.name}`,
  band: "sealed",
  offsetSeconds: 5 * MINUTE,
  zoneIndex: zone.index,
  meter: 0,
  status: zone.baselineStatus,
  ...(voltageForBaseline(zone.baselineStatus) === undefined
    ? {}
    : { voltage: voltageForBaseline(zone.baselineStatus) }),
  expect: baselineExpectation(zone.baselineStatus)
}));

/**
 * Sealed-hour acts. Offsets are spaced so the ±10-minute agreement window
 * (`detection/rules.ts`) fires exactly where the expectation says it should and
 * nowhere else — S1 at +5m is deliberately far from S2 at +20m.
 */
const SEALED_ACTS: ScenarioEvent[] = [
  {
    kind: "sensor",
    act: "S2",
    title: "Feeder A trips — meter 0 sees a dead bus",
    band: "sealed",
    offsetSeconds: 20 * MINUTE,
    zoneIndex: 0,
    meter: 0,
    status: "grid_down",
    voltage: DEAD_LINE_VOLTAGE_V,
    expect: {
      candidate: "outage",
      confidence: 0.95,
      decision: "approve",
      why: "0.95 rung; nearest other evidence is 15 min away so no agreement bonus applies"
    }
  },
  {
    kind: "sensor",
    act: "S3",
    title: "Second meter on the same feeder corroborates",
    band: "sealed",
    offsetSeconds: 22 * MINUTE,
    zoneIndex: 0,
    meter: 1,
    status: "grid_down",
    voltage: RESIDUAL_LINE_VOLTAGE_V,
    expect: {
      candidate: "outage",
      confidence: 0.97,
      decision: "approve",
      why: "0.95 + 0.04 same-source agreement = 0.99, clipped by the 0.97 ceiling"
    }
  },
  {
    kind: "sensor",
    act: "S4a",
    title: "Power returns on meter 0",
    band: "sealed",
    // Capped at +36m so the last sealed *sensor* beat is >= 22 min old even when
    // a run starts at exactly HH:00:00 — outside the sweep's 18-minute lookback,
    // so the sealed hour can never manufacture a heartbeat gap in the live one.
    offsetSeconds: 36 * MINUTE,
    zoneIndex: 0,
    meter: 0,
    status: "grid_up",
    voltage: HEALTHY_LINE_VOLTAGE_V,
    expect: {
      candidate: "restored",
      confidence: 0.9,
      decision: "approve",
      why: "0.9 rung; the outage readings are 14-16 min back, outside the agreement window"
    }
  },
  {
    kind: "sensor",
    act: "S4b",
    title: "Meter 1 confirms restoration",
    band: "sealed",
    offsetSeconds: 38 * MINUTE,
    zoneIndex: 0,
    meter: 1,
    status: "grid_up",
    voltage: HEALTHY_LINE_VOLTAGE_V,
    expect: {
      candidate: "restored",
      confidence: 0.94,
      decision: "approve",
      why: "0.9 + 0.04 same-source agreement with S4a two minutes earlier"
    }
  },
  {
    kind: "reporter",
    act: "S5a",
    title: "Resident reports an outage before any meter does",
    band: "sealed",
    offsetSeconds: 30 * MINUTE,
    zoneIndex: 10,
    status: "grid_down",
    note: "Transformer went off around 30 minutes ago, whole street is dark.",
    expect: {
      candidate: "outage",
      confidence: 0.65,
      decision: "escalate",
      why: "human reports get the 0.65 default, inside the 0.5-0.85 escalation band"
    }
  },
  {
    kind: "sensor",
    act: "S5b",
    title: "Meter confirms the resident — cross-source agreement",
    band: "sealed",
    offsetSeconds: 33 * MINUTE,
    zoneIndex: 10,
    meter: 0,
    status: "grid_down",
    voltage: DEAD_LINE_VOLTAGE_V,
    expect: {
      candidate: "outage",
      confidence: 0.97,
      decision: "approve",
      why: "0.95 + 0.08 cross-source agreement = 1.03, clipped by the 0.97 ceiling"
    }
  },
  {
    kind: "reporter",
    act: "S6",
    title: "Under-supported report a reviewer will approve by hand",
    band: "sealed",
    offsetSeconds: 50 * MINUTE,
    zoneIndex: 6,
    status: "grid_down",
    note: "Transformer at Oba-Ile has been off since midday, no crew on site yet.",
    expect: {
      candidate: "outage",
      confidence: 0.65,
      decision: "escalate",
      why: "0.65 escalates; sealed-band, so a reviewer approving it mints a committable epoch score"
    }
  }
];

/**
 * Live-band acts. Every one of these escalates or raises nothing, so none of
 * them mints a chain commitment for the still-open current hour.
 *
 * Heartbeat note: the sweep is timer-driven, so it fires 0-6 minutes *after* a
 * run, and its 18-minute lookback is measured from that later instant — not from
 * when the events were sent. Offsets here are chosen so every beat the scenario
 * relies on is still inside the window at the latest possible sweep.
 *
 * Real firmware beats once a minute; this simulator sends a single burst and
 * stops. So a few minutes after any run, `now - lastBeat` crosses the 6-minute
 * threshold and every zone touched here also picks up a trailing open-gap
 * candidate. That is the detector working on a silent field, not a scenario bug
 * — `printOperatorNotes` in the runner says so out loud.
 */
const LIVE_ACTS: ScenarioEvent[] = [
  {
    kind: "reporter",
    act: "L1a",
    title: "Resident says the light is on",
    band: "live",
    offsetSeconds: -10 * MINUTE,
    zoneIndex: 19,
    status: "grid_up",
    note: "Light is back on our side of Trans-Amadi.",
    expect: {
      candidate: "restored",
      confidence: 0.65,
      decision: "escalate",
      why: "0.65 human default; sets up the conflict the next two readings run into"
    }
  },
  {
    kind: "sensor",
    act: "L1b",
    title: "Meter disagrees with the resident — confidence clamped",
    band: "live",
    offsetSeconds: -8 * MINUTE,
    zoneIndex: 19,
    meter: 0,
    status: "grid_down",
    voltage: DEAD_LINE_VOLTAGE_V,
    expect: {
      candidate: "outage",
      confidence: 0.8,
      decision: "escalate",
      why: "0.95 rung clamped to the 0.8 conflict ceiling by the disagreeing witness"
    }
  },
  {
    kind: "sensor",
    act: "L1c",
    title: "Meter holds its position four minutes later",
    band: "live",
    offsetSeconds: -4 * MINUTE,
    zoneIndex: 19,
    meter: 0,
    status: "grid_down",
    voltage: DEAD_LINE_VOLTAGE_V,
    expect: {
      candidate: "outage",
      confidence: 0.8,
      decision: "escalate",
      why: "still conflicting (the report is 6 min back, inside the window); also closes the heartbeat gap"
    }
  },
  {
    kind: "reporter",
    act: "L2",
    title: "Human-only report with no sensor coverage — the reviewer's reject case",
    band: "live",
    offsetSeconds: -6 * MINUTE,
    zoneIndex: 12,
    status: "grid_down",
    note: "No power on the Agege feeder since this afternoon.",
    expect: {
      candidate: "outage",
      confidence: 0.65,
      decision: "escalate",
      why: "a claim with nothing corroborating it; the runner rejects this one by hand, minting nothing"
    }
  },
  {
    kind: "whatsapp",
    act: "L3",
    title: "WhatsApp free text, status inferred by the webhook",
    band: "live",
    offsetSeconds: -5 * MINUTE,
    zoneIndex: 8,
    fromPhone: "+2348030000008",
    text: "No light since morning here at Onitsha main market",
    expect: {
      candidate: "outage",
      confidence: 0.65,
      decision: "escalate",
      why: "\"no light\" matches the grid_down keyword set, then takes the same 0.65 human rung"
    }
  },
  {
    kind: "sensor",
    act: "L4",
    title: "Meter is alive but cannot measure",
    band: "live",
    offsetSeconds: -3 * MINUTE,
    zoneIndex: 14,
    meter: 0,
    status: "unknown",
    expect: {
      candidate: "none",
      why: "unknown raises no candidate, yet still proves liveness — voltage is omitted, never null"
    }
  },
  {
    kind: "sensor",
    act: "L5a",
    title: "Last reading before the meter goes silent",
    band: "live",
    // -11m, not further back: the sweep can fire up to 6 minutes after this run,
    // and its 18-minute lookback is measured from then, so anything older than
    // -12m would be invisible to the very sweep that is supposed to see it.
    offsetSeconds: -11 * MINUTE,
    zoneIndex: 16,
    meter: 0,
    status: "unknown",
    expect: {
      candidate: "none",
      why: "opens a 9-minute silence; the server's heartbeat sweep turns that gap into a candidate"
    }
  },
  {
    kind: "sensor",
    act: "L5b",
    title: "Meter comes back after nine minutes of silence",
    band: "live",
    offsetSeconds: -2 * MINUTE,
    zoneIndex: 16,
    meter: 0,
    status: "unknown",
    expect: {
      candidate: "none",
      why: "closes the gap, so the sweep raises one bounded candidate at 0.65 rather than an open-ended one"
    }
  }
];

export const SCENARIO_EVENTS: ScenarioEvent[] = [...NATIONAL_BASELINE, ...SEALED_ACTS, ...LIVE_ACTS];

/** Floor to the top of the hour — matches `floorToEpoch` in the pipeline. */
function floorToHour(date: Date): Date {
  const floored = new Date(date.getTime());
  floored.setUTCMinutes(0, 0, 0);
  return floored;
}

/**
 * Resolve the constant scenario against a wall clock.
 *
 * The *scenario* is fixed; only the anchor moves, because `observedAt` has to
 * land inside the API's 24-hour-past / 5-minute-future window. `runOffsetSeconds`
 * shifts every timestamp by a constant, which changes the idempotency keys — use
 * it to replay the scenario twice within the same hour without every request
 * coming back as a duplicate.
 */
export function buildScenario(now: Date, runOffsetSeconds = 0): Scenario {
  const currentHour = floorToHour(now);
  const sealedEpochStart = new Date(currentHour.getTime() - 60 * 60 * 1000);
  const liveAnchor = now;

  const events: ResolvedEvent[] = SCENARIO_EVENTS.map((event) => {
    const anchor = event.band === "sealed" ? sealedEpochStart : liveAnchor;
    const observedAtUnix = Math.floor(anchor.getTime() / 1000) + event.offsetSeconds + runOffsetSeconds;
    return {
      event,
      zone: zoneAt(event.zoneIndex),
      observedAtUnix,
      observedAt: firmwareTimestamp(observedAtUnix)
    };
  });

  return { sealedEpochStart, liveAnchor, zones: SCENARIO_ZONES, events };
}

/** Zones the scenario touches beyond the national baseline, in narrative order. */
export const FEATURED_ZONE_INDEXES = [0, 10, 6, 19, 12, 8, 14, 16] as const;

/** Distinct DisCos the scenario sends evidence for — the dashboard coverage claim. */
export function coveredDiscoCodes(): string[] {
  return [...new Set(SCENARIO_ZONES.map((zone) => zone.discoCode))].sort();
}
