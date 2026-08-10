export type WorkerReadinessCheck = {
  name: string;
  status: "pass" | "fail";
  required: true;
  message: string;
  missingEnv: string[];
};

export type WorkerReadinessResponse = {
  ok: boolean;
  service: "gridproof-agent-worker";
  status: "ready" | "not_ready";
  timestamp: string;
  checks: WorkerReadinessCheck[];
};

export function workerReadinessSnapshot(
  env: NodeJS.ProcessEnv = process.env,
  workerReady = false,
  now = new Date()
): WorkerReadinessResponse {
  const checks: WorkerReadinessCheck[] = [
    runtimeCheck(workerReady),
    configuredCheck({
      name: "database",
      env,
      keys: ["DATABASE_URL"],
      passMessage: "Postgres/Supabase database URL is configured for agent context and persistence.",
      missingMessage: "DATABASE_URL is required so agent decisions, audit logs, epoch scores, and chain queue artifacts persist."
    }),
    configuredCheck({
      name: "redis_queue",
      env,
      keys: ["REDIS_URL"],
      passMessage: "Redis/Upstash URL is configured for BullMQ agent-review jobs.",
      missingMessage: "REDIS_URL is required; the worker cannot consume durable BullMQ jobs without it."
    }),
    configuredCheck({
      name: "llm_proxy",
      env,
      keys: ["LLM_BASE_URL", "LLM_API_KEY"],
      passMessage: "LLM proxy URL and API key are configured.",
      missingMessage: "LLM_BASE_URL and LLM_API_KEY are required for production AI review."
    }),
    configuredCheck({
      name: "llm_models",
      env,
      keys: ["LLM_ANALYSIS_MODEL", "LLM_VERIFICATION_MODEL"],
      passMessage: "Analysis and verification model names are configured.",
      missingMessage: "LLM_ANALYSIS_MODEL and LLM_VERIFICATION_MODEL should be explicit for reproducible demo behavior."
    })
  ];
  const ok = checks.every((check) => check.status === "pass");

  return {
    ok,
    service: "gridproof-agent-worker",
    status: ok ? "ready" : "not_ready",
    timestamp: now.toISOString(),
    checks
  };
}

function runtimeCheck(workerReady: boolean): WorkerReadinessCheck {
  return {
    name: "worker_runtime",
    status: workerReady ? "pass" : "fail",
    required: true,
    message: workerReady
      ? "BullMQ worker is running and marked ready."
      : "BullMQ worker is not marked ready; check Redis connectivity and worker startup logs.",
    missingEnv: []
  };
}

function configuredCheck(input: {
  name: string;
  env: NodeJS.ProcessEnv;
  keys: string[];
  passMessage: string;
  missingMessage: string;
}): WorkerReadinessCheck {
  const missingEnv = input.keys.filter((key) => !hasValue(input.env[key]));

  return {
    name: input.name,
    status: missingEnv.length === 0 ? "pass" : "fail",
    required: true,
    message: missingEnv.length === 0 ? input.passMessage : input.missingMessage,
    missingEnv
  };
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
