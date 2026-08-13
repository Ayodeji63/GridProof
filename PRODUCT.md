# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are electricity-sector regulators. They use GridProof to assess whether feeder-monitoring infrastructure is reliably delivering trustworthy telemetry and to identify data-quality or device-reliability problems that require intervention.

DisCos and grid operators are operational stakeholders. They use the evidence and alerts produced by GridProof to investigate missing data, abnormal transmission patterns and emerging device or feeder-monitoring faults before they become prolonged data-loss incidents.

The public can inspect published uptime proofs without receiving access to sensitive raw operational evidence.

## Product Purpose

GridProof is an AI-powered, blockchain-verifiable reliability layer for electricity-grid telemetry infrastructure. It continuously monitors feeder-monitoring devices for missing data, abnormal transmission patterns and emerging faults, allowing operators to intervene before prolonged data loss occurs.

Success means regulators and other authorized stakeholders can distinguish trustworthy telemetry from gaps or anomalies, investigate emerging reliability problems promptly, and independently verify the availability records published for monitored feeders.

## Positioning

Registered devices cryptographically sign telemetry. GridProof evaluates that evidence with deterministic detection rules and AI-assisted review, produces verified telemetry epochs and availability metrics, and anchors those records to BOT Chain. This creates tamper-evident proof of the data delivered to DisCos and other stakeholders rather than relying solely on a mutable operator-controlled database.

## Operating Context

- GridProof monitors electricity feeder telemetry across Nigeria's 11 distribution companies.
- Registered hardware devices submit signed voltage, current, status and heartbeat evidence.
- Missing heartbeats, abnormal transmission patterns and conflicting or uncertain evidence enter a review pipeline.
- AI review assesses candidate incidents and supports the decision process. Ambiguous cases can be escalated for human reviewer confirmation.
- Authorized operators and reviewers investigate alerts, provider status, evidence and operational health through the web application.
- Regulators and public proof viewers can inspect published feeder availability records and BOT Chain commitments.
- The product is expected to remain usable on phones as a progressive web application as well as on control-room and office displays.

## Capabilities and Constraints

- Device telemetry must be attributable to a registered provider and protected by cryptographic signatures and replay-resistant idempotency controls.
- Feeder reliability is represented through telemetry epochs and availability metrics, including DAR and uptime basis points.
- Deterministic rules detect clear outages, restorations, heartbeat gaps and cross-source agreement or conflict.
- AI review is part of the evidence-verification pipeline; it must support explainable review and must not silently convert uncertainty into an immutable proof.
- Human review remains available for uncertain or conflicting evidence.
- Verified epoch commitments are anchored to BOT Chain and exposed through a proof explorer.
- Sensitive raw evidence, device details and operational records must not be made public merely because a derived proof is publicly verifiable. Public blockchain commitments should contain proof material rather than plaintext sensitive telemetry.
- The product must distinguish missing measurements from genuine zero-voltage or zero-current readings.
- Live data may be incomplete or unavailable; the interface must communicate stale, missing, demo and fallback states honestly.
- Mainnet deployment status, production scale and external customer adoption must not be claimed until independently verified.

## Brand Commitments

- Product name: GridProof.
- BOT Chain is the blockchain used for verifiable telemetry-availability commitments.
- Domain terminology includes feeder, DisCo, telemetry, evidence, candidate incident, epoch, DAR, availability proof and commitment.
- Product communication must remain precise about what is measured, inferred, reviewed and cryptographically proven.

## Evidence on Hand

- Product architecture and requirements: `gridproof.md` and `docs/architecture.md`.
- Nigerian DisCo and feeder demonstration data: `packages/shared-types/src/demo-zones.ts` and `scripts/seed-demo-data.ts`.
- Hardware telemetry scenario and simulator: `scripts/hardware-scenario.ts` and `scripts/simulate-hardware.ts`.
- Deterministic detection and heartbeat logic: `apps/api/src/modules/detection/`.
- AI and review pipeline: `apps/api/src/modules/pipeline/`, `packages/ai/` and `apps/agent-worker/`.
- BOT Chain contracts and deployment tooling: `smart-contracts/` and `packages/blockchain-client/`.
- Public proof, regulatory dashboard, alerts and review interfaces: `apps/web/src/features/`.
- Automated API, web, contract, script and end-to-end tests are present in the repository.
- No verified customer testimonials, regulatory endorsements, production-scale reliability statistics or completed mainnet deployment evidence are currently recorded as product proof and must not be fabricated.

## Product Principles

1. Prove the telemetry, not merely the claim: every published availability record must trace back to attributable evidence and a tamper-evident commitment.
2. Surface degradation before prolonged loss: monitoring should help operators intervene while a device or transmission problem is emerging.
3. Preserve uncertainty: deterministic detection, AI review and human escalation must clearly distinguish observations, inferences and approved facts.
4. Make public verification compatible with operational privacy: expose proofs and derived availability without disclosing sensitive raw infrastructure data.
5. Represent data quality honestly: missing, stale, conflicting, demo and unmeasured states must never be presented as healthy telemetry.

## Accessibility & Inclusion

GridProof must support responsive web and PWA use across phone, tablet and desktop contexts. Critical operational states must not rely on color alone, and regulator-facing evidence, status and proof information must remain understandable with keyboard and assistive-technology navigation.

The required formal accessibility conformance level remains an open decision.
