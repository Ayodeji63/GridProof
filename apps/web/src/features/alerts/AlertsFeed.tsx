import { AlertTriangle, ExternalLink } from "lucide-react";
import type { AlertItem } from "@gridproof/shared-types";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../lib/api-client.js";
import { formatGridProofDateTime } from "../../lib/date-time.js";

const ALERTS_PER_PAGE = 8;

type StatusFilter = "all" | "outage" | "restored";
type OutcomeFilter = "all" | "auto-approved" | "reviewer-approved" | "needs-review" | "rejected";
type ConfidenceFilter = "all" | "low" | "review" | "high";

export function AlertsFeed() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [page, setPage] = useState(1);
  const alertsQuery = useQuery({
    queryKey: ["alerts"],
    queryFn: apiClient.alerts,
    retry: 1,
    refetchInterval: 10_000
  });

  const alerts = alertsQuery.data?.alerts ?? [];
  const filteredAlerts = useMemo(
    () => alerts.filter((alert) => matchesFilters(alert, search, statusFilter, outcomeFilter, confidenceFilter)),
    [alerts, confidenceFilter, outcomeFilter, search, statusFilter]
  );
  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / ALERTS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * ALERTS_PER_PAGE;
  const visibleAlerts = filteredAlerts.slice(pageStart, pageStart + ALERTS_PER_PAGE);
  const hasActiveFilters = Boolean(search.trim()) || statusFilter !== "all" || outcomeFilter !== "all" || confidenceFilter !== "all";

  const resetPage = () => setPage(1);
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setOutcomeFilter("all");
    setConfidenceFilter("all");
    setPage(1);
  };

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

      {alerts.length > 0 ? (
        <section className="proof-panel alert-filter-panel" aria-label="Alert filters">
          <div className="alert-filter-grid">
            <label className="field alert-filter-search">
              Search alerts
              <input
                aria-label="Search alerts"
                onChange={(event) => {
                  setSearch(event.target.value);
                  resetPage();
                }}
                placeholder="Zone, candidate, evidence, or note"
                type="search"
                value={search}
              />
            </label>
            <label className="field">
              Grid status
              <select
                aria-label="Filter by grid status"
                onChange={(event) => {
                  setStatusFilter(event.target.value as StatusFilter);
                  resetPage();
                }}
                value={statusFilter}
              >
                <option value="all">All statuses</option>
                <option value="outage">Outage</option>
                <option value="restored">Restoration</option>
              </select>
            </label>
            <label className="field">
              Decision
              <select
                aria-label="Filter by decision"
                onChange={(event) => {
                  setOutcomeFilter(event.target.value as OutcomeFilter);
                  resetPage();
                }}
                value={outcomeFilter}
              >
                <option value="all">All decisions</option>
                <option value="auto-approved">Auto-approved</option>
                <option value="reviewer-approved">Reviewer approved</option>
                <option value="needs-review">Needs review</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
            <label className="field">
              Automated confidence
              <select
                aria-label="Filter by confidence"
                onChange={(event) => {
                  setConfidenceFilter(event.target.value as ConfidenceFilter);
                  resetPage();
                }}
                value={confidenceFilter}
              >
                <option value="all">All confidence bands</option>
                <option value="high">85–100% · auto band</option>
                <option value="review">50–84% · review band</option>
                <option value="low">Below 50%</option>
              </select>
            </label>
          </div>
          <div className="alert-filter-footer">
            <p aria-live="polite">
              {filteredAlerts.length === 0
                ? "No matching alerts"
                : `Showing ${pageStart + 1}–${Math.min(pageStart + ALERTS_PER_PAGE, filteredAlerts.length)} of ${filteredAlerts.length} matching alerts`}
            </p>
            {hasActiveFilters ? <button onClick={clearFilters} type="button">Clear filters</button> : null}
          </div>
        </section>
      ) : null}

      {!alertsQuery.isLoading && !alertsQuery.isError && alerts.length > 0 && filteredAlerts.length === 0 ? (
        <section className="review-item alert-empty-state">
          <div>
            <h2>No alerts match these filters</h2>
            <p>Adjust the filters or clear them to see all recent alerts.</p>
          </div>
        </section>
      ) : null}

      <div className="notification-list">
        {visibleAlerts.map((alert) => {
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
                    <dd><time dateTime={alert.createdAt} title={alert.createdAt}>{formatGridProofDateTime(alert.createdAt)}</time></dd>
                  </div>
                  {alert.review?.reviewedAt ? (
                    <div>
                      <dt>Reviewed</dt>
                      <dd>
                        <time dateTime={alert.review.reviewedAt} title={alert.review.reviewedAt}>
                          {formatGridProofDateTime(alert.review.reviewedAt)}
                        </time>
                      </dd>
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

      {filteredAlerts.length > ALERTS_PER_PAGE ? (
        <nav className="action-row alert-pagination" aria-label="Alert pages">
          <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} type="button">Previous</button>
          <span>Page {currentPage} of {totalPages}</span>
          <button disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} type="button">Next</button>
        </nav>
      ) : null}
    </main>
  );
}

function matchesFilters(
  alert: AlertItem,
  search: string,
  statusFilter: StatusFilter,
  outcomeFilter: OutcomeFilter,
  confidenceFilter: ConfidenceFilter
): boolean {
  if (statusFilter !== "all" && alert.status !== statusFilter) return false;
  if (!matchesOutcome(alert, outcomeFilter)) return false;
  if (!matchesConfidence(alert.confidence, confidenceFilter)) return false;

  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    alert.zoneId,
    alert.candidateEventId,
    alert.hypothesis,
    alert.review?.note ?? "",
    ...alert.supportingEvidenceIds
  ].some((value) => value.toLowerCase().includes(query));
}

function matchesOutcome(alert: AlertItem, filter: OutcomeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "auto-approved") return alert.decision === "approve" && alert.review === null;
  if (filter === "reviewer-approved") return alert.review?.decision === "approve";
  if (filter === "needs-review") return alert.decision === "escalate";
  return alert.decision === "reject";
}

function matchesConfidence(confidence: number, filter: ConfidenceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "high") return confidence >= 0.85;
  if (filter === "review") return confidence >= 0.5 && confidence < 0.85;
  return confidence < 0.5;
}

function pastTenseDecision(decision: "approve" | "escalate" | "reject"): string {
  if (decision === "approve") return "approved";
  if (decision === "escalate") return "escalated";
  return "rejected";
}
