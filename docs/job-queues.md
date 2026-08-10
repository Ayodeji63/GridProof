# GridProof job queues

GridProof uses BullMQ/Redis for the async seams that should survive process restarts. The first connected queue is:

- `agent-review` — produced by the API when a candidate is ambiguous and consumed by `apps/agent-worker`.

The synchronous reviewer-console path remains active even when Redis is unavailable, so the demo still works in local/free-tier fallback mode.

## API producer behavior

When the deterministic pipeline escalates a candidate, the API:

1. stores the `AgentDecision` as `escalate`;
2. enqueues an `agent-review` job containing `{ candidate, evidence, providers }`;
3. emits `review.required` for realtime and notifications;
4. leaves the item in the human review queue as a safe fallback.

If `REDIS_URL` is configured, the API writes to BullMQ. If Redis is missing or unavailable, the API records an in-memory job instead and continues processing.

Environment variables:

- `REDIS_URL` — optional for the API producer; required by `apps/agent-worker`.
- `JOB_QUEUE_USE_REDIS_FOR_TESTS=true` — lets API tests use Redis instead of memory fallback.
- `AGENT_REVIEW_QUEUE_ATTEMPTS` — BullMQ retry attempts, default `2`.
- `AGENT_REVIEW_QUEUE_BACKOFF_MS` — initial exponential backoff, default `1000`.

Audit records:

- `agent_review.queued` — records queue name, backend (`bullmq` or `memory`), job ID, and candidate ID.

## Agent worker behavior

`apps/agent-worker` listens to the `agent-review` queue and runs:

1. read-only context collection, when `DATABASE_URL` is configured;
2. anomaly analysis agent;
3. verification agent;
4. confidence guardrail.

Before calling the LLM, the worker can enrich the queued `{ candidate, evidence, providers }` payload with validated read-only tool snapshots from Postgres:

- `getTelemetryWindow(zoneId, range)` — recent evidence in the candidate window;
- `getHistoricalBaseline(zoneId)` — status counts, sample size, average voltage, and observed-at bounds for the baseline window;
- `getProviderMetadata(providerId)` — provider activity/reputation plus recent evidence stats;
- `getConflictingReports(zoneId, range)` — reporter-only evidence grouped by status, including whether reporter reports conflict.

The tool query wrapper only accepts `SELECT` statements. These tools cannot sign transactions, mutate reputation/stake, enqueue chain work, or write database rows.

On LLM failures or unsafe low-confidence approvals, the worker persists an `escalate` decision instead of crashing or auto-approving. `REDIS_URL` is required for the worker process because workers need a durable queue backend.

When `DATABASE_URL` is configured, the worker upserts an `agent_decisions` row with `agent_name = 'ai-evidence-verification-agent'`. This row includes:

- final AI decision (`approve`, `escalate`, or `reject`);
- confidence;
- anomaly hypothesis;
- supporting evidence IDs;
- notification draft;
- reasoning trace containing both analysis and verification outputs.

If the persisted AI decision is `approve`, the worker then performs the same deterministic handoff used by the API pipeline:

1. reload approved candidates for the candidate's zone and epoch;
2. recompute the epoch uptime score and evidence hash;
3. upsert the `epoch_scores` row;
4. upsert a `chain_commitments` row with `status = 'pending'`;
5. append `agent_decision.created` and `chain_commitment.queued` audit logs.

The worker does **not** sign or submit BOT Chain transactions. It only queues pending chain artifacts in Postgres. The Blockchain Service remains the only component that owns the relayer key and submits `UptimeAttestation.commitEpoch(...)`.

If `DATABASE_URL` is missing, the worker still completes the BullMQ job and returns a non-persisted result. This is useful for smoke-testing Redis/LLM connectivity, but production-like runs should configure both `REDIS_URL` and `DATABASE_URL`.

## Worker health and readiness

The worker exposes two HTTP endpoints because Render free-tier services need a lightweight web health check even though the process behaves like a background worker:

- `GET /health` — process liveness for Render. It returns `200` when the BullMQ worker has started and `503` when startup/queue errors mark it not ready.
- `GET /readiness` — redacted demo-readiness checklist for deployment rehearsal. It verifies worker runtime, `DATABASE_URL`, `REDIS_URL`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_ANALYSIS_MODEL`, and `LLM_VERIFICATION_MODEL`.

`/readiness` never returns configured secret values, database URLs, Redis URLs, or LLM URLs. It returns missing environment variable names only. The final deployment verifier checks this endpoint when `GRIDPROOF_WORKER_BASE_URL` is set.
