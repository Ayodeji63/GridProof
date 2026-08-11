import { AlertTriangle, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "../../lib/api-client.js";

export function AlertsFeed() {
  const alertsQuery = useQuery({
    queryKey: ["alerts"],
    queryFn: apiClient.alerts,
    retry: 1,
    refetchInterval: 10_000
  });

  const alerts = alertsQuery.data?.alerts ?? [];

  return (
    <main className="shell narrow">
      <section className="topbar" aria-label="Public alerts heading">
        <div>
          <p className="eyebrow">Public grid insights</p>
          <h1>Alerts Feed</h1>
        </div>
        <div className="health-pill">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{alerts.length} recent</span>
        </div>
      </section>

      {alertsQuery.isLoading ? <p className="status-message">Loading public alerts…</p> : null}
      {alertsQuery.isError ? <p className="status-message error">Could not load public alerts.</p> : null}
      {!alertsQuery.isLoading && !alertsQuery.isError && alerts.length === 0 ? (
        <section className="review-item">
          <div>
            <h2>No public alerts yet</h2>
            <p>New outage/restoration candidates and agent hypotheses will appear here as evidence arrives.</p>
          </div>
        </section>
      ) : null}

      <div className="notification-list">
        {alerts.map((alert) => {
          const decisionLabel = alert.review
            ? `reviewer ${pastTenseDecision(alert.review.decision)}`
            : alert.decision === "approve"
              ? "auto-approved"
              : alert.decision;

          return (
            <article className="review-item notification-item" key={alert.id}>
            <div>
              <div className="badge-row">
                <span className={`status-badge ${alert.status === "restored" ? "active" : ""}`}>{alert.status}</span>
                <span className="status-badge">{decisionLabel}</span>
                <span className="status-badge">{Math.round(alert.confidence * 100)}% automated confidence</span>
              </div>
              <p className="eyebrow">{alert.zoneId}</p>
              <h2>{alert.status === "outage" ? "Outage" : "Restoration"}</h2>
              {alert.review ? (
                <p><strong>Initial policy decision:</strong> {pastTenseDecision(alert.review.initialDecision)}</p>
              ) : null}
              <p><strong>Initial assessment:</strong> {alert.hypothesis}</p>
              {alert.review ? <p><strong>Reviewer confirmation:</strong> {alert.review.note}</p> : null}
              <dl>
                <div>
                  <dt>Candidate</dt>
                  <dd className="mono">{alert.candidateEventId}</dd>
                </div>
                <div>
                  <dt>Evidence</dt>
                  <dd className="mono">{alert.supportingEvidenceIds.join(", ")}</dd>
                </div>
                <div>
                  <dt>Automated assessment</dt>
                  <dd>{alert.createdAt}</dd>
                </div>
                {alert.review?.reviewedAt ? (
                  <div>
                    <dt>Reviewed</dt>
                    <dd>{alert.review.reviewedAt}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
            <div className="action-row">
              <Link className="button-link" to={`/proof/${alert.zoneId}/latest`}>
                <ExternalLink size={18} aria-hidden="true" />
                Open proof
              </Link>
            </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}

function pastTenseDecision(decision: "approve" | "escalate" | "reject"): string {
  if (decision === "approve") return "approved";
  if (decision === "escalate") return "escalated";
  return "rejected";
}
