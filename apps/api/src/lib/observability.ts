import * as Sentry from "@sentry/node";

type SentryRuntime = {
  init: (options: Parameters<typeof Sentry.init>[0]) => void;
  captureException: (error: unknown, hint?: { extra?: Record<string, unknown> }) => string;
};

export type ApiSentryConfig = {
  dsn: string;
  environment?: string;
  release?: string;
  tracesSampleRate: number;
};

let sentryInitialized = false;

export function initApiObservability(
  env: NodeJS.ProcessEnv = process.env,
  runtime: SentryRuntime = Sentry
): boolean {
  const config = sentryConfigFromEnv(env);
  if (!config) return false;

  runtime.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    sendDefaultPii: false
  });
  sentryInitialized = true;
  return true;
}

export function captureApiException(
  error: unknown,
  extra: Record<string, unknown> = {},
  runtime: SentryRuntime = Sentry
): boolean {
  if (!sentryInitialized) return false;
  runtime.captureException(error, { extra: redactSensitiveExtra(extra) });
  return true;
}

export function sentryConfigFromEnv(env: NodeJS.ProcessEnv): ApiSentryConfig | null {
  const dsn = firstNonEmpty(env.SENTRY_DSN, env.API_SENTRY_DSN);
  if (!dsn) return null;

  return {
    dsn,
    environment: firstNonEmpty(env.SENTRY_ENVIRONMENT, env.NODE_ENV),
    release: firstNonEmpty(env.SENTRY_RELEASE, env.API_VERSION),
    tracesSampleRate: fractionFromEnv(env.SENTRY_TRACES_SAMPLE_RATE, 0)
  };
}

export function resetApiObservabilityForTests(): void {
  sentryInitialized = false;
}

function redactSensitiveExtra(extra: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(extra).filter(([key]) => !/authorization|token|secret|private.?key|signature/i.test(key))
  );
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function fractionFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}
