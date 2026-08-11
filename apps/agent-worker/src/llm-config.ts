import type { LlmClientOptions } from "@gridproof/ai";

export const DEFAULT_LLM_BASE_URL = "http://localhost:3001";
export const DEFAULT_LLM_TIMEOUT_MS = 20_000;

/**
 * Placeholder model names that ship as code defaults. They match nothing in a
 * FreeLLMAPI catalog, so a request using them fails at the router.
 */
export const PLACEHOLDER_MODELS = ["fast-free-model", "strong-free-model"] as const;

export type LlmConfigIssue = {
  env: string;
  message: string;
};

export type LlmConfig = {
  analysis: LlmClientOptions;
  verification: LlmClientOptions;
  issues: LlmConfigIssue[];
};

/**
 * Normalises a router root for `@gridproof/ai`, which appends
 * `/v1/chat/completions` itself. A `LLM_BASE_URL` ending in `/v1` would
 * otherwise produce `/v1/v1/chat/completions` and a 404, so drop it here:
 * FreeLLMAPI's docs show `/v1` for OpenAI-SDK use, and copying that value
 * across should not break the worker.
 */
export function normalizeLlmBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function parseTimeoutMs(raw: string | undefined, issues: LlmConfigIssue[]): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_LLM_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    issues.push({
      env: "LLM_TIMEOUT_MS",
      message: `LLM_TIMEOUT_MS must be a positive number of milliseconds, got "${raw}". Falling back to ${DEFAULT_LLM_TIMEOUT_MS}.`
    });
    return DEFAULT_LLM_TIMEOUT_MS;
  }

  return parsed;
}

function resolveModel(
  envKey: "LLM_ANALYSIS_MODEL" | "LLM_VERIFICATION_MODEL",
  raw: string | undefined,
  issues: LlmConfigIssue[]
): string {
  const model = raw?.trim() ?? "";

  if (model === "") {
    issues.push({
      env: envKey,
      message: `${envKey} is not set. Pin a concrete model ID from your router's catalog (GET /v1/models) so demo runs are reproducible.`
    });
    return "";
  }

  if ((PLACEHOLDER_MODELS as readonly string[]).includes(model)) {
    issues.push({
      env: envKey,
      message: `${envKey}="${model}" is a placeholder from the code defaults, not a real model. Replace it with an ID your router actually serves.`
    });
  }

  return model;
}

export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const issues: LlmConfigIssue[] = [];

  const rawBaseUrl = env.LLM_BASE_URL?.trim() ?? "";
  const baseUrl = rawBaseUrl === "" ? DEFAULT_LLM_BASE_URL : normalizeLlmBaseUrl(rawBaseUrl);
  if (rawBaseUrl === "") {
    issues.push({
      env: "LLM_BASE_URL",
      message: `LLM_BASE_URL is not set; defaulting to ${DEFAULT_LLM_BASE_URL}.`
    });
  } else if (baseUrl !== rawBaseUrl.replace(/\/+$/, "")) {
    issues.push({
      env: "LLM_BASE_URL",
      message: `LLM_BASE_URL ended in "/v1"; using "${baseUrl}" because the client appends /v1/chat/completions itself.`
    });
  }

  const apiKey = env.LLM_API_KEY?.trim() ?? "";
  if (apiKey === "") {
    issues.push({
      env: "LLM_API_KEY",
      message: "LLM_API_KEY is not set. Use the single unified key from the FreeLLMAPI dashboard, not an upstream provider key."
    });
  }

  const timeoutMs = parseTimeoutMs(env.LLM_TIMEOUT_MS, issues);

  const analysis: LlmClientOptions = {
    baseUrl,
    apiKey,
    model: resolveModel("LLM_ANALYSIS_MODEL", env.LLM_ANALYSIS_MODEL, issues),
    timeoutMs
  };

  return {
    analysis,
    verification: {
      ...analysis,
      model: resolveModel("LLM_VERIFICATION_MODEL", env.LLM_VERIFICATION_MODEL, issues)
    },
    issues
  };
}
