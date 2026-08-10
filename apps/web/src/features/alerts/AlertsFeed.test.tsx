/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/api-client.js";
import { AlertsFeed } from "./AlertsFeed.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    alerts: vi.fn()
  }
}));

const alertsMock = vi.mocked(apiClient.alerts);
const alert = {
  id: "4f80f256-d4a8-4e51-8d58-ff7b8a605fd2",
  candidateEventId: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
  zoneId: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  status: "outage" as const,
  confidence: 0.95,
  decision: "approve" as const,
  hypothesis: "Candidate outage passed deterministic confidence threshold.",
  supportingEvidenceIds: ["6a670093-7823-44e1-80e4-ac608f9e75bd"],
  createdAt: "2026-08-09T12:03:00.000Z",
  candidateCreatedAt: "2026-08-09T12:02:00.000Z"
};

describe("AlertsFeed", () => {
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

  it("renders public alert details and proof links", async () => {
    alertsMock.mockResolvedValue({ alerts: [alert] });

    container = renderAlertsFeed();

    await waitFor(() => expect(container?.textContent).toContain("Possible outage"));

    expect(container.textContent).toContain("95% confidence");
    expect(container.textContent).toContain(alert.hypothesis);
    expect(container.textContent).toContain(alert.supportingEvidenceIds[0]);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(`/proof/${alert.zoneId}/latest`);
  });

  it("renders an empty state when no public alerts exist", async () => {
    alertsMock.mockResolvedValue({ alerts: [] });

    container = renderAlertsFeed();

    await waitFor(() => expect(container?.textContent).toContain("No public alerts yet"));

    expect(container.textContent).toContain("New outage/restoration candidates");
  });

  function renderAlertsFeed(): HTMLDivElement {
    const element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);

    act(() => {
      root?.render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <AlertsFeed />
          </QueryClientProvider>
        </MemoryRouter>
      );
    });

    return element;
  }
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
