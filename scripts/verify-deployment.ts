type CheckStatus = "pass" | "warn" | "fail";

export type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
};

type DeploymentVerifierOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

type DeploymentVerifierConfig = {
  apiBaseUrl: string;
  webUrl: string | null;
  workerBaseUrl: string | null;
  proofZoneId: string | null;
  proofEpoch: string;
  requireConfirmedProof: boolean;
  timeoutMs: number;
  allowDegradedReadiness: boolean;
  fetchImpl: typeof fetch;
};

async function main(): Promise<void> {
  const checks = await verifyDeployment();
  printResults(checks);

  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}

export async function verifyDeployment(options: DeploymentVerifierOptions = {}): Promise<CheckResult[]> {
  const config = deploymentConfigFromEnv(options.env ?? process.env, options.fetchImpl ?? fetch);
  const { apiBaseUrl, webUrl, workerBaseUrl, proofZoneId, proofEpoch } = config;

  const checks: CheckResult[] = [];
  checks.push(await checkJson(config, `${apiBaseUrl}/health`, "api_health", isApiHealth));
  checks.push(await checkJson(config, `${apiBaseUrl}/metrics`, "api_metrics", isApiMetrics));
  checks.push(await checkReadiness(config, `${apiBaseUrl}/readiness`));
  checks.push(await checkJson(config, `${apiBaseUrl}/zones`, "api_zones", isZonesResponse));
  checks.push(await checkJson(config, `${apiBaseUrl}/providers`, "api_providers", isProvidersResponse));

  if (proofZoneId) {
    checks.push(await checkProof(config, `${apiBaseUrl}/chain/proof/${encodeURIComponent(proofZoneId)}/${encodeURIComponent(proofEpoch)}`));
  } else {
    checks.push({
      name: "api_proof",
      status: "warn",
      detail: "GRIDPROOF_PROOF_ZONE_ID is not set; skipping deployed proof smoke check."
    });
  }

  if (webUrl) {
    checks.push(await checkWeb(config, webUrl));
  } else {
    checks.push({
      name: "web_url",
      status: "warn",
      detail: "GRIDPROOF_WEB_URL is not set; skipping public frontend smoke check."
    });
  }

  if (workerBaseUrl) {
    checks.push(await checkJson(config, `${workerBaseUrl}/health`, "worker_health", isWorkerHealth));
    checks.push(await checkWorkerReadiness(config, `${workerBaseUrl}/readiness`));
  } else {
    checks.push({
      name: "worker_health",
      status: "warn",
      detail: "GRIDPROOF_WORKER_BASE_URL is not set; skipping agent-worker health/readiness checks."
    });
  }

  return checks;
}

function deploymentConfigFromEnv(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): DeploymentVerifierConfig {
  return {
    apiBaseUrl: apiBaseUrlFromEnv(env),
    webUrl: optionalUrl(env, "GRIDPROOF_WEB_URL"),
    workerBaseUrl: optionalUrl(env, "GRIDPROOF_WORKER_BASE_URL"),
    proofZoneId: optionalString(env, "GRIDPROOF_PROOF_ZONE_ID"),
    proofEpoch: optionalString(env, "GRIDPROOF_PROOF_EPOCH") ?? "latest",
    requireConfirmedProof: booleanEnv(env, "GRIDPROOF_REQUIRE_CONFIRMED_PROOF"),
    timeoutMs: numberEnv(env, "GRIDPROOF_DEPLOYMENT_VERIFY_TIMEOUT_MS", 10_000),
    allowDegradedReadiness: booleanEnv(env, "GRIDPROOF_ALLOW_DEGRADED_READINESS"),
    fetchImpl
  };
}

function apiBaseUrlFromEnv(env: NodeJS.ProcessEnv): string {
  const raw = requiredUrl(env, "GRIDPROOF_API_BASE_URL");
  return raw.endsWith("/api/v1") ? raw : `${raw}/api/v1`;
}

async function checkJson(
  config: DeploymentVerifierConfig,
  url: string,
  name: string,
  predicate: (value: unknown) => string | null
): Promise<CheckResult> {
  try {
    const response = await fetchWithTimeout(config, url);
    const value = await response.json() as unknown;
    const error = predicate(value);

    if (!response.ok) {
      return {
        name,
        status: "fail",
        detail: `Expected 2xx but received HTTP ${response.status}.`
      };
    }

    return error
      ? { name, status: "fail", detail: error }
      : { name, status: "pass", detail: `HTTP ${response.status}; response shape is valid.` };
  } catch (error) {
    return { name, status: "fail", detail: errorMessage(error) };
  }
}

async function checkProof(config: DeploymentVerifierConfig, url: string): Promise<CheckResult> {
  try {
    const response = await fetchWithTimeout(config, url);
    const value = await response.json() as unknown;
    const shapeError = isProofResponse(value);
    if (shapeError) return { name: "api_proof", status: "fail", detail: shapeError };

    if (!response.ok) {
      return { name: "api_proof", status: "fail", detail: `Expected 2xx but received HTTP ${response.status}.` };
    }

    const proof = value as {
      epochScore: {
        epochStart: string;
        uptimeBps: number;
        evidenceHash: string;
      } | null;
      commitment: {
        status: "pending" | "confirmed" | "failed";
        txHash: string | null;
        blockNumber: number | null;
        explorerUrl: string | null;
      } | null;
    };

    if (!proof.epochScore) {
      return { name: "api_proof", status: "fail", detail: "Proof response does not include an epoch score." };
    }

    if (!proof.commitment) {
      return { name: "api_proof", status: "fail", detail: "Proof response does not include a chain commitment." };
    }

    if (config.requireConfirmedProof && proof.commitment.status !== "confirmed") {
      return {
        name: "api_proof",
        status: "fail",
        detail: `Expected a confirmed BOT Chain proof but commitment is ${proof.commitment.status}.`
      };
    }

    if (proof.commitment.status === "confirmed") {
      if (!proof.commitment.txHash) return { name: "api_proof", status: "fail", detail: "Confirmed proof is missing txHash." };
      if (proof.commitment.blockNumber === null) return { name: "api_proof", status: "fail", detail: "Confirmed proof is missing blockNumber." };
      if (!proof.commitment.explorerUrl) return { name: "api_proof", status: "fail", detail: "Confirmed proof is missing explorerUrl." };
      return {
        name: "api_proof",
        status: "pass",
        detail: `Confirmed proof for epoch ${proof.epochScore.epochStart}; uptime ${proof.epochScore.uptimeBps} bps.`
      };
    }

    if (proof.commitment.status === "pending") {
      return {
        name: "api_proof",
        status: config.requireConfirmedProof ? "fail" : "pass",
        detail: `Pending proof for epoch ${proof.epochScore.epochStart}; confirmed transaction not required for this run.`
      };
    }

    return { name: "api_proof", status: "fail", detail: "Proof commitment is failed." };
  } catch (error) {
    return { name: "api_proof", status: "fail", detail: errorMessage(error) };
  }
}

async function checkReadiness(config: DeploymentVerifierConfig, url: string): Promise<CheckResult> {
  try {
    const response = await fetchWithTimeout(config, url);
    const value = await response.json() as unknown;
    const shapeError = isReadiness(value);
    if (shapeError) return { name: "api_readiness", status: "fail", detail: shapeError };

    const readiness = value as { status: "ready" | "degraded" | "not_ready"; checks: Array<{ name: string; status: string; missingEnv?: string[] }> };
    if (readiness.status === "ready" && response.ok) {
      return { name: "api_readiness", status: "pass", detail: "Deployment readiness is ready." };
    }

    const failingChecks = readiness.checks
      .filter((check) => check.status !== "pass")
      .map((check) => {
        const missing = check.missingEnv?.length ? ` missing ${check.missingEnv.join(", ")}` : "";
        return `${check.name}:${check.status}${missing}`;
      });
    const detail = `Readiness is ${readiness.status}${failingChecks.length ? ` (${failingChecks.join("; ")})` : ""}.`;

    if (readiness.status === "degraded" && config.allowDegradedReadiness) {
      return { name: "api_readiness", status: "warn", detail };
    }

    return { name: "api_readiness", status: "fail", detail };
  } catch (error) {
    return { name: "api_readiness", status: "fail", detail: errorMessage(error) };
  }
}

async function checkWorkerReadiness(config: DeploymentVerifierConfig, url: string): Promise<CheckResult> {
  try {
    const response = await fetchWithTimeout(config, url);
    const value = await response.json() as unknown;
    const shapeError = isServiceReadiness(value, "gridproof-agent-worker");
    if (shapeError) return { name: "worker_readiness", status: "fail", detail: shapeError };

    const readiness = value as { status: "ready" | "degraded" | "not_ready"; checks: Array<{ name: string; status: string; missingEnv?: string[] }> };
    if (readiness.status === "ready" && response.ok) {
      return { name: "worker_readiness", status: "pass", detail: "Agent worker readiness is ready." };
    }

    const failingChecks = readiness.checks
      .filter((check) => check.status !== "pass")
      .map((check) => {
        const missing = check.missingEnv?.length ? ` missing ${check.missingEnv.join(", ")}` : "";
        return `${check.name}:${check.status}${missing}`;
      });
    const detail = `Worker readiness is ${readiness.status}${failingChecks.length ? ` (${failingChecks.join("; ")})` : ""}.`;

    if (readiness.status === "degraded" && config.allowDegradedReadiness) {
      return { name: "worker_readiness", status: "warn", detail };
    }

    return { name: "worker_readiness", status: "fail", detail };
  } catch (error) {
    return { name: "worker_readiness", status: "fail", detail: errorMessage(error) };
  }
}

async function checkWeb(config: DeploymentVerifierConfig, url: string): Promise<CheckResult> {
  try {
    const response = await fetchWithTimeout(config, url);
    const html = await response.text();
    if (!response.ok) {
      return { name: "web_frontend", status: "fail", detail: `Expected 2xx but received HTTP ${response.status}.` };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return { name: "web_frontend", status: "fail", detail: `Expected HTML but received content-type ${contentType || "unknown"}.` };
    }

    if (!html.includes("<div id=\"root\"")) {
      return { name: "web_frontend", status: "fail", detail: "HTML does not look like the GridProof Vite app shell." };
    }

    if (html.includes("localhost:4000")) {
      return { name: "web_frontend", status: "fail", detail: "Frontend HTML references localhost API configuration." };
    }

    return { name: "web_frontend", status: "pass", detail: `HTTP ${response.status}; Vite app shell loaded.` };
  } catch (error) {
    return { name: "web_frontend", status: "fail", detail: errorMessage(error) };
  }
}

async function fetchWithTimeout(config: DeploymentVerifierConfig, url: string): Promise<Response> {
  return config.fetchImpl(url, {
    headers: {
      accept: "application/json,text/html;q=0.9,*/*;q=0.1",
      "user-agent": "gridproof-deployment-verifier/0.1.0"
    },
    signal: AbortSignal.timeout(config.timeoutMs)
  });
}

function isApiHealth(value: unknown): string | null {
  const record = objectRecord(value);
  if (!record) return "Health response must be an object.";
  if (record.ok !== true) return "Health response ok must be true.";
  if (record.service !== "gridproof-api") return "Health response service must be gridproof-api.";
  if (typeof record.timestamp !== "string") return "Health response timestamp must be a string.";
  return null;
}

function isApiMetrics(value: unknown): string | null {
  const record = objectRecord(value);
  const counters = objectRecord(record?.counters);
  if (!record || !counters) return "Metrics response must include counters.";
  for (const key of ["evidenceIngested", "candidatesDetected", "agentDecisions", "chainSubmissions", "failures"]) {
    if (typeof counters[key] !== "number") return `Metrics counter ${key} must be a number.`;
  }
  return null;
}

function isReadiness(value: unknown): string | null {
  return isServiceReadiness(value, "gridproof-api");
}

function isServiceReadiness(value: unknown, service: "gridproof-api" | "gridproof-agent-worker"): string | null {
  const record = objectRecord(value);
  if (!record) return "Readiness response must be an object.";
  if (record.service !== service) return `Readiness response service must be ${service}.`;
  if (record.status !== "ready" && record.status !== "degraded" && record.status !== "not_ready") {
    return "Readiness status must be ready, degraded, or not_ready.";
  }
  if (!Array.isArray(record.checks)) return "Readiness response must include checks.";
  return null;
}

function isZonesResponse(value: unknown): string | null {
  const record = objectRecord(value);
  return Array.isArray(record?.zones) ? null : "Zones response must include a zones array.";
}

function isProvidersResponse(value: unknown): string | null {
  const record = objectRecord(value);
  return Array.isArray(record?.providers) ? null : "Providers response must include a providers array.";
}

function isProofResponse(value: unknown): string | null {
  const record = objectRecord(value);
  if (!record) return "Proof response must be an object.";
  if (record.epochScore !== null) {
    const epochScore = objectRecord(record.epochScore);
    if (!epochScore) return "Proof epochScore must be an object or null.";
    if (typeof epochScore.epochStart !== "string") return "Proof epochScore.epochStart must be a string.";
    if (typeof epochScore.uptimeBps !== "number") return "Proof epochScore.uptimeBps must be a number.";
    if (!isBytes32(epochScore.evidenceHash)) return "Proof epochScore.evidenceHash must be a bytes32 value.";
  }

  if (record.commitment !== null) {
    const commitment = objectRecord(record.commitment);
    if (!commitment) return "Proof commitment must be an object or null.";
    if (commitment.status !== "pending" && commitment.status !== "confirmed" && commitment.status !== "failed") {
      return "Proof commitment.status must be pending, confirmed, or failed.";
    }
    if (commitment.txHash !== null && !isTxHash(commitment.txHash)) return "Proof commitment.txHash must be a transaction hash or null.";
    if (commitment.blockNumber !== null && typeof commitment.blockNumber !== "number") {
      return "Proof commitment.blockNumber must be a number or null.";
    }
    if (commitment.explorerUrl !== null && typeof commitment.explorerUrl !== "string") {
      return "Proof commitment.explorerUrl must be a URL string or null.";
    }
  }

  return null;
}

function isWorkerHealth(value: unknown): string | null {
  const record = objectRecord(value);
  if (!record) return "Worker health response must be an object.";
  if (record.ok !== true) return "Worker health response ok must be true.";
  if (record.service !== "gridproof-agent-worker") return "Worker health service must be gridproof-agent-worker.";
  return null;
}

function printResults(checks: CheckResult[]): void {
  console.log("GridProof deployment verification");
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

function requiredUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = normalizeBaseUrl(env[name]);
  if (!value) {
    throw new Error(`${name} is required. Example: ${name}=https://gridproof-api.example.com pnpm deployment:verify`);
  }
  return value;
}

function optionalUrl(env: NodeJS.ProcessEnv, name: string): string | null {
  return normalizeBaseUrl(env[name]);
}

function optionalString(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }
}

function numberEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  return env[name]?.trim().toLowerCase() === "true";
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isBytes32(value: unknown): boolean {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isTxHash(value: unknown): boolean {
  return isBytes32(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const invokedScript = process.argv[1]?.replace(/\\/g, "/");

if (invokedScript?.endsWith("/verify-deployment.ts") || invokedScript?.endsWith("/verify-deployment.js")) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
