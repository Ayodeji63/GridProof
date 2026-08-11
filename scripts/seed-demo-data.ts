import { Pool, type PoolClient } from "pg";
import { DEMO_NATIONAL_ZONES } from "../packages/shared-types/src/demo-zones.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://gridproof:gridproof@localhost:5432/gridproof";
const pool = new Pool({ connectionString: databaseUrl });

const ids = {
  reviewerUser: "7af7b612-2b58-4ed4-87bc-a2eb02225729",
  reporterUser: "c9674aa0-5116-476e-9c26-92b7692893b7",
  zoneA: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  zoneB: "378b2fae-55dd-488f-aefd-c9bc17f8d4ff",
  sensorProvider: "2084fca3-725c-4a2d-b521-bc82de112c64",
  reporterProvider: "54324f65-3db3-41b8-9884-562178fd1617",
  outageEvidence: "6a670093-7823-44e1-80e4-ac608f9e75bd",
  restoredEvidence: "ff8c0ebe-c5b6-47ce-a24e-8fd4dfd9ea47",
  outageCandidate: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
  restoredCandidate: "2d8aa1b9-493d-4cca-af07-9b559f424475",
  approvedDecision: "4f80f256-d4a8-4e51-8d58-ff7b8a605fd2",
  escalatedDecision: "a216864f-a58c-453f-a99e-8038cf314942",
  outageEpochScore: "70a77c54-5e61-47f6-979e-f19810acfb95",
  stableEpochScore: "f2f0e092-c6a4-4745-88d3-a673523c444b",
  chainCommitment: "0d823346-2b42-463e-9d37-3ad4c323b237",
  reviewNotification: "60455448-ba24-4e5d-8cf9-d1057e1777cf",
  chainNotification: "c50684d8-b059-4cab-a42a-e38131701ba6",
  auditAgentDecision: "a8b14f2f-47a6-43dc-9a36-c537759cff89",
  auditChainCommitment: "874526f4-747a-4cd0-bd2d-034d25773893"
} as const;

const wallets = {
  sensor: "0x54509b12aB6Ad9D0F3590eD241980433ffCCFe2C",
  reporter: "0x3cfFEC3f8fdaE6Dff40A1CA2FbFc8dcF003669D4",
} as const;

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

    console.log("seeded demo users, zones, providers, evidence, candidates, decisions, proofs, notifications, and audit logs");
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
      on conflict (phone_or_email) do update
      set role = excluded.role,
          id = excluded.id
    `,
    [ids.reviewerUser, ids.reporterUser]
  );
}

async function seedZones(client: PoolClient): Promise<void> {
  // The first two rows keep their historical ids because the rest of the demo
  // seed (providers, evidence, epoch scores) is keyed to them; the remainder
  // give the dashboard coverage across all 11 DisCos.
  const zones = DEMO_NATIONAL_ZONES.map((zone, index) => ({
    ...zone,
    id: index === 0 ? ids.zoneA : index === 1 ? ids.zoneB : zone.id
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
      zone.centroid.lng
    ])
  );
}

async function seedProviders(client: PoolClient): Promise<void> {
  await client.query(
    `
      insert into providers (id, user_id, wallet_address, provider_type, zone_id, reputation_cache, active)
      values
        ($1, null, $2, 'sensor', $3, 12, true),
        ($4, $5, $6, 'reporter', $3, 4, true)
      on conflict (wallet_address) do update
      set id = excluded.id,
          user_id = excluded.user_id,
          wallet_address = excluded.wallet_address,
          provider_type = excluded.provider_type,
          zone_id = excluded.zone_id,
          reputation_cache = excluded.reputation_cache,
          active = excluded.active,
          updated_at = now()
    `,
    [ids.sensorProvider, wallets.sensor, ids.zoneA, ids.reporterProvider, ids.reporterUser, wallets.reporter]
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
      JSON.stringify({ deviceId: "esp32-ogb-a-demo", providerWallet: wallets.sensor }),
      ids.restoredEvidence,
      ids.reporterProvider,
      JSON.stringify({ reporterWallet: wallets.reporter, note: "Power is back near the market transformer." })
    ]
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
          $2, 'restored', 0.65, '2026-08-09T10:20:00.000Z', '2026-08-09T10:20:00.000Z',
          $5::uuid[], '2026-08-09T10:20:05.000Z'
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
    [ids.outageCandidate, ids.zoneA, [ids.outageEvidence], ids.restoredCandidate, [ids.restoredEvidence]]
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
          'Reporter restoration evidence needs reviewer confirmation before chain submission.',
          $7::uuid[], 'Reviewer should verify market transformer restoration.',
          $8::jsonb, '2026-08-09T10:20:08.000Z'
        )
      on conflict (candidate_event_id, agent_name) do update
      set confidence = excluded.confidence,
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
      [ids.restoredEvidence],
      JSON.stringify({ source: "seed", policyGate: "human_review_required" })
    ]
  );
}

async function seedEpochScores(client: PoolClient): Promise<void> {
  await client.query(
    `
      insert into epoch_scores (id, zone_id, epoch_start, uptime_bps, evidence_hash, created_at)
      values
        ($1, $2, '2026-08-09T10:00:00.000Z', 0, $3, '2026-08-09T10:00:07.000Z'),
        ($4, $5, '2026-08-09T09:00:00.000Z', 9675, $6, '2026-08-09T09:55:00.000Z')
      on conflict (zone_id, epoch_start) do update
      set uptime_bps = excluded.uptime_bps,
          evidence_hash = excluded.evidence_hash,
          created_at = excluded.created_at
    `,
    [ids.outageEpochScore, ids.zoneA, `0x${"e".repeat(64)}`, ids.stableEpochScore, ids.zoneB, `0x${"d".repeat(64)}`]
  );
}

async function seedChainCommitments(client: PoolClient): Promise<void> {
  await client.query(
    `
      insert into chain_commitments (
        id, epoch_score_id, tx_hash, block_number, status, explorer_url, created_at, confirmed_at
      )
      values (
        $1, $2, $3, 12345, 'confirmed', $4,
        '2026-08-09T10:00:10.000Z', '2026-08-09T10:00:12.000Z'
      )
      on conflict (epoch_score_id) do update
      set id = excluded.id,
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
      `0x${"f".repeat(64)}`,
      `https://explorer.botchain.example/tx/0x${"f".repeat(64)}`
    ]
  );
}

async function seedNotifications(client: PoolClient): Promise<void> {
  await client.query(
    `
      insert into notification_outbox (
        id, kind, audience, channel, title, message, payload, status,
        attempts, last_error, created_at, sent_at
      )
      values
        (
          $1, 'review_required', 'reviewer', 'outbox',
          'Restoration report needs review',
          'Ogbomoso Feeder A has a reporter restoration event awaiting human review.',
          $2::jsonb, 'queued', 0, null, '2026-08-09T10:20:09.000Z', null
        ),
        (
          $3, 'chain_committed', 'public', 'outbox',
          'Proof confirmed on BOT Chain',
          'Ogbomoso Feeder A outage proof has been confirmed.',
          $4::jsonb, 'sent', 1, null, '2026-08-09T10:00:13.000Z', '2026-08-09T10:00:14.000Z'
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
      JSON.stringify({ candidateEventId: ids.restoredCandidate, zoneId: ids.zoneA }),
      ids.chainNotification,
      JSON.stringify({ zoneId: ids.zoneA, txHash: `0x${"f".repeat(64)}`, status: "confirmed" })
    ]
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
          $4, null, null, 'chain_commitment.queued', null,
          $5::jsonb, '2026-08-09T10:00:10.000Z'
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
          decision: "approve"
        }
      }),
      ids.auditChainCommitment,
      JSON.stringify({
        epochScoreId: ids.outageEpochScore,
        commitmentId: ids.chainCommitment,
        source: "demo_seed"
      })
    ]
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
