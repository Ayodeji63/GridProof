/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/api-client.js";
import { connectInjectedWallet, signWalletMessage } from "../../lib/wallet.js";
import { DemoLab } from "./DemoLab.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    zones: vi.fn(),
    demoWalletChallenge: vi.fn(),
    runDemoSimulation: vi.fn(),
    demoSimulation: vi.fn()
  }
}));

vi.mock("../../lib/wallet.js", () => ({
  connectInjectedWallet: vi.fn(),
  signWalletMessage: vi.fn()
}));

const wallet = "0x1111111111111111111111111111111111111111";
const zone = {
  id: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  zoneKey: `0x${"a".repeat(64)}`,
  name: "Akure Feeder A",
  discosFeederCode: "BEDC-AKR-01",
  region: "South West",
  centroid: { lat: 7.25, lng: 5.19 },
  latestStatus: "grid_up" as const,
  latestUptimeBps: 9500,
  uptimeBps: 9500,
  darBps: 9200,
  latestVoltage: 10_700,
  latestCurrentAmps: 42,
  hasVoltageTelemetry: true,
  hasCurrentTelemetry: true
};

const simulation = {
  id: "00000000-0000-4000-8000-000000000020",
  initiatedBy: wallet,
  scenario: "ambiguous_outage" as const,
  zoneId: zone.id,
  createdAt: "2026-08-13T12:00:00.000Z",
  stage: "ai_queued" as const,
  telemetry: {
    evidenceId: "00000000-0000-4000-8000-000000000021",
    deviceId: "gridproof-judge-lab-01",
    status: "grid_down" as const,
    voltage: 72,
    currentAmps: 3.2,
    observedAt: "2026-08-13T12:00:00.000Z"
  },
  candidate: {
    id: "00000000-0000-4000-8000-000000000022",
    status: "outage" as const,
    confidence: 0.72
  },
  policyDecision: {
    agentName: "evidence-verification-agent",
    decision: "escalate" as const,
    confidence: 0.72,
    hypothesis: "Candidate outage requires additional verification.",
    createdAt: "2026-08-13T12:00:00.000Z"
  },
  aiDecision: null,
  agentState: "queued" as const,
  chain: { mode: "preview" as const, status: "not_requested" as const, txHash: null, explorerUrl: null }
};

describe("DemoLab", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  it("connects a wallet, signs one run, and renders the live AI pipeline", async () => {
    vi.mocked(apiClient.zones).mockResolvedValue({ zones: [zone] });
    vi.mocked(connectInjectedWallet).mockResolvedValue(wallet);
    vi.mocked(apiClient.demoWalletChallenge).mockResolvedValue({
      nonce: "00000000-0000-4000-8000-000000000023",
      message: "Authorize GridProof demo",
      expiresAt: "2026-08-13T12:05:00.000Z"
    });
    vi.mocked(signWalletMessage).mockResolvedValue(`0x${"f".repeat(130)}`);
    vi.mocked(apiClient.runDemoSimulation).mockResolvedValue({ simulation });
    vi.mocked(apiClient.demoSimulation).mockResolvedValue({ simulation });

    container = renderDemoLab();
    await waitFor(() => expect(container?.textContent).toContain("BEDC-AKR-01"));

    act(() => buttonByText(container!, "Connect wallet").click());
    await waitFor(() => expect(container?.textContent).toContain("0x1111…1111"));

    act(() => buttonByText(container!, "Run this simulation").click());
    await waitFor(() => expect(container?.textContent).toContain("AI processing"));

    expect(apiClient.demoWalletChallenge).toHaveBeenCalledWith({ walletAddress: wallet });
    expect(signWalletMessage).toHaveBeenCalledWith(wallet, "Authorize GridProof demo");
    expect(container.textContent).toContain("72 V");
    expect(container.textContent).toContain("Candidate outage requires additional verification.");
    expect(container.textContent).toContain("queued for the anomaly-analysis and evidence-verification agents");
  });

  function renderDemoLab(): HTMLDivElement {
    const element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);
    act(() => {
      root?.render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <DemoLab />
          </QueryClientProvider>
        </MemoryRouter>
      );
    });
    return element;
  }
});

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    }
  }
  throw lastError;
}
