import { Copy, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { apiClient } from "../../lib/api-client.js";

export function ProofExplorer() {
  const { zoneId, epoch } = useParams();
  const proofQuery = useQuery({
    queryKey: ["proof", zoneId, epoch],
    queryFn: () => apiClient.proof(requireRouteParam(zoneId, "zoneId"), requireRouteParam(epoch, "epoch")),
    enabled: Boolean(zoneId && epoch),
    retry: 1
  });

  const epochScore = proofQuery.data?.epochScore ?? null;
  const commitment = proofQuery.data?.commitment ?? null;
  const txHash = commitment?.txHash ?? null;
  const explorerUrl = commitment?.explorerUrl ?? null;

  return (
    <main className="shell narrow">
      <p className="eyebrow">On-chain evidence</p>
      <h1>Proof Explorer</h1>
      <section className="proof-panel">
        {proofQuery.isLoading ? <p>Loading proof from GridProof API…</p> : null}
        {proofQuery.isError ? <p className="status-message error">Could not load this proof. Check the zone and epoch, then retry.</p> : null}
        {!proofQuery.isLoading && !proofQuery.isError && !epochScore ? (
          <p className="status-message">No epoch score has been committed off-chain for this proof yet.</p>
        ) : null}
        {epochScore ? (
          <>
            <dl>
              <div>
                <dt>Zone</dt>
                <dd>{epochScore.zoneId}</dd>
              </div>
              <div>
                <dt>Epoch</dt>
                <dd>{epochScore.epochStart}</dd>
              </div>
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
                disabled={!epochScore.evidenceHash}
                onClick={() => navigator.clipboard.writeText(epochScore.evidenceHash)}
                type="button"
                title="Copy proof hash"
              >
                <Copy size={18} aria-hidden="true" />
                Copy hash
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

function requireRouteParam(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing route parameter ${name}`);
  return value;
}
