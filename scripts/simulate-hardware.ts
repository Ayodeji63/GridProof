/**
 * GridProof hardware simulator.
 *
 * Impersonates the ESP32-S3 firmware in `hardware.ino` and drives the constant
 * scenario in `hardware-scenario.ts` through the entire architecture: telemetry
 * ingestion -> deterministic detection -> policy gate -> epoch score -> pending
 * chain commitment -> `UptimeAttestation.commitEpoch` -> public proof endpoint.
 *
 * It asserts as it goes. Every reading carries an expected candidate status and
 * confidence derived by hand from `detection/rules.ts`, so a change to the
 * detection ladder shows up here as a failing check rather than as a demo that
 * quietly shows the wrong number.
 *
 *   pnpm simulate:hardware
 *   pnpm simulate:hardware -- --base-url https://api.example.org --run-offset 1
 *
 * Re-running inside the same hour replays identical idempotency keys, so every
 * request comes back 200/duplicate and no pipeline work happens — that is the
 * firmware's replay protection working, not a failure. Pass `--run-offset 1` to
 * shift the whole scenario by a second and get a fresh run.
 *
 * Depends only on Node builtins and workspace source files: the repo root has no
 * `zod` or `dotenv` under pnpm's strict module isolation.
 */

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildScenario,
  coveredDiscoCodes,
  devEuiFor,
  idempotencyKeyFor,
  reporterWalletFor,
  sensorWalletFor,
  signTelemetry,
  type ResolvedEvent,
  type Scenario,
  type ScenarioZone
} from "./hardware-scenario.js";

type CheckStatus = "pass" | "warn" | "fail";

type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
};

type HttpResult = {
  status: number;
  body: unknown;
};

/** Mirrors `LOCAL_DEV_JWT_SECRET` in `auth/middleware.ts`. */
const LOCAL_DEV_JWT_SECRET = "gridproof-local-dev-jwt-secret";
const AUTO_APPROVE_THRESHOLD = 0.85;
const ESCALATE_THRESHOLD = 0.5;
const DEFAULT_BASE_URL = "http://localhost:4000";
/** `submitPendingCommitments` takes 5 per call; the baseline act queues ~20. */
const CHAIN_SUBMIT_ROUNDS = 8;

const checks: CheckResult[] = [];

/** Candidate id per act, so the review and chain stages can find their targets. */
const candidateIdByAct = new Map<string, string>();
/** Zones that produced at least one auto-approved candidate in the sealed hour. */
const approvedZones = new Set<string>();

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  loadApiEnv();

  const scenario = buildScenario(new Date(), options.runOffsetSeconds);
  printHeader(scenario, options.baseUrl);

  const tokens = {
    reporter: mintToken("reporter"),
    reviewer: mintToken("reviewer"),
    admin: mintToken("admin")
  };

  await checkApiReachable(options.baseUrl);
  if (checks.some((check) => check.status === "fail")) {
    printResults();
    process.exitCode = 1;
    return;
  }

  await checkZonesProvisioned(options.baseUrl, scenario);
  await checkRoleEnforcement(options.baseUrl, tokens.reporter);

  await sendScenario(options.baseUrl, scenario, tokens.reporter);
  await checkIdempotentReplay(options.baseUrl, scenario);
  await checkRejectedSignature(options.baseUrl, scenario);
  await checkClockSkewRejection(options.baseUrl, scenario);

  await resolveReviewQueue(options.baseUrl, tokens.reviewer);
  await driveChain(options.baseUrl, tokens.admin, scenario);
  await checkPublicSurfaces(options.baseUrl, scenario);

  printResults();
  printOperatorNotes();

  if (checks.some((check) => check.status === "fail")) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

async function checkApiReachable(baseUrl: string): Promise<void> {
  try {
    const health = await httpJson("GET", `${baseUrl}/api/v1/health`);
    if (health.status !== 200) {
      record("api_reachable", "fail", `GET /api/v1/health returned ${health.status}.`);
      return;
    }
    record("api_reachable", "pass", `API is up at ${baseUrl}.`);
  } catch (error) {
    record("api_reachable", "fail", `Cannot reach ${baseUrl}: ${errorMessage(error)}. Start it with pnpm dev.`);
    return;
  }

  const readiness = await httpJson("GET", `${baseUrl}/api/v1/readiness`);
  const failing = readinessFailures(readiness.body);
  if (failing.length === 0) {
    record("api_readiness", "pass", "All required readiness checks pass.");
    return;
  }

  record(
    "api_readiness",
    "warn",
    `Readiness reports ${failing.length} unmet required check(s): ${failing.join(", ")}. The simulation still runs; chain steps may be skipped.`
  );
}

async function checkZonesProvisioned(baseUrl: string, scenario: Scenario): Promise<void> {
  const response = await httpJson("GET", `${baseUrl}/api/v1/zones`);
  const zones = Array.isArray(recordOf(response.body)?.zones) ? (recordOf(response.body)?.zones as unknown[]) : [];
  const knownIds = new Set(zones.map((zone) => stringField(zone, "id")).filter((id): id is string => Boolean(id)));

  const missing = scenario.zones.filter((zone) => !knownIds.has(zone.id));
  if (missing.length === 0) {
    record("zones_provisioned", "pass", `All ${scenario.zones.length} scenario zones exist, covering ${coveredDiscoCodes().length} DisCos.`);
    return;
  }

  // Ingestion auto-inserts an unknown zoneId as a placeholder, so this is a
  // naming/coverage problem for the dashboard, not a blocker for the run.
  record(
    "zones_provisioned",
    "warn",
    `${missing.length} scenario zone(s) are absent and will be auto-created with placeholder names (${missing
      .slice(0, 3)
      .map((zone) => zone.discosFeederCode)
      .join(", ")}${missing.length > 3 ? ", ..." : ""}). Run pnpm db:seed first for the real DisCo labels.`
  );
}

async function checkRoleEnforcement(baseUrl: string, reporterToken: string): Promise<void> {
  const response = await httpJson("GET", `${baseUrl}/api/v1/admin/review-queue`, undefined, reporterToken);
  if (response.status === 403) {
    record("rbac_enforced", "pass", "A reporter token is refused on the reviewer-only review queue (403).");
    return;
  }
  record("rbac_enforced", "fail", `Expected 403 for a reporter token on /admin/review-queue, got ${response.status}.`);
}

// ---------------------------------------------------------------------------
// The scenario itself
// ---------------------------------------------------------------------------

async function sendScenario(baseUrl: string, scenario: Scenario, reporterToken: string): Promise<void> {
  console.log("\nSending scenario\n");

  for (const resolved of scenario.events) {
    // Strictly sequential: cross-source agreement is scored against evidence
    // already stored, so a parallel send would change the confidences.
    const response = await sendEvent(baseUrl, resolved, reporterToken);
    verifyEvent(resolved, response);
  }
}

async function sendEvent(baseUrl: string, resolved: ResolvedEvent, reporterToken: string): Promise<HttpResult> {
  const { event, zone, observedAt, observedAtUnix } = resolved;

  if (event.kind === "sensor") {
    return httpJson("POST", `${baseUrl}/api/v1/ingest/telemetry`, telemetryBody(resolved));
  }

  if (event.kind === "reporter") {
    return httpJson(
      "POST",
      `${baseUrl}/api/v1/ingest/report`,
      {
        reporterWallet: reporterWalletFor(zone.index),
        zoneId: zone.id,
        idempotencyKey: `sim-report-${zone.index}-${observedAtUnix}`,
        observedAt,
        status: event.status,
        note: event.note
      },
      reporterToken
    );
  }

  const body = {
    source: "demo" as const,
    messageId: `sim-wa-${zone.index}-${observedAtUnix}`,
    fromPhone: event.fromPhone,
    reporterWallet: reporterWalletFor(zone.index),
    zoneId: zone.id,
    observedAt,
    text: event.text
  };
  return httpJson("POST", `${baseUrl}/api/v1/ingest/whatsapp-webhook`, body, undefined, webhookHeaders(body));
}

/** The exact JSON the firmware PUTs on the wire, including the signature. */
function telemetryBody(resolved: ResolvedEvent): Record<string, unknown> {
  const { event, zone, observedAt, observedAtUnix } = resolved;
  if (event.kind !== "sensor") throw new Error("telemetryBody expects a sensor event");

  const deviceId = devEuiFor(zone.index, event.meter);
  const providerWallet = sensorWalletFor(zone.index);
  const idempotencyKey = idempotencyKeyFor(deviceId, observedAtUnix);
  const currentAmps = event.currentAmps ?? (event.status === "grid_up" ? 36 + event.meter * 8 : event.status === "grid_down" ? 0 : undefined);

  const signable = {
    deviceId,
    providerWallet,
    zoneId: zone.id,
    idempotencyKey,
    observedAt,
    status: event.status,
    ...(event.voltage === undefined ? {} : { voltage: event.voltage }),
    ...(currentAmps === undefined ? {} : { currentAmps })
  };

  return {
    ...signable,
    signature: signTelemetry(signable, telemetrySecret())
  };
}

function verifyEvent(resolved: ResolvedEvent, response: HttpResult): void {
  const { event, zone } = resolved;
  const label = `${event.act} ${zone.discosFeederCode}`;

  if (response.status !== 202 && response.status !== 200) {
    record(`ingest:${event.act}`, "fail", `${label} — expected 202, got ${response.status}: ${describe(response.body)}`);
    return;
  }

  const body = recordOf(response.body);
  if (body?.duplicate === true) {
    record(
      `ingest:${event.act}`,
      "warn",
      `${label} — already ingested (idempotency key replayed). Pass --run-offset 1 for a fresh run.`
    );
    return;
  }

  const candidate = recordOf(body?.candidateEvent);

  if (event.expect.candidate === "none") {
    if (candidate) {
      record(`ingest:${event.act}`, "fail", `${label} — expected no candidate, got ${describe(candidate.status)}.`);
      return;
    }
    record(`ingest:${event.act}`, "pass", `${label} — no candidate, as expected. ${event.expect.why}`);
    return;
  }

  if (!candidate) {
    record(`ingest:${event.act}`, "fail", `${label} — expected a ${event.expect.candidate} candidate, got none.`);
    return;
  }

  if (candidate.status !== event.expect.candidate) {
    record(`ingest:${event.act}`, "fail", `${label} — expected status ${event.expect.candidate}, got ${describe(candidate.status)}.`);
    return;
  }

  const candidateId = typeof candidate.id === "string" ? candidate.id : null;
  if (candidateId) candidateIdByAct.set(event.act, candidateId);

  const confidence = typeof candidate.confidence === "number" ? candidate.confidence : Number.NaN;
  const decision = decisionFor(confidence);
  if (decision === "approve") approvedZones.add(zone.id);

  if (event.expect.confidence !== undefined && Math.abs(confidence - event.expect.confidence) > 1e-6) {
    record(
      `ingest:${event.act}`,
      "fail",
      `${label} — expected confidence ${event.expect.confidence}, got ${confidence}. ${event.expect.why}`
    );
    return;
  }

  if (event.expect.decision && decision !== event.expect.decision) {
    record(
      `ingest:${event.act}`,
      "fail",
      `${label} — confidence ${confidence} maps to ${decision}, expected ${event.expect.decision}.`
    );
    return;
  }

  record(
    `ingest:${event.act}`,
    "pass",
    `${label} — ${candidate.status} @ ${confidence} -> ${decision}. ${event.expect.why}`
  );
}

// ---------------------------------------------------------------------------
// Firmware-level guarantees
// ---------------------------------------------------------------------------

async function checkIdempotentReplay(baseUrl: string, scenario: Scenario): Promise<void> {
  const target = scenario.events.find((resolved) => resolved.event.act === "S2");
  if (!target) {
    record("replay_idempotent", "fail", "Scenario act S2 is missing.");
    return;
  }

  const response = await httpJson("POST", `${baseUrl}/api/v1/ingest/telemetry`, telemetryBody(target));
  const body = recordOf(response.body);

  if (response.status === 200 && body?.duplicate === true) {
    record(
      "replay_idempotent",
      "pass",
      "Re-sending S2 verbatim returns 200 duplicate=true and runs no pipeline work — the offline-queue flush is safe to retry."
    );
    return;
  }

  record(
    "replay_idempotent",
    "fail",
    `Expected 200 with duplicate=true on replay, got ${response.status} duplicate=${describe(body?.duplicate)}.`
  );
}

async function checkRejectedSignature(baseUrl: string, scenario: Scenario): Promise<void> {
  if (!process.env.TELEMETRY_HMAC_SECRET) {
    record(
      "signature_rejected",
      "warn",
      "TELEMETRY_HMAC_SECRET is unset, so the API accepts unsigned telemetry outside production. Set it before demoing the signing story."
    );
    return;
  }

  const target = scenario.events.find((resolved) => resolved.event.act === "S4a");
  if (!target) {
    record("signature_rejected", "fail", "Scenario act S4a is missing.");
    return;
  }

  // Same payload, one flipped voltage digit: the signature no longer covers it.
  const tampered = { ...telemetryBody(target), voltage: 10_701 };
  const response = await httpJson("POST", `${baseUrl}/api/v1/ingest/telemetry`, tampered);

  if (response.status === 401) {
    record("signature_rejected", "pass", "A payload altered after signing is rejected with 401 BAD_SIGNATURE.");
    return;
  }

  record("signature_rejected", "fail", `Expected 401 for a tampered payload, got ${response.status}.`);
}

async function checkClockSkewRejection(baseUrl: string, scenario: Scenario): Promise<void> {
  const target = scenario.events.find((resolved) => resolved.event.act === "S2");
  if (!target) {
    record("clock_skew_rejected", "fail", "Scenario act S2 is missing.");
    return;
  }

  const futureUnix = Math.floor(Date.now() / 1000) + 30 * 60;
  const skewed: ResolvedEvent = {
    ...target,
    observedAtUnix: futureUnix,
    observedAt: `${new Date(futureUnix * 1000).toISOString().slice(0, 19)}Z`
  };

  const response = await httpJson("POST", `${baseUrl}/api/v1/ingest/telemetry`, telemetryBody(skewed));
  if (response.status === 400) {
    record("clock_skew_rejected", "pass", "A reading 30 minutes in the future is rejected (400 OBSERVED_AT_OUT_OF_RANGE).");
    return;
  }

  record("clock_skew_rejected", "fail", `Expected 400 for a future observedAt, got ${response.status}.`);
}

// ---------------------------------------------------------------------------
// Human review
// ---------------------------------------------------------------------------

async function resolveReviewQueue(baseUrl: string, reviewerToken: string): Promise<void> {
  const queue = await httpJson("GET", `${baseUrl}/api/v1/admin/review-queue`, undefined, reviewerToken);
  if (queue.status !== 200) {
    record("review_queue", "fail", `GET /admin/review-queue returned ${queue.status}: ${describe(queue.body)}`);
    return;
  }

  const items = Array.isArray(recordOf(queue.body)?.items) ? (recordOf(queue.body)?.items as unknown[]) : [];
  const escalatedActs = ["S5a", "S6", "L1a", "L1b", "L1c", "L2", "L3"];
  const present = escalatedActs.filter((act) => {
    const candidateId = candidateIdByAct.get(act);
    return candidateId ? items.some((item) => stringField(item, "candidateEventId") === candidateId) : false;
  });

  if (present.length === 0) {
    record("review_queue", "fail", `No escalated candidate from this run reached the review queue (${items.length} item(s) queued).`);
    return;
  }

  record(
    "review_queue",
    present.length === escalatedActs.length ? "pass" : "warn",
    `${present.length}/${escalatedActs.length} escalated candidates are awaiting human review: ${present.join(", ")}.`
  );

  // S6 sits in the sealed hour, so approving it mints an epoch score for an
  // epoch the chain will already accept. L2 is live-band and gets rejected,
  // which mints nothing — the current hour stays clean.
  await resolveOne(baseUrl, reviewerToken, items, "S6", "approve", "Field crew confirmed the outage on the Akure feeder.");
  await resolveOne(baseUrl, reviewerToken, items, "L2", "reject", "Single unverified report with no sensor coverage; not committing.");
}

async function resolveOne(
  baseUrl: string,
  reviewerToken: string,
  items: unknown[],
  act: string,
  decision: "approve" | "reject",
  note: string
): Promise<void> {
  const candidateId = candidateIdByAct.get(act);
  const item = candidateId ? items.find((entry) => stringField(entry, "candidateEventId") === candidateId) : undefined;
  const reviewId = item ? stringField(item, "id") : null;

  if (!reviewId) {
    record(`review_${decision}:${act}`, "warn", `Act ${act} was not in the review queue, so the ${decision} path was not exercised.`);
    return;
  }

  const response = await httpJson(
    "POST",
    `${baseUrl}/api/v1/admin/review/${reviewId}/decision`,
    { decision, note },
    reviewerToken
  );

  if (response.status !== 200) {
    record(`review_${decision}:${act}`, "fail", `Reviewer ${decision} on ${act} returned ${response.status}: ${describe(response.body)}`);
    return;
  }

  const body = recordOf(response.body);
  const epochScore = recordOf(body?.epochScore);
  const commitment = recordOf(body?.commitment);

  if (decision === "approve") {
    if (!epochScore || !commitment) {
      record(`review_approve:${act}`, "fail", `Approving ${act} produced no epoch score or commitment.`);
      return;
    }
    record(
      "review_approve:S6",
      "pass",
      `Reviewer approval of ${act} minted epoch score ${describe(epochScore.uptimeBps)} bps and queued a chain commitment.`
    );
    return;
  }

  if (epochScore || commitment) {
    record(`review_reject:${act}`, "fail", `Rejecting ${act} should mint nothing, but an epoch score or commitment appeared.`);
    return;
  }

  record("review_reject:L2", "pass", `Reviewer rejection of ${act} closed the item and committed nothing on chain.`);
}

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

async function driveChain(baseUrl: string, adminToken: string, scenario: Scenario): Promise<void> {
  let scanned = 0;
  let submitted = 0;
  let reason: string | null = null;

  for (let round = 0; round < CHAIN_SUBMIT_ROUNDS; round += 1) {
    const response = await httpJson("POST", `${baseUrl}/api/v1/chain/submit-pending`, {}, adminToken);
    if (response.status !== 200) {
      record("chain_submit", "fail", `POST /chain/submit-pending returned ${response.status}: ${describe(response.body)}`);
      return;
    }

    const body = recordOf(response.body);
    const roundScanned = numberField(body, "scanned");
    const roundSubmitted = numberField(body, "submitted");
    scanned += roundScanned;
    submitted += roundSubmitted;
    if (typeof body?.reason === "string") reason = body.reason;
    if (roundSubmitted === 0) break;
  }

  if (reason) {
    record(
      "chain_submit",
      "warn",
      `Commitments are queued but not submitted: ${reason}. Everything up to the chain boundary is proven; configure the relayer to close the loop.`
    );
  } else if (submitted > 0) {
    record("chain_submit", "pass", `Submitted ${submitted} epoch commitment(s) to UptimeAttestation for the ${scenario.sealedEpochStart.toISOString()} epoch.`);
  } else {
    record(
      "chain_submit",
      "warn",
      `Nothing was submitted (${scanned} scanned). The background sweep runs every 2 minutes and may have already claimed them.`
    );
  }

  const indexed = await httpJson("POST", `${baseUrl}/api/v1/chain/index-confirmations`, {}, adminToken);
  if (indexed.status !== 200) {
    record("chain_index", "fail", `POST /chain/index-confirmations returned ${indexed.status}: ${describe(indexed.body)}`);
    return;
  }

  const indexBody = recordOf(indexed.body);
  if (typeof indexBody?.reason === "string") {
    record("chain_index", "warn", `Confirmation indexing skipped: ${indexBody.reason}`);
    return;
  }

  const confirmed = numberField(indexBody, "confirmed");
  const failed = numberField(indexBody, "failed");
  if (failed > 0) {
    record("chain_index", "fail", `${failed} commitment(s) reverted on chain. Check that the epoch is hour-aligned and fully elapsed.`);
    return;
  }

  record(
    "chain_index",
    confirmed > 0 ? "pass" : "warn",
    confirmed > 0
      ? `${confirmed} commitment(s) confirmed on BOT Chain.`
      : `No confirmations yet (${numberField(indexBody, "stillPending")} still pending). Blocks may not have landed; re-run to index.`
  );
}

async function checkPublicSurfaces(baseUrl: string, scenario: Scenario): Promise<void> {
  const featured = scenario.zones.filter((zone) => approvedZones.has(zone.id)).slice(0, 4);
  if (featured.length === 0) {
    record("public_proof", "fail", "No zone reached an approved candidate, so there is no proof to serve.");
    return;
  }

  let withProof = 0;
  for (const zone of featured) {
    const response = await httpJson("GET", `${baseUrl}/api/v1/chain/proof/${zone.id}/latest`);
    if (response.status === 200 && recordOf(recordOf(response.body)?.epochScore)) withProof += 1;
  }

  record(
    "public_proof",
    withProof === featured.length ? "pass" : "fail",
    `${withProof}/${featured.length} featured zones serve a public proof at GET /api/v1/chain/proof/:zoneId/latest.`
  );

  await checkHistory(baseUrl, featured[0]);

  const alerts = await httpJson("GET", `${baseUrl}/api/v1/alerts`);
  const alertItems = Array.isArray(recordOf(alerts.body)?.alerts) ? (recordOf(alerts.body)?.alerts as unknown[]) : [];
  record(
    "public_alerts",
    alerts.status === 200 && alertItems.length > 0 ? "pass" : "fail",
    `GET /api/v1/alerts returns ${alertItems.length} alert(s) for the operations view.`
  );
}

async function checkHistory(baseUrl: string, zone: ScenarioZone | undefined): Promise<void> {
  if (!zone) return;

  const response = await httpJson("GET", `${baseUrl}/api/v1/zones/${zone.id}/history`);
  const body = recordOf(response.body);
  const candidates = Array.isArray(body?.candidates) ? body.candidates.length : 0;
  const epochScores = Array.isArray(body?.epochScores) ? body.epochScores.length : 0;

  record(
    "zone_history",
    response.status === 200 && candidates > 0 && epochScores > 0 ? "pass" : "fail",
    `${zone.discosFeederCode} history: ${candidates} candidate(s), ${epochScores} epoch score(s), trend ${describe(body?.trend)}.`
  );
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

type Options = {
  baseUrl: string;
  runOffsetSeconds: number;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    baseUrl: (process.env.GRIDPROOF_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    runOffsetSeconds: 0
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") {
      const value = argv[index + 1];
      if (!value) throw new Error("--base-url requires a URL");
      options.baseUrl = value.replace(/\/$/, "");
      index += 1;
    } else if (arg === "--run-offset") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isFinite(value)) throw new Error("--run-offset requires an integer number of seconds");
      options.runOffsetSeconds = value;
      index += 1;
    }
  }

  return options;
}

/**
 * Populate `process.env` from `apps/api/.env` without overriding what is already
 * set. The simulator has to derive the *same* HMAC and JWT secrets the API is
 * using, and `dotenv` is not resolvable from the repo root under pnpm.
 */
function loadApiEnv(): void {
  const envPath = resolve(process.cwd(), "apps/api/.env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    if (process.env[key] !== undefined) continue;

    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (value) process.env[key] = value;
  }
}

function telemetrySecret(): string {
  // When the API has no secret it skips verification outside production, so any
  // signature satisfies the `min(32)` schema check and the demo still runs.
  return process.env.TELEMETRY_HMAC_SECRET ?? "unsigned-local-demo";
}

/** Mirrors `jwtSecret()` in `auth/middleware.ts`, including its precedence. */
function jwtSecret(): string {
  return process.env.SUPABASE_JWT_SECRET ?? process.env.GRIDPROOF_DEV_JWT_SECRET ?? LOCAL_DEV_JWT_SECRET;
}

/**
 * Mint a session token directly rather than registering through `/auth/register`,
 * which gates the reviewer and admin roles behind `GRIDPROOF_AUTH_INVITE_CODE`.
 */
function mintToken(role: "reporter" | "reviewer" | "admin"): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({
    sub: simulatorUserId(role),
    email: `sim-${role}@gridproof.test`,
    iat: now,
    exp: now + 3600,
    app_metadata: { role }
  });
  const signature = createHmac("sha256", jwtSecret()).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** Fixed UUIDs so audit rows attribute every simulated action to the same actors. */
function simulatorUserId(role: "reporter" | "reviewer" | "admin"): string {
  const suffix = { reporter: "1", reviewer: "2", admin: "3" }[role];
  return `00000000-0000-4000-9000-00000000000${suffix}`;
}

function webhookHeaders(body: Record<string, unknown>): Record<string, string> {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!secret) return {};
  // Must be the HMAC of the exact bytes sent, so serialize once here and reuse.
  return { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex")}` };
}

async function httpJson(
  method: "GET" | "POST",
  url: string,
  body?: Record<string, unknown>,
  token?: string,
  extraHeaders: Record<string, string> = {}
): Promise<HttpResult> {
  const headers: Record<string, string> = { accept: "application/json", ...extraHeaders };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error pages are reported verbatim in the check detail.
  }

  return { status: response.status, body: parsed };
}

function decisionFor(confidence: number): "approve" | "escalate" | "reject" {
  if (confidence >= AUTO_APPROVE_THRESHOLD) return "approve";
  if (confidence >= ESCALATE_THRESHOLD) return "escalate";
  return "reject";
}

function readinessFailures(body: unknown): string[] {
  const raw = recordOf(body)?.checks;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((check) => recordOf(check)?.required === true && recordOf(check)?.status === "fail")
    .map((check) => stringField(check, "name") ?? "unknown");
}

function record(name: string, status: CheckStatus, detail: string): void {
  checks.push({ name, status, detail });
  console.log(`${icon(status)} ${name}: ${detail}`);
}

function printHeader(scenario: Scenario, baseUrl: string): void {
  console.log("GridProof hardware simulator");
  console.log(`  target        ${baseUrl}`);
  console.log(`  sealed epoch  ${scenario.sealedEpochStart.toISOString()} (elapsed, committable on chain)`);
  console.log(`  live band     last 11 minutes (escalations only, no commitments)`);
  console.log(`  events        ${scenario.events.length} across ${scenario.zones.length} zones / ${coveredDiscoCodes().length} DisCos\n`);
}

function printResults(): void {
  const passed = checks.filter((check) => check.status === "pass").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  console.log(`\nSummary: ${passed} passed, ${warnings} warning(s), ${failed} failed.`);
}

function printOperatorNotes(): void {
  console.log("\nNot covered by this run:");
  console.log("  - Heartbeat-gap detection is timer-driven (a sweep every 6 minutes) and has no");
  console.log("    HTTP trigger. Acts L5a/L5b open a 9-minute silence; leave the API running and");
  console.log("    the gap candidate appears in the review queue on the next sweep (~0.65).");
  console.log("  - Real firmware beats once a minute; this simulator sends one burst and stops.");
  console.log("    A few minutes after the run, every zone it touched trips the same 6-minute");
  console.log("    threshold and picks up a trailing open-gap candidate. That is the detector");
  console.log("    working against a silent field, not a fault in the scenario.");
  console.log("  - The reject *decision path* is reachable only through a reviewer, as exercised");
  console.log("    above. Telemetry alone cannot produce one: the detection ladder floors at 0.65,");
  console.log("    above the 0.5 auto-reject threshold.");
}

function icon(status: CheckStatus): string {
  if (status === "pass") return "✓";
  if (status === "warn") return "!";
  return "✗";
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringField(value: unknown, key: string): string | null {
  const field = recordOf(value)?.[key];
  return typeof field === "string" ? field : null;
}

function numberField(value: unknown, key: string): number {
  const field = recordOf(value)?.[key];
  return typeof field === "number" ? field : 0;
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
