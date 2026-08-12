# GridProof security checklist

This checklist tracks the Goal 21 hardening items from `gridproof.md`.

| Item | Current status | Evidence |
| --- | --- | --- |
| Route RBAC is enforced | Passing for implemented protected routes | `apps/api/test/app.test.ts` covers unauthenticated and wrong-role access for reporter ingestion, provider registration, reviewer queue, reviewer decisions, chain submission/indexing, and notification outbox. |
| Ingestion endpoints are rate-limited | Passing | `apps/api/test/app.test.ts` covers telemetry, web reporter, and WhatsApp webhook rate limits. |
| Browser CORS is locked to deployed frontend origins | Passing in code/config; deployment must set env | `apps/api/src/lib/cors.ts` requires `CORS_ORIGINS` in production, rejects wildcards, and shares the allowlist with HTTP/WebSocket setup. |
| Relayer private key is not returned by API responses | Passing by design for implemented routes | Blockchain routes return submission/indexing summaries and never serialize `RELAYER_PRIVATE_KEY`; relayer config is read only inside the blockchain client/service path. |
| Error monitoring avoids obvious secret leakage | Passing for implemented Sentry wrappers | API/web Sentry helpers set `sendDefaultPii: false` and redact authorization, token, secret, private-key, and signature context fields before capture. |
| High-severity dependency audit findings | Passing | `pnpm audit --audit-level high` exits successfully; current remaining advisories are low/moderate only. |
| Supabase direct-table access is denied by default | Passing after migration 005 | `005_enable_row_level_security.sql` enables RLS on every GridProof table without granting client policies; `pnpm deployment:data` verifies the setting. |
| Testnet contract roles match Part 3 | Requires deployed testnet contracts | `smart-contracts/test/Deploy.t.sol` asserts the role wiring in-process. Confirm it on-chain with the `cast` checks below after BOT Chain deployment, then record the manifest and explorer links. |

## Data confidentiality boundary

- BOT Chain is public and immutable. GridProof commits only `zoneId`, epoch time, uptime basis points, an evidence hash, and the relayer address. It does not put reporter phone numbers, message text, or raw sensor payloads on-chain.
- Postgres stores `users.phone_or_email` and `evidence_events.raw_payload` in plaintext at the application layer. Database-provider encryption at rest and TLS protect storage media and transport, but database administrators or a compromised server credential can still read these fields.
- Migration 005 blocks Supabase anon/authenticated table access unless an explicit RLS policy is added later. Browser clients must use the GridProof API rather than querying these tables directly.
- Application-layer encryption for reporter identity and message content remains required before collecting sensitive real-user data. It needs key rotation, encrypted backups, search-safe identity lookup, and a migration for existing rows; do not treat RLS alone as encryption.

## Post-deployment role verification

`Deploy.s.sol` grants `DEFAULT_ADMIN_ROLE` to `GRIDPROOF_ADMIN_ADDRESS` and
`RELAYER_ROLE` to `GRIDPROOF_RELAYER_ADDRESS` only. Confirm that against the
live contracts before the demo, using addresses from the deployment manifest:

```bash
ADMIN_ROLE=0x0000000000000000000000000000000000000000000000000000000000000000
RELAYER_ROLE=$(cast keccak "RELAYER_ROLE")

# Admin holds admin, relayer holds relayer: both must print true.
cast call <UptimeAttestation> "hasRole(bytes32,address)(bool)" $ADMIN_ROLE <ADMIN> --rpc-url "$BOTCHAIN_RPC_URL"
cast call <UptimeAttestation> "hasRole(bytes32,address)(bool)" $RELAYER_ROLE <RELAYER> --rpc-url "$BOTCHAIN_RPC_URL"

# The hot relayer must NOT hold admin on either contract: both must print false.
cast call <UptimeAttestation> "hasRole(bytes32,address)(bool)" $ADMIN_ROLE <RELAYER> --rpc-url "$BOTCHAIN_RPC_URL"
cast call <ReputationEscrow> "hasRole(bytes32,address)(bool)" $ADMIN_ROLE <RELAYER> --rpc-url "$BOTCHAIN_RPC_URL"

# The escrow must point at the NodeRegistry from the same deployment.
cast call <ReputationEscrow> "nodeRegistry()(address)" --rpc-url "$BOTCHAIN_RPC_URL"
```

Deployment reminder: production API instances must set `CORS_ORIGINS` to the deployed frontend URL(s). Do not use wildcard CORS.
