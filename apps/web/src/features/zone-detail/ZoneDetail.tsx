import { Activity, Clock, ExternalLink, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../lib/api-client.js";
import { formatGridProofDateTime } from "../../lib/date-time.js";
import { useRealtime } from "../../lib/realtime.js";
import { PageHeader, PanelHeader } from "../../components/PageHeader.js";

export function ZoneDetail() {
  const { zoneId } = useParams();
  useRealtime(zoneId);
  const historyQuery = useQuery({
    queryKey: ["zone-history", zoneId],
    queryFn: () => apiClient.zoneHistory(requireRouteParam(zoneId, "zoneId")),
    enabled: Boolean(zoneId),
    retry: 1
  });

  const history = historyQuery.data;
  const candidates = history?.candidates ?? [];
  const epochScores = history?.epochScores ?? [];

  return (
    <main className="shell">
      <PageHeader
        title={history?.zone.name ?? "Zone Detail"}
        description="Feeder evidence history, reliability epochs, and candidate event timeline."
        status={<div className="health-pill">
          <Activity size={18} aria-hidden="true" />
          <span>{history ? history.zone.discosFeederCode : "Loading zone"}</span>
        </div>}
      />

      {historyQuery.isLoading ? <p className="status-message">Loading zone history…</p> : null}
      {historyQuery.isError ? (
        <p className="status-message error">Could not load this zone history. Check the zone ID and API connection.</p>
      ) : null}

      {history ? (
        <>
          <section className="metrics-grid" aria-label="Zone history metrics">
            <Metric label="Candidate events" value={candidates.length.toString()} icon={<Zap size={18} />} />
            <Metric label="Epoch scores" value={epochScores.length.toString()} icon={<Clock size={18} />} />
            <Metric label="Health trend" value={formatTrend(history.trend)} icon={<Activity size={18} />} />
            <Metric
              label="Latest uptime"
              value={epochScores[0] ? `${(epochScores[0].uptimeBps / 100).toFixed(2)}%` : "Pending"}
              icon={<Activity size={18} />}
            />
          </section>

          <section className="dashboard-grid">
            <div className="zone-panel">
              <PanelHeader title="Feeder metadata" description={history.zone.name} />
              <dl>
                <div>
                  <dt>Zone ID</dt>
                  <dd className="mono">{history.zone.id}</dd>
                </div>
                <div>
                  <dt>Zone key</dt>
                  <dd className="mono">{history.zone.zoneKey}</dd>
                </div>
                <div>
                  <dt>Region</dt>
                  <dd>{history.zone.region}</dd>
                </div>
                <div>
                  <dt>Coordinates</dt>
                  <dd>
                    {history.zone.centroid.lat}, {history.zone.centroid.lng}
                  </dd>
                </div>
              </dl>
              <div className="action-row">
                <Link className="button-link" to={`/proof/${history.zone.id}/latest`}>
                  <ExternalLink size={18} aria-hidden="true" />
                  Latest proof
                </Link>
              </div>
            </div>

            <section className="zone-panel" aria-label="Epoch scores">
              <PanelHeader title="Epoch scores" description="Reliability windows prepared for on-chain proof." />
              {epochScores.length === 0 ? <p className="status-message">No epoch scores yet.</p> : null}
              <div className="notification-list">
                {epochScores.map((score) => (
                  <article className="provider-card" key={score.id}>
                    <div>
                      <strong>{(score.uptimeBps / 100).toFixed(2)}% uptime</strong>
                      <span className="status-badge active">epoch</span>
                    </div>
                    <dl>
                      <div>
                        <dt>Epoch</dt>
                        <dd><time dateTime={score.epochStart}>{formatGridProofDateTime(score.epochStart)}</time></dd>
                      </div>
                      <div>
                        <dt>Evidence hash</dt>
                        <dd className="mono">{score.evidenceHash}</dd>
                      </div>
                    </dl>
                    <Link className="primary-link" to={`/proof/${score.zoneId}/${encodeURIComponent(score.epochStart)}`}>
                      Open proof
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          </section>

          <section className="zone-panel timeline-panel" aria-label="Candidate timeline">
            <PanelHeader title="Candidate events" description="Chronological outage and restoration assessments." />
            {candidates.length === 0 ? <p className="status-message">No outage/restoration candidates yet.</p> : null}
            <div className="notification-list">
              {candidates.map((candidate) => (
                <article className="review-item notification-item" key={candidate.id}>
                  <div>
                    <div className="badge-row">
                      <span className={`status-badge ${candidate.status === "restored" ? "active" : ""}`}>{candidate.status}</span>
                      <span className="status-badge">{Math.round(candidate.confidence * 100)}% confidence</span>
                    </div>
                    <h3>{candidate.status === "outage" ? "Outage candidate" : "Restoration candidate"}</h3>
                    <dl>
                      <div>
                        <dt>Window</dt>
                        <dd>
                          <time dateTime={candidate.windowStart}>{formatGridProofDateTime(candidate.windowStart)}</time>
                          {" → "}
                          <time dateTime={candidate.windowEnd}>{formatGridProofDateTime(candidate.windowEnd)}</time>
                        </dd>
                      </div>
                      <div>
                        <dt>Evidence</dt>
                        <dd className="mono">{candidate.evidenceEventIds.join(", ")}</dd>
                      </div>
                      <div>
                        <dt>Created</dt>
                        <dd><time dateTime={candidate.createdAt}>{formatGridProofDateTime(candidate.createdAt)}</time></dd>
                      </div>
                    </dl>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="metric">
      <span className="metric-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function requireRouteParam(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing route parameter ${name}`);
  return value;
}

function formatTrend(trend: "improving" | "stable" | "declining"): string {
  if (trend === "improving") return "Improving";
  if (trend === "declining") return "Declining";
  return "Stable";
}
