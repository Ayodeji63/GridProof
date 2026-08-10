/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/api-client.js";
import { OperationsHealth } from "./OperationsHealth.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    health: vi.fn(),
    metrics: vi.fn(),
    readiness: vi.fn()
  }
}));

const healthMock = vi.mocked(apiClient.health);
const metricsMock = vi.mocked(apiClient.metrics);
const readinessMock = vi.mocked(apiClient.readiness);

describe("OperationsHealth", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  it("renders API health and pipeline counters", async () => {
    healthMock.mockResolvedValue({
      ok: true,
      service: "gridproof-api",
      version: "0.1.0",
      timestamp: "2026-08-09T12:00:00.000Z"
    });
    metricsMock.mockResolvedValue({
      uptimeSeconds: 3725,
      counters: {
        evidenceIngested: 5,
        candidatesDetected: 3,
        agentDecisions: 2,
        chainSubmissions: 1,
        failures: 0
      }
    });
    readinessMock.mockResolvedValue({
      ok: true,
      service: "gridproof-api",
      status: "ready",
      timestamp: "2026-08-09T12:00:00.000Z",
      checks: [
        {
          name: "database",
          status: "pass",
          required: true,
          message: "Postgres/Supabase database URL is configured.",
          missingEnv: []
        },
        {
          name: "bot_chain_relayer",
          status: "pass",
          required: true,
          message: "BOT Chain RPC, contract addresses, explorer URL, and relayer key are configured.",
          missingEnv: []
        }
      ]
    });

    container = renderOperationsHealth();

    await waitFor(() => expect(container?.textContent).toContain("API healthy"));

    expect(container.textContent).toContain("gridproof-api");
    expect(container.textContent).toContain("1h 2m");
    expect(container.textContent).toContain("Evidence ingested5");
    expect(container.textContent).toContain("Candidates detected3");
    expect(container.textContent).toContain("Readinessready");
    expect(container.textContent).toContain("Bot Chain Relayer");
    expect(container.textContent).toContain("No failures reported");
  });

  it("renders endpoint error states", async () => {
    healthMock.mockRejectedValue(new Error("health unavailable"));
    metricsMock.mockRejectedValue(new Error("metrics unavailable"));
    readinessMock.mockRejectedValue(new Error("readiness unavailable"));

    container = renderOperationsHealth();

    await waitFor(() => expect(container?.textContent).toContain("API unavailable"));

    expect(container.textContent).toContain("Could not load API health.");
    expect(container.textContent).toContain("Could not load API metrics.");
    expect(container.textContent).toContain("Could not load deployment readiness.");
  });

  function renderOperationsHealth(): HTMLDivElement {
    const element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);

    act(() => {
      root?.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <OperationsHealth />
        </QueryClientProvider>
      );
    });

    return element;
  }
});

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }
  }

  throw lastError;
}
