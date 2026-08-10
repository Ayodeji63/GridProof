import { randomUUID } from "node:crypto";
import type { CandidateEvent, EvidenceEvent } from "@gridproof/shared-types";
import { evidenceSourceIdentity } from "./identity.js";

/** Evidence further than this from the subject reading contributes no agreement signal. */
export const AGREEMENT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Ceiling applied while sources actively disagree. Keeps the candidate inside the
 * escalation band so a contested reading is never auto-committed on chain.
 */
export const CONFLICT_CONFIDENCE_CEILING = 0.8;

const CROSS_SOURCE_BONUS = 0.08;
const SAME_SOURCE_BONUS = 0.04;
const MAX_AGREEMENT_BONUS = 0.16;
const MAX_AGREED_CONFIDENCE = 0.97;

export type DetectionContext = {
  /** Recent evidence for the same zone, used for deterministic cross-source agreement. */
  recentEvidence?: readonly EvidenceEvent[];
};

export type AgreementScore = {
  /** Distinct witnesses, other than the subject, reporting the same status. */
  agreeing: number;
  /** Distinct witnesses reporting the opposite status. */
  conflicting: number;
  /** True when at least one agreeing witness is of the other source type. */
  crossSource: boolean;
  /** Confidence added for corroboration, before the conflict ceiling. */
  bonus: number;
  /** Corroborating evidence IDs, ordered deterministically. */
  supportingEvidenceIds: string[];
};

export function detectCandidateFromEvidence(
  evidence: EvidenceEvent,
  context: DetectionContext = {}
): CandidateEvent | null {
  if (evidence.status === "unknown") return null;

  const agreement = scoreCrossSourceAgreement(evidence, context.recentEvidence ?? []);
  const observedAt = new Date(evidence.observedAt);
  const windowStart = new Date(observedAt.getTime() - 5 * 60 * 1000).toISOString();

  return {
    id: randomUUID(),
    zoneId: evidence.zoneId,
    status: evidence.status === "grid_down" ? "outage" : "restored",
    confidence: applyAgreement(confidenceForEvidence(evidence), agreement),
    windowStart,
    windowEnd: evidence.observedAt,
    evidenceEventIds: [evidence.id, ...agreement.supportingEvidenceIds],
    createdAt: new Date().toISOString()
  };
}

/**
 * Deterministic cross-source agreement for one reading.
 *
 * Counts distinct witnesses in the same zone and time window, per
 * `evidenceSourceIdentity`, so repeated readings from one device cannot corroborate
 * themselves. Independent witnesses raise confidence, and a witness of the other
 * source type raises it more: a sensor and a human agreeing is stronger evidence
 * than two sensors on the same feeder agreeing.
 */
export function scoreCrossSourceAgreement(
  subject: EvidenceEvent,
  recentEvidence: readonly EvidenceEvent[]
): AgreementScore {
  const subjectIdentity = evidenceSourceIdentity(subject);
  const subjectAt = Date.parse(subject.observedAt);

  const agreeingByIdentity = new Map<string, EvidenceEvent>();
  const conflictingIdentities = new Set<string>();

  if (Number.isFinite(subjectAt)) {
    for (const other of recentEvidence) {
      if (other.id === subject.id) continue;
      if (other.zoneId !== subject.zoneId) continue;
      if (other.status === "unknown") continue;

      const identity = evidenceSourceIdentity(other);
      if (identity === subjectIdentity) continue;

      const otherAt = Date.parse(other.observedAt);
      if (!Number.isFinite(otherAt) || Math.abs(otherAt - subjectAt) > AGREEMENT_WINDOW_MS) continue;

      if (other.status !== subject.status) {
        conflictingIdentities.add(identity);
        continue;
      }

      const existing = agreeingByIdentity.get(identity);
      if (!existing || isEarlier(other, existing)) agreeingByIdentity.set(identity, other);
    }
  }

  const agreeingEvents = Array.from(agreeingByIdentity.values()).sort((left, right) =>
    isEarlier(left, right) ? -1 : 1
  );

  let bonus = 0;
  for (const event of agreeingEvents) {
    bonus += event.source === subject.source ? SAME_SOURCE_BONUS : CROSS_SOURCE_BONUS;
  }

  return {
    agreeing: agreeingEvents.length,
    conflicting: conflictingIdentities.size,
    crossSource: agreeingEvents.some((event) => event.source !== subject.source),
    bonus: roundConfidence(Math.min(bonus, MAX_AGREEMENT_BONUS)),
    supportingEvidenceIds: agreeingEvents.map((event) => event.id)
  };
}

function applyAgreement(base: number, agreement: AgreementScore): number {
  const corroborated = Math.min(base + agreement.bonus, MAX_AGREED_CONFIDENCE);
  const contested =
    agreement.conflicting > 0 ? Math.min(corroborated, CONFLICT_CONFIDENCE_CEILING) : corroborated;

  return roundConfidence(Math.min(Math.max(contested, 0), 1));
}

function confidenceForEvidence(evidence: EvidenceEvent): number {
  if (evidence.source === "reporter") {
    return evidence.confidenceHint ?? 0.65;
  }

  if (evidence.status === "grid_down" && evidence.voltage != null && evidence.voltage <= 5) {
    return 0.95;
  }

  if (evidence.status === "grid_up" && evidence.voltage != null && evidence.voltage >= 180) {
    return 0.9;
  }

  return evidence.confidenceHint ?? 0.72;
}

function isEarlier(left: EvidenceEvent, right: EvidenceEvent): boolean {
  const leftAt = Date.parse(left.observedAt);
  const rightAt = Date.parse(right.observedAt);
  if (leftAt !== rightAt) return leftAt < rightAt;
  return left.id.localeCompare(right.id) < 0;
}

function roundConfidence(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
