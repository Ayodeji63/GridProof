/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/api-client.js";
import { ZoneDetail } from "./ZoneDetail.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/realtime.js", () => ({
  useRealtime: vi.fn()
}));

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    zoneHistory: vi.fn()
  }
}));

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const evidenceId = "6a670093-7823-44e1-80e4-ac608f9e75bd";
const zoneHistory = {
  zone: {
    id: zoneId,
    zoneKey: `0x${"a".repeat(64)}`,
    name: "Ogbomoso Feeder A",
    discosFeederCode: "IBEDC-OGB-A",
    region: "Oyo",
    centroid: { lat: 8.133, lng: 4.25 }
  },
  candidates: [
    {
      id: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
      zoneId,
      status: "outage" as const,
      confidence: 0.65,
      windowStart: "2026-08-09T12:03:00.000Z",
      windowEnd: "2026-08-09T12:08:00.000Z",
      evidenceEventIds: [evidenceId],
      createdAt: "2026-08-09T12:08:01.000Z"
    }
  ],
  epochScores: [
    {
      id: "f2f0e092-c6a4-4745-88d3-a673523c444b",
      zoneId,
      epochStart: "2026-08-09T12:00:00.000Z",
      uptimeBps: 5000,
      evidenceHash: `0x${"e".repeat(64)}`,
      createdAt: "2026-08-09T12:10:00.000Z"
    }
  ],
  trend: "declining" as const
};

const zoneHistoryMock = vi.mocked(apiClient.zoneHistory);

describe("ZoneDetail", () => {
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

  it("renders feeder metadata, candidate timeline, and epoch proof links", async () => {
    zoneHistoryMock.mockResolvedValue(zoneHistory);

    container = renderZoneDetail();

    await waitFor(() => expect(container?.textContent).toContain("Ogbomoso Feeder A"));

    expect(container.textContent).toContain("IBEDC-OGB-A");
    expect(container.textContent).toContain("Candidate events");
    expect(container.textContent).toContain("Outage candidate");
    expect(container.textContent).toContain("65% confidence");
    expect(container.textContent).toContain(evidenceId);
    expect(container.textContent).toContain("50.00% uptime");
    expect(container.textContent).toContain("Health trend");
    expect(container.textContent).toContain("Declining");
    expect(linkHrefs(container).some((href) => href?.startsWith(`/proof/${zoneId}/2026-08-09T12%3A00%3A00.000Z`))).toBe(
      true
    );
    expect(linkHrefs(container)).toContain(`/proof/${zoneId}/latest`);
    expect(zoneHistoryMock).toHaveBeenCalledWith(zoneId);
  });

  it("renders empty timeline states for zones without history", async () => {
    zoneHistoryMock.mockResolvedValue({
      ...zoneHistory,
      candidates: [],
      epochScores: [],
      trend: "stable" as const
    });

    container = renderZoneDetail();

    await waitFor(() => expect(container?.textContent).toContain("No epoch scores yet."));

    expect(container.textContent).toContain("No outage/restoration candidates yet.");
    expect(container.textContent).toContain("Latest uptimePending");
    expect(container.textContent).toContain("Stable");
  });

  function renderZoneDetail(): HTMLDivElement {
    const element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);

    act(() => {
      root?.render(
        <MemoryRouter initialEntries={[`/zones/${zoneId}`]}>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <Routes>
              <Route element={<ZoneDetail />} path="/zones/:zoneId" />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>
      );
    });

    return element;
  }
});

function linkHrefs(container: HTMLElement | null): Array<string | null> {
  return Array.from(container?.querySelectorAll("a") ?? []).map((link) => link.getAttribute("href"));
}

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
