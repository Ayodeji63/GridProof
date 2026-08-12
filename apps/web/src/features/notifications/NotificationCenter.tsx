import { BellRing, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "../../lib/api-client.js";
import { isAuthenticationError } from "../../lib/api-error.js";
import { formatGridProofDateTime } from "../../lib/date-time.js";
import { ReviewerSignInPrompt } from "../settings/ReviewerSignInPrompt.js";

export function NotificationCenter() {
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: apiClient.notifications,
    retry: (failureCount, error) => !isAuthenticationError(error) && failureCount < 1,
    refetchInterval: 15_000
  });

  const notifications = notificationsQuery.data?.notifications ?? [];
  const authRequired = notificationsQuery.isError && isAuthenticationError(notificationsQuery.error);

  return (
    <main className="shell narrow">
      <section className="topbar" aria-label="Notification center heading">
        <div>
          <p className="eyebrow">Operator alerts</p>
          <h1>Notifications</h1>
        </div>
        <div className="health-pill">
          <BellRing size={18} aria-hidden="true" />
          <span>{notifications.length} visible</span>
        </div>
      </section>

      {notificationsQuery.isLoading ? <p className="status-message">Loading notifications…</p> : null}
      {authRequired ? <ReviewerSignInPrompt /> : null}
      {notificationsQuery.isError && !authRequired ? (
        <p className="status-message error">Could not load notifications. Check the API connection and retry.</p>
      ) : null}
      {!notificationsQuery.isLoading && !notificationsQuery.isError && notifications.length === 0 ? (
        <section className="review-item">
          <div>
            <h2>No notifications yet</h2>
            <p>Review alerts and BOT Chain confirmation updates will appear here as the system processes evidence.</p>
          </div>
        </section>
      ) : null}

      <div className="notification-list">
        {notifications.map((notification) => {
          const zoneId = typeof notification.payload.zoneId === "string" ? notification.payload.zoneId : null;
          const txHash = typeof notification.payload.txHash === "string" ? notification.payload.txHash : null;
          return (
            <article className="review-item notification-item" key={notification.id}>
              <div>
                <div className="badge-row">
                  <span className={`status-badge ${notification.status === "sent" ? "active" : ""}`}>
                    {notification.status}
                  </span>
                  <span className="status-badge">{notification.audience}</span>
                  <span className="status-badge">{notification.channel}</span>
                </div>
                <p className="eyebrow">{notification.kind.replace("_", " ")}</p>
                <h2>{notification.title}</h2>
                <p>{notification.message}</p>
                <dl>
                  <div>
                    <dt>Created</dt>
                    <dd><time dateTime={notification.createdAt}>{formatGridProofDateTime(notification.createdAt)}</time></dd>
                  </div>
                  <div>
                    <dt>Attempts</dt>
                    <dd>{notification.attempts}</dd>
                  </div>
                  {zoneId ? (
                    <div>
                      <dt>Zone</dt>
                      <dd className="mono">{zoneId}</dd>
                    </div>
                  ) : null}
                  {txHash ? (
                    <div>
                      <dt>Tx</dt>
                      <dd className="mono">{txHash}</dd>
                    </div>
                  ) : null}
                  {notification.lastError ? (
                    <div>
                      <dt>Error</dt>
                      <dd>{notification.lastError}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
              <div className="action-row">
                {zoneId ? (
                  <Link className="button-link" to={`/proof/${zoneId}/latest`}>
                    <ExternalLink size={18} aria-hidden="true" />
                    Open proof
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
