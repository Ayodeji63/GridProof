import { randomUUID } from "node:crypto";
import type { AuditLog } from "@gridproof/shared-types";
import { isDatabaseConfigured, query } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";

const memoryAuditLogs: AuditLog[] = [];

export type AppendAuditLogInput = {
  actorUserId?: string | null;
  subjectProviderId?: string | null;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export async function appendAuditLog(input: AppendAuditLogInput): Promise<void> {
  const auditLog: AuditLog = {
    id: randomUUID(),
    actorUserId: input.actorUserId ?? null,
    subjectProviderId: input.subjectProviderId ?? null,
    action: input.action,
    before: input.before ?? null,
    after: input.after ?? null,
    createdAt: new Date().toISOString()
  };

  if (!isDatabaseConfigured()) {
    memoryAuditLogs.push(auditLog);
    return;
  }

  try {
    await query(
      `
        insert into audit_logs (id, actor_user_id, subject_provider_id, action, before, after, created_at)
        values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
      `,
      [
        auditLog.id,
        auditLog.actorUserId,
        auditLog.subjectProviderId,
        auditLog.action,
        auditLog.before ? JSON.stringify(auditLog.before) : null,
        auditLog.after ? JSON.stringify(auditLog.after) : null,
        auditLog.createdAt
      ]
    );
  } catch (error) {
    logger.warn({ err: error, action: input.action }, "Failed to append audit log");
  }
}

export function listMemoryAuditLogs(action?: string): AuditLog[] {
  return memoryAuditLogs.filter((item) => !action || item.action === action);
}

export function clearAuditLogStore(): void {
  memoryAuditLogs.length = 0;
}
