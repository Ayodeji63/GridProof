import net from "node:net";
import tls from "node:tls";
import { Pool } from "pg";

type CheckStatus = "pass" | "warn" | "fail";

export type DataServicesCheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
};

type QueryRows = (sql: string, values?: unknown[]) => Promise<Array<Record<string, unknown>>>;

type DataServicesVerifierOptions = {
  env?: NodeJS.ProcessEnv;
  queryRows?: QueryRows;
  pingRedis?: (redisUrl: string) => Promise<string>;
};

const requiredTables = [
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
] as const;

const requiredIndexes = [
  "evidence_events_zone_observed_at_idx",
  "candidate_events_zone_window_start_idx",
  "chain_commitments_status_idx",
  "audit_logs_created_at_idx",
  "notification_outbox_status_created_at_idx",
  "notification_outbox_kind_created_at_idx",
  "agent_decisions_candidate_agent_unique_idx",
  "users_phone_or_email_unique_idx"
] as const;

function main(): void {
  verifyDataServices().then((checks) => {
    printResults(checks);

    if (checks.some((check) => check.status === "fail")) {
      process.exitCode = 1;
    }
  }).catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}

export async function verifyDataServices(options: DataServicesVerifierOptions = {}): Promise<DataServicesCheckResult[]> {
  const env = options.env ?? process.env;
  const databaseUrl = requiredUrl(env, "DATABASE_URL");
  const redisUrl = requiredRedisUrl(env, "REDIS_URL");
  const databaseUrlCheck = checkDatabaseUrl(databaseUrl);
  const redisUrlCheck = checkRedisUrl(redisUrl);

  if (databaseUrlCheck.status === "fail" || redisUrlCheck.status === "fail") {
    return [databaseUrlCheck, redisUrlCheck];
  }

  const pool = options.queryRows ? null : new Pool({ connectionString: databaseUrl });
  const queryRows: QueryRows = options.queryRows ?? (async (sql, values = []) => {
    if (!pool) throw new Error("Postgres pool was not initialized.");
    const result = await pool.query(sql, values);
    return result.rows as Array<Record<string, unknown>>;
  });
  const pingRedis = options.pingRedis ?? pingRedisUrl;

  try {
    const checks: DataServicesCheckResult[] = [];
    checks.push(databaseUrlCheck);
    checks.push(await checkPostgresConnectivity(queryRows));
    checks.push(await checkPgcrypto(queryRows));
    checks.push(await checkTables(queryRows));
    checks.push(await checkIndexes(queryRows));
    checks.push(redisUrlCheck);
    checks.push(await checkRedisPing(redisUrl, pingRedis));
    return checks;
  } finally {
    await pool?.end();
  }
}

function checkDatabaseUrl(databaseUrl: string): DataServicesCheckResult {
  const protocol = new URL(databaseUrl).protocol;
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    return { name: "database_url", status: "fail", detail: "DATABASE_URL must use postgres:// or postgresql://." };
  }

  return { name: "database_url", status: "pass", detail: "DATABASE_URL is present and uses a Postgres URL scheme." };
}

async function checkPostgresConnectivity(queryRows: QueryRows): Promise<DataServicesCheckResult> {
  try {
    const rows = await queryRows("select current_database() as database_name, now() as checked_at");
    const databaseName = rows[0]?.database_name;
    return {
      name: "postgres_connectivity",
      status: typeof databaseName === "string" ? "pass" : "fail",
      detail: typeof databaseName === "string"
        ? `Connected to Postgres database ${databaseName}.`
        : "Postgres connectivity check did not return a database name."
    };
  } catch (error) {
    return { name: "postgres_connectivity", status: "fail", detail: errorMessage(error) };
  }
}

async function checkPgcrypto(queryRows: QueryRows): Promise<DataServicesCheckResult> {
  try {
    const rows = await queryRows("select exists(select 1 from pg_extension where extname = 'pgcrypto') as installed");
    if (rows[0]?.installed !== true) {
      return {
        name: "postgres_pgcrypto",
        status: "fail",
        detail: "pgcrypto extension is not installed; run DATABASE_URL=<prod-url> pnpm db:migrate."
      };
    }

    return { name: "postgres_pgcrypto", status: "pass", detail: "pgcrypto extension is installed for UUID generation." };
  } catch (error) {
    return { name: "postgres_pgcrypto", status: "fail", detail: errorMessage(error) };
  }
}

async function checkTables(queryRows: QueryRows): Promise<DataServicesCheckResult> {
  try {
    const rows = await queryRows(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [[...requiredTables]]
    );
    const found = new Set(rows.map((row) => String(row.table_name)));
    const missing = requiredTables.filter((table) => !found.has(table));
    if (missing.length > 0) {
      return {
        name: "postgres_tables",
        status: "fail",
        detail: `Missing required table(s): ${missing.join(", ")}. Run pnpm db:migrate against production Supabase.`
      };
    }

    return {
      name: "postgres_tables",
      status: "pass",
      detail: `All ${requiredTables.length} GridProof tables exist.`
    };
  } catch (error) {
    return { name: "postgres_tables", status: "fail", detail: errorMessage(error) };
  }
}

async function checkIndexes(queryRows: QueryRows): Promise<DataServicesCheckResult> {
  try {
    const rows = await queryRows(
      `
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and indexname = any($1::text[])
      `,
      [[...requiredIndexes]]
    );
    const found = new Set(rows.map((row) => String(row.indexname)));
    const missing = requiredIndexes.filter((index) => !found.has(index));
    if (missing.length > 0) {
      return {
        name: "postgres_indexes",
        status: "fail",
        detail: `Missing required index(es): ${missing.join(", ")}. Re-run migrations before demo traffic.`
      };
    }

    return {
      name: "postgres_indexes",
      status: "pass",
      detail: `All ${requiredIndexes.length} demo-critical indexes exist.`
    };
  } catch (error) {
    return { name: "postgres_indexes", status: "fail", detail: errorMessage(error) };
  }
}

function checkRedisUrl(redisUrl: string): DataServicesCheckResult {
  const protocol = new URL(redisUrl).protocol;
  if (protocol !== "redis:" && protocol !== "rediss:") {
    return { name: "redis_url", status: "fail", detail: "REDIS_URL must use redis:// or rediss://." };
  }

  return { name: "redis_url", status: "pass", detail: "REDIS_URL is present and uses a Redis URL scheme." };
}

async function checkRedisPing(redisUrl: string, pingRedis: (redisUrl: string) => Promise<string>): Promise<DataServicesCheckResult> {
  try {
    const pong = await pingRedis(redisUrl);
    if (pong !== "PONG") {
      return { name: "redis_ping", status: "fail", detail: `Expected PONG from Redis, received ${pong}.` };
    }

    return { name: "redis_ping", status: "pass", detail: "Redis/Upstash accepted AUTH when needed and returned PONG." };
  } catch (error) {
    return { name: "redis_ping", status: "fail", detail: errorMessage(error) };
  }
}

async function pingRedisUrl(redisUrl: string): Promise<string> {
  const url = new URL(redisUrl);
  const isTls = url.protocol === "rediss:";
  const port = Number(url.port || (isTls ? 6380 : 6379));
  const socket = isTls
    ? tls.connect({ host: url.hostname, port, servername: url.hostname })
    : net.connect({ host: url.hostname, port });

  try {
    await waitForConnect(socket);
    const commands: string[] = [];
    const username = decodeURIComponent(url.username || "");
    const password = decodeURIComponent(url.password || "");
    if (password) {
      commands.push(username ? redisCommand("AUTH", username, password) : redisCommand("AUTH", password));
    }
    commands.push(redisCommand("PING"));

    const response = await writeAndRead(socket, commands.join(""));
    if (response.includes("-")) throw new Error(response.trim());
    return response.includes("+PONG") ? "PONG" : response.trim();
  } finally {
    socket.destroy();
  }
}

function waitForConnect(socket: net.Socket | tls.TLSSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("secureConnect", onConnect);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("Redis connection timed out."));
    };

    socket.setTimeout(10_000);
    socket.once("connect", onConnect);
    socket.once("secureConnect", onConnect);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}

function writeAndRead(socket: net.Socket | tls.TLSSocket, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.includes("+PONG") || text.startsWith("-")) {
        cleanup();
        resolve(text);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("Redis PING timed out."));
    };

    socket.setTimeout(10_000);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.write(payload);
  });
}

function redisCommand(...parts: string[]): string {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`;
}

function requiredUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Example: ${name}=<production-service-url> pnpm deployment:data`);
  }

  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
}

function requiredRedisUrl(env: NodeJS.ProcessEnv, name: string): string {
  return requiredUrl(env, name);
}

function printResults(checks: DataServicesCheckResult[]): void {
  console.log("GridProof data services verification");
  for (const check of checks) {
    console.log(`${icon(check.status)} ${check.name}: ${check.detail}`);
  }

  const passed = checks.filter((check) => check.status === "pass").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  console.log(`\nSummary: ${passed} passed, ${warnings} warning(s), ${failed} failed.`);
}

function icon(status: CheckStatus): string {
  if (status === "pass") return "✓";
  if (status === "warn") return "!";
  return "✗";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const invokedScript = process.argv[1]?.replace(/\\/g, "/");

if (invokedScript?.endsWith("/verify-data-services.ts") || invokedScript?.endsWith("/verify-data-services.js")) {
  main();
}
