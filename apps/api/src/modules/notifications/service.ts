import { randomUUID } from "node:crypto";
import { domainEvents, type DomainEvents } from "../../lib/events.js";
import { isDatabaseConfigured, query } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";

export type NotificationKind = "review_required" | "chain_committed";
export type NotificationAudience = "reviewer" | "operator" | "public";
export type NotificationChannel = "outbox" | "webhook";
export type NotificationStatus = "queued" | "sent" | "failed";

export type NotificationRecord = {
  id: string;
  kind: NotificationKind;
  audience: NotificationAudience;
  channel: NotificationChannel;
  title: string;
  message: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
};

type NotificationInput = Pick<NotificationRecord, "kind" | "audience" | "title" | "message" | "payload">;

const memoryNotifications = new Map<string, NotificationRecord>();

export function attachNotifications(): () => void {
  const unsubscribers = [
    domainEvents.on("review.required", (payload) => {
      void enqueueReviewRequired(payload);
    }),
    domainEvents.on("chain.committed", (payload) => {
      void enqueueChainCommitted(payload);
    })
  ];

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

export async function listNotifications(limit = 50): Promise<NotificationRecord[]> {
  if (!isDatabaseConfigured()) {
    return Array.from(memoryNotifications.values())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  const result = await query<NotificationRow>(
    `
      select id, kind, audience, channel, title, message, payload, status,
             attempts, last_error, created_at, sent_at
      from notification_outbox
      order by created_at desc
      limit $1
    `,
    [limit]
  );

  return result.rows.map(mapNotificationRow);
}

export function clearNotificationStore(): void {
  memoryNotifications.clear();
}

async function enqueueReviewRequired(payload: DomainEvents["review.required"]): Promise<void> {
  await enqueueNotification({
    kind: "review_required",
    audience: "reviewer",
    title: "Evidence needs reviewer confirmation",
    message: payload.reason,
    payload
  });
}

async function enqueueChainCommitted(payload: DomainEvents["chain.committed"]): Promise<void> {
  await enqueueNotification({
    kind: "chain_committed",
    audience: payload.status === "pending" ? "operator" : "public",
    title: titleForChainStatus(payload.status),
    message: `Zone ${payload.zoneId} chain commitment is ${payload.status}.`,
    payload
  });
}

async function enqueueNotification(input: NotificationInput): Promise<NotificationRecord> {
  const notification: NotificationRecord = {
    id: randomUUID(),
    ...input,
    channel: process.env.NOTIFICATION_WEBHOOK_URL ? "webhook" : "outbox",
    status: "queued",
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    sentAt: null
  };

  await storeNotification(notification);
  void deliverNotification(notification);
  return notification;
}

async function deliverNotification(notification: NotificationRecord): Promise<void> {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), webhookTimeoutMs());

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...webhookAuthHeader()
      },
      body: JSON.stringify(notification),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Notification webhook returned ${response.status}`);
    }

    await markNotificationDelivered(notification.id, "sent", null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown notification webhook failure";
    logger.warn({ err: error, notificationId: notification.id }, "Notification delivery failed");
    await markNotificationDelivered(notification.id, "failed", message);
  } finally {
    clearTimeout(timeout);
  }
}

async function storeNotification(notification: NotificationRecord): Promise<void> {
  if (!isDatabaseConfigured()) {
    memoryNotifications.set(notification.id, notification);
    return;
  }

  await query(
    `
      insert into notification_outbox (
        id, kind, audience, channel, title, message, payload, status,
        attempts, last_error, created_at, sent_at
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)
    `,
    [
      notification.id,
      notification.kind,
      notification.audience,
      notification.channel,
      notification.title,
      notification.message,
      JSON.stringify(notification.payload),
      notification.status,
      notification.attempts,
      notification.lastError,
      notification.createdAt,
      notification.sentAt
    ]
  );
}

async function markNotificationDelivered(id: string, status: "sent" | "failed", lastError: string | null): Promise<void> {
  const sentAt = status === "sent" ? new Date().toISOString() : null;

  if (!isDatabaseConfigured()) {
    const current = memoryNotifications.get(id);
    if (!current) return;
    memoryNotifications.set(id, {
      ...current,
      status,
      attempts: current.attempts + 1,
      lastError,
      sentAt
    });
    return;
  }

  await query(
    `
      update notification_outbox
      set status = $2,
          attempts = attempts + 1,
          last_error = $3,
          sent_at = $4
      where id = $1
    `,
    [id, status, lastError, sentAt]
  );
}

function titleForChainStatus(status: DomainEvents["chain.committed"]["status"]): string {
  if (status === "confirmed") return "Proof confirmed on BOT Chain";
  if (status === "failed") return "Chain commitment failed";
  return "Proof queued for BOT Chain submission";
}

function webhookAuthHeader(): Record<string, string> {
  const token = process.env.NOTIFICATION_WEBHOOK_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function webhookTimeoutMs(): number {
  const raw = process.env.NOTIFICATION_WEBHOOK_TIMEOUT_MS;
  if (!raw) return 1500;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1500;
}

type NotificationRow = {
  id: string;
  kind: NotificationKind;
  audience: NotificationAudience;
  channel: NotificationChannel;
  title: string;
  message: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
};

function mapNotificationRow(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    kind: row.kind,
    audience: row.audience,
    channel: row.channel,
    title: row.title,
    message: row.message,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    sentAt: row.sent_at?.toISOString() ?? null
  };
}
