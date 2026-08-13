import { BellRing, CheckCircle2, Clock3, ExternalLink, Inbox, TriangleAlert } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { NotificationRecord } from "@gridproof/shared-types";
import { apiClient } from "../../lib/api-client.js";
import { isAuthenticationError, isAuthorizationError } from "../../lib/api-error.js";
import { formatGridProofDateTime } from "../../lib/date-time.js";
import { ReviewerSignInPrompt } from "../settings/ReviewerSignInPrompt.js";
import { PageHeader, PanelHeader } from "../../components/PageHeader.js";

const NOTIFICATIONS_PER_PAGE = 8;

type KindFilter = "all" | NotificationRecord["kind"];
type AudienceFilter = "all" | NotificationRecord["audience"];
type DeliveryFilter = "all" | "in-app" | NotificationRecord["status"];

export function NotificationCenter() {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("all");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("all");
  const [page, setPage] = useState(1);
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: apiClient.notifications,
    retry: (failureCount, error) => !isAuthenticationError(error) && failureCount < 1,
    refetchInterval: 15_000
  });
  const zonesQuery = useQuery({ queryKey: ["zones"], queryFn: apiClient.zones, retry: 1 });

  const notifications = notificationsQuery.data?.notifications ?? [];
  const zones = zonesQuery.data?.zones ?? [];
  const zoneByReference = useMemo(
    () => new Map(zones.flatMap((zone) => [[zone.id, zone], [zone.zoneKey, zone]] as const)),
    [zones]
  );
  const filteredNotifications = useMemo(
    () => notifications.filter((notification) => matchesFilters(
      notification,
      search,
      kindFilter,
      audienceFilter,
      deliveryFilter,
      typeof notification.payload.zoneId === "string" ? zoneByReference.get(notification.payload.zoneId) : undefined
    )),
    [audienceFilter, deliveryFilter, kindFilter, notifications, search, zoneByReference]
  );
  const totalPages = Math.max(1, Math.ceil(filteredNotifications.length / NOTIFICATIONS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * NOTIFICATIONS_PER_PAGE;
  const visibleNotifications = filteredNotifications.slice(pageStart, pageStart + NOTIFICATIONS_PER_PAGE);
  const hasActiveFilters = Boolean(search.trim())
    || kindFilter !== "all"
    || audienceFilter !== "all"
    || deliveryFilter !== "all";
  const authRequired = notificationsQuery.isError && isAuthenticationError(notificationsQuery.error);
  const forbidden = notificationsQuery.isError && isAuthorizationError(notificationsQuery.error);

  const resetPage = () => setPage(1);
  const clearFilters = () => {
    setSearch("");
    setKindFilter("all");
    setAudienceFilter("all");
    setDeliveryFilter("all");
    setPage(1);
  };

  return (
    <main className="shell narrow">
      <PageHeader
        title="Notifications"
        description="In-app records of review decisions and BOT Chain updates, including optional external delivery status."
        status={<div className="health-pill">
          <BellRing size={18} aria-hidden="true" />
          <span>{notifications.length} recent</span>
        </div>}
      />

      {notificationsQuery.isLoading ? <p className="status-message">Loading notifications…</p> : null}
      {authRequired ? <ReviewerSignInPrompt forbidden={forbidden} /> : null}
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

      {notifications.length > 0 ? (
        <section className="proof-panel feed-filter-panel" aria-label="Notification filters">
          <PanelHeader
            title="Filter notifications"
            description="Narrow the record by update type, intended audience, or delivery state."
          />
          <div className="feed-filter-grid">
            <label className="field feed-filter-search">
              Search notifications
              <input
                aria-label="Search notifications"
                onChange={(event) => {
                  setSearch(event.target.value);
                  resetPage();
                }}
                placeholder="Title, zone, transaction, or message"
                type="search"
                value={search}
              />
            </label>
            <label className="field">
              Update type
              <select
                aria-label="Filter by update type"
                onChange={(event) => {
                  setKindFilter(event.target.value as KindFilter);
                  resetPage();
                }}
                value={kindFilter}
              >
                <option value="all">All updates</option>
                <option value="review_required">Reviewer requests</option>
                <option value="chain_committed">BOT Chain updates</option>
              </select>
            </label>
            <label className="field">
              Audience
              <select
                aria-label="Filter by audience"
                onChange={(event) => {
                  setAudienceFilter(event.target.value as AudienceFilter);
                  resetPage();
                }}
                value={audienceFilter}
              >
                <option value="all">All audiences</option>
                <option value="reviewer">Reviewers</option>
                <option value="operator">Operators</option>
                <option value="public">Public</option>
              </select>
            </label>
            <label className="field">
              Delivery
              <select
                aria-label="Filter by delivery state"
                onChange={(event) => {
                  setDeliveryFilter(event.target.value as DeliveryFilter);
                  resetPage();
                }}
                value={deliveryFilter}
              >
                <option value="all">All delivery states</option>
                <option value="in-app">In-app records</option>
                <option value="queued">Webhook pending</option>
                <option value="sent">Webhook delivered</option>
                <option value="failed">Webhook failed</option>
              </select>
            </label>
          </div>
          <div className="feed-filter-footer">
            <p aria-live="polite">
              {filteredNotifications.length === 0
                ? "No matching notifications"
                : `Showing ${pageStart + 1}–${Math.min(pageStart + NOTIFICATIONS_PER_PAGE, filteredNotifications.length)} of ${filteredNotifications.length} matching notifications`}
            </p>
            {hasActiveFilters ? <button onClick={clearFilters} type="button">Clear filters</button> : null}
          </div>
        </section>
      ) : null}

      {!notificationsQuery.isLoading
        && !notificationsQuery.isError
        && notifications.length > 0
        && filteredNotifications.length === 0 ? (
          <section className="review-item feed-empty-state">
            <div>
              <h2>No notifications match these filters</h2>
              <p>Adjust the filters or clear them to return to all recent notifications.</p>
            </div>
          </section>
        ) : null}

      <div className="notification-list">
        {visibleNotifications.map((notification) => {
          const zoneReference = typeof notification.payload.zoneId === "string" ? notification.payload.zoneId : null;
          const feeder = zoneReference ? zoneByReference.get(zoneReference) : undefined;
          const zoneId = feeder?.id ?? (zoneReference && isUuid(zoneReference) ? zoneReference : null);
          const txHash = typeof notification.payload.txHash === "string" ? notification.payload.txHash : null;
          const epochStart = typeof notification.payload.epochStart === "string" ? notification.payload.epochStart : null;
          const eventState = getEventState(notification);
          const deliveryState = getDeliveryState(notification);
          const EventIcon = eventState.icon;
          const DeliveryIcon = deliveryState.icon;
          return (
            <article className="review-item notification-item" key={notification.id}>
              <div>
                <div className="badge-row">
                  <span className={`status-badge ${eventState.tone}`}>
                    <EventIcon size={13} aria-hidden="true" />
                    {eventState.label}
                  </span>
                  <span className={`status-badge ${deliveryState.tone}`} title={deliveryState.description}>
                    <DeliveryIcon size={13} aria-hidden="true" />
                    {deliveryState.label}
                  </span>
                  <span className="status-badge">{audienceLabel(notification.audience)}</span>
                </div>
                <h2>{notification.title}</h2>
                <p>{notificationMessage(notification, feeder)}</p>
                <dl>
                  <div>
                    <dt>Created</dt>
                    <dd><time dateTime={notification.createdAt}>{formatGridProofDateTime(notification.createdAt)}</time></dd>
                  </div>
                  <div>
                    <dt>Delivery</dt>
                    <dd>{deliveryState.description}</dd>
                  </div>
                  {notification.channel === "webhook" ? (
                    <div>
                      <dt>Webhook attempts</dt>
                      <dd>{notification.attempts}</dd>
                    </div>
                  ) : null}
                  {zoneReference ? (
                    <>
                      <div>
                        <dt>Feeder</dt>
                        <dd>{feeder?.name ?? "Unknown feeder"}</dd>
                      </div>
                      {feeder ? (
                        <div>
                          <dt>Feeder code</dt>
                          <dd className="mono">{feeder.discosFeederCode}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>{zoneId ? "Zone ID" : "Chain zone key"}</dt>
                        <dd className="mono">{zoneId ?? zoneReference}</dd>
                      </div>
                    </>
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
                  <Link className="button-link" to={`/proof/${zoneId}/${epochStart ? encodeURIComponent(epochStart) : "latest"}`}>
                    <ExternalLink size={18} aria-hidden="true" />
                    Open proof
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {filteredNotifications.length > NOTIFICATIONS_PER_PAGE ? (
        <nav className="action-row feed-pagination" aria-label="Notification pages">
          <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} type="button">Previous</button>
          <span>Page {currentPage} of {totalPages}</span>
          <button disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} type="button">Next</button>
        </nav>
      ) : null}
    </main>
  );
}

type StatusPresentation = {
  label: string;
  description: string;
  tone: "active" | "pending" | "failed" | "neutral";
  icon: typeof CheckCircle2;
};

function getEventState(notification: NotificationRecord): StatusPresentation {
  if (notification.kind === "review_required") {
    return {
      label: "Review required",
      description: "This evidence is waiting for reviewer confirmation.",
      tone: "pending",
      icon: Clock3
    };
  }

  const chainStatus = notification.payload.status;
  if (chainStatus === "confirmed") {
    return {
      label: "Chain confirmed",
      description: "The proof commitment is confirmed on BOT Chain.",
      tone: "active",
      icon: CheckCircle2
    };
  }
  if (chainStatus === "failed") {
    return {
      label: "Commitment failed",
      description: "The BOT Chain commitment did not complete.",
      tone: "failed",
      icon: TriangleAlert
    };
  }
  return {
    label: "Submission pending",
    description: "The proof is waiting to be submitted or confirmed on BOT Chain.",
    tone: "pending",
    icon: Clock3
  };
}

function getDeliveryState(notification: NotificationRecord): StatusPresentation {
  if (notification.channel === "outbox") {
    return {
      label: "In-app record",
      description: "Stored in GridProof; external delivery is not configured.",
      tone: "neutral",
      icon: Inbox
    };
  }
  if (notification.status === "sent") {
    return {
      label: "Webhook delivered",
      description: "Delivered to the configured notification webhook.",
      tone: "active",
      icon: CheckCircle2
    };
  }
  if (notification.status === "failed") {
    return {
      label: "Webhook failed",
      description: "External delivery failed; the in-app record is still available.",
      tone: "failed",
      icon: TriangleAlert
    };
  }
  return {
    label: "Webhook pending",
    description: "Waiting for the configured notification webhook.",
    tone: "pending",
    icon: Clock3
  };
}

function audienceLabel(audience: NotificationRecord["audience"]): string {
  if (audience === "public") return "Public notice";
  if (audience === "operator") return "Operator notice";
  return "Reviewer notice";
}

function notificationMessage(
  notification: NotificationRecord,
  feeder?: { name: string; discosFeederCode: string }
): string {
  if (!feeder || notification.kind !== "chain_committed") return notification.message;
  const status = typeof notification.payload.status === "string" ? notification.payload.status : null;
  if (!status) return notification.message;
  return `${feeder.name} (${feeder.discosFeederCode}) chain commitment is ${status}.`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function matchesFilters(
  notification: NotificationRecord,
  search: string,
  kindFilter: KindFilter,
  audienceFilter: AudienceFilter,
  deliveryFilter: DeliveryFilter,
  feeder?: { name: string; discosFeederCode: string }
): boolean {
  if (kindFilter !== "all" && notification.kind !== kindFilter) return false;
  if (audienceFilter !== "all" && notification.audience !== audienceFilter) return false;
  if (deliveryFilter === "in-app" && notification.channel !== "outbox") return false;
  if (deliveryFilter !== "all" && deliveryFilter !== "in-app") {
    if (notification.channel !== "webhook" || notification.status !== deliveryFilter) return false;
  }

  const query = search.trim().toLowerCase();
  if (!query) return true;
  const payloadValues = Object.values(notification.payload)
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map(String);

  return [
    notification.title,
    notification.message,
    feeder?.name ?? "",
    feeder?.discosFeederCode ?? "",
    notification.lastError ?? "",
    ...payloadValues
  ].some((value) => value.toLowerCase().includes(query));
}
