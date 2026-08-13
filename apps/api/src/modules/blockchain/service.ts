import {
  GridProofBlockchainClient,
  type BlockchainClientConfig,
  type ChainTransactionReceipt,
  type CommitEpochInput
} from "@gridproof/blockchain-client";
import { domainEvents } from "../../lib/events.js";
import { isDatabaseConfigured, query } from "../../lib/db.js";
import { counters } from "../../lib/metrics.js";
import { appendAuditLog } from "../audit/service.js";

export type SubmitPendingResult = {
  scanned: number;
  submitted: number;
  skipped: number;
  reason?: string;
  txHashes: string[];
};

export type IndexConfirmationsResult = {
  scanned: number;
  confirmed: number;
  failed: number;
  stillPending: number;
  reason?: string;
  txHashes: string[];
};

type PendingCommitmentRow = {
  commitment_id: string;
  zone_key: string;
  epoch_start: Date;
  uptime_bps: number;
  evidence_hash: string;
};

type SubmittedCommitmentRow = PendingCommitmentRow & {
  zone_id: string;
  tx_hash: string;
};

export async function submitPendingCommitments(limit = 5): Promise<SubmitPendingResult> {
  if (!isDatabaseConfigured()) {
    const result = { scanned: 0, submitted: 0, skipped: 0, reason: "DATABASE_URL is not configured", txHashes: [] };
    await appendAuditLog({
      action: "chain_submission.skipped",
      after: result
    });
    return result;
  }

  const client = createClientFromEnv();
  if (!client) {
    const pendingCount = await query<{ count: string }>("select count(*)::text as count from chain_commitments where status = 'pending'");
    const result = {
      scanned: Number(pendingCount.rows[0]?.count ?? 0),
      submitted: 0,
      skipped: Number(pendingCount.rows[0]?.count ?? 0),
      reason: "BOT Chain relayer env vars are not fully configured",
      txHashes: []
    };
    await appendAuditLog({
      action: "chain_submission.skipped",
      after: result
    });
    return result;
  }

  return submitPendingCommitmentsWithClient(client, limit);
}

export async function indexPendingConfirmations(limit = 10): Promise<IndexConfirmationsResult> {
  if (!isDatabaseConfigured()) {
    const result = {
      scanned: 0,
      confirmed: 0,
      failed: 0,
      stillPending: 0,
      reason: "DATABASE_URL is not configured",
      txHashes: []
    };
    await appendAuditLog({
      action: "chain_index.skipped",
      after: result
    });
    return result;
  }

  const client = createClientFromEnv();
  if (!client) {
    const pendingCount = await query<{ count: string }>(
      "select count(*)::text as count from chain_commitments where status = 'pending' and tx_hash is not null"
    );
    const result = {
      scanned: Number(pendingCount.rows[0]?.count ?? 0),
      confirmed: 0,
      failed: 0,
      stillPending: Number(pendingCount.rows[0]?.count ?? 0),
      reason: "BOT Chain relayer env vars are not fully configured",
      txHashes: []
    };
    await appendAuditLog({
      action: "chain_index.skipped",
      after: result
    });
    return result;
  }

  return indexPendingConfirmationsWithClient(client, limit);
}

export async function indexPendingConfirmationsWithClient(
  client: Pick<GridProofBlockchainClient, "getTransactionReceipt">,
  limit = 10
): Promise<IndexConfirmationsResult> {
  const pending = await query<SubmittedCommitmentRow>(
    `
      select cc.id as commitment_id, cc.tx_hash, z.id::text as zone_id, z.zone_key,
             es.epoch_start, es.uptime_bps, es.evidence_hash
      from chain_commitments cc
      join epoch_scores es on es.id = cc.epoch_score_id
      join zones z on z.id = es.zone_id
      where cc.status = 'pending'
        and cc.tx_hash is not null
      order by cc.created_at asc
      limit $1
    `,
    [limit]
  );

  const result: IndexConfirmationsResult = {
    scanned: pending.rowCount ?? pending.rows.length,
    confirmed: 0,
    failed: 0,
    stillPending: 0,
    txHashes: []
  };

  for (const row of pending.rows) {
    const receipt = await client.getTransactionReceipt(row.tx_hash);
    const update = confirmationUpdateFromReceipt(receipt, process.env.BOTCHAIN_EXPLORER_BASE_URL);
    if (!update) {
      result.stillPending += 1;
      continue;
    }

    await query(
      `
        update chain_commitments
        set status = $2,
            block_number = $3,
            explorer_url = $4,
            confirmed_at = $5
        where id = $1
      `,
      [row.commitment_id, update.status, update.blockNumber, update.explorerUrl, update.confirmedAt]
    );

    if (update.status === "confirmed") {
      result.confirmed += 1;
    } else {
      result.failed += 1;
    }

    result.txHashes.push(row.tx_hash);
    domainEvents.emit("chain.committed", {
      zoneId: row.zone_id,
      txHash: row.tx_hash,
      status: update.status
    });
    await appendAuditLog({
      action: update.status === "confirmed" ? "chain_index.confirmed" : "chain_index.failed",
      after: {
        commitmentId: row.commitment_id,
        txHash: row.tx_hash,
        blockNumber: update.blockNumber,
        explorerUrl: update.explorerUrl,
        input: serializeCommitInput(commitInputFromPending(row))
      }
    });
  }

  return result;
}

export async function submitPendingCommitmentsWithClient(
  client: Pick<GridProofBlockchainClient, "commitEpoch">,
  limit = 5
): Promise<SubmitPendingResult> {
  const pending = await query<PendingCommitmentRow>(
    `
      select cc.id as commitment_id, z.zone_key, es.epoch_start, es.uptime_bps, es.evidence_hash
      from chain_commitments cc
      join epoch_scores es on es.id = cc.epoch_score_id
      join zones z on z.id = es.zone_id
      where cc.status = 'pending'
        and cc.tx_hash is null
      order by cc.created_at asc
      limit $1
    `,
    [limit]
  );

  const txHashes: string[] = [];
  const scanned = pending.rowCount ?? pending.rows.length;

  for (const row of pending.rows) {
    try {
      const tx = await client.commitEpoch(commitInputFromPending(row));
      await query(
        `
          update chain_commitments
          set tx_hash = $2,
              status = 'pending'
          where id = $1
        `,
        [row.commitment_id, tx.hash]
      );
      counters.chainSubmissions += 1;
      txHashes.push(tx.hash);
      await appendAuditLog({
        action: "chain_submission.submitted",
        after: {
          commitmentId: row.commitment_id,
          txHash: tx.hash,
          input: serializeCommitInput(commitInputFromPending(row))
        }
      });
    } catch (error) {
      await query(
        `
          update chain_commitments
          set status = 'failed'
          where id = $1
        `,
        [row.commitment_id]
      );
      await appendAuditLog({
        action: "chain_submission.failed",
        after: {
          commitmentId: row.commitment_id,
          error: error instanceof Error ? error.message : "Unknown chain submission failure",
          input: serializeCommitInput(commitInputFromPending(row))
        }
      });
      throw error;
    }
  }

  return {
    scanned,
    submitted: txHashes.length,
    skipped: scanned - txHashes.length,
    txHashes
  };
}

export function commitInputFromPending(row: PendingCommitmentRow): CommitEpochInput {
  return {
    zoneId: row.zone_key,
    epochStart: BigInt(Math.floor(row.epoch_start.getTime() / 1000)),
    uptimeBps: row.uptime_bps,
    evidenceHash: row.evidence_hash
  };
}

export function confirmationUpdateFromReceipt(
  receipt: ChainTransactionReceipt | null,
  explorerBaseUrl?: string
): null | {
  status: "confirmed" | "failed";
  blockNumber: number;
  explorerUrl: string | null;
  confirmedAt: string | null;
} {
  if (!receipt || receipt.status === null) return null;

  const status = receipt.status === 1 ? "confirmed" : "failed";
  return {
    status,
    blockNumber: receipt.blockNumber,
    explorerUrl: explorerUrlForTx(receipt.hash, explorerBaseUrl),
    confirmedAt: status === "confirmed" ? new Date().toISOString() : null
  };
}

export function explorerUrlForTx(txHash: string, explorerBaseUrl?: string): string | null {
  if (!explorerBaseUrl) return null;
  return `${explorerBaseUrl.replace(/\/$/, "")}/tx/${txHash}`;
}

function serializeCommitInput(input: CommitEpochInput): Record<string, unknown> {
  return {
    ...input,
    epochStart: input.epochStart.toString()
  };
}

/**
 * Whether the relayer is fully configured, without constructing a client.
 *
 * Lets callers such as the background scheduler decide whether a chain sweep can
 * do anything at all, while the private key stays inside this module.
 */
export function isChainRelayerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readRelayerConfig(env) !== null;
}

function readRelayerConfig(env: NodeJS.ProcessEnv): BlockchainClientConfig | null {
  const rpcUrl = env.BOTCHAIN_RPC_URL;
  const relayerPrivateKey = env.RELAYER_PRIVATE_KEY;
  const nodeRegistry = env.BOTCHAIN_NODE_REGISTRY_ADDRESS;
  const uptimeAttestation = env.BOTCHAIN_UPTIME_ATTESTATION_ADDRESS;
  const reputationEscrow = env.BOTCHAIN_REPUTATION_ESCROW_ADDRESS;

  if (!rpcUrl || !relayerPrivateKey || !nodeRegistry || !uptimeAttestation || !reputationEscrow) {
    return null;
  }

  return {
    rpcUrl,
    relayerPrivateKey,
    contracts: {
      NodeRegistry: nodeRegistry,
      UptimeAttestation: uptimeAttestation,
      ReputationEscrow: reputationEscrow
    }
  };
}

function createClientFromEnv(): GridProofBlockchainClient | null {
  const config = readRelayerConfig(process.env);
  return config ? new GridProofBlockchainClient(config) : null;
}
