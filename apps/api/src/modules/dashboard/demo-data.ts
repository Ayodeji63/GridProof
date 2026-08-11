import type {
  AgentDecision,
  CandidateEvent,
  ChainCommitment,
  EpochScore,
  Zone
} from "@gridproof/shared-types";
import { DEMO_NATIONAL_ZONES } from "@gridproof/shared-types";

export const demoZone: Zone = {
  id: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  zoneKey: `0x${"a".repeat(64)}`,
  name: "Ogbomoso Feeder A",
  discosFeederCode: "IBEDC-OGB-A",
  region: "Oyo",
  centroid: { lat: 8.133, lng: 4.25 }
};

/** Used when DATABASE_URL is absent; covers all 11 DisCos. */
export const demoZones = DEMO_NATIONAL_ZONES;

export const demoCandidate: CandidateEvent = {
  id: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
  zoneId: demoZone.id,
  status: "outage",
  confidence: 0.62,
  windowStart: "2026-08-09T09:45:00.000Z",
  windowEnd: "2026-08-09T10:00:00.000Z",
  evidenceEventIds: ["6a670093-7823-44e1-80e4-ac608f9e75bd"],
  createdAt: "2026-08-09T10:01:00.000Z"
};

export const demoDecision: AgentDecision = {
  id: "a216864f-a58c-453f-a99e-8038cf314942",
  candidateEventId: demoCandidate.id,
  agentName: "evidence-verification-agent",
  confidence: 0.64,
  decision: "escalate",
  hypothesis: "Reporter evidence conflicts with the latest sensor heartbeat and needs reviewer confirmation.",
  supportingEvidenceIds: demoCandidate.evidenceEventIds,
  reasoningTrace: {
    sourceAgreement: "conflicting",
    policyGate: "human_review_required"
  },
  createdAt: "2026-08-09T10:01:30.000Z"
};

export const demoEpochScore: EpochScore = {
  id: "70a77c54-5e61-47f6-979e-f19810acfb95",
  zoneId: demoZone.id,
  epochStart: "2026-08-09T09:00:00.000Z",
  uptimeBps: 9675,
  evidenceHash: `0x${"e".repeat(64)}`,
  createdAt: "2026-08-09T10:02:00.000Z"
};

export const demoCommitment: ChainCommitment = {
  id: "0d823346-2b42-463e-9d37-3ad4c323b237",
  epochScoreId: demoEpochScore.id,
  txHash: `0x${"f".repeat(64)}`,
  blockNumber: 12345,
  status: "confirmed",
  explorerUrl: "https://explorer.botchain.example/tx/0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  createdAt: "2026-08-09T10:02:05.000Z",
  confirmedAt: "2026-08-09T10:02:08.000Z"
};
