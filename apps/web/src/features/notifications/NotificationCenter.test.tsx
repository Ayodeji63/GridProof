/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/api-client.js";
import { NotificationCenter } from "./NotificationCenter.js";
import { ApiError } from "../../lib/api-error.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    notifications: vi.fn(),
    zones: vi.fn()
  }
}));

const notificationsMock = vi.mocked(apiClient.notifications);
const zonesMock = vi.mocked(apiClient.zones);
const zone = {
  id: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  zoneKey: `0x${"1".repeat(64)}`,
  name: "Akure Feeder A",
  discosFeederCode: "BEDC-AKR-01",
  region: "Ondo",
  centroid: { lat: 7.25, lng: 5.19 },
  latestStatus: "grid_up" as const,
  latestUptimeBps: 9800
};
const notification = {
  id: "60455448-ba24-4e5d-8cf9-d1057e1777cf",
  kind: "chain_committed" as const,
  audience: "public" as const,
  channel: "webhook" as const,
  title: "Proof confirmed on BOT Chain",
  message: "Zone 8a27 chain commitment is confirmed.",
  payload: {
    zoneId: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
    txHash: `0x${"f".repeat(64)}`,
    epochStart: "2026-08-09T12:00:00.000Z",
    status: "confirmed"
  },
  status: "sent" as const,
  attempts: 1,
  lastError: null,
  createdAt: "2026-08-09T12:03:00.000Z",
  sentAt: "2026-08-09T12:03:01.000Z"
};

describe("NotificationCenter", () => {
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

  beforeEach(() => {
    zonesMock.mockResolvedValue({ zones: [zone] });
  });

  it("renders notification details and proof links", async () => {
    notificationsMock.mockResolvedValue({ notifications: [notification] });

    container = renderNotificationCenter();

    await waitFor(() => expect(container?.textContent).toContain("Proof confirmed on BOT Chain"));

    expect(container.textContent).toContain("Chain confirmed");
    expect(container.textContent).toContain("Webhook delivered");
    expect(container.textContent).toContain("Akure Feeder A");
    expect(container.textContent).toContain("BEDC-AKR-01");
    expect(container.textContent).toContain("Akure Feeder A (BEDC-AKR-01) chain commitment is confirmed.");
    expect(container.textContent).toContain(notification.payload.txHash);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(
      `/proof/${notification.payload.zoneId}/${encodeURIComponent(notification.payload.epochStart)}`
    );
  });

  it("does not present a local outbox record as a pending chain event", async () => {
    notificationsMock.mockResolvedValue({
      notifications: [{
        ...notification,
        channel: "outbox",
        status: "queued",
        attempts: 0,
        sentAt: null
      }]
    });

    container = renderNotificationCenter();

    await waitFor(() => expect(container?.textContent).toContain("external delivery is not configured"));

    expect(container.textContent).toContain("Chain confirmed");
    expect(container.textContent).toContain("external delivery is not configured");
    expect(container.textContent).not.toContain("Queued");
  });

  it("renders an empty state when the outbox has no items", async () => {
    notificationsMock.mockResolvedValue({ notifications: [] });

    container = renderNotificationCenter();

    await waitFor(() => expect(container?.textContent).toContain("No notifications yet"));

    expect(container.textContent).toContain("No notifications yet");
  });

  it("filters notifications by update type, audience, delivery, and search text", async () => {
    const reviewNotification = {
      ...notification,
      id: "00000000-0000-4000-8000-000000000002",
      kind: "review_required" as const,
      audience: "reviewer" as const,
      channel: "outbox" as const,
      title: "Evidence needs reviewer confirmation",
      message: "Akure feeder evidence needs confirmation.",
      payload: { candidateEventId: "00000000-0000-4000-8000-000000000003" },
      status: "queued" as const,
      attempts: 0,
      sentAt: null
    };
    notificationsMock.mockResolvedValue({ notifications: [notification, reviewNotification] });

    container = renderNotificationCenter();
    await waitFor(() => expect(container?.querySelectorAll("article")).toHaveLength(2));

    const audience = selectByLabel(container, "Filter by audience");
    act(() => {
      setSelectValue(audience, "reviewer");
      audience.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitFor(() => expect(container?.querySelectorAll("article")).toHaveLength(1));
    expect(container.textContent).toContain("Evidence needs reviewer confirmation");

    const delivery = selectByLabel(container, "Filter by delivery state");
    act(() => {
      setSelectValue(delivery, "sent");
      delivery.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitFor(() => expect(container?.textContent).toContain("No notifications match these filters"));

    const clear = buttonByText(container, "Clear filters");
    act(() => clear.click());
    const search = inputByLabel(container, "Search notifications");
    act(() => {
      setInputValue(search, "Akure feeder evidence");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await waitFor(() => expect(container?.querySelectorAll("article")).toHaveLength(1));
    expect(container.textContent).toContain("Akure feeder evidence");
  });

  it("paginates long notification lists", async () => {
    notificationsMock.mockResolvedValue({
      notifications: Array.from({ length: 10 }, (_, index) => ({
        ...notification,
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
      }))
    });

    container = renderNotificationCenter();
    await waitFor(() => expect(container?.querySelectorAll("article")).toHaveLength(8));
    expect(container.textContent).toContain("Page 1 of 2");

    act(() => buttonByText(container!, "Next").click());

    await waitFor(() => expect(container?.querySelectorAll("article")).toHaveLength(2));
    expect(container.textContent).toContain("Page 2 of 2");
  });

  it("directs unauthenticated operators to Settings", async () => {
    notificationsMock.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", "A valid bearer token is required"));

    container = renderNotificationCenter();

    await waitFor(() => expect(container?.textContent).toContain("Reviewer sign-in required"));
    expect(container.querySelector('a[href="/settings"]')).not.toBeNull();
  });

  it("explains when the signed-in account lacks reviewer access", async () => {
    notificationsMock.mockRejectedValue(new ApiError(403, "FORBIDDEN", "User role is not allowed to access this route"));

    container = renderNotificationCenter();

    await waitFor(() => expect(container?.textContent).toContain("Reviewer access required"));
    expect(container.textContent).toContain("this account is not a reviewer or admin");
  });

  function renderNotificationCenter(): HTMLDivElement {
    const element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);

    act(() => {
      root?.render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <NotificationCenter />
          </QueryClientProvider>
        </MemoryRouter>
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
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  }

  throw lastError;
}

function selectByLabel(container: HTMLElement, label: string): HTMLSelectElement {
  const select = container.querySelector(`[aria-label="${label}"]`);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`Select not found: ${label}`);
  return select;
}

function inputByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const input = container.querySelector(`[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${label}`);
  return input;
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (!setter) throw new Error("Unable to set select value");
  setter.call(select, value);
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Unable to set input value");
  setter.call(input, value);
}
