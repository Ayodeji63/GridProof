/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/api-client.js";
import { useDashboardStore } from "../../stores/dashboard-store.js";
import { Dashboard } from "./Dashboard.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/realtime.js", () => ({
  useRealtime: vi.fn()
}));

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    zones: vi.fn()
  }
}));

const zonesMock = vi.mocked(apiClient.zones);
const zones = [
  {
    id: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
    zoneKey: `0x${"a".repeat(64)}`,
    name: "Ogbomoso Feeder A",
    discosFeederCode: "IBEDC-OGB-A",
    region: "Oyo",
    centroid: { lat: 8.133, lng: 4.25 },
    latestStatus: "grid_up" as const,
    latestUptimeBps: 9000
  },
  {
    id: "378b2fae-55dd-488f-aefd-c9bc17f8d4ff",
    zoneKey: `0x${"b".repeat(64)}`,
    name: "Ogbomoso Feeder B",
    discosFeederCode: "IBEDC-OGB-B",
    region: "Oyo",
    centroid: { lat: 8.151, lng: 4.238 },
    latestStatus: "grid_down" as const,
    latestUptimeBps: 7000
  }
];

describe("Dashboard", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container = null;
    vi.clearAllMocks();
    useDashboardStore.setState({ selectedZoneId: null, realtimeStatuses: {} });
  });

  it("renders API-backed zone metrics and proof links", async () => {
    zonesMock.mockResolvedValue({ zones });

    container = renderDashboard();

    await waitFor(() => expect(container?.textContent).toContain("API connected"));

    expect(container.textContent).toContain("Tracked zones");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("Average uptime");
    expect(container.textContent).toContain("80.00%");
    expect(container.textContent).toContain("Zones down");
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("Ogbomoso Feeder A");
    expect(linkHrefs(container)).toContain(`/zones/${zones[0]?.id}`);
    expect(linkHrefs(container)).toContain(`/proof/${zones[0]?.id}/latest`);
  });

  it("updates selected feeder details from zone marker clicks", async () => {
    zonesMock.mockResolvedValue({ zones });

    container = renderDashboard();

    await waitFor(() => expect(container?.textContent).toContain("Ogbomoso Feeder A"));
    const feederBMarker = Array.from(container.querySelectorAll("button")).find((button) =>
      button.title.includes("Ogbomoso Feeder B")
    );
    if (!feederBMarker) throw new Error("Expected feeder B marker");

    await act(async () => {
      feederBMarker.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Ogbomoso Feeder B");
    expect(container.textContent).toContain("IBEDC-OGB-B");
    expect(linkHrefs(container)).toContain(`/zones/${zones[1]?.id}`);
    expect(linkHrefs(container)).toContain(`/proof/${zones[1]?.id}/latest`);
  });

  it("shows explicit demo fallback data when live zones fail", async () => {
    zonesMock.mockRejectedValue(new Error("API unavailable"));

    container = renderDashboard();

    await waitFor(() => expect(container?.textContent).toContain("Demo data active"));

    expect(container.textContent).toContain("Could not load live zones");
    expect(container.textContent).toContain("Ogbomoso Feeder A");
  });

  function renderDashboard(): HTMLDivElement {
    const element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);

    act(() => {
      root?.render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <Dashboard />
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
