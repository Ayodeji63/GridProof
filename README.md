# GridProof

![GridProof logo](apps/web/public/gridproof-logo.png)

**AI-assisted, blockchain-verifiable reliability monitoring for electricity-grid telemetry.**

GridProof monitors feeder telemetry for missing heartbeats, abnormal electrical readings, conflicting reports, and emerging monitoring-device faults. It preserves uncertainty through deterministic rules, AI-assisted verification, and human review, then anchors approved hourly availability records to BOT Chain as tamper-evident proofs.

The primary interface is designed for electricity-sector regulators. DisCos and operators can investigate operational evidence, while public viewers can verify published proofs without receiving access to sensitive raw telemetry.

> GridProof proves a derived availability record and its evidence hash. It does not publish raw sensor payloads, reporter identities, or private operational evidence on-chain.

## Contents

- [Why GridProof exists](#why-gridproof-exists)
- [What the system does](#what-the-system-does)
- [Architecture](#architecture)
- [Evidence and decision pipeline](#evidence-and-decision-pipeline)
- [AI agent worker](#ai-agent-worker)
- [Blockchain layer](#blockchain-layer)
- [Web application](#web-application)
- [Repository structure](#repository-structure)
- [Local development](#local-development)
- [Running the demonstrations](#running-the-demonstrations)
- [API and authorization](#api-and-authorization)
- [Deployment](#deployment)
- [Security and privacy](#security-and-privacy)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Further documentation](#further-documentation)

## Why GridProof exists

Electricity availability reports are only as trustworthy as the monitoring infrastructure that produces them. A feeder may appear healthy because a sensor stopped transmitting, a device clock drifted, or a report was altered after collection. A conventional dashboard can show the latest database value, but it cannot independently prove that the underlying evidence existed at a particular time or remained unchanged.

GridProof separates this problem into four questions:

1. **Was telemetry delivered?** Heartbeats, timestamps, idempotency keys, and device authentication establish liveness and replay resistance.
2. **What does the evidence indicate?** Deterministic rules classify clear readings and detect missing or conflicting data.
3. **How should uncertainty be handled?** Ambiguous candidates are examined by two AI agents and remain available for human review.
4. **Can the final record be independently verified?** Approved hourly scores and evidence hashes are committed to BOT Chain.

GridProof does not treat every outage candidate as a proven outage. The interface and data model distinguish:

| State | Meaning |
| --- | --- |
| Observed | A sensor or reporter supplied an evidence event. |
| Detected | Deterministic rules produced an outage or restoration candidate. |
| AI-reviewed | The external agent worker analyzed ambiguous evidence. |
| Human-reviewed | An authorized reviewer approved or rejected an escalation. |
| Queued | An approved, completed epoch has a pending chain commitment. |
| Confirmed | BOT Chain included the commitment in a successful transaction. |

## What the system does

- Accepts signed voltage, current, status, timestamp, and heartbeat telemetry.
- Accepts authenticated web reports and HMAC-verified messaging webhook reports.
- Rejects modified signatures, stale/future readings, duplicates, and excessive traffic.
- Detects clear outages/restorations and six-minute heartbeat gaps deterministically.
- Measures agreement and conflict across independent sensor and reporter sources.
- Routes high-confidence candidates directly to epoch scoring.
- Sends ambiguous candidates to a durable Redis/BullMQ AI queue.
- Keeps escalations visible to human reviewers even if the AI service is unavailable.
- Computes hourly availability scores in basis points (`0`–`10,000`).
- Commits only fixed-size proof material to BOT Chain.
- Exposes public proof, feeder history, alerts, realtime status, notification, and operational-health views.
- Provides a Judge Demo Lab and a full hardware simulation covering Nigeria's 11 DisCos.

## Architecture

```mermaid
flowchart LR
    subgraph Sources[Evidence sources]
        HW[ESP32 / feeder monitor]
        REPORT[Authenticated web reporter]
        MSG[WhatsApp or messaging adapter]
    end

    subgraph API[GridProof API]
        INGEST[Validated ingestion]
        DETECT[Deterministic detection]
        POLICY[Confidence policy]
        REVIEW[Human review API]
        EPOCH[Epoch scoring]
        RELAYER[Blockchain service / relayer]
        PUBLIC[Public read APIs and realtime events]
    end

    subgraph Data[Durable services]
        PG[(Postgres / Supabase)]
        REDIS[(Redis / BullMQ)]
    end

    subgraph AI[Agent worker]
        ANALYZE[Anomaly Analysis Agent]
        VERIFY[Evidence Verification Agent]
    end

    subgraph Chain[BOT Chain]
        NR[NodeRegistry]
        UA[UptimeAttestation]
        RE[ReputationEscrow]
    end

    WEB[React web application]

    HW --> INGEST
    REPORT --> INGEST
    MSG --> INGEST
    INGEST --> PG
    INGEST --> DETECT --> POLICY
    POLICY -->|approve| EPOCH
    POLICY -->|ambiguous| REDIS
    REDIS --> ANALYZE --> VERIFY
    VERIFY -->|approve| EPOCH
    VERIFY -->|escalate / reject| REVIEW
    REVIEW -->|human approval| EPOCH
    EPOCH --> PG
    PG --> RELAYER --> UA
    RELAYER -. provider reads .-> NR
    RELAYER -. reputation policy .-> RE
    PG --> PUBLIC --> WEB
    UA --> PUBLIC
```

### Runtime components

| Component | Technology | Responsibility |
| --- | --- | --- |
| Web | React, Vite, TanStack Query, Socket.IO, Mapbox | Regulator dashboard, alerts, review, proofs, providers, operations, and simulations. |
| API | Node.js, Express, TypeScript | Validation, authentication, ingestion, deterministic policy, persistence, notifications, scheduling, and chain submission. |
| Agent worker | BullMQ, Redis, OpenAI-compatible LLM API | Read-only context collection and two-stage analysis of ambiguous candidates. |
| Database | PostgreSQL or Supabase Postgres | Evidence, candidates, decisions, epoch scores, commitments, notifications, users, and audit logs. |
| Queue/rate limits | Redis or Upstash | Durable AI jobs and distributed rate limiting. |
| Contracts | Solidity and Foundry | Provider registry, append-only uptime attestations, and provider stake/reputation policy. |

### Core data model

```mermaid
erDiagram
    USERS ||--o{ PROVIDERS : owns
    ZONES ||--o{ PROVIDERS : contains
    PROVIDERS ||--o{ EVIDENCE_EVENTS : submits
    ZONES ||--o{ EVIDENCE_EVENTS : receives
    ZONES ||--o{ CANDIDATE_EVENTS : produces
    CANDIDATE_EVENTS ||--o{ AGENT_DECISIONS : evaluated_by
    ZONES ||--o{ EPOCH_SCORES : aggregates
    EPOCH_SCORES ||--o| CHAIN_COMMITMENTS : anchors
    USERS ||--o{ AUDIT_LOGS : acts_in
    PROVIDERS ||--o{ AUDIT_LOGS : concerns
```

Candidate records retain the IDs of their supporting evidence events. Epoch scores aggregate approved candidates by feeder and hour, and each score can have at most one chain commitment. Notification-outbox records are delivery jobs derived from pipeline events rather than owners of the underlying evidence.

## Evidence and decision pipeline

```mermaid
sequenceDiagram
    participant Device as Sensor / reporter
    participant API as GridProof API
    participant DB as Postgres
    participant Queue as Redis / BullMQ
    participant Worker as Agent worker
    participant Reviewer as Human reviewer
    participant Relayer as GridProof relayer
    participant Chain as UptimeAttestation

    Device->>API: Signed evidence + idempotency key
    API->>API: Validate source, signature, time and rate limit
    API->>DB: Store evidence once
    API->>API: Detect candidate and calculate confidence
    alt Confidence >= 0.85
        API->>DB: Approve and compute completed epoch
    else Confidence 0.50–0.85
        API->>Queue: Enqueue agent-review job
        Queue->>Worker: Candidate + evidence + providers
        Worker->>Worker: Analyze, verify and enforce guardrail
        alt Safe AI approval
            Worker->>DB: Persist decision and queue commitment
        else Escalation or failure
            Worker->>DB: Persist escalation
            Reviewer->>API: Approve or reject with note
            API->>DB: Persist human decision
        end
    else Confidence < 0.50
        API->>DB: Reject
    end
    Relayer->>DB: Read eligible pending commitments
    Relayer->>Chain: commitEpoch(zoneKey, epoch, uptimeBps, evidenceHash)
    Chain-->>Relayer: Transaction receipt
    Relayer->>DB: Store tx hash, block and confirmation
```

### Ingestion protections

Sensor telemetry is authenticated with an HMAC over its canonical fields. Current-aware devices append current as an additional authenticated field while legacy voltage-only devices remain compatible. Web reporters use bearer-token RBAC. Messaging webhook adapters use an HMAC of the exact raw request body.

Every event also carries an idempotency key. A repeated payload returns the existing event and does not run the pipeline again. Observations older than the configured window or too far in the future are rejected.

`GRIDPROOF_EVIDENCE_MODE` controls accepted sources:

- `sensor` — device telemetry only;
- `reporter` — authenticated/webhook reports only;
- `hybrid` — both sources, enabling cross-source corroboration.

### Deterministic detection

The detector runs before any LLM call:

- sensor `grid_down` with voltage at or below `5 V` starts at `0.95` confidence;
- sensor `grid_up` with voltage at or above `180 V` starts at `0.90`;
- human reports default to `0.65` unless a validated confidence hint is present;
- independent agreement can increase confidence up to `0.97`;
- conflicting witnesses cap confidence at `0.80`, forcing escalation;
- six missed one-minute heartbeats create a gap candidate;
- a single silent device is capped at `0.80` because device failure and grid failure are ambiguous.

The pipeline policy is:

```text
confidence >= 0.85  -> approve
0.50 <= confidence < 0.85 -> escalate
confidence < 0.50   -> reject
```

## AI agent worker

The worker consumes the `agent-review` BullMQ queue. It does not ingest public requests and it never receives the relayer private key.

```mermaid
flowchart TD
    JOB[Ambiguous candidate job] --> TOOLS[Read-only Postgres context]
    TOOLS --> A1[Agent 1: anomaly analysis]
    A1 --> A2[Agent 2: evidence verification]
    A2 --> SCHEMA[Zod output validation]
    SCHEMA --> GUARD{Decision guardrail}
    GUARD -->|approve and confidence >= 0.85| COMMIT[Queue epoch commitment in Postgres]
    GUARD -->|low confidence, error, timeout or malformed JSON| ESC[Escalate for human review]
    GUARD -->|reject| REJECT[Persist rejection]
```

### Agent 1: Anomaly Analysis

Produces a hypothesis, confidence, and supporting evidence IDs. It is explicitly instructed not to recommend blockchain writes.

### Agent 2: Evidence Verification

Receives the same evidence plus Agent 1's analysis and returns `approve`, `escalate`, or `reject`, a final confidence, and a notification draft.

### Guardrails

- All model output is parsed through strict Zod schemas.
- An AI approval below `0.85` is overridden to escalation in code.
- Timeouts, provider failures, invalid JSON, and schema failures escalate safely.
- Database context tools accept `SELECT` statements only.
- The worker can queue a commitment but cannot sign or broadcast it.
- Human review remains available as a fallback.

The worker uses an OpenAI-compatible `/v1/chat/completions` endpoint. Set `LLM_BASE_URL` to the router root **without `/v1`**, because the client appends that path.

## Blockchain layer

GridProof uses three Solidity contracts:

| Contract | Purpose |
| --- | --- |
| `NodeRegistry` | Maps registered provider wallets to allowed feeder-zone keys and provider types. |
| `UptimeAttestation` | Stores one immutable commitment per `(zoneKey, epochStart)`. Only `RELAYER_ROLE` can call `commitEpoch`. |
| `ReputationEscrow` | Implements provider stake, reward, slash cap, minimum stake, and withdrawal cooldown policy. |

### What is committed

`UptimeAttestation.commitEpoch` receives:

```solidity
commitEpoch(
  bytes32 zoneId,
  uint64 epochStart,
  uint16 uptimeBps,
  bytes32 evidenceHash
)
```

The evidence hash commits to the approved candidate set without publishing its raw contents. The contract requires an aligned epoch, valid basis points, a completed epoch, no duplicate commitment, an unpaused contract, and a caller with `RELAYER_ROLE`.

### Mainnet deployment

The checked-in deployment manifest is [`smart-contracts/deployments/botchainMainnet.json`](smart-contracts/deployments/botchainMainnet.json).

| Item | Value |
| --- | --- |
| Network | BOT Chain mainnet |
| Chain ID | `677` |
| Admin | `0x53f04Af7ff379a5Cef4a923e1a2B368791AaF3d1` |
| Relayer | `0x79955f9ABadCeb277596EE06D65981ce6377aB12` |
| NodeRegistry | `0x78624f4025A3B41524c2EdCD99270500a1aC9477` |
| UptimeAttestation | `0xB3A976CC574fdBf1488a3912B244433244e3f189` |
| ReputationEscrow | `0x2E084a59dA63b5B2E0E44DA6990aa03A10Dfe2fc` |
| Epoch duration | `3600` seconds |

Do not mix the testnet contract addresses with mainnet chain ID `677`. Run this before live submission:

```bash
BOTCHAIN_CHAIN_ID=677 \
BOTCHAIN_NODE_REGISTRY_ADDRESS=0x78624f4025A3B41524c2EdCD99270500a1aC9477 \
BOTCHAIN_UPTIME_ATTESTATION_ADDRESS=0xB3A976CC574fdBf1488a3912B244433244e3f189 \
BOTCHAIN_REPUTATION_ESCROW_ADDRESS=0x2E084a59dA63b5B2E0E44DA6990aa03A10Dfe2fc \
pnpm deployment:contracts:mainnet
```

The API scheduler submits eligible commitments every two minutes and indexes receipts every 30 seconds. Admin endpoints can trigger both stages immediately.

## Web application

| Route | Purpose | Access |
| --- | --- | --- |
| `/` | National feeder performance, DisCo coverage, map, voltage/current, DAR and proof links. | Public |
| `/demo` | Judge-controlled synthetic telemetry and optional relayer-backed mainnet proof. | Public wallet signature |
| `/alerts` | Filterable and paginated incident/decision history. | Public |
| `/report` | Human reporter evidence submission. | Reporter+ |
| `/providers` | Provider list, registration, and wallet self-registration intent. | Read public; write reporter+ |
| `/notifications` | Review, delivery, and BOT Chain notification records. | Reviewer+ |
| `/review` | Human approval/rejection queue with required reviewer notes. | Reviewer+ |
| `/operations` | Health, readiness, and live pipeline counters. | Public system data |
| `/settings` | Demo registration/login and bearer-token management. | Public |
| `/zones/:zoneId` | Feeder metadata, candidates, epoch history, and trend. | Public |
| `/proof/:zoneId/:epoch` | Exact epoch score, evidence hash, transaction, block, and explorer link. | Public |

Realtime Socket.IO events update public zone status and invalidate relevant views. Reviewer-only review events are delivered only to authenticated reviewer/admin sockets.

## Repository structure

```text
GridProof/
├── apps/
│   ├── api/                 Express API, scheduler, relayer and domain modules
│   ├── agent-worker/        BullMQ AI orchestration worker and health server
│   └── web/                 React/Vite regulator and proof interface
├── packages/
│   ├── ai/                  LLM client, agents, schemas and read-only tools
│   ├── blockchain-client/   Ethers client and contract ABIs
│   ├── config/              Deployment/environment validation
│   └── shared-types/        Shared Zod schemas, API types and demo feeder data
├── smart-contracts/         Foundry contracts, tests, deploy script and manifests
├── infrastructure/
│   ├── docker/              Production API and worker Dockerfiles
│   ├── migrations/          PostgreSQL schema and RLS migrations
│   ├── docker-compose.yml   Local Postgres and Redis
│   └── render.yaml          Render Blueprint for API and worker
├── scripts/                 Migration, seed, preflight and simulation tools
├── tests/                   Script tests and browser/API end-to-end tests
├── docs/                    Focused implementation and operations guides
├── PRODUCT.md               Product truth and user context
└── DESIGN.md                Web design system and interaction rules
```

## Local development

### Prerequisites

- Node.js 20 or newer
- pnpm 10.33.0 through Corepack
- Docker for local PostgreSQL and Redis
- Foundry (`forge` and `cast`) for contract work
- An OpenAI-compatible LLM endpoint for live agent reviews

### 1. Install dependencies

```bash
corepack enable
pnpm install --frozen-lockfile
```

For a fresh contract checkout:

```bash
pnpm contracts:install
```

### 2. Create environment files

```bash
cp apps/api/.env.example apps/api/.env
cp apps/agent-worker/.env.example apps/agent-worker/.env
cp apps/web/.env.example apps/web/.env
cp smart-contracts/.env.example smart-contracts/.env
```

Never commit populated `.env` files or print private keys in logs.

### 3. Start data services

```bash
docker compose -f infrastructure/docker-compose.yml up -d
```

This starts PostgreSQL on `5432` and Redis on `6379`.

### 4. Migrate and seed

```bash
pnpm db:migrate
pnpm db:seed
```

The migration runner applies sorted SQL files idempotently. The seed script can be rerun without duplicating unique agent decisions.

### 5. Configure the LLM worker

In `apps/agent-worker/.env`:

```env
DATABASE_URL=postgres://gridproof:gridproof@localhost:5432/gridproof
REDIS_URL=redis://localhost:6379
LLM_BASE_URL=http://localhost:3001
LLM_API_KEY=<router-key>
LLM_ANALYSIS_MODEL=<concrete-model-id>
LLM_VERIFICATION_MODEL=<concrete-model-id>
LLM_TIMEOUT_MS=20000
```

Check the router's models and then run a real preflight:

```bash
curl -s http://localhost:3001/v1/models \
  -H "Authorization: Bearer $LLM_API_KEY"

pnpm llm:preflight
```

### 6. Start the applications

Run everything:

```bash
pnpm dev
```

Or use separate terminals:

```bash
pnpm --filter @gridproof/api dev
pnpm --filter @gridproof/agent-worker dev
pnpm --filter @gridproof/web dev
```

Default URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:4000/api/v1`
- API health: `http://localhost:4000/api/v1/health`
- API readiness: `http://localhost:4000/api/v1/readiness`
- Worker health: `http://localhost:4101/health`
- Worker readiness: `http://localhost:4101/readiness`

## Running the demonstrations

### Judge Demo Lab

Open `/demo`, connect an injected wallet, select a feeder and scenario, and sign the one-time authorization message.

- **Preview mode** is the default and does not broadcast a transaction.
- **Publish proof to BOT Chain** authorizes the backend relayer to publish an approved synthetic proof.
- The judge's wallet does not pay gas and is never granted `RELAYER_ROLE`.
- The signed challenge binds the wallet, feeder, scenario, chain mode, nonce, and expiration.

For supervised mainnet writes, set on the API:

```env
GRIDPROOF_DEMO_ENABLED=true
GRIDPROOF_DEMO_ALLOW_CHAIN_WRITE=true
```

Disable `GRIDPROOF_DEMO_ALLOW_CHAIN_WRITE` after the demonstration to protect relayer funds.

### Full hardware simulation

The hardware simulator sends 38 deterministic events across 23 demo feeders representing all 11 Nigerian DisCos. It tests signatures, replay protection, clock validation, deterministic decisions, reviewer approval/rejection, chain submission, receipt indexing, public proofs, alerts, and feeder history.

It performs real writes when the target API has a configured relayer. Treat this command as a mainnet-changing operation:

```bash
pnpm simulate:hardware -- --run-offset 1
```

Against a deployed API:

```bash
pnpm simulate:hardware -- \
  --base-url https://your-api.example \
  --run-offset 2
```

Use a new `--run-offset` for a fresh run. Reusing the same keys intentionally exercises idempotent replay and may produce no new commitments.

Approved scenario events are placed in the previous completed hour because `UptimeAttestation` rejects an unfinished epoch. The timestamp displayed as “Measurement epoch” is therefore earlier than “Transaction confirmed”; those timestamps describe different lifecycle stages.

## API and authorization

All endpoints use the `/api/v1` prefix.

### Public reads

```text
GET /health
GET /readiness
GET /metrics
GET /zones
GET /zones/:id/history
GET /alerts
GET /chain/proof/:zoneId/:epoch
GET /providers
```

### Evidence writes

```text
POST /ingest/telemetry          HMAC-authenticated device
POST /ingest/report             reporter bearer token
POST /ingest/whatsapp-webhook   raw-body HMAC
```

### Protected operations

```text
GET  /admin/review-queue                 reviewer+
POST /admin/review/:id/decision          reviewer+
GET  /admin/notifications                reviewer+
POST /chain/submit-pending               admin
POST /chain/index-confirmations          admin
POST /providers                          reporter+
```

Roles are hierarchical: `public < reporter < reviewer < admin`. The API reads the role from `app_metadata.role`, then `user_metadata.role`, then `role`. Reviewer/admin demo registration requires `GRIDPROOF_AUTH_INVITE_CODE`.

## Deployment

### Web on Vercel

When the Vercel project Root Directory is `apps/web`, use:

```text
Framework preset: Vite
Build command: pnpm --filter @gridproof/shared-types build && pnpm --filter @gridproof/web build
Output directory: dist
Install command: pnpm install --frozen-lockfile
```

Required web variable:

```env
VITE_API_BASE_URL=https://your-api.example/api/v1
```

Optional variables include `VITE_MAPBOX_TOKEN` and Sentry settings. The checked-in [`apps/web/vercel.json`](apps/web/vercel.json) supplies SPA routing behavior.

### API and worker on Render

[`infrastructure/render.yaml`](infrastructure/render.yaml) defines two Docker web services:

- `gridproof-api` with health path `/api/v1/health`;
- `gridproof-agent-worker` with health path `/health`.

Both Dockerfiles expect the repository root as their build context. Deploy the Blueprint after pushing the current `main` branch. When changing Docker paths, use **Clear build cache & deploy**.

The API needs Postgres, Redis, CORS, authentication, evidence-signing, BOT Chain, and relayer variables listed in [`apps/api/.env.example`](apps/api/.env.example).

The worker must use the **same** `DATABASE_URL` and `REDIS_URL` as the API. Its `LLM_BASE_URL` must be publicly reachable from Render; `localhost:3001` refers to the worker container itself and will not reach a service running on your laptop.

Verify deployed services:

```bash
GRIDPROOF_API_BASE_URL=https://your-api.example \
GRIDPROOF_WORKER_BASE_URL=https://your-worker.example \
pnpm deployment:verify
```

See [`docs/deployment.md`](docs/deployment.md) for contract deployment, verification, environment wiring, Vercel, and Render details.

## Security and privacy

### Trust boundaries

```mermaid
flowchart TB
    PUBLIC[Public internet] -->|validated requests| API[GridProof API]
    API -->|parameterized SQL| DB[(Postgres with RLS)]
    API -->|jobs only| REDIS[(Redis)]
    REDIS --> WORKER[Agent worker]
    WORKER -->|read-only context + decision writes| DB
    WORKER -->|OpenAI-compatible HTTPS| LLM[LLM router]
    API -->|private relayer signer| CHAIN[BOT Chain]
    WEB[Browser] -->|bearer token / public reads| API

    classDef secret fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    class API secret;
```

- The relayer private key belongs only in the API environment.
- The agent worker and browser must never receive it.
- Production CORS requires explicit origins; wildcards are rejected.
- Sensor and webhook writes require cryptographic signatures.
- Protected routes validate JWT signature, expiry, and role server-side.
- Distributed rate limiting uses Redis with an in-memory availability fallback.
- Supabase tables have RLS enabled without direct browser policies; clients use the API.
- Sentry integrations redact authorization, token, secret, private-key, and signature fields.
- The chain stores proof material, not raw evidence.

### Known confidentiality limitation

`users.phone_or_email` and `evidence_events.raw_payload` are plaintext at the application layer. Database-provider encryption at rest, TLS, and RLS reduce exposure, but a database administrator or compromised server credential can still read them. Application-layer field encryption with key rotation and a migration strategy is required before collecting sensitive production identities or message content at scale.

### Mainnet safety

- Keep the admin and relayer wallets separate.
- Verify `RELAYER_ROLE`, contract pause state, network chain ID, and relayer balance before a demo.
- Never mix addresses from `botchainTestnet.json` with chain ID `677`.
- Leave `GRIDPROOF_DEMO_ALLOW_CHAIN_WRITE=false` outside supervised demos.
- A transaction is irreversible; do not put secrets or raw evidence in commitment fields.

## Testing

```bash
# All package tests
pnpm test

# Type checking and lint tasks
pnpm lint
pnpm typecheck

# Production builds
pnpm build

# API and browser end-to-end flow
pnpm e2e

# Solidity tests
pnpm contracts:test

# Dependency audit
pnpm audit --audit-level high
```

Useful focused commands:

```bash
pnpm --filter @gridproof/api test
pnpm --filter @gridproof/agent-worker test
pnpm --filter @gridproof/web test
pnpm scripts:typecheck
```

## Troubleshooting

### `ECONNREFUSED 127.0.0.1:5432`

PostgreSQL is not running or `DATABASE_URL` points to the wrong host.

```bash
docker compose -f infrastructure/docker-compose.yml up -d postgres
```

### Duplicate `agent_decisions_candidate_agent_idx`

Use the current idempotent seed script and migrations, then rerun:

```bash
pnpm db:migrate
pnpm db:seed
```

### Redis rate-limit timeout

The API falls back to an in-memory counter, so requests continue, but rate limits are no longer distributed across instances. Verify the Redis URL, TLS scheme, firewall, and provider availability.

### `UNAUTHENTICATED` or `FORBIDDEN`

`UNAUTHENTICATED` means the bearer token is missing or invalid. `FORBIDDEN` means it is valid but its role is below the route requirement. Register/login from `/settings`, include the reviewer/admin invite code where required, and confirm the token with `/api/v1/auth/me`.

### Agent worker fails on Render

- Use the current Dockerfiles; stale versions referenced a removed `gridproof-contracts` path.
- Set `REDIS_URL`; without it the worker exits.
- Set the same `DATABASE_URL` and `REDIS_URL` used by the API.
- Use a public `LLM_BASE_URL`, not a laptop or container-local URL.
- Check `/health` for process liveness and `/readiness` for missing variable names.

### LLM calls return `404`

Remove `/v1` from `LLM_BASE_URL`. The client appends `/v1/chat/completions`.

```env
LLM_BASE_URL=https://your-router.example
```

### `EpochNotYetElapsed`

The contract accepts only fully completed, hour-aligned epochs. The chain sweep now ignores unfinished epochs. For demos, use the Judge Lab live replay or hardware simulator, both of which choose completed epochs.

### Notification opens an older/wrong proof

Current chain notifications include `epochStart`, and older records are resolved by joining their transaction hash to the commitment. Redeploy both the API and web so “Open proof” links to the exact epoch instead of `/latest`.

### Proof transaction uses the wrong contract

Compare the API environment with the mainnet manifest. The correct mainnet `UptimeAttestation` is:

```text
0xB3A976CC574fdBf1488a3912B244433244e3f189
```

Restart or redeploy the API after changing environment variables; already-mined historical transactions remain associated with the contract that received them.

## Further documentation

| Document | Subject |
| --- | --- |
| [`PRODUCT.md`](PRODUCT.md) | Users, purpose, product principles, and evidence boundaries. |
| [`DESIGN.md`](DESIGN.md) | GridProof interface system and visual rules. |
| [`gridproof.md`](gridproof.md) | Original comprehensive architecture and implementation specification. |
| [`docs/agent-orchestration.md`](docs/agent-orchestration.md) | Agent prompts, tools, outputs, thresholds, and known gaps. |
| [`docs/job-queues.md`](docs/job-queues.md) | BullMQ producer/worker behavior and health endpoints. |
| [`docs/auth-rbac.md`](docs/auth-rbac.md) | JWT claims, roles, invite codes, and protected routes. |
| [`docs/deployment.md`](docs/deployment.md) | Contracts, mainnet checks, Vercel, Render, and deployment verification. |
| [`docs/security-checklist.md`](docs/security-checklist.md) | Security status, data confidentiality, and role verification. |
| [`docs/blockchain-indexing.md`](docs/blockchain-indexing.md) | Relayer submission and confirmation indexing. |
| [`docs/realtime.md`](docs/realtime.md) | Socket.IO events and access boundaries. |
| [`docs/test-plan.md`](docs/test-plan.md) | Test coverage and acceptance behavior. |

---

GridProof is built around one rule: **never turn uncertainty into an immutable claim silently.** Deterministic detection, AI review, human judgment, audit records, and BOT Chain proofs are separate stages so every published reliability record can be understood and challenged.
