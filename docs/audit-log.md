# GridProof Audit Log

GridProof writes append-only audit records beside key state transitions. In production these go to Postgres `audit_logs`; in local/test mode without `DATABASE_URL`, the API uses an in-memory audit store so the pipeline remains runnable.

Current audited actions:

| Action | Written when | Payload highlights |
| --- | --- | --- |
| `agent_decision.created` | Deterministic policy gate creates an `AgentDecision` for a candidate. | decision, candidate summary, source evidence event ID |
| `review.decision_resolved` | Reviewer approves or rejects an escalated decision. | before/after decision when available, reviewer note |
| `chain_commitment.queued` | Approved evidence creates or updates a pending chain commitment. | source (`agent_auto_approval` or `review_approval`), epoch score, commitment |
| `chain_submission.skipped` | Admin/manual submit is skipped because DB or chain env is missing. | scanned/submitted/skipped counts and reason |
| `chain_submission.submitted` | Relayer submits a pending commitment transaction. | commitment ID, tx hash, serialized commit input |
| `chain_submission.failed` | Relayer submission fails and the commitment is marked failed. | commitment ID, error, serialized commit input |
| `chain_index.skipped` | Confirmation indexing is skipped because DB or chain env is missing. | scanned/confirmed/failed/still-pending counts and reason |
| `chain_index.confirmed` | A pending tx receipt is found successful and indexed as confirmed. | commitment ID, tx hash, block number, explorer URL, serialized commit input |
| `chain_index.failed` | A pending tx receipt is found reverted and indexed as failed. | commitment ID, tx hash, block number, explorer URL, serialized commit input |

Audit append failures are logged as warnings and do not throw back into the primary request path. This preserves the core demo flow while surfacing reconciliation problems.
