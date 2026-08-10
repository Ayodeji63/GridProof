import { describe, expect, it } from "vitest";

import {
  verifyDataServices,
  type DataServicesCheckResult
} from "../../scripts/verify-data-services.ts";

const env = {
  DATABASE_URL: "postgres://gridproof:secret@db.gridproof.example:5432/gridproof",
  REDIS_URL: "rediss://default:secret@redis.gridproof.example:6379"
};

const tables = [
  "users",
  "zones",
  "providers",
  "evidence_events",
  "candidate_events",
  "agent_decisions",
  "epoch_scores",
  "chain_commitments",
  "audit_logs",
  "notification_outbox"
];

const indexes = [
  "evidence_events_zone_observed_at_idx",
  "candidate_events_zone_window_start_idx",
  "chain_commitments_status_idx",
  "audit_logs_created_at_idx",
  "notification_outbox_status_created_at_idx",
  "notification_outbox_kind_created_at_idx",
  "agent_decisions_candidate_agent_unique_idx",
  "users_phone_or_email_unique_idx"
];

describe("verifyDataServices", () => {
  it("passes when production Postgres schema and Redis are reachable", async () => {
    const checks = await verifyDataServices({
      env,
      queryRows: queryRowsFixture(),
      pingRedis: async () => "PONG"
    });

    expect(statuses(checks)).toEqual({
      database_url: "pass",
      postgres_connectivity: "pass",
      postgres_pgcrypto: "pass",
      postgres_tables: "pass",
      postgres_indexes: "pass",
      redis_url: "pass",
      redis_ping: "pass"
    });
  });

  it("fails clearly when DATABASE_URL is missing", async () => {
    await expect(
      verifyDataServices({
        env: {
          REDIS_URL: env.REDIS_URL
        },
        queryRows: queryRowsFixture(),
        pingRedis: async () => "PONG"
      })
    ).rejects.toThrow("DATABASE_URL is required");
  });

  it("fails when pgcrypto was not installed by migrations", async () => {
    const checks = await verifyDataServices({
      env,
      queryRows: queryRowsFixture({ pgcryptoInstalled: false }),
      pingRedis: async () => "PONG"
    });

    expect(byName(checks, "postgres_pgcrypto")).toMatchObject({
      status: "fail",
      detail: "pgcrypto extension is not installed; run DATABASE_URL=<prod-url> pnpm db:migrate."
    });
  });

  it("fails when demo-critical tables are missing", async () => {
    const checks = await verifyDataServices({
      env,
      queryRows: queryRowsFixture({ tables: tables.filter((table) => table !== "chain_commitments") }),
      pingRedis: async () => "PONG"
    });

    expect(byName(checks, "postgres_tables")).toMatchObject({
      status: "fail",
      detail: "Missing required table(s): chain_commitments. Run pnpm db:migrate against production Supabase."
    });
  });

  it("fails when demo-critical indexes are missing", async () => {
    const checks = await verifyDataServices({
      env,
      queryRows: queryRowsFixture({ indexes: indexes.filter((index) => index !== "users_phone_or_email_unique_idx") }),
      pingRedis: async () => "PONG"
    });

    expect(byName(checks, "postgres_indexes")).toMatchObject({
      status: "fail",
      detail: "Missing required index(es): users_phone_or_email_unique_idx. Re-run migrations before demo traffic."
    });
  });

  it("fails when Redis does not respond with PONG", async () => {
    const checks = await verifyDataServices({
      env,
      queryRows: queryRowsFixture(),
      pingRedis: async () => "NOPE"
    });

    expect(byName(checks, "redis_ping")).toMatchObject({
      status: "fail",
      detail: "Expected PONG from Redis, received NOPE."
    });
  });

  it("fails Redis URL scheme drift before the worker points at a non-Redis service", async () => {
    const checks = await verifyDataServices({
      env: {
        ...env,
        REDIS_URL: "https://redis.gridproof.example"
      },
      queryRows: queryRowsFixture(),
      pingRedis: async () => "PONG"
    });

    expect(byName(checks, "redis_url")).toMatchObject({
      status: "fail",
      detail: "REDIS_URL must use redis:// or rediss://."
    });
  });
});

function queryRowsFixture(options: {
  pgcryptoInstalled?: boolean;
  tables?: string[];
  indexes?: string[];
} = {}): (sql: string, values?: unknown[]) => Promise<Array<Record<string, unknown>>> {
  const pgcryptoInstalled = options.pgcryptoInstalled ?? true;
  const tableRows = options.tables ?? tables;
  const indexRows = options.indexes ?? indexes;

  return async (sql: string) => {
    if (sql.includes("current_database()")) {
      return [{ database_name: "gridproof" }];
    }
    if (sql.includes("pg_extension")) {
      return [{ installed: pgcryptoInstalled }];
    }
    if (sql.includes("information_schema.tables")) {
      return tableRows.map((table_name) => ({ table_name }));
    }
    if (sql.includes("pg_indexes")) {
      return indexRows.map((indexname) => ({ indexname }));
    }

    throw new Error(`Unexpected query: ${sql}`);
  };
}

function statuses(checks: DataServicesCheckResult[]): Record<string, DataServicesCheckResult["status"]> {
  return Object.fromEntries(checks.map((check) => [check.name, check.status]));
}

function byName(checks: DataServicesCheckResult[], name: string): DataServicesCheckResult {
  const check = checks.find((candidate) => candidate.name === name);
  if (!check) throw new Error(`Missing check ${name}`);
  return check;
}
