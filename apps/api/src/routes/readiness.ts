import type { ReadinessResponse } from "@gridproof/shared-types";
import { readinessResponseSchema } from "@gridproof/shared-types";

type ReadinessCheck = ReadinessResponse["checks"][number];

export function readinessSnapshot(env: NodeJS.ProcessEnv = process.env, now = new Date()): ReadinessResponse {
  const checks: ReadinessCheck[] = [
    corsCheck(env),
    databaseCheck(env),
    redisCheck(env),
    authCheck(env),
    evidenceModeCheck(env),
    telemetrySigningCheck(env),
    webhookSigningCheck(env),
    botChainRelayerCheck(env),
    notificationCheck(env),
    observabilityCheck(env)
  ];
  const status = checks.some((check) => check.status === "fail")
    ? "not_ready"
    : checks.some((check) => check.status === "warn")
      ? "degraded"
      : "ready";

  return readinessResponseSchema.parse({
    ok: status !== "not_ready",
    service: "gridproof-api",
    status,
    timestamp: now.toISOString(),
    checks
  });
}

function corsCheck(env: NodeJS.ProcessEnv): ReadinessCheck {
  const configured = hasValue(env.CORS_ORIGINS) || hasValue(env.CORS_ORIGIN);
  const required = env.NODE_ENV === "production";

  return {
    name: "browser_cors",
    status: configured ? "pass" : required ? "fail" : "warn",
    required,
    message: configured
      ? "Browser CORS origins are explicitly configured."
      : required
        ? "Production API requires CORS_ORIGINS to match deployed frontend origins."
        : "Using local-only CORS defaults; set CORS_ORIGINS before deployment.",
    missingEnv: configured ? [] : ["CORS_ORIGINS"]
  };
}

function databaseCheck(env: NodeJS.ProcessEnv): ReadinessCheck {
  return configuredCheck({
    name: "database",
    env,
    keys: ["DATABASE_URL"],
    required: true,
    passMessage: "Postgres/Supabase database URL is configured.",
    missingMessage: "DATABASE_URL is required for durable evidence, reviews, proofs, audits, and demo seed data."
  });
}

function redisCheck(env: NodeJS.ProcessEnv): ReadinessCheck {
  return configuredCheck({
    name: "redis_queue_and_rate_limits",
    env,
    keys: ["REDIS_URL"],
    required: true,
    passMessage: "Redis/Upstash URL is configured for queues and distributed rate limits.",
    missingMessage: "REDIS_URL is required for durable agent queues and deployment-safe rate limiting."
  });
}

function authCheck(env: NodeJS.ProcessEnv): ReadinessCheck {
  return configuredCheck({
    name: "auth",
    env,
    keys: ["SUPABASE_JWT_SECRET", "GRIDPROOF_AUTH_INVITE_CODE"],
    required: true,
    passMessage: "JWT verification and reviewer/admin invite configuration are present.",
    missingMessage: "SUPABASE_JWT_SECRET and GRIDPROOF_AUTH_INVITE_CODE are required for production RBAC."
  });
}

function evidenceModeCheck(env: NodeJS.ProcessEnv): ReadinessCheck {
  const mode = evidenceMode(env);
  if (mode) {
    return {
      name: "evidence_mode",
      status: "pass",
      required: true,
      message: `GRIDPROOF_EVIDENCE_MODE is valid (${mode}).`,
      missingEnv: []
    };
  }

  const raw = env.GRIDPROOF_EVIDENCE_MODE?.trim();
  return {
    name: "evidence_mode",
    status: raw ? "fail" : "warn",
    required: true,
    message: raw
      ? "GRIDPROOF_EVIDENCE_MODE must be one of sensor, reporter, or hybrid."
      : "GRIDPROOF_EVIDENCE_MODE is not set; API will default to hybrid.",
    missingEnv: raw ? [] : ["GRIDPROOF_EVIDENCE_MODE"]
  };
}

function telemetrySigningCheck(env: NodeJS.ProcessEnv): ReadinessCheck {
  const mode = evidenceMode(env) ?? "hybrid";
  return configuredCheck({
    name: "sensor_ingestion_signing",
    env,
    keys: ["TELEMETRY_HMAC_SECRET"],
    required: mode === "sensor" || mode === "hybrid",
    passMessage: "Sensor telemetry HMAC signing secret is configured.",
    missingMessage:
      mode === "reporter"
        ? "Sensor mode is disabled; telemetry HMAC secret is optional for this deployment."
        : "TELEMETRY_HMAC_SECRET is required before accepting production sensor telemetry."
  });
}

function webhookSigningCheck(env: NodeJS.ProcessEnv): ReadinessCheck {
  const mode = evidenceMode(env) ?? "hybrid";
  return configuredCheck({
    name: "whatsapp_webhook_signing",
    env,
    keys: ["WHATSAPP_WEBHOOK_SECRET"],
    required: mode === "reporter" || mode === "hybrid",
    passMessage: "WhatsApp webhook HMAC signing secret is configured.",
    missingMessage:
      mode === "sensor"
        ? "Reporter mode is disabled; WhatsApp webhook secret is optional for this deployment."
        : "WHATSAPP_WEBHOOK_SECRET is required before accepting production webhook reporter evidence."
  });
}

function botChainRelayerCheck(env: NodeJS.ProcessEnv): ReadinessCheck {
  return configuredCheck({
    name: "bot_chain_relayer",
    env,
    keys: [
      "BOTCHAIN_RPC_URL",
      "BOTCHAIN_CHAIN_ID",
      "BOTCHAIN_EXPLORER_BASE_URL",
      "BOTCHAIN_NODE_REGISTRY_ADDRESS",
      "BOTCHAIN_UPTIME_ATTESTATION_ADDRESS",
      "BOTCHAIN_REPUTATION_ESCROW_ADDRESS",
      "RELAYER_PRIVATE_KEY"
    ],
    required: true,
    passMessage: "BOT Chain RPC, contract addresses, explorer URL, and relayer key are configured.",
    missingMessage: "BOT Chain relayer configuration is incomplete; on-chain proof submission cannot run."
  });
}

function notificationCheck(env: NodeJS.ProcessEnv): ReadinessCheck {
  return configuredCheck({
    name: "notifications",
    env,
    keys: ["NOTIFICATION_WEBHOOK_URL"],
    required: false,
    passMessage: "Notification webhook is configured.",
    missingMessage: "Notification webhook is not configured; notifications will remain in the local outbox."
  });
}

function observabilityCheck(env: NodeJS.ProcessEnv): ReadinessCheck {
  return configuredCheck({
    name: "observability",
    env,
    keys: ["SENTRY_DSN"],
    required: false,
    passMessage: "Sentry error tracking is configured.",
    missingMessage: "Sentry DSN is not configured; rely on platform logs and /metrics during the demo."
  });
}

function configuredCheck(input: {
  name: string;
  env: NodeJS.ProcessEnv;
  keys: string[];
  required: boolean;
  passMessage: string;
  missingMessage: string;
}): ReadinessCheck {
  const missingEnv = input.keys.filter((key) => !hasValue(input.env[key]));
  const configured = missingEnv.length === 0;

  return {
    name: input.name,
    status: configured ? "pass" : input.required ? "fail" : "warn",
    required: input.required,
    message: configured ? input.passMessage : input.missingMessage,
    missingEnv
  };
}

function evidenceMode(env: NodeJS.ProcessEnv): "sensor" | "reporter" | "hybrid" | null {
  const raw = env.GRIDPROOF_EVIDENCE_MODE?.trim().toLowerCase();
  if (!raw) return "hybrid";
  if (raw === "sensor" || raw === "reporter" || raw === "hybrid") return raw;
  return null;
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
