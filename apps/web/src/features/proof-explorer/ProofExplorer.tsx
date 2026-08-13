import { CheckCircle2, Clock3, Copy, ExternalLink, RefreshCw, Send, XCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../../lib/api-client.js";
import { formatGridProofDateTime } from "../../lib/date-time.js";
import { PageHeader } from "../../components/PageHeader.js";

export function ProofExplorer() {
  const { zoneId, epoch } = useParams();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetTimer = useRef<number | null>(null);
  const proofQuery = useQuery({
    queryKey: ["proof", zoneId, epoch],
    queryFn: () => apiClient.proof(requireRouteParam(zoneId, "zoneId"), requireRouteParam(epoch, "epoch")),
    enabled: Boolean(zoneId && epoch),
    retry: 1,
    refetchInterval: (query) => query.state.data?.commitment?.status === "confirmed" ? false : 10_000
  });

  const epochScore = proofQuery.data?.epochScore ?? null;
  const commitment = proofQuery.data?.commitment ?? null;
  const txHash = commitment?.txHash ?? null;
  const explorerUrl = commitment?.explorerUrl ?? null;

  useEffect(() => () => {
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
  }, []);

  async function copyEvidenceHash() {
    if (!epochScore?.evidenceHash) return;
    try {
      await navigator.clipboard.writeText(epochScore.evidenceHash);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    copyResetTimer.current = window.setTimeout(() => setCopyState("idle"), 2_000);
  }

  return (
    <main className="shell narrow">
      <PageHeader
        title="Proof Explorer"
        description="Verify a feeder reliability epoch and follow its settlement status on BOT Chain."
      />
      <section className="proof-panel">
        {proofQuery.isLoading ? <p>Loading proof from GridProof API…</p> : null}
        {proofQuery.isError ? <p className="status-message error">Could not load this proof. Check the zone and epoch, then retry.</p> : null}
        {!proofQuery.isLoading && !proofQuery.isError && !epochScore ? (
          <p className="status-message">No epoch score has been committed off-chain for this proof yet.</p>
        ) : null}
        {epochScore ? (
          <>
            <section className={`proof-state ${commitment?.status ?? "pending"}`} aria-live="polite">
              {commitment?.status === "confirmed" ? <CheckCircle2 size={22} aria-hidden="true" /> : null}
              {commitment?.status === "failed" ? <XCircle size={22} aria-hidden="true" /> : null}
              {!commitment || commitment.status === "pending" ? <Clock3 size={22} aria-hidden="true" /> : null}
              <div>
                <strong>{proofStateTitle(commitment?.status)}</strong>
                <p>{proofStateMessage(commitment?.status, Boolean(txHash))}</p>
              </div>
            </section>
            <ol className="proof-steps" aria-label="Proof lifecycle">
              <ProofStep complete label="Evidence assessed" />
              <ProofStep complete label="Proof queued" />
              <ProofStep complete={Boolean(txHash)} label="Transaction submitted" />
              <ProofStep complete={commitment?.status === "confirmed"} label="Block confirmed" />
            </ol>
            <dl>
              <div>
                <dt>Zone</dt>
                <dd>{epochScore.zoneId}</dd>
              </div>
              <div>
                <dt>Measurement epoch</dt>
                <dd><time dateTime={epochScore.epochStart}>{formatGridProofDateTime(epochScore.epochStart)}</time></dd>
              </div>
              <div>
                <dt>Proof queued</dt>
                <dd><time dateTime={commitment?.createdAt ?? epochScore.createdAt}>{formatGridProofDateTime(commitment?.createdAt ?? epochScore.createdAt)}</time></dd>
              </div>
              {commitment?.confirmedAt ? (
                <div>
                  <dt>Transaction confirmed</dt>
                  <dd><time dateTime={commitment.confirmedAt}>{formatGridProofDateTime(commitment.confirmedAt)}</time></dd>
                </div>
              ) : null}
              <div>
                <dt>Uptime</dt>
                <dd>{(epochScore.uptimeBps / 100).toFixed(2)}%</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{commitment?.status ?? "pending submission"}</dd>
              </div>
              <div>
                <dt>Evidence hash</dt>
                <dd className="mono">{epochScore.evidenceHash}</dd>
              </div>
              <div>
                <dt>Transaction</dt>
                <dd className="mono">{txHash ?? "Waiting for BOT Chain transaction"}</dd>
              </div>
              <div>
                <dt>Block</dt>
                <dd>{commitment?.blockNumber ?? "Pending confirmation"}</dd>
              </div>
            </dl>
            <div className="action-row">
              <button
                aria-live="polite"
                className={copyState === "copied" ? "is-success" : copyState === "failed" ? "is-error" : undefined}
                disabled={!epochScore.evidenceHash}
                onClick={() => void copyEvidenceHash()}
                type="button"
                title="Copy proof hash"
              >
                {copyState === "copied" ? <CheckCircle2 size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
                {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy hash"}
              </button>
              <button disabled={proofQuery.isFetching} onClick={() => void proofQuery.refetch()} type="button">
                <RefreshCw size={18} aria-hidden="true" />
                {proofQuery.isFetching ? "Refreshing…" : "Refresh status"}
              </button>
              <a
                aria-disabled={!explorerUrl}
                className={`button-link${explorerUrl ? "" : " disabled"}`}
                href={explorerUrl ?? undefined}
                rel="noreferrer"
                target="_blank"
                title={explorerUrl ? "Open BOT Chain explorer" : "Explorer link appears after confirmation"}
              >
                <ExternalLink size={18} aria-hidden="true" />
                Explorer
              </a>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}

function ProofStep({ complete, label }: { complete: boolean; label: string }) {
  return (
    <li className={complete ? "complete" : ""}>
      {complete ? <CheckCircle2 size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
      <span>{label}</span>
    </li>
  );
}

function proofStateTitle(status: "pending" | "confirmed" | "failed" | undefined): string {
  if (status === "confirmed") return "Confirmed on BOT Chain";
  if (status === "failed") return "Submission failed";
  return "Queued for BOT Chain submission";
}

function proofStateMessage(status: "pending" | "confirmed" | "failed" | undefined, hasTransaction: boolean): string {
  if (status === "confirmed") return "The transaction is confirmed and the explorer record is available below.";
  if (status === "failed") return "The latest chain attempt failed. An operator should inspect API logs and retry the submission.";
  if (hasTransaction) return "The transaction was submitted and is waiting for block confirmation.";
  return "The proof exists off-chain and is waiting for the relayer to submit its transaction.";
}

function requireRouteParam(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing route parameter ${name}`);
  return value;
}
