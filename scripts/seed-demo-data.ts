import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { DEMO_NATIONAL_ZONES } from "../packages/shared-types/src/demo-zones.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gridproof:gridproof@localhost:5432/gridproof";
const pool = new Pool({ connectionString: databaseUrl });

/**
 * Demo narrative, on purpose:
 *
 * Zone A (Ogbomoso Feeder A) — an unambiguous outage that auto-approves and
 * queues for chain submission, followed by a genuinely disputed restoration:
 * a reporter claims power is back, but the zone's own sensor logs zero volts
 * two minutes later. That disagreement is what should trigger AI escalation
 * live during the demo — resolve it in the Reviewer Console on stage rather
 * than pre-resolving it here, so the audience watches the human-in-the-loop
 * step actually happen.
 *
 * Zone B (Ogbomoso Feeder B) — a clean, boring, steady-supply zone with two
 * corroborating sensor heartbeats, auto-approved, so there's a second,
 * uncontested proof sitting on the dashboard from the start.
 *
 * A third, low-confidence, single-source flicker report on Zone A gets
 * auto-rejected — completing the approve / escalate / reject fan-out the
 * architecture doc describes, instead of only ever showing two of three.
 *
 * IMPORTANT: chain_commitments are seeded as status: 'pending' with
 * tx_hash/block_number/explorer_url left null — exactly the shape
 * pendingCommitmentForEpochScore() produces in apps/api/src/modules/pipeline/service.ts.
 * Do NOT hand-write a 'confirmed' row with a fabricated tx hash here: Goal 18
 * in gridproof.md explicitly forbids estimating a tx hash before the chain
 * returns one, and a fake hash/explorer link will 404 if a judge checks it.
 * Once contracts are deployed to BOT Chain testnet, the real chain-submit
 * sweep (submitPendingCommitments, apps/api/src/modules/blockchain/service.ts)
 * will pick these two rows up and turn them into real, verifiable proofs —
 * which is a better live moment than anything pre-baked.
 */

const ids = {
  reviewerUser: "7af7b612-2b58-4ed4-87bc-a2eb02225729",
  reporterUser: "c9674aa0-5116-476e-9c26-92b7692893b7",
  zoneA: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  zoneB: "378b2fae-55dd-488f-aefd-c9bc17f8d4ff",

  sensorProvider: "2084fca3-725c-4a2d-b521-bc82de112c64",
  reporterProvider: "54324f65-3db3-41b8-9884-562178fd1617",
  sensorProviderB: "aaaaaaaa-1111-4111-8111-111111111101",

  outageEvidence: "6a670093-7823-44e1-80e4-ac608f9e75bd",
  restoredEvidence: "ff8c0ebe-c5b6-47ce-a24e-8fd4dfd9ea47",
  conflictingEvidence: "aaaaaaaa-1111-4111-8111-111111111104",
  zoneBEvidence1: "aaaaaaaa-1111-4111-8111-111111111102",
  zoneBEvidence2: "aaaaaaaa-1111-4111-8111-111111111103",
  rejectEvidence: "aaaaaaaa-1111-4111-8111-111111111105",

  outageCandidate: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
  restoredCandidate: "2d8aa1b9-493d-4cca-af07-9b559f424475",
  stableCandidate: "aaaaaaaa-2222-4222-8222-222222222201",
  rejectCandidate: "aaaaaaaa-2222-4222-8222-222222222202",

  approvedDecision: "4f80f256-d4a8-4e51-8d58-ff7b8a605fd2",
  // NOTE: previously "a216864f-a58c-453f-a99e-8038cf314942", which collided
  // with the decision id demo-data.ts uses for the no-DB fallback fixture
  // (a *different* candidate/confidence/story). Reassigned to avoid the two
  // fixtures resolving to different states under the same id.
  escalatedDecision: "aaaaaaaa-3333-4333-8333-333333333301",
  stableDecision: "aaaaaaaa-3333-4333-8333-333333333302",
  rejectDecision: "aaaaaaaa-3333-4333-8333-333333333303",

  outageEpochScore: "70a77c54-5e61-47f6-979e-f19810acfb95",
  stableEpochScore: "f2f0e092-c6a4-4745-88d3-a673523c444b",

  chainCommitment: "0d823346-2b42-463e-9d37-3ad4c323b237",
  stableCommitment: "aaaaaaaa-4444-4444-8444-444444444401",

  reviewNotification: "60455448-ba24-4e5d-8cf9-d1057e1777cf",

  auditAgentDecision: "a8b14f2f-47a6-43dc-9a36-c537759cff89",
  auditChainCommitment: "874526f4-747a-4cd0-bd2d-034d25773893",
  auditEscalateDecision: "aaaaaaaa-5555-4555-8555-555555555501",
  auditStableDecision: "aaaaaaaa-5555-4555-8555-555555555502",
  auditStableChainQueued: "aaaaaaaa-5555-4555-8555-555555555503",
  auditRejectDecision: "aaaaaaaa-5555-4555-8555-555555555504",
} as const;

const wallets = {
  sensor: "0x54509b12aB6Ad9D0F3590eD241980433ffCCFe2C",
  reporter: "0x3cfFEC3f8fdaE6Dff40A1CA2FbFc8dcF003669D4",
  sensorB: "0x8f2Ac710Bd4E9931aC5017Fe6B203D9a71Ef44C2",
} as const;

/**
 * Real commitments hash the canonicalized evidence batch with keccak256
 * before submitting on-chain (see modules/blockchain/service.ts). This seed
 * script doesn't pull in a keccak helper, so it uses sha256 instead — same
 * 32-byte / 64-hex-char shape the epoch_scores_evidence_hash_bytes32 check
 * constraint expects, and genuinely derived from the evidence ids rather
 * than a repeated-digit placeholder. It will NOT match what a contract call
 * recomputes; treat it as seed-only, not a real proof hash.
 */
function evidenceHash(evidenceIds: string[]): string {
  const canonical = evidenceIds.slice().sort().join(",");
  return `0x${createHash("sha256").update(canonical).digest("hex")}`;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await seedUsers(client);
    await seedZones(client);
    await seedProviders(client);
    await seedEvidence(client);
    await seedCandidates(client);
    await seedAgentDecisions(client);
    await seedEpochScores(client);
    await seedChainCommitments(client);
    await seedNotifications(client);
    await seedAuditLogs(client);
    await client.query("commit");

    console.log(
      "seeded demo users, zones, providers, evidence, candidates, decisions, pending proofs, notifications, and audit logs " +
        "(escalated restoration case left unresolved on purpose — resolve it live via /admin/review/:id/decision)",
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function seedUsers(client: PoolClient): Promise<void> {
  await client.query(
    `
      insert into users (id, role, phone_or_email, created_at)
      values
        ($1, 'reviewer', 'reviewer@gridproof.test', '2026-08-09T08:00:00.000Z'),
        ($2, 'reporter', '+2348012345678', '2026-08-09T08:05:00.000Z')
      on conflict (id) do update
      set role = excluded.role,
          phone_or_email = excluded.phone_or_email
    `,
    [ids.reviewerUser, ids.reporterUser],
  );
}

async function seedZones(client: PoolClient): Promise<void> {
  // The first two rows keep their historical ids because the rest of the demo
  // seed (providers, evidence, epoch scores) is keyed to them; the remainder
  // give the dashboard coverage across all 11 DisCos.
  const zones = DEMO_NATIONAL_ZONES.map((zone, index) => ({
    ...zone,
    id: index === 0 ? ids.zoneA : index === 1 ? ids.zoneB : zone.id,
  }));

  const values = zones
    .map((_, index) => {
      const base = index * 7;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    })
    .join(",\n        ");

  await client.query(
    `
      insert into zones (id, zone_key, name, discos_feeder_code, region, centroid_lat, centroid_lng)
      values
        ${values}
      on conflict (id) do update
      set zone_key = excluded.zone_key,
          name = excluded.name,
          discos_feeder_code = excluded.discos_feeder_code,
          region = excluded.region,
          centroid_lat = excluded.centroid_lat,
          centroid_lng = excluded.centroid_lng
    `,
    zones.flatMap((zone) => [
      zone.id,
      zone.zoneKey,
      zone.name,
      zone.discosFeederCode,
      zone.region,
      zone.centroid.lat,
      zone.centroid.lng,
    ]),
  );
}

async function seedProviders(client: PoolClient): Promise<void> {
  await client.query(
    `
      insert into providers (id, user_id, wallet_address, provider_type, zone_id, reputation_cache, active)
      values
        ($1, null, $2, 'sensor', $3, 12, true),
        ($4, $5, $6, 'reporter', $3, 4, true),
        ($7, null, $8, 'sensor', $9, 9, true)
      on conflict (id) do update
      set user_id = excluded.user_id,
          wallet_address = excluded.wallet_address,
          provider_type = excluded.provider_type,
          zone_id = excluded.zone_id,
          reputation_cache = excluded.reputation_cache,
          active = excluded.active,
          updated_at = now()
    `,
    [
      ids.sensorProvider,
      wallets.sensor,
      ids.zoneA,
      ids.reporterProvider,
      ids.reporterUser,
      wallets.reporter,
      ids.sensorProviderB,
      wallets.sensorB,
      ids.zoneB,
    ],
  );
}

async function seedEvidence(client: PoolClient): Promise<void> {
  await client.query(
    `
      insert into evidence_events (
        id, provider_id, zone_id, idempotency_key, source, status, voltage,
        confidence_hint, raw_payload, observed_at, received_at
      )
      values
        (
          $1, $2, $3, 'demo-seed:sensor:ogb-a:outage:2026-08-09T10:00:00Z',
          'sensor', 'grid_down', 0, 0.95,
          $4::jsonb, '2026-08-09T10:00:00.000Z', '2026-08-09T10:00:03.000Z'
        ),
        (
          $5, $6, $3, 'demo-seed:reporter:ogb-a:restored:2026-08-09T10:20:00Z',
          'reporter', 'grid_up', null, 0.65,
          $7::jsonb, '2026-08-09T10:20:00.000Z', '2026-08-09T10:20:04.000Z'
        ),
        (
          $8, $2, $3, 'demo-seed:sensor:ogb-a:conflict:2026-08-09T10:22:00Z',
          'sensor', 'grid_down', 0, 0.9,
          $9::jsonb, '2026-08-09T10:22:00.000Z', '2026-08-09T10:22:02.000Z'
        ),
        (
          $10, $11, $12, 'demo-seed:sensor:ogb-b:steady:2026-08-09T09:00:00Z',
          'sensor', 'grid_up', 231, 0.9,
          $13::jsonb, '2026-08-09T09:00:00.000Z', '2026-08-09T09:00:02.000Z'
        ),
        (
          $14, $11, $12, 'demo-seed:sensor:ogb-b:steady:2026-08-09T09:30:00Z',
          'sensor', 'grid_up', 229, 0.92,
          $15::jsonb, '2026-08-09T09:30:00.000Z', '2026-08-09T09:30:02.000Z'
        ),
        (
          $16, $6, $3, 'demo-seed:reporter:ogb-a:flicker:2026-08-09T11:15:00Z',
          'reporter', 'unknown', null, 0.2,
          $17::jsonb, '2026-08-09T11:15:00.000Z', '2026-08-09T11:15:05.000Z'
        )
      on conflict (id) do update
      set provider_id = excluded.provider_id,
          zone_id = excluded.zone_id,
          idempotency_key = excluded.idempotency_key,
          source = excluded.source,
          status = excluded.status,
          voltage = excluded.voltage,
          confidence_hint = excluded.confidence_hint,
          raw_payload = excluded.raw_payload,
          observed_at = excluded.observed_at,
          received_at = excluded.received_at
    `,
    [
      ids.outageEvidence,
      ids.sensorProvider,
      ids.zoneA,
      JSON.stringify({
        deviceId: "esp32-ogb-a-demo",
        providerWallet: wallets.sensor,
      }),
      ids.restoredEvidence,
      ids.reporterProvider,
      JSON.stringify({
        reporterWallet: wallets.reporter,
        note: "Power is back near the market transformer.",
      }),
      ids.conflictingEvidence,
      JSON.stringify({
        deviceId: "esp32-ogb-a-demo",
        providerWallet: wallets.sensor,
        note: "Still reading zero volts.",
      }),
      ids.zoneBEvidence1,
      ids.sensorProviderB,
      ids.zoneB,
      JSON.stringify({
        deviceId: "esp32-ogb-b-demo",
        providerWallet: wallets.sensorB,
      }),
      ids.zoneBEvidence2,
      JSON.stringify({
        deviceId: "esp32-ogb-b-demo",
        providerWallet: wallets.sensorB,
      }),
      ids.rejectEvidence,
      JSON.stringify({
        reporterWallet: wallets.reporter,
        note: "Might have flickered? Not sure, only saw it for a second.",
      }),
    ],
  );
}

async function seedCandidates(client: PoolClient): Promise<void> {
  await client.query(
    `
      insert into candidate_events (
        id, candidate_key, zone_id, status, confidence, window_start, window_end,
        evidence_event_ids, created_at
      )
      values
        (
          $1, 'demo-seed:candidate:ogb-a:outage:2026-08-09T10:00:00Z',
          $2, 'outage', 0.95, '2026-08-09T10:00:00.000Z', '2026-08-09T10:00:00.000Z',
          $3::uuid[], '2026-08-09T10:00:05.000Z'
        ),
        (
          $4, 'demo-seed:candidate:ogb-a:restored:2026-08-09T10:20:00Z',
          $2, 'restored', 0.65, '2026-08-09T10:20:00.000Z', '2026-08-09T10:22:00.000Z',
          $5::uuid[], '2026-08-09T10:22:05.000Z'
        ),
        (
          $6, 'demo-seed:candidate:ogb-b:restored:2026-08-09T09:00:00Z',
          $7, 'restored', 0.92, '2026-08-09T09:00:00.000Z', '2026-08-09T09:30:00.000Z',
          $8::uuid[], '2026-08-09T09:30:05.000Z'
        ),
        (
          $9, 'demo-seed:candidate:ogb-a:flicker:2026-08-09T11:15:00Z',
          $2, 'restored', 0.2, '2026-08-09T11:15:00.000Z', '2026-08-09T11:15:00.000Z',
          $10::uuid[], '2026-08-09T11:15:06.000Z'
        )
      on conflict (id) do update
      set candidate_key = excluded.candidate_key,
          zone_id = excluded.zone_id,
          status = excluded.status,
          confidence = excluded.confidence,
          window_start = excluded.window_start,
          window_end = excluded.window_end,
          evidence_event_ids = excluded.evidence_event_ids,
          created_at = excluded.created_at
    `,
    [
      ids.outageCandidate,
      ids.zoneA,
      [ids.outageEvidence],
      ids.restoredCandidate,
      [ids.restoredEvidence, ids.conflictingEvidence],
      ids.stableCandidate,
      ids.zoneB,
      [ids.zoneBEvidence1, ids.zoneBEvidence2],
      ids.rejectCandidate,
      [ids.rejectEvidence],
    ],
  );
}

async function seedAgentDecisions(client: PoolClient): Promise<void> {
  await client.query(
    `
      insert into agent_decisions (
        id, candidate_event_id, agent_name, confidence, decision, hypothesis,
        supporting_evidence_ids, notification_draft, reasoning_trace, created_at
      )
      values
        (
          $1, $2, 'deterministic-policy-gate', 0.95, 'approve',
          'Candidate outage passed deterministic confidence threshold.',
          $3::uuid[], 'Public outage alert prepared.',
          $4::jsonb, '2026-08-09T10:00:06.000Z'
        ),
        (
          $5, $6, 'evidence-verification-agent', 0.65, 'escalate',
          'Reporter claims Ogbomoso Feeder A is restored, but the zone''s own sensor logged zero volts two minutes later. The two sources disagree; reviewer confirmation is required before any restoration proof is committed.',
          $7::uuid[], 'Reviewer should verify the restoration against the conflicting sensor reading.',
          $8::jsonb, '2026-08-09T10:22:08.000Z'
        ),
        (
          $9, $10, 'deterministic-policy-gate', 0.92, 'approve',
          'Two consecutive sensor heartbeats confirm steady supply; no anomaly detected.',
          $11::uuid[], 'Zone status update: steady supply confirmed.',
          $12::jsonb, '2026-08-09T09:30:06.000Z'
        ),
        (
          $13, $14, 'evidence-verification-agent', 0.2, 'reject',
          'Single uncorroborated low-confidence report with no supporting sensor or second-reporter evidence; below the reject floor.',
          $15::uuid[], 'Report noted; not enough corroboration to act on yet.',
          $16::jsonb, '2026-08-09T11:15:07.000Z'
        )
      on conflict (candidate_event_id, agent_name) do update
      set id = excluded.id,
          confidence = excluded.confidence,
          decision = excluded.decision,
          hypothesis = excluded.hypothesis,
          supporting_evidence_ids = excluded.supporting_evidence_ids,
          notification_draft = excluded.notification_draft,
          reasoning_trace = excluded.reasoning_trace
    `,
    [
      ids.approvedDecision,
      ids.outageCandidate,
      [ids.outageEvidence],
      JSON.stringify({ source: "seed", policyGate: "auto_approved" }),
      ids.escalatedDecision,
      ids.restoredCandidate,
      [ids.restoredEvidence, ids.conflictingEvidence],
      JSON.stringify({
        source: "seed",
        policyGate: "human_review_required",
        sourceAgreement: "conflicting",
      }),
      ids.stableDecision,
      ids.stableCandidate,
      [ids.zoneBEvidence1, ids.zoneBEvidence2],
      JSON.stringify({
        source: "seed",
        policyGate: "auto_approved",
        sourceAgreement: "corroborating",
      }),
      ids.rejectDecision,
      ids.rejectCandidate,
      [ids.rejectEvidence],
      JSON.stringify({
        source: "seed",
        policyGate: "auto_rejected",
        sourceAgreement: "uncorroborated",
      }),
    ],
  );
}

async function seedEpochScores(client: PoolClient): Promise<void> {
  await client.query(
    `
      insert into epoch_scores (id, zone_id, epoch_start, uptime_bps, evidence_hash, created_at)
      values
        ($1, $2, '2026-08-09T10:00:00.000Z', 0, $3, '2026-08-09T10:00:07.000Z'),
        ($4, $5, '2026-08-09T09:00:00.000Z', 9820, $6, '2026-08-09T09:30:07.000Z')
      on conflict (id) do update
      set zone_id = excluded.zone_id,
          epoch_start = excluded.epoch_start,
          uptime_bps = excluded.uptime_bps,
          evidence_hash = excluded.evidence_hash,
          created_at = excluded.created_at
    `,
    [
      ids.outageEpochScore,
      ids.zoneA,
      evidenceHash([ids.outageEvidence]),
      ids.stableEpochScore,
      ids.zoneB,
      evidenceHash([ids.zoneBEvidence1, ids.zoneBEvidence2]),
    ],
  );
}

async function seedChainCommitments(client: PoolClient): Promise<void> {
  // Seeded as 'pending' with no tx_hash/block_number/explorer_url — this is
  // the exact shape a fresh approval produces (see
  // pendingCommitmentForEpochScore in pipeline/service.ts). The real
  // chain-submit sweep fills these in for real once contracts are deployed.
  // Never hand-write a 'confirmed' row here; see the note at the top of this
  // file.
  await client.query(
    `
      insert into chain_commitments (
        id, epoch_score_id, tx_hash, block_number, status, explorer_url, created_at, confirmed_at
      )
      values
        ($1, $2, null, null, 'pending', null, '2026-08-09T10:00:10.000Z', null),
        ($3, $4, null, null, 'pending', null, '2026-08-09T09:30:10.000Z', null)
      on conflict (id) do update
      set epoch_score_id = excluded.epoch_score_id,
          tx_hash = excluded.tx_hash,
          block_number = excluded.block_number,
          status = excluded.status,
          explorer_url = excluded.explorer_url,
          created_at = excluded.created_at,
          confirmed_at = excluded.confirmed_at
    `,
    [
      ids.chainCommitment,
      ids.outageEpochScore,
      ids.stableCommitment,
      ids.stableEpochScore,
    ],
  );
}

async function seedNotifications(client: PoolClient): Promise<void> {
  // Only the review-required notification is seeded. A "chain committed"
  // notification is no longer seeded up front — it would be announcing a
  // confirmation that hasn't happened yet. The real notification service
  // fires that one for real once a commitment actually confirms.
  await client.query(
    `
      insert into notification_outbox (
        id, kind, audience, channel, title, message, payload, status,
        attempts, last_error, created_at, sent_at
      )
      values (
        $1, 'review_required', 'reviewer', 'outbox',
        'Restoration report needs review',
        'Ogbomoso Feeder A: a reporter says power is back, but the zone sensor logged zero volts two minutes later. Needs reviewer confirmation.',
        $2::jsonb, 'queued', 0, null, '2026-08-09T10:22:09.000Z', null
      )
      on conflict (id) do update
      set kind = excluded.kind,
          audience = excluded.audience,
          channel = excluded.channel,
          title = excluded.title,
          message = excluded.message,
          payload = excluded.payload,
          status = excluded.status,
          attempts = excluded.attempts,
          last_error = excluded.last_error,
          created_at = excluded.created_at,
          sent_at = excluded.sent_at
    `,
    [
      ids.reviewNotification,
      JSON.stringify({
        candidateEventId: ids.restoredCandidate,
        zoneId: ids.zoneA,
      }),
    ],
  );
}

async function seedAuditLogs(client: PoolClient): Promise<void> {
  await client.query(
    `
      insert into audit_logs (id, actor_user_id, subject_provider_id, action, before, after, created_at)
      values
        (
          $1, null, $2, 'agent_decision.created', null,
          $3::jsonb, '2026-08-09T10:00:06.000Z'
        ),
        (
          $4, null, null, 'chain_submission.queued', null,
          $5::jsonb, '2026-08-09T10:00:10.000Z'
        ),
        (
          $6, null, $7, 'agent_decision.created', null,
          $8::jsonb, '2026-08-09T10:22:08.000Z'
        ),
        (
          $9, null, $10, 'agent_decision.created', null,
          $11::jsonb, '2026-08-09T09:30:06.000Z'
        ),
        (
          $12, null, null, 'chain_submission.queued', null,
          $13::jsonb, '2026-08-09T09:30:10.000Z'
        ),
        (
          $14, null, $15, 'agent_decision.created', null,
          $16::jsonb, '2026-08-09T11:15:07.000Z'
        )
      on conflict (id) do update
      set actor_user_id = excluded.actor_user_id,
          subject_provider_id = excluded.subject_provider_id,
          action = excluded.action,
          before = excluded.before,
          after = excluded.after,
          created_at = excluded.created_at
    `,
    [
      ids.auditAgentDecision,
      ids.sensorProvider,
      JSON.stringify({
        decision: {
          id: ids.approvedDecision,
          candidateEventId: ids.outageCandidate,
          decision: "approve",
        },
      }),
      ids.auditChainCommitment,
      JSON.stringify({
        epochScoreId: ids.outageEpochScore,
        commitmentId: ids.chainCommitment,
        status: "pending",
        source: "demo_seed",
      }),
      ids.auditEscalateDecision,
      ids.reporterProvider,
      JSON.stringify({
        decision: {
          id: ids.escalatedDecision,
          candidateEventId: ids.restoredCandidate,
          decision: "escalate",
        },
      }),
      ids.auditStableDecision,
      ids.sensorProviderB,
      JSON.stringify({
        decision: {
          id: ids.stableDecision,
          candidateEventId: ids.stableCandidate,
          decision: "approve",
        },
      }),
      ids.auditStableChainQueued,
      JSON.stringify({
        epochScoreId: ids.stableEpochScore,
        commitmentId: ids.stableCommitment,
        status: "pending",
        source: "demo_seed",
      }),
      ids.auditRejectDecision,
      ids.reporterProvider,
      JSON.stringify({
        decision: {
          id: ids.rejectDecision,
          candidateEventId: ids.rejectCandidate,
          decision: "reject",
        },
      }),
    ],
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
