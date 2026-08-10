/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProofExplorer } from "./ProofExplorer.js";
import { apiClient } from "../../lib/api-client.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    proof: vi.fn()
  }
}));

const proofMock = vi.mocked(apiClient.proof);

const epochScore = {
  id: "f2f0e092-c6a4-4745-88d3-a673523c444b",
  zoneId: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  epochStart: "2026-08-09T12:00:00.000Z",
  uptimeBps: 5000,
  evidenceHash: `0x${"e".repeat(64)}`,
  createdAt: "2026-08-09T12:01:00.000Z"
};

describe("ProofExplorer", () => {
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

  it("renders pending proof details returned by the API", async () => {
    proofMock.mockResolvedValue({ epochScore, commitment: null });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={[`/proof/${epochScore.zoneId}/latest`]}>
            <Routes>
              <Route element={<ProofExplorer />} path="/proof/:zoneId/:epoch" />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      );
    });

    expect(proofMock).toHaveBeenCalledWith(epochScore.zoneId, "latest");
    await waitFor(() => expect(container?.textContent).toContain("50.00%"));
    expect(container.textContent).toContain("50.00%");
    expect(container.textContent).toContain(epochScore.evidenceHash);
    expect(container.textContent).toContain("Waiting for BOT Chain transaction");
  });

  it("renders an honest empty state when the API has no proof for the requested zone", async () => {
    proofMock.mockResolvedValue({ epochScore: null, commitment: null });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={[`/proof/22222222-2222-4222-8222-222222222222/latest`]}>
            <Routes>
              <Route element={<ProofExplorer />} path="/proof/:zoneId/:epoch" />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      );
    });

    expect(proofMock).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", "latest");
    await waitFor(() => expect(container?.textContent).toContain("No epoch score has been committed off-chain"));
    expect(container.textContent).not.toContain(epochScore.evidenceHash);
  });
});

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  throw lastError;
}
