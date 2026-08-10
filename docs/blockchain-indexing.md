# GridProof Blockchain Confirmation Indexing

GridProof separates submission from confirmation:

1. `POST /api/v1/chain/submit-pending` signs/submits pending epoch commitments and stores the transaction hash while keeping status `pending`.
2. `POST /api/v1/chain/index-confirmations` asks BOT Chain RPC for receipts for pending tx hashes.
3. A successful receipt updates `chain_commitments.status = confirmed`, stores `block_number`, `explorer_url`, and `confirmed_at`.
4. A reverted receipt updates `chain_commitments.status = failed`.
5. Missing receipts stay pending and are retried on the next indexing run.

The indexer uses the same blockchain env as submission:

- `BOTCHAIN_RPC_URL`
- `RELAYER_PRIVATE_KEY`
- `BOTCHAIN_NODE_REGISTRY_ADDRESS`
- `BOTCHAIN_UPTIME_ATTESTATION_ADDRESS`
- `BOTCHAIN_REPUTATION_ESCROW_ADDRESS`
- `BOTCHAIN_EXPLORER_BASE_URL`

`BOTCHAIN_EXPLORER_BASE_URL` is optional, but when set the proof API can return a judge-clickable explorer link in the form `<base>/tx/<txHash>`.
