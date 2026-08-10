import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureApiException,
  initApiObservability,
  resetApiObservabilityForTests,
  sentryConfigFromEnv
} from "./observability.js";

describe("API observability", () => {
  afterEach(() => {
    resetApiObservabilityForTests();
  });

  it("stays disabled without a Sentry DSN", () => {
    const runtime = fakeRuntime();

    expect(initApiObservability({ NODE_ENV: "test" }, runtime)).toBe(false);
    expect(captureApiException(new Error("boom"), { path: "/api/v1/health" }, runtime)).toBe(false);
    expect(runtime.init).not.toHaveBeenCalled();
    expect(runtime.captureException).not.toHaveBeenCalled();
  });

  it("builds privacy-conscious Sentry config from env", () => {
    expect(
      sentryConfigFromEnv({
        SENTRY_DSN: "https://public@example.invalid/1",
        SENTRY_ENVIRONMENT: "staging",
        SENTRY_RELEASE: "gridproof@demo",
        SENTRY_TRACES_SAMPLE_RATE: "0.25"
      })
    ).toEqual({
      dsn: "https://public@example.invalid/1",
      environment: "staging",
      release: "gridproof@demo",
      tracesSampleRate: 0.25
    });
  });

  it("captures server exceptions after initialization and redacts sensitive extras", () => {
    const runtime = fakeRuntime();
    const error = new Error("database unavailable");

    expect(initApiObservability({ SENTRY_DSN: "https://public@example.invalid/1" }, runtime)).toBe(true);
    expect(captureApiException(error, {
      path: "/api/v1/chain/submit-pending",
      authorization: "Bearer secret",
      relayerPrivateKey: "0x123",
      signature: "abc"
    }, runtime)).toBe(true);

    expect(runtime.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: "https://public@example.invalid/1",
      sendDefaultPii: false,
      tracesSampleRate: 0
    }));
    expect(runtime.captureException).toHaveBeenCalledWith(error, {
      extra: {
        path: "/api/v1/chain/submit-pending"
      }
    });
  });
});

function fakeRuntime() {
  return {
    init: vi.fn(),
    captureException: vi.fn(() => "event-id")
  };
}
