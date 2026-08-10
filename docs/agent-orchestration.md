# Agent Orchestration

How GridProof's two LLM agents work, what they are allowed to do, and where the
guardrails sit. Every claim below is anchored to a file and line so it can be
re-checked against the code.

Detection is **not** an agent. A deterministic engine produces candidate events;
the agents only interpret a candidate and gate whether it reaches the chain.

## Where the agents run

`apps/agent-worker/src/index.ts:42` runs a BullMQ worker consuming the
`agent-review` queue. Each job carries a `candidate`, its `evidence`, and the
`providers` involved (`orchestrator.ts:12-16`).

The worker builds two client configs from env (`index.ts:30-40`) — same base URL
and API key, different model per agent:

| Env var | Used by | Default (placeholder) |
| --- | --- | --- |
| `LLM_BASE_URL` | both | `http://localhost:3040` |
| `LLM_API_KEY` | both | empty |
| `LLM_ANALYSIS_MODEL` | Agent 1 | `fast-free-model` |
| `LLM_VERIFICATION_MODEL` | Agent 2 | `strong-free-model` |

The split is intentional: a cheap fast model for the high-volume analysis task,
a stronger one for the judgment call (`gridproof.md:504`). `timeoutMs` is fixed
at 8 s (`index.ts:34`).

`packages/ai/src/llm-client.ts` talks only to an OpenAI-compatible
`/v1/chat/completions` endpoint (`llm-client.ts:34`) with
`response_format: json_object` and `temperature: 0.1` (`llm-client.ts:43-44`).
No provider-specific code exists anywhere, which is what makes swapping
providers a one-line env change.

## Step 0 — tool context gathering (no LLM involved)

Before either agent runs, `collectAgentToolContext` (`packages/ai/src/tools.ts:254`)
pulls four things from Postgres, the first three in parallel:

- **`getTelemetryWindow`** (`tools.ts:105`) — raw evidence events inside the
  candidate's window, capped at 200 rows.
- **`getHistoricalBaseline`** (`tools.ts:131`) — 7-day status counts and average
  voltage for the zone, so "grid down" is judged against local normal.
- **`getConflictingReports`** (`tools.ts:224`) — human reporter events only,
  grouped by status. `hasConflict` is true when two or more non-`unknown`
  statuses appear (`tools.ts:248`) — people in the same zone disagreeing.
- **`getProviderMetadata`** (`tools.ts:169`) — per provider: reputation cache,
  recent evidence count, latest status.

These are plain parameterized SQL functions, not LLM-callable tools. The agents
never reach the database directly.

**Read-only enforcement** is at `index.ts:102-105`: the query wrapper rejects
any statement not beginning with `select`. Agents cannot write.

## Agent 1 — Anomaly Analysis

`packages/ai/src/agents.ts:27`. The system prompt declares it read-only and
explicitly forbids recommending blockchain writes (`agents.ts:32`).

Returns exactly three fields (`agents.ts:6-10`):

- `hypothesis` — prose explanation of what likely happened
- `confidence` — 0 to 1
- `supportingEvidenceIds` — which events back the hypothesis

It decides nothing. Its job is to turn ambiguous evidence into a stated,
attributable claim that the next stage can act on.

## Agent 2 — Evidence Verification

`packages/ai/src/agents.ts:41`. Receives the same context **plus** Agent 1's
analysis, and returns (`agents.ts:13-17`):

- `decision` — `approve` | `escalate` | `reject`
- `finalConfidence` — 0 to 1
- `notificationDraft` — the human-facing message

Thresholds are supplied twice: in the system prompt and as a `policy` object in
the payload (`agents.ts:50-54`) — approve at ≥ 0.85, escalate 0.5–0.85, reject
below 0.5.

## Guardrails

This is where the real design lives.

**Schema validation is the gate.** `completeJson` parses the model's JSON
through Zod (`llm-client.ts:59`). Malformed or off-schema output throws; there is
no lenient fallback and no partial acceptance.

**Failure always escalates, never approves.** `orchestrator.ts:50-53` catches
everything — timeout, non-2xx, bad JSON, schema mismatch — and converts it to
`{outcome: "escalate"}`. With the 8 s abort at `llm-client.ts:31`, the worst case
is "a human looks at it," never "assume it's fine" (`gridproof.md:469`).

**Approve is re-checked in code.** `orchestrator.ts:45` overrides any `approve`
carrying `finalConfidence < 0.85` into an escalation with reason
`"Agent attempted low-confidence approval"`. The model's claimed policy
compliance is not trusted.

**Approval is what unlocks the chain write.** Only on approval does
`queueApprovedDecisionForChain` (`apps/agent-worker/src/result-sink.ts:148`) run,
floor the window to an epoch boundary, and queue the commitment. The agents never
touch the blockchain; they gate whether a commitment is queued at all.

**Every outcome is persisted.** `persistOrchestrationResult` writes an
`agent_decisions` row either way, including a `reasoningTrace` with both agents'
raw output (`result-sink.ts:103-108`) or the failure mode on escalation
(`result-sink.ts:122-127`).

## Flow

```
candidate event (deterministic engine, not an agent)
        │
        ▼
BullMQ "agent-review" job            index.ts:42
        │
        ▼
collectAgentToolContext (SQL, read-only)   tools.ts:254
        │
        ▼
Agent 1: Anomaly Analysis            agents.ts:27
  → hypothesis, confidence, supportingEvidenceIds
        │
        ▼
Agent 2: Evidence Verification       agents.ts:41
  → decision, finalConfidence, notificationDraft
        │
        ├── approve & confidence ≥ 0.85 ──▶ queue chain commitment
        │                                   result-sink.ts:148
        ├── approve & confidence < 0.85 ──▶ escalate (code override)
        │                                   orchestrator.ts:45
        ├── escalate / reject ────────────▶ persisted, no chain write
        └── any throw ────────────────────▶ escalate
                                            orchestrator.ts:50
```

## Known gaps

**The reject path is not re-validated.** `orchestrator.ts:45` re-checks only
`approve`. A model returning `reject` at confidence 0.95 passes through
unchallenged, discarding evidence. The asymmetry is defensible — a false approval
writes bad data on chain, a false rejection only loses a record — but it is
currently unbounded, and a confused model rejecting real outages would be silent.

**Provider-controlled text reaches the prompt unfenced.** `agents.ts:36` does
`JSON.stringify(context)`, and that context includes `rawPayload` from every
evidence event (`tools.ts:315`) — provider-submitted data. A human reporter,
particularly via the WhatsApp ingestion path, can place text there that reads as
instructions to the model. Nothing sanitizes or delimits it. Acceptable for a
demo; before untrusted providers submit at volume, `rawPayload` should be
stripped to known fields or clearly fenced.

**Readiness only checks presence, not validity.** `readiness.ts:38-51` verifies
the four `LLM_*` vars are non-empty. It will report ready with the placeholder
model names above, which no provider will accept — a misconfigured proxy
degrades quietly to "everything escalates."

**`zoneId` type mismatch across the boundary.** The application treats `zoneId`
as a UUID (`packages/shared-types/src/domain.ts:53`, and every tool schema in
`tools.ts`), while the contracts take `bytes32`; `api.ts:148` accepts either. The
UUID-to-`bytes32` mapping determines whether zones allowlisted on chain match
what the pipeline sends. See `docs/deployment.md` for the seeding path.

## Related

- `docs/job-queues.md` — BullMQ queue topology and the `/readiness` contract
- `docs/deployment.md` — `LLM_*` env vars and zone allowlist seeding
- `gridproof.md:500-505` — why the proxy indirection exists and its demo-tier caveats
