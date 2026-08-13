import { randomUUID } from "node:crypto";
import type { AuthRegisterRequest, User, UserRole } from "@gridproof/shared-types";
import { isDatabaseConfigured, query } from "../../lib/db.js";
import { appendAuditLog } from "../audit/service.js";

const memoryUsersByIdentity = new Map<string, User>();

export async function registerUser(input: AuthRegisterRequest): Promise<User> {
  assertRoleAllowed(input.role, input.inviteCode);
  const phoneOrEmail = normalizeIdentity(input.phoneOrEmail);

  if (!isDatabaseConfigured()) {
    const existing = memoryUsersByIdentity.get(phoneOrEmail);
    if (existing) {
      const nextRole = highestRole(existing.role, input.role);
      if (nextRole === existing.role) return existing;

      const upgraded = { ...existing, role: nextRole };
      memoryUsersByIdentity.set(phoneOrEmail, upgraded);
      await appendAuditLog({
        actorUserId: upgraded.id,
        action: "user.role_upgraded",
        before: { user: publicAuditUser(existing) },
        after: { user: publicAuditUser(upgraded) }
      });
      return upgraded;
    }

    const user: User = {
      id: randomUUID(),
      role: input.role,
      phoneOrEmail,
      createdAt: new Date().toISOString()
    };
    memoryUsersByIdentity.set(phoneOrEmail, user);
    await appendAuditLog({
      actorUserId: user.id,
      action: "user.registered",
      after: {
        user: publicAuditUser(user)
      }
    });
    return user;
  }

  const result = await query<UserRow>(
    `
      insert into users (role, phone_or_email)
      values ($1, $2)
      on conflict (phone_or_email) do update
      set role = case
        when excluded.role = 'admin' then 'admin'
        when excluded.role = 'reviewer' and users.role in ('public', 'reporter') then 'reviewer'
        when excluded.role = 'reporter' and users.role = 'public' then 'reporter'
        else users.role
      end
      returning id, role, phone_or_email, created_at
    `,
    [input.role, phoneOrEmail]
  );
  const user = mapUserRow(result.rows[0]);
  await appendAuditLog({
    actorUserId: user.id,
    action: "user.registered",
    after: {
      user: publicAuditUser(user)
    }
  });
  return user;
}

function highestRole(
  current: UserRole,
  requested: Exclude<UserRole, "public">
): UserRole {
  const rank: Record<UserRole, number> = {
    public: 0,
    reporter: 1,
    reviewer: 2,
    admin: 3
  };
  return rank[requested] > rank[current] ? requested : current;
}

export async function findUserForLogin(phoneOrEmail: string): Promise<User | null> {
  const normalized = normalizeIdentity(phoneOrEmail);

  if (!isDatabaseConfigured()) {
    return memoryUsersByIdentity.get(normalized) ?? null;
  }

  const result = await query<UserRow>(
    `
      select id, role, phone_or_email, created_at
      from users
      where phone_or_email = $1
    `,
    [normalized]
  );
  return result.rows[0] ? mapUserRow(result.rows[0]) : null;
}

export function clearAuthStore(): void {
  memoryUsersByIdentity.clear();
}

function assertRoleAllowed(role: Exclude<UserRole, "public">, inviteCode?: string): void {
  if (role === "reporter") return;

  const expected = process.env.GRIDPROOF_AUTH_INVITE_CODE;
  if (!expected || inviteCode !== expected) {
    throw Object.assign(new Error("An invite code is required for reviewer/admin registration"), {
      statusCode: 403,
      code: "INVITE_REQUIRED"
    });
  }
}

function normalizeIdentity(phoneOrEmail: string): string {
  return phoneOrEmail.trim().toLowerCase();
}

function publicAuditUser(user: User): Pick<User, "id" | "role" | "phoneOrEmail"> {
  return {
    id: user.id,
    role: user.role,
    phoneOrEmail: user.phoneOrEmail
  };
}

function mapUserRow(row: UserRow | undefined): User {
  if (!row) throw new Error("User query did not return a row");
  return {
    id: row.id,
    role: row.role,
    phoneOrEmail: row.phone_or_email,
    createdAt: row.created_at.toISOString()
  };
}

type UserRow = {
  id: string;
  role: Exclude<UserRole, "public">;
  phone_or_email: string;
  created_at: Date;
};
