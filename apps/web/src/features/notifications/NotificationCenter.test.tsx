/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/api-client.js";
import { NotificationCenter } from "./NotificationCenter.js";
import { ApiError } from "../../lib/api-error.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    notifications: vi.fn()
  }
}));

const notificationsMock = vi.mocked(apiClient.notifications);
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

  it("renders notification details and proof links", async () => {
    notificationsMock.mockResolvedValue({ notifications: [notification] });

    container = renderNotificationCenter();

    await waitFor(() => expect(container?.textContent).toContain("Proof confirmed on BOT Chain"));

    expect(container.textContent).toContain("sent");
    expect(container.textContent).toContain(notification.payload.txHash);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(`/proof/${notification.payload.zoneId}/latest`);
  });

  it("renders an empty state when the outbox has no items", async () => {
    notificationsMock.mockResolvedValue({ notifications: [] });

    container = renderNotificationCenter();

    await waitFor(() => expect(container?.textContent).toContain("No notifications yet"));

    expect(container.textContent).toContain("No notifications yet");
  });

  it("directs unauthenticated operators to Settings", async () => {
    notificationsMock.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", "A valid bearer token is required"));

    container = renderNotificationCenter();

    await waitFor(() => expect(container?.textContent).toContain("Reviewer sign-in required"));
    expect(container.querySelector('a[href="/settings"]')).not.toBeNull();
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
