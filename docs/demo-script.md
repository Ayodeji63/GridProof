# GridProof Demo Script

This is the living demo script for the stage-ready system. Keep it synchronized
with the actual deployed stack and the final hardware-vs-reporter mode decision.

## Core Proof Loop

### Seeded rehearsal setup

For an offline-safe rehearsal with local Postgres:

```bash
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm db:seed` is idempotent. It populates demo users, zones, sensor/reporter providers, evidence events, outage/restoration candidates, agent decisions, epoch scores, pending chain commitments, notifications, and audit logs. Pending seed records are not proof of a blockchain transaction; the relayer sweep must submit and confirm them before an explorer link is available. Run the seed before each dry run if you want to reset the visible demo path to known data without clearing the database.

1. Start from the public dashboard and show current feeder-zone status.
2. Open `Ogbomoso Feeder A` timeline and show seeded outage/restoration candidates.
3. Submit or replay one evidence event for a demo zone.
4. Show the candidate event moving through deterministic detection.
5. If the event is ambiguous, resolve it in the reviewer console.
6. Show the backend creating the epoch score and submitting the on-chain proof.
7. Open the proof page and verify the transaction hash on the BOT Chain explorer.

## Fallback Mode

If live hardware is unavailable, use reporter mode:

1. Set `GRIDPROOF_EVIDENCE_MODE=reporter` in the API runtime so sensor telemetry is explicitly disabled for the run.
2. Open Settings and register/login a reporter demo session, or paste a prepared reporter JWT.
3. Register a reporter/provider for the demo zone and complete the returned `NodeRegistry.register(zoneKey, 1)` wallet step if the BOT Chain registry is deployed.
4. Stake native token in `ReputationEscrow`.
5. Submit a reporter outage/restoration event.
6. Approve the event and show the resulting proof, reward, or slash state.

If hardware is ready, set `GRIDPROOF_EVIDENCE_MODE=sensor`. For rehearsals where either path may be used, keep the default `hybrid` mode.

## Dry-run rule

Before demo day, run the full script twice in a row:

1. Twice against the live deployed stack after API, worker, web, Supabase/Upstash, BOT Chain contracts, and confirmation indexing are configured.
2. Once against the recorded fallback video/screenshot set if the live network is unavailable.

Record any manual intervention required. The demo is not ready until the same operator can complete both runs without changing source code.

## Evidence manifest

After the two deployed-stack rehearsals, copy `docs/demo-evidence.example.json` to a private/local evidence file such as `docs/demo-evidence.json`, fill in the real URLs/artifact paths, and run:

```bash
GRIDPROOF_DEMO_EVIDENCE_PATH=docs/demo-evidence.json pnpm deployment:evidence
```

The manifest should record both successful live rehearsals, the deployment verifier log for each run, public dashboard/proof/operations screenshots, BOT Chain explorer screenshots, and a backup recording path or URL. Do not commit private tokens, database URLs, Redis URLs, or relayer keys in the evidence manifest.
