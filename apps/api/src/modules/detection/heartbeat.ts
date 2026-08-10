import { randomUUID } from "node:crypto";
import type { CandidateEvent, EvidenceEvent } from "@gridproof/shared-types";
import { evidenceSourceIdentity } from "./identity.js";

/** Sensor nodes are provisioned to report once per minute. */
export const HEARTBEAT_INTERVAL_MS = 60 * 1000;

/** Six consecutive missed heartbeats promote zone silence to a candidate outage. */
export const HEARTBEAT_GAP_MS = 6 * HEARTBEAT_INTERVAL_MS;

const MIN_GAP_CONFIDENCE = 0.6;
/** Extra confidence earned as the silence grows, saturating at three times the threshold. */
const GAP_LENGTH_WEIGHT = 0.2;
/** One silent device is ambiguous between a grid outage and a dead node, so it escalates. */
const SINGLE_NODE_CEILING = 0.8;
const CORROBORATION_BONUS = 0.06;
const MAX_GAP_CONFIDENCE = 0.95;

export type HeartbeatGapOptions = {
  /** Evaluation instant. Injected so sweeps and tests are deterministic. */
  now?: Date;
  /** Silence threshold. Defaults to `HEARTBEAT_GAP_MS`. */
  gapMs?: number;
};

type Heartbeat = {
  event: EvidenceEvent;
  at: number;
};

/**
 * Deterministic heartbeat-gap detection for one zone.
 *
 * A zone "had a reading" whenever any of its sensors reported, so gaps are found on
 * the merged timeline: each stretch of silence longer than the threshold yields
 * exactly one outage candidate, whether it has since closed or is still open.
 *
 * Liveness is judged from arrival, not content — a `status: "unknown"` reading still
 * proves the node is powered and talking, so it counts as a heartbeat. Reporter
 * submissions never count: a human not sending a message is not evidence of anything.
 *
 * Calls no LLM and performs no I/O.
 */
export function detectHeartbeatGapCandidates(
  zoneId: string,
  evidence: readonly EvidenceEvent[],
  options: HeartbeatGapOptions = {}
): CandidateEvent[] {
  const gapMs = options.gapMs ?? HEARTBEAT_GAP_MS;
  const now = options.now ?? new Date();
  if (!Number.isFinite(gapMs) || gapMs <= 0) return [];

  const beats = heartbeatsFor(zoneId, evidence);
  // Never having heard from a zone is not evidence that its grid is down.
  if (beats.length === 0) return [];

  const candidates: CandidateEvent[] = [];

  for (let index = 1; index < beats.length; index += 1) {
    const previous = beats[index - 1]!;
    const next = beats[index]!;
    if (next.at - previous.at <= gapMs) continue;

    candidates.push(
      buildGapCandidate({
        zoneId,
        gapMs,
        beats,
        startIndex: index - 1,
        windowEnd: next.event.observedAt,
        endsAt: next.at,
        closingBeat: next,
        createdAt: now
      })
    );
  }

  const last = beats[beats.length - 1]!;
  const nowMs = now.getTime();
  if (nowMs - last.at > gapMs) {
    candidates.push(
      buildGapCandidate({
        zoneId,
        gapMs,
        beats,
        startIndex: beats.length - 1,
        windowEnd: now.toISOString(),
        endsAt: nowMs,
        closingBeat: null,
        createdAt: now
      })
    );
  }

  return candidates;
}

/**
 * Stable dedupe key for a heartbeat-gap candidate.
 *
 * A silence is identified by when it *started*, not by when it was observed to end:
 * an open gap grows on every sweep, so keying on `windowEnd` too would mint a new key
 * each tick. Keying on `windowStart` alone means repeated sweeps — and the later sweep
 * that finally sees the gap close — all resolve to the one candidate.
 */
export function heartbeatGapKey(candidate: Pick<CandidateEvent, "zoneId" | "windowStart">): string {
  return `heartbeat-gap:${candidate.zoneId}:${candidate.windowStart}`;
}

function heartbeatsFor(zoneId: string, evidence: readonly EvidenceEvent[]): Heartbeat[] {
  return evidence
    .filter((event) => event.zoneId === zoneId && event.source === "sensor")
    .map((event) => ({ event, at: Date.parse(event.observedAt) }))
    .filter((beat) => Number.isFinite(beat.at))
    .sort((left, right) => left.at - right.at || left.event.id.localeCompare(right.event.id));
}

function buildGapCandidate(input: {
  zoneId: string;
  gapMs: number;
  beats: Heartbeat[];
  startIndex: number;
  windowEnd: string;
  endsAt: number;
  closingBeat: Heartbeat | null;
  createdAt: Date;
}): CandidateEvent {
  const startBeat = input.beats[input.startIndex]!;
  const silentNodes = nodesReportingBefore(input.beats, input.startIndex, input.gapMs);

  const evidenceEventIds = [startBeat.event.id];
  if (input.closingBeat && input.closingBeat.event.id !== startBeat.event.id) {
    evidenceEventIds.push(input.closingBeat.event.id);
  }

  return {
    id: randomUUID(),
    zoneId: input.zoneId,
    status: "outage",
    confidence: gapConfidence(input.endsAt - startBeat.at, input.gapMs, silentNodes.size),
    windowStart: startBeat.event.observedAt,
    windowEnd: input.windowEnd,
    evidenceEventIds,
    createdAt: input.createdAt.toISOString()
  };
}

/**
 * Distinct sensor nodes heard from in the threshold window before the silence began.
 * These are the nodes that went quiet together, which is what corroborates a real
 * zone outage over a single failed device.
 */
function nodesReportingBefore(beats: Heartbeat[], startIndex: number, gapMs: number): Set<string> {
  const identities = new Set<string>();
  const startedAt = beats[startIndex]!.at;

  for (let index = startIndex; index >= 0; index -= 1) {
    const beat = beats[index]!;
    if (startedAt - beat.at > gapMs) break;
    identities.add(evidenceSourceIdentity(beat.event));
  }

  return identities;
}

function gapConfidence(observedGapMs: number, thresholdMs: number, silentNodes: number): number {
  const overrun = Math.min(Math.max(observedGapMs - thresholdMs, 0) / (2 * thresholdMs), 1);
  let confidence = MIN_GAP_CONFIDENCE + GAP_LENGTH_WEIGHT * overrun;
  confidence += CORROBORATION_BONUS * Math.max(silentNodes - 1, 0);

  if (silentNodes < 2) confidence = Math.min(confidence, SINGLE_NODE_CEILING);

  return roundConfidence(Math.min(confidence, MAX_GAP_CONFIDENCE));
}

function roundConfidence(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
