# GridProof Architecture

The authoritative architecture and build plan is maintained in
[`../gridproof.md`](../gridproof.md). This file exists so the monorepo has the
`docs/architecture.md` path expected by the implementation roadmap.

## Current Implementation Tracks

- `smart-contracts`: Foundry implementation and tests for `NodeRegistry`,
  `UptimeAttestation`, and `ReputationEscrow`.
- `packages/shared-types`: Zod schemas and inferred TypeScript types shared by
  API, worker, and web.
- `apps/api`: Express modular-monolith foundation. Beyond request handling it runs
  a background scheduler (`src/modules/pipeline/scheduler.ts`) that closes the core
  loop: a heartbeat sweep turns sensor silence into outage candidates that no
  inbound request would reveal, and chain sweeps move approved epochs through the
  Blockchain Service relayer. The chain sweeps start only when `DATABASE_URL` and
  the relayer env are both present; the admin endpoints remain available either way.
- `apps/agent-worker`: BullMQ worker shell for AI review and blockchain jobs.
- `apps/web`: Vite React dashboard shell.
- `infrastructure/migrations`: Postgres schema matching Part 5.
