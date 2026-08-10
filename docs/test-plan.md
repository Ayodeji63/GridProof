# GridProof test plan

This document writes out the automated tests that protect the demo-critical GridProof loop.

## Run commands

From the repository root:

```bash
pnpm test
pnpm e2e
pnpm lint
pnpm build
pnpm contracts:test
pnpm foundry:test
pnpm scripts:typecheck
```

For faster focused checks:

```bash
pnpm --filter @gridproof/api test
pnpm --filter @gridproof/web test
pnpm --filter @gridproof/agent-worker test
pnpm --filter @gridproof/shared-types test
pnpm --filter @gridproof/blockchain-client test
pnpm --filter @gridproof/ai test
pnpm --filter @gridproof/e2e test
```

## Continuous integration

Location: `.github/workflows/ci.yml`

GitHub Actions runs on every pull request to `main` and every push to `main`.

The CI job uses Node.js 20, pnpm 10.33.0, and the stable Foundry toolchain, then runs:

```bash
pnpm install --frozen-lockfile
pnpm --filter @gridproof/e2e exec playwright install --with-deps chromium
pnpm test
pnpm lint
pnpm build
pnpm foundry:test
```

This protects the monorepo TypeScript packages, API, web app, agent worker, API-level e2e flow, Playwright browser demo flow, and Foundry contracts before changes merge to `main`.

## API tests

Location: `apps/api/test/app.test.ts`

- Health endpoint returns service status.
- Metrics endpoint returns process uptime and pipeline counters.
- Readiness endpoint returns a redacted deployment checklist, fails with 503 when required demo env is missing, and does not leak configured secret values.
- Browser CORS headers are emitted only for configured frontend origins.
- Unknown routes return structured `NOT_FOUND` errors.
- `/auth/me` returns anonymous state without a token.
- `/auth/me` returns a Supabase-compatible JWT user and role.
- `/auth/register` issues reporter demo sessions and stores/audits local users.
- `/auth/login` issues fresh tokens for already registered demo users.
- `/auth/register` requires an invite code for reviewer/admin sessions.
- Web reporter ingestion requires reporter-or-higher auth and rejects anonymous/public users.
- Malformed reporter payloads return structured validation errors.
- Telemetry with a bad HMAC signature is rejected.
- Production telemetry fails closed when `TELEMETRY_HMAC_SECRET` is missing.
- Telemetry with `observedAt` too far in the future is rejected.
- Reporter evidence with `observedAt` outside the accepted event-age window is rejected.
- Telemetry is deduplicated by idempotency key.
- Telemetry ingest is rate-limited by device identity.
- Reporter ingest is rate-limited by reporter wallet.
- `GRIDPROOF_EVIDENCE_MODE=sensor` disables reporter/WhatsApp ingestion.
- `GRIDPROOF_EVIDENCE_MODE=reporter` disables sensor telemetry ingestion.
- Invalid evidence mode configuration fails ingestion with `EVIDENCE_MODE_INVALID`.
- Reporter ingest accepts typed fallback evidence submissions.
- WhatsApp webhook reports normalize into the reporter evidence pipeline.
- WhatsApp webhook reports verify `X-Hub-Signature-256` when `WHATSAPP_WEBHOOK_SECRET` is configured.
- Production WhatsApp webhook ingestion fails closed when `WHATSAPP_WEBHOOK_SECRET` is missing.
- WhatsApp webhook reports are deduplicated by provider message ID.
- Malformed WhatsApp webhook reports return structured validation errors.
- WhatsApp webhook reports are rate-limited by reporter identity.
- Unknown telemetry is accepted without creating a candidate or fabricated proof.
- High-confidence sensor evidence creates a pending proof commitment.
- Zone history returns feeder metadata, candidate timeline entries, and epoch scores.
- Ambiguous reporter evidence enters the reviewer queue.
- Reviewer approval creates an epoch score and pending commitment.
- Reviewer rejection does not create a commitment.
- Public alerts feed returns candidate statuses, agent hypotheses, and evidence IDs.
- Reviewer queue access is role-gated.
- Admin-only chain submission endpoint rejects unauthenticated and reporter users.
- Admin-only chain confirmation indexing endpoint rejects unauthenticated and reporter users.
- Chain submission/indexing report a safe skipped state when no database is configured.
- Provider registration requires reporter-or-higher authentication.
- Provider registration creates audit logs, lowercases wallet addresses, and returns provider details.
- Provider registration returns a wallet self-service NodeRegistry registration intent with zone key, provider type enum, and configured/unconfigured chain status.
- Unchanged provider registration is idempotent by wallet address.
- Provider listing returns registered providers.
- Notification outbox access requires reviewer-or-higher authentication.
- Reviewer decision, reviewer queue, provider registration, chain submission/indexing, and notification outbox routes reject unauthenticated and wrong-role callers.

## Security hardening tests

Location: `apps/api/src/lib/cors.test.ts`

- Production API startup requires an explicit `CORS_ORIGINS` allowlist.
- Local/test runs keep a localhost-only browser CORS default.
- Wildcard and malformed CORS origins are rejected.
- Server-to-server requests without a browser `Origin` header remain allowed.

## Configuration and deployment tests

Location: `packages/config/test/deployment-config.test.ts`

- Shared GridProof defaults keep demo-critical ports, epoch timing, agent timeout, and confidence thresholds inside safe bounds.
- Render blueprint declares the production API Docker service, free-tier plan, health check, production mode, and hybrid evidence mode.
- Render API service exposes all fail-closed production secrets/config as unsynced Render environment variables, including CORS, database/Redis, Supabase JWT, invite code, telemetry HMAC, WhatsApp webhook HMAC, relayer key, BOT Chain RPC/chain ID, and attestation contract address.
- Render worker service exposes database, Redis, and LLM configuration as unsynced environment variables.

## Observability tests

Locations:

- `apps/api/src/lib/observability.test.ts`
- `apps/web/src/lib/observability.test.tsx`

- API Sentry capture stays disabled without a DSN.
- API Sentry config reads DSN/environment/release/sample-rate env vars and disables default PII capture.
- API exception capture redacts obvious secret-bearing context keys.
- Web Sentry capture stays disabled without a Vite DSN.
- Web Sentry config reads Vite DSN/environment/release/sample-rate env vars and disables default PII capture.
- Web exception capture redacts obvious secret-bearing context keys.
- The web observability error boundary renders children normally when capture is disabled.

Additional module-level API tests live beside the source:

- `apps/api/src/modules/auth/middleware.test.ts`
- `apps/api/src/modules/auth/service.test.ts`
- `apps/api/src/modules/ingestion/store.test.ts`
- `apps/api/src/modules/providers/chain-registration.test.ts`
- `apps/api/src/modules/providers/store.test.ts`

Covered behavior:

- Local demo auth registration normalizes identities, supports login lookup, avoids duplicate audit entries, and enforces invite codes for reviewer/admin accounts.
- JWT session helpers create Supabase-compatible bearer tokens, reject expired/not-yet-active/tampered tokens, and default unaffiliated users to the public role.
- In-memory ingestion stores high-confidence sensor telemetry, ambiguous reporter restorations, duplicate idempotency handling, and unknown-evidence no-candidate behavior.
- Provider registration lowercases wallets, lists providers deterministically, audits material updates, treats unchanged registration as idempotent, and resolves demo/fallback zone keys.
- Provider chain-registration intents expose wallet self-service `NodeRegistry.register(...)` calldata, chain configuration status, explorer links, provider type enum values, and safe unconfigured behavior without RPC calls.

## Demo seed and deployment scripts

Locations:

- `scripts/seed-demo-data.ts`
- `scripts/verify-data-services.ts`
- `scripts/verify-demo-evidence.ts`
- `scripts/verify-contract-manifest.ts`
- `scripts/verify-deployment.ts`
- `tests/scripts/verify-data-services.test.ts`
- `tests/scripts/verify-demo-evidence.test.ts`
- `tests/scripts/verify-contract-manifest.test.ts`
- `tests/scripts/verify-deployment.test.ts`

- `pnpm scripts:typecheck` verifies the migration and demo seed scripts compile under strict Node TypeScript settings.
- `pnpm db:seed` idempotently populates demo users, zones, providers, evidence, candidates, agent decisions, epoch scores, chain commitments, notification outbox rows, and audit logs after migrations are applied.
- `pnpm deployment:data` verifies production Supabase/Postgres connectivity, `pgcrypto`, required tables/indexes, Redis/Upstash URL shape, and Redis `PING`.
- `pnpm deployment:contracts` verifies the BOT Chain deployment manifest and compares contract addresses/chain ID to API relayer env vars before live submission.
- `pnpm deployment:verify` checks deployed API health, metrics, readiness, public zones/providers, optional known proof, frontend HTML, and worker health from public URLs without printing configured secret values.
- `pnpm deployment:evidence` verifies that final demo evidence records two passing deployed-stack rehearsals, required screenshots, deployment-verifier logs, proof/explorer URLs, and backup recording artifacts.
- Data-services verifier tests cover healthy Postgres/Redis, missing `DATABASE_URL`, missing `pgcrypto`, missing tables, missing indexes, Redis `PING` drift, and non-Redis URL schemes.
- Contract manifest verifier tests cover successful manifest/env alignment, missing env warnings, chain-ID mismatches, API contract-address mismatches, duplicate contract addresses, admin/relayer wallet reuse, and missing manifest files.
- Deployment verifier tests cover public API/proof/web/worker happy path checks, omitted optional URL/proof warnings, pending proof rehearsal checks, strict confirmed-proof enforcement for final runs, strict degraded readiness failures, explicit rehearsal override warnings, frontend `localhost:4000` leakage detection, and missing API base URL validation.
- Demo evidence verifier tests cover successful two-run deployed rehearsal evidence, too-few deployed passes, failed rehearsal records, missing rehearsal screenshots, missing backup proof screenshots, missing manifest path, and missing evidence files.

## Detection tests

Locations:

- `apps/api/src/modules/detection/rules.test.ts`
- `apps/api/src/modules/detection/heartbeat.test.ts`
- `apps/api/src/modules/detection/trend.test.ts`

- Zero-voltage sensor evidence creates a high-confidence outage candidate.
- Reporter restoration evidence creates an ambiguous restoration candidate.
- Unknown evidence does not create a candidate.
- Zone health trend marks improving, stable, and declining epoch-score series.

Heartbeat-gap rules (deterministic, no LLM, no I/O):

- Seeded telemetry with one clear gap produces exactly one outage candidate spanning the silence.
- Silence that is still open at evaluation time is reported against the evaluation instant.
- Several separate gaps each produce exactly one candidate.
- Unbroken minute beats and silence exactly at the six-minute threshold produce no candidate.
- A zone that has never reported produces no candidate: silence from an unknown node is not evidence.
- Reporter submissions are not heartbeats, and `unknown`-status sensor readings still count as liveness.
- Another zone's beats never close this zone's gap, and a second node still reporting means the zone is not dark.
- Out-of-order evidence is sorted before gap detection.
- A single silent node stays in the escalation band; several nodes silent together for a long gap reach the auto-approve band; confidence never exceeds the 0.95 cap.
- Repeated sweeps over the same evidence derive the same gap dedupe key.
- The gap threshold is caller-overridable and defaults to six minutes.

Cross-source agreement scoring:

- An independent agreeing witness raises confidence and is recorded in the candidate's evidence IDs.
- A conflicting witness caps confidence at the escalation ceiling, so a contested reading is never auto-committed on chain.
- Repeat readings from one device count as a single witness.
- Cross-source agreement (sensor plus human) scores higher than same-source agreement.
- Unknown-status, out-of-window, and other-zone evidence contribute no signal.
- Agreement and conflict are counted independently, the corroboration bonus is capped, and supporting evidence IDs are ordered deterministically.

## Core-loop scheduler tests

Location: `apps/api/src/modules/pipeline/scheduler.test.ts`

The scheduler is what closes the loop between requests: heartbeat gaps are found by
sweeping, not by an inbound call, and approved epochs reach the chain without an
operator pressing the admin endpoint.

Heartbeat sweep:

- A sweep turns sensor silence into a candidate, emits `candidate.detected`, and increments the detection counter, with no inbound request involved.
- Repeated sweeps over the same open gap run the pipeline exactly once, even as the gap's window keeps growing.
- A gap first observed already closed is still detected exactly once.
- A single silent node is escalated for review and queues no chain commitment; several nodes dark together queue one pending commitment.
- Every zone is swept independently.
- No sensor evidence, and evidence older than the sweep lookback, both produce nothing.
- A failing evidence source is logged and reported, never thrown to the timer.

Sweep gating and lifecycle:

- Chain sweeps start only when both `DATABASE_URL` and the full relayer env are present; partial relayer config is not enough.
- Starting the scheduler without those dependencies appends no `chain_submission.skipped` or `chain_index.skipped` audit entry, so an in-memory demo or CI run cannot accumulate skip records for the life of the process. The admin endpoints stay available either way.
- Stop handles are idempotent, individually and repeated.
- Timers are unref'd, so holding a scheduler never blocks process exit.
- Sweep intervals match the detection threshold, and confirmations are indexed at least as often as they are submitted.

## Blockchain service tests

Location: `apps/api/src/modules/blockchain/service.test.ts`

- Queues commitments for approved events.
- Avoids duplicate pending commitments.
- Skips submission safely when database configuration is missing.
- Skips confirmation indexing safely when database configuration is missing.
- Emits audit records for chain transitions.

## Realtime tests

Location: `apps/api/src/modules/realtime/socket.test.ts`

- `evidence.received` broadcasts public zone status and zone-scoped evidence updates.
- `review.required` reaches authenticated reviewer/admin clients only.
- `chain.committed` broadcasts chain confirmation updates.

## Notification tests

Location: `apps/api/src/modules/notifications/service.test.ts`

- Review-required and chain-committed domain events create local outbox notifications when no webhook is configured.
- Optional webhook notifications are posted with bearer auth and marked sent without blocking the event emitter.

## Web tests

Locations:

- `apps/web/src/lib/api-client.test.ts`
- `apps/web/src/lib/realtime.test.tsx`
- `apps/web/src/features/alerts/AlertsFeed.test.tsx`
- `apps/web/src/features/dashboard/Dashboard.test.tsx`
- `apps/web/src/features/notifications/NotificationCenter.test.tsx`
- `apps/web/src/features/operations/OperationsHealth.test.tsx`
- `apps/web/src/features/providers/ProviderRegistry.test.tsx`
- `apps/web/src/features/reporter-submission/ReporterSubmission.test.tsx`
- `apps/web/src/features/proof-explorer/ProofExplorer.test.tsx`
- `apps/web/src/features/review-queue/ReviewQueue.test.tsx`
- `apps/web/src/features/settings/AuthSettings.test.tsx`
- `apps/web/src/features/zone-detail/ZoneDetail.test.tsx`

Covered behavior:

- API client parses auth session, health/metrics/readiness, proof, public alerts, zone history, and review responses.
- Realtime hook applies status pushes, refreshes proof/history/review queries on socket events, passes auth tokens to Socket.io, and falls back to REST refreshes on socket failure.
- Alerts Feed renders public outage/restoration alerts, hypotheses, evidence IDs, empty states, and proof links.
- Dashboard renders API-backed zone metrics, selected feeder proof links, and explicit demo fallback data.
- Notification Center renders outbox notifications and proof links.
- Operations Health renders service status, deployment readiness, pipeline counters, endpoint errors, and failure warnings.
- Proof Explorer renders latest proof details from the API and shows an honest empty state when no proof exists for the requested zone.
- Provider Registry renders providers and submits provider registrations.
- Reporter Submission posts fallback human evidence with the saved bearer token and renders candidate/no-candidate feedback.
- Review Queue renders pending reviews and can submit reviewer decisions.
- Settings renders active auth state, can register/login demo sessions, and can save/clear the local bearer token used by REST and realtime.
- Zone Detail renders feeder metadata, candidate timelines, epoch scores, empty states, and proof links.
- Zone Detail renders the API-provided zone health trend.
- Frontend code typechecks under the configured Vite/React test environment.

## End-to-end API flow tests

Location: `tests/e2e/test/demo-flow.test.ts`

- Runs the demo API loop through HTTP without starting a public port.
- Registers a reporter demo session and uses the issued token for protected provider setup.
- Registers a reporter provider with role-gated auth.
- Ingests high-confidence sensor evidence and verifies the pending proof, alert, notification, audit trail, and metrics counters.
- Ingests ambiguous reporter restoration evidence, verifies reviewer escalation, approves it, and checks that zone history plus the latest proof update to the recomputed epoch score.
- Confirms the admin chain-submission endpoint fails safe when no database/relayer environment is configured.

## End-to-end browser flow tests

Locations:

- `tests/e2e/playwright.config.ts`
- `tests/e2e/playwright/demo-ui.spec.ts`

Run command:

```bash
pnpm --filter @gridproof/e2e test:browser
```

Covered behavior:

- Starts the real local API and real Vite web app through Playwright web servers.
- Registers reporter and reviewer demo sessions through the API.
- Injects high-confidence sensor telemetry through the real API and verifies the browser Proof Explorer shows a pending proof honestly.
- Uses the browser Reporter Submission form to submit a restoration report.
- Uses the browser Review Queue to approve the escalated restoration.
- Verifies the browser Proof Explorer updates to the reviewer-approved uptime score.
- Verifies the Operations page renders pipeline counters after the demo flow.

Current scope note: this Playwright flow proves the browser against the local API and local pending-commitment path. It does not claim the Goal 22 “confirmed proof on live BOT Chain testnet” acceptance criterion; that still requires a deployed API with `DATABASE_URL`, relayer env, BOT Chain RPC, funded relayer wallet, and deployed contract addresses.

## Worker and package tests

Locations:

- `apps/agent-worker/test/orchestrator.test.ts`
- `apps/agent-worker/test/readiness.test.ts`
- `apps/agent-worker/test/result-sink.test.ts`
- `packages/ai/test/llm-client.test.ts`
- `packages/ai/test/tools.test.ts`
- `packages/blockchain-client/test/client.test.ts`
- `packages/blockchain-client/test/deployment.test.ts`
- `packages/shared-types/test/api.test.ts`
- `packages/shared-types/test/domain.test.ts`

Covered behavior:

- Ambiguous API candidates enqueue an `agent-review` job and audit `agent_review.queued`.
- Agent-worker orchestration preserves deterministic fallback behavior and attaches read-only tool snapshots to LLM prompt context when a tool query is configured.
- Agent-worker readiness reports missing DB/Redis/LLM env as redacted deployment failures and reports ready without leaking configured values.
- Agent-worker result sink maps AI success/failure into persisted `AgentDecision` shapes and safely skips persistence without `DATABASE_URL`.
- Agent-worker approved decisions recompute epoch scores, create pending chain commitments, and audit the queued chain artifact.
- Agent-worker rejected decisions persist without creating epoch scores or chain commitments.
- FreeLLM client handles success and error/timeout-style failures.
- AI read-only tools validate telemetry windows, historical baselines, provider metadata, conflicting reporter reports, and combined agent context snapshots.
- Blockchain client formats commit calls and reads committed state.
- Blockchain client encodes NodeRegistry provider self-registration calls and reads provider registration state.
- Blockchain deployment helpers validate Forge deployment manifests and convert them into relayer client config.
- Shared API/domain schemas accept valid GridProof payloads and reject invalid ones.
- Shared provider registry schemas validate list and registration responses.

## Smart contract tests

Foundry tests live in `smart-contracts/test/`:

- `NodeRegistry.t.sol`
- `UptimeAttestation.t.sol`
- `ReputationEscrow.t.sol`
- `EpochMath.t.sol`
- `Deploy.t.sol`

Run them with `pnpm contracts:test` (equivalently `forge test --root smart-contracts`).

Covered behavior:

- Provider registration and deactivation.
- Epoch commitment validation and replay protection.
- Role-gated relayer actions.
- Stake, reward, slash, and withdrawal accounting.
- Escrow rewards are paid only from the admin-funded reward pool, never from staked principal.
- Slashes above the admin-set policy cap revert, and slashed principal moves into the reward pool rather than to the caller.
- The escrow balance invariant `balance == totalStaked + rewardPool` holds across fuzzed stake/slash sequences.
- The deploy script wires admin/relayer roles, keeps the relayer out of `DEFAULT_ADMIN_ROLE` on the escrow, and points the escrow at the registry deployed in the same run.
- The deploy script writes a manifest that `deploymentManifestSchema` parses: decimal-string `chainId` and params, offset-bearing ISO-8601 `deployedAt`.
- The deploy script seeds the zone allowlist when the broadcaster is the admin, and skips seeding without reverting when the admin is a separate multisig.
- The deploy script reverts on a zero admin, zero relayer, or zero epoch duration.
