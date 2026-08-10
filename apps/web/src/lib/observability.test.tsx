import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ObservabilityErrorBoundary,
  captureWebException,
  initWebObservability,
  resetWebObservabilityForTests,
  sentryConfigFromEnv
} from "./observability.js";

describe("web observability", () => {
  afterEach(() => {
    resetWebObservabilityForTests();
  });

  it("stays disabled without a browser Sentry DSN", () => {
    const runtime = fakeRuntime();

    expect(initWebObservability({ MODE: "test" }, runtime)).toBe(false);
    expect(captureWebException(new Error("boom"), { route: "/" }, runtime)).toBe(false);
    expect(runtime.init).not.toHaveBeenCalled();
    expect(runtime.captureException).not.toHaveBeenCalled();
  });

  it("builds browser Sentry config from Vite env", () => {
    expect(
      sentryConfigFromEnv({
        VITE_SENTRY_DSN: "https://public@example.invalid/1",
        VITE_SENTRY_ENVIRONMENT: "preview",
        VITE_SENTRY_RELEASE: "gridproof-web@demo",
        VITE_SENTRY_TRACES_SAMPLE_RATE: "0.1"
      })
    ).toEqual({
      dsn: "https://public@example.invalid/1",
      environment: "preview",
      release: "gridproof-web@demo",
      tracesSampleRate: 0.1
    });
  });

  it("captures browser exceptions after initialization and redacts sensitive extras", () => {
    const runtime = fakeRuntime();
    const error = new Error("render failed");

    expect(initWebObservability({ VITE_SENTRY_DSN: "https://public@example.invalid/1" }, runtime)).toBe(true);
    expect(captureWebException(error, {
      route: "/review",
      token: "secret",
      signature: "abc"
    }, runtime)).toBe(true);

    expect(runtime.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: "https://public@example.invalid/1",
      sendDefaultPii: false,
      tracesSampleRate: 0
    }));
    expect(runtime.captureException).toHaveBeenCalledWith(error, {
      extra: {
        route: "/review"
      }
    });
  });

  it("renders children without a boundary when Sentry is disabled", () => {
    expect(renderToString(<ObservabilityErrorBoundary>GridProof</ObservabilityErrorBoundary>)).toContain("GridProof");
  });
});

function fakeRuntime() {
  return {
    init: vi.fn(),
    captureException: vi.fn(() => "event-id"),
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>
  };
}
