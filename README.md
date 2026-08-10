# GridProof — Session Work Log (2026-08-09)

This file documents everything changed in the GridProof repository during the
takeover session of **2026-08-09**, in which this agent inherited the codebase
from a previous autonomous agent ("Codex") and continued implementation against
[`gridproof.md`](./gridproof.md), the single source of truth.

It is a record of work performed, not a specification. `gridproof.md` remains
authoritative for architecture and requirements; [`docs/`](./docs) remains
authoritative for operational procedure.

---

## 1. Mission and method

The task was to take over an in-flight repository: determine what was actually
built versus merely present, repair what was wrong, and continue along the
dependency graph — without rewriting the specification, restarting from Goal 1,
or discarding correct prior work.

The governing rule throughout: **a file existing does not mean a goal is
complete.** Every claim below was verified by executing the relevant check, and
each section states what was run and what it produced. Where something could not
be verified, that is stated plainly rather than assumed.

### Constraints observed

| Constraint | How it was honored |
|---|---|
| No destructive git operations | None run. The repository is not a git work tree at all (`git rev-parse` fails), so no history existed to rewrite. |
| Never print secrets from `.env` | No `.env` file was read or echoed. `smart-contracts/.env.example` was authored with placeholder values only. |
| Preserve correct prior work | Existing logic was extended, not replaced. `confidenceForEvidence` was carried over verbatim; Foundry was kept over the spec's Hardhat (see §6). |
| Never claim unverified results | No contract was deployed and no transaction was submitted. See §7. |
| Minimal corrections over rewrites | Changes were scoped to restoring specification compliance. |

---

## 2. Summary of the session

Six tasks were completed. Tasks 1–5 were closed earlier in the day; task 6 —
wiring the core-loop scheduler — was the substantial piece of work and is
detailed in §5.

| # | Task | Outcome |
|---|---|---|
| 1 | Fix E2E Playwright browser demo (Goal 22) | Browser demo runs from a cold start |
| 2 | Implement `ReputationEscrow.sol` + tests (Goal 8) | Contract + 26 tests |
| 3 | Repair dead `gridproof-contracts` path references | Workspace and scripts repointed |
| 4 | Parameterized deploy script + manifest (Goal 8) | `Deploy.s.sol` + `Deploy.t.sol`; docs corrected |
| 5 | Heartbeat-gap + cross-source agreement detection (Goal 7) | Two deterministic rules, 36 detection tests |
| 6 | Wire core-loop scheduler | Background sweeps; API test count 115 → 144 |

### Verified final state

Every command below was run uncached at the end of the session:

```
turbo run test  --force   13 successful, 13 total,  0 cached
turbo run lint  --force    9 successful,  9 total,  0 cached
turbo run build --force    7 successful,  7 total,  0 cached
pnpm contracts:test       62 passed, 0 failed  (5 suites)
tsc --noEmit (apps/api)   exit 0
```

Per-package test counts from that run:

| Package | Tests |
|---|---|
| `@gridproof/api` | 144 |
| `@gridproof/web` | 43 |
| `@gridproof/script-tests` | 29 |
| `@gridproof/shared-types` | 15 |
| `@gridproof/blockchain-client` | 11 |
| `@gridproof/agent-worker` | 10 |
| `@gridproof/ai` | 8 |
| `@gridproof/config` | 4 |
| `@gridproof/e2e` | 1 API flow + 1 Playwright browser flow |

Smart contracts (Foundry, 62 tests): `ReputationEscrow` 26, `UptimeAttestation`,
`NodeRegistry`, `EpochMath`, `Deploy`.

---

## 3. Tasks 1–3: unblocking the build

### Task 1 — E2E Playwright browser demo (Goal 22)

`apps/web`'s dev script hardcodes `vite --host 0.0.0.0`. Playwright appended
`-- --host 127.0.0.1 --port 5174`, which Vite ignored, so the server bound 5173
and Playwright timed out after 20 s.

Fixed by having the Playwright web server invoke Vite directly with explicit
binding rather than going through the dev script
(`tests/e2e/playwright.config.ts:49`):

```
pnpm --dir ../.. --filter @gridproof/web exec vite --host 127.0.0.1 --port ${webPort} --strictPort
```

`--strictPort` matters: it converts a silent port fallback into a loud failure,
so this class of bug cannot recur quietly.

### Task 2 — `ReputationEscrow.sol` (Goal 8)

Part 3 of the specification requires three contracts. Only `NodeRegistry` and
`UptimeAttestation` existed. This was not a cosmetic gap: `createClientFromEnv()`
requires `BOTCHAIN_REPUTATION_ESCROW_ADDRESS`, so with no such contract the
blockchain client could never be constructed — **the missing contract blocked the
entire core loop's chain submission path.**

Implemented stake / reward / slash / withdraw with a `RELAYER_ROLE` policy cap,
a minimum-stake floor, and a withdrawal cooldown. Covered by 26 tests including
the adversarial cases: slashing above the policy cap, withdrawing during
cooldown, withdrawing below the minimum stake while active, staking while paused,
staking from an unregistered or deactivated provider, and topping up stake
restarting the cooldown.

### Task 3 — dead path references

`pnpm-workspace.yaml` globbed `gridproof-contracts/packages/*` and the root
`contracts:test` script targeted `gridproof-contracts/packages/contracts`.
Neither path exists — contracts live in `smart-contracts/` under Foundry.
Repointed to the real location; `contracts:test` is now
`forge test --root smart-contracts`.

---

## 4. Tasks 4–5: deployment tooling and detection rules

### Task 4 — deploy script, manifest, and documentation repair

`smart-contracts/script/` was empty. Added `Deploy.s.sol` (parameterized by
network via `GRIDPROOF_*` environment variables, emitting a manifest matching
`deploymentManifestSchema`) and `Deploy.t.sol`.

The larger problem was documentation describing a toolchain that does not exist.
`docs/deployment.md` instructed operators to run
`pnpm --filter @gridproof/contracts test|compile|deploy:testnet|verify-roles`
and a `hardhat verify` block. **No Hardhat exists anywhere in the repository and
there is no `@gridproof/contracts` package** — every one of those commands would
fail. An operator following the deployment guide could not have deployed.

Replaced with real, verified invocations:

```bash
pnpm contracts:test
forge build --root smart-contracts

set -a && . ./.env && set +a
forge script script/Deploy.s.sol:Deploy --rpc-url "$BOTCHAIN_RPC_URL" --broadcast
```

Verification switched to three `forge verify-contract` calls with
`cast abi-encode` constructor arguments — signatures checked against the actual
contract source, not assumed.

Also created `smart-contracts/.env.example`, resolving a dangling
`cp .env.example .env` instruction that referenced a file which did not exist.
It documents the RPC/explorer/deployer variables and the `GRIDPROOF_*` deploy
parameters. It contains placeholders only, and `.gitignore` carries
`!.env.example`, so it is safe to commit.

`docs/security-checklist.md` row 13 pointed at the same nonexistent
`verify-roles` command. Replaced with a **Post-deployment role verification**
section using real `cast call hasRole(bytes32,address)(bool)` checks. These
assert the *negative* case as well as the positive: that the relayer does **not**
hold admin on either contract, and that `nodeRegistry()` points at the
same-deployment registry. Privilege separation is only meaningful if the absence
of privilege is tested.

> A final stale `verify-roles` reference at `docs/deployment.md:406` survived
> that cleanup and was found and fixed while writing this document. It now links
> to the `cast call` procedure. `docs/` is clean of phantom-toolchain references
> as of this session; see §8 for lockfile residue.

`gridproof.md` was deliberately **not** edited, despite mentioning
Hardhat/TypeChain. It is the specification, not an implementation artifact. The
Foundry deviation is a real divergence from the spec and is called out in §6
rather than silently papered over.

### Task 5 — heartbeat-gap and cross-source agreement (Goal 7)

`detection/rules.ts` only classified a single evidence row by voltage and
confidence hint. Part 6 and Goal 7 require two further deterministic rules. Both
were implemented with no LLM call and no I/O — detection stays deterministic, as
the architecture requires.

**`apps/api/src/modules/detection/identity.ts` (new).** Corroboration must be
counted per real-world witness, not per row: ten readings from one ESP32 are one
witness. `providerId` cannot serve as that identity because the in-memory
ingestion path mints a fresh UUID per event
(`providerId: randomUUID()`), so the function prefers the device or wallet
identity carried in `rawPayload` and falls back to `providerId`.

**`apps/api/src/modules/detection/heartbeat.ts` (new).** Nodes report once per
minute; six consecutive missed beats promote zone silence to a candidate outage.
Gaps are found on the merged per-zone timeline, so a stretch of silence yields
exactly one candidate whether it has closed or is still open. Three judgment
calls are encoded deliberately:

- `status: "unknown"` still counts as a heartbeat. Liveness is judged from
  arrival, not content — a node saying "I cannot tell" is still powered and
  talking.
- Reporter submissions are never heartbeats. A human not sending a message is
  not evidence of anything.
- A zone never heard from produces nothing. Silence from an unknown node is not
  evidence of an outage.

**Confidence banding is the safety-critical part.** The bands are set so that
ambiguity reaches a human rather than the blockchain:

| Situation | Confidence | Routing |
|---|---|---|
| One node silent | capped at 0.80 | escalate — indistinguishable from a dead device |
| Several nodes silent, long gap | ≥ 0.85 | auto-approve |
| Any active source conflict | capped at 0.80 | escalate |
| Deterministic ceiling | 0.95 | never exceeded |

The single-node ceiling exists because one silent device is genuinely ambiguous
between a grid outage and a failed sensor — which the specification names as
agent territory, not detector territory. The conflict ceiling means a 0.95
zero-voltage reading contested by a human report escalates instead of being
committed to an immutable record.

**Cross-source agreement** was added to `rules.ts`, preserving the original
`confidenceForEvidence` logic verbatim and keeping the new context parameter
optional so all existing callers remain valid. Independent witnesses raise
confidence; a witness of the *other* source type raises it more (a sensor and a
human agreeing is stronger evidence than two sensors on one feeder), with the
bonus capped.

Detection tests: `rules.test.ts` 3 → 16, `heartbeat.test.ts` 20 new, including
the Goal 7 acceptance criterion — *one clear gap in seeded telemetry produces
exactly one candidate*.

---

## 5. Task 6: wiring the core loop (the main work)

### The problem

Two halves of the core loop had no driver:

1. `detectHeartbeatGapCandidates` was fully implemented and tested, but **nothing
   called it at runtime.** Gap detection is inherently a sweep: nothing arrives
   to trigger it, because the defining signal is that nothing arrived.
2. `submitPendingCommitments` / `indexPendingConfirmations` were reachable only
   from manual admin endpoints (`apps/api/src/modules/dashboard/routes.ts`).
   Nothing drove them, so **a pending commitment never became a transaction.**

The pipeline wrote a pending commitment and emitted `chain.committed` with an
empty `txHash`, and there it stopped.

### What was built

`apps/api/src/modules/pipeline/scheduler.ts` (new), wired into
`apps/api/src/server.ts`:

| Sweep | Interval | Responsibility |
|---|---|---|
| Heartbeat | 6 min (= gap threshold) | Group recent sensor evidence by zone → detect gaps → record → emit `candidate.detected` → run pipeline |
| Chain submit | 2 min | Drive `submitPendingCommitments()` |
| Chain index | 30 s | Drive `indexPendingConfirmations()` |

The heartbeat interval equals the gap threshold deliberately: running more often
cannot find earlier gaps, because the threshold is the binding constraint. Index
runs more often than submit so confirmations never lag submissions — asserted by
a test.

**Idempotency** comes from `recordGapCandidate()`, which returns a candidate only
when newly recorded. In database mode the `candidate_key` unique index
(`infrastructure/migrations/001_initial_schema.sql:51`) enforces this via
`on conflict (candidate_key) do nothing` with `rowCount === 0 ? null : candidate`.
That means the guarantee holds **across restarts and across concurrent API
instances**, not merely within one process's memory.

**No agent or scheduler signs anything.** The sweeps call the Blockchain Service,
which owns the relayer key. That boundary is unchanged.

### A latent bug found and fixed in my own prior work

`heartbeatGapKey` originally keyed on `windowStart:windowEnd`. An open gap's
`windowEnd` is `now` — so **every sweep would have minted a fresh key and re-fired
the pipeline for the same ongoing outage, every six minutes, indefinitely.** A
single outage would have produced an unbounded stream of duplicate candidates,
agent decisions, and audit records.

The key is now `zoneId:windowStart` — a silence is identified by when it started,
not by when it was observed to end. A regression test asserts that an early
sweep, a later grown sweep, and a post-restoration closed sweep all resolve to
one key.

This was caught before the code was wired in, but it is worth recording that it
was a defect in work produced earlier in this same session, not inherited.

### Chain sweeps are gated, not merely fail-safe

`submitPendingCommitments` already degraded safely when `DATABASE_URL` or the
relayer environment was absent — but "safely" meant appending a
`chain_submission.skipped` audit record on *every* invocation. On a timer, in an
in-memory demo or CI run, that is an unbounded write every two minutes for the
life of the process.

`startScheduler` now checks configuration up front and does not start those
timers at all, logging the reason exactly once. To do that without constructing a
client around a private key, `isChainRelayerConfigured` was extracted from
`createClientFromEnv` in the blockchain service — the key itself stays inside
that module. The manual admin endpoints remain available regardless, so no
capability is lost.

This matters concretely: the Playwright E2E boots the real API with
`DATABASE_URL: ""`, and now starts cleanly.

### Scope note: graceful shutdown

`server.ts` gained a `SIGINT`/`SIGTERM` handler that calls `scheduler.stopAll()`
and closes the server. **This was not in the task description.** It was added
because `stopAll()` is meaningless if nothing ever calls it, but it is a change
to process lifecycle behavior and is flagged here rather than buried.

### Testing

20 new scheduler tests and 8 new store tests; API package 115 → 144.

The sweep logic is exported as `runHeartbeatSweep(now)` with an injectable clock,
so behavior is tested deterministically rather than by waiting on timers. Tests
cover: silence becoming a candidate with no inbound request; repeated sweeps
running the pipeline exactly once; a gap first seen already closed; single-node
escalation queuing no commitment while multi-node darkness queues exactly one;
per-zone independence; empty and aged-out evidence; and a failing evidence source
being logged rather than thrown to the timer.

Four tests failed on first run. Three shared one root cause — the 18-minute sweep
lookback aged the seeded beats out of the window, so my test clocks were simply
too far past them; the code was correct and the expectations were wrong. The
fourth used `process.getActiveResourcesInfo()` to assert timers were unref'd, but
that list includes the test runner's own timers; it was rewritten to assert on
the delta against a baseline, which is what "unref'd" actually means for process
exit.

### Live verification

Beyond unit tests, the wired system was exercised in a real process:

- A live sweep against the system clock: first sweep `{zones:1, candidates:1,
  newCandidates:1}`, second `{...newCandidates:0}`, one `candidate.detected`
  event — confirming detection and idempotency outside the test harness.
- The real server booted and logged
  `GridProof API listening {port:4602, chainSweepsEnabled:false}`.
- `GET /api/v1/health` → `{"ok":true,"service":"gridproof-api",...}` and
  `/api/v1/metrics` returned live counters.
- `SIGTERM` produced `GridProof API stopped` and a clean exit in ~100 ms,
  confirming the new shutdown path.

---

## 6. Preserved deviation: Foundry instead of Hardhat

`gridproof.md` specifies Hardhat with TypeChain. The inherited implementation
uses Foundry, and no Hardhat installation exists anywhere in the repository.

This was **deliberately preserved**. The Foundry suite is complete and passing
(62 tests), and migrating a working, well-tested contract suite to a different
toolchain would be a rewrite driven by conformance to a document rather than by
any functional need — exactly the kind of change the takeover brief prohibits.
The documentation was corrected to describe the toolchain that actually exists,
and the divergence is recorded here so it is a known decision rather than an
undetected drift.

---

## 7. What is *not* done — stated explicitly

**No contract has been deployed. No transaction has been submitted. No BOT Chain
endpoint has been contacted.**

The chain submission path is implemented, wired, and unit-tested, but it has
never executed against a live network. Live deployment is **BLOCKED BY EXTERNAL
DEPENDENCY**: there is no BOT Chain RPC URL and no funded relayer key available
in this environment. This is a *missing-credentials* condition — not a code
failure, configuration failure, or external service failure. The deploy script
and verification procedure are ready for whoever holds those credentials.

Nothing in this document asserts an external result that was not observed.

---

## 8. Known open items

- **Lockfile residue.** `pnpm-lock.yaml` still contains a
  `gridproof-contracts/packages/contracts` importer and the full Hardhat /
  TypeChain dependency tree from the pre-Foundry layout. It bloats the lockfile
  but breaks nothing — all 13 build tasks pass. Regenerating it is a wide,
  version-churning change and was **not** undertaken unprompted.
- **Per-heartbeat candidates.** Every healthy `grid_up` sensor reading mints a
  "restored" candidate on ingest. Epoch scores collapse per
  `(zone, epochStart)`, so this does not cause unbounded chain writes. It is
  pre-existing behavior, noticed while writing scheduler tests, and left
  unchanged as out of scope.
- **Sweep lookback bound.** The heartbeat sweep looks back three gap-lengths
  (18 min). In steady operation the 6-minute cadence always catches a gap well
  inside that window. An API outage longer than 18 minutes coinciding with a
  zone going dark would miss the gap — recovering that is a distinct
  restart-reconciliation concern, not attempted here.

---

## 9. Files changed today

**Created**

```
apps/api/src/modules/detection/identity.ts
apps/api/src/modules/detection/heartbeat.ts
apps/api/src/modules/detection/heartbeat.test.ts
apps/api/src/modules/pipeline/scheduler.ts
apps/api/src/modules/pipeline/scheduler.test.ts
smart-contracts/src/ReputationEscrow.sol
smart-contracts/test/ReputationEscrow.t.sol
smart-contracts/script/Deploy.s.sol
smart-contracts/test/Deploy.t.sol
smart-contracts/.env.example
```

**Modified**

```
apps/api/src/server.ts                       scheduler wiring + graceful shutdown
apps/api/src/modules/blockchain/service.ts   extracted isChainRelayerConfigured
apps/api/src/modules/ingestion/store.ts      recordGapCandidate, listSweepEvidenceByZone
apps/api/src/modules/ingestion/store.test.ts +8 sweep-store tests
apps/api/src/modules/detection/rules.ts      cross-source agreement
apps/api/src/modules/detection/rules.test.ts 3 → 16 tests
tests/e2e/playwright.config.ts               explicit host/port/strictPort
pnpm-workspace.yaml, package.json            repointed contract paths
docs/deployment.md                           real forge/cast commands
docs/security-checklist.md                   cast call role verification
docs/test-plan.md                            detection + scheduler sections
docs/architecture.md                         scheduler in the apps/api track
```

---

## 10. Reproducing the verification

```bash
pnpm install

pnpm exec turbo run test  --force    # 13 tasks
pnpm exec turbo run lint  --force    #  9 tasks
pnpm exec turbo run build --force    #  7 tasks
pnpm contracts:test                  # 62 Foundry tests

pnpm --filter @gridproof/api exec vitest run   # 144 tests
pnpm --filter @gridproof/api exec tsc --noEmit
```

The API runs without a database or relayer; it falls back to in-memory stores and
starts with chain sweeps disabled, which the startup log states explicitly.
# GridProof
