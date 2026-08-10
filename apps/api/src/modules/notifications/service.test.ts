import { afterEach, describe, expect, it, vi } from "vitest";
import { domainEvents } from "../../lib/events.js";
import {
  attachNotifications,
  clearNotificationStore,
  listNotifications
} from "./service.js";

describe("notification service", () => {
  let detach: (() => void) | null = null;

  afterEach(() => {
    detach?.();
    detach = null;
    clearNotificationStore();
    vi.unstubAllGlobals();
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    delete process.env.NOTIFICATION_WEBHOOK_TOKEN;
    delete process.env.NOTIFICATION_WEBHOOK_TIMEOUT_MS;
  });

  it("records review and chain notifications in the local outbox when no webhook is configured", async () => {
    detach = attachNotifications();

    domainEvents.emit("review.required", {
      candidateEventId: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
      reason: "Reporter evidence needs confirmation."
    });
    domainEvents.emit("chain.committed", {
      zoneId: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
      txHash: `0x${"f".repeat(64)}`,
      status: "confirmed"
    });

    await waitFor(async () => expect(await listNotifications()).toHaveLength(2));

    const notifications = await listNotifications();
    expect(notifications.map((item) => item.kind).sort()).toEqual(["chain_committed", "review_required"]);
    expect(notifications.every((item) => item.channel === "outbox")).toBe(true);
    expect(notifications.every((item) => item.status === "queued")).toBe(true);
  });

  it("posts webhook notifications and marks them sent without blocking the event emitter", async () => {
    process.env.NOTIFICATION_WEBHOOK_URL = "https://notifications.gridproof.test/webhook";
    process.env.NOTIFICATION_WEBHOOK_TOKEN = "demo-token";
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    detach = attachNotifications();

    domainEvents.emit("chain.committed", {
      zoneId: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
      txHash: `0x${"a".repeat(64)}`,
      status: "failed"
    });

    await waitFor(async () => expect((await listNotifications())[0]?.status).toBe("sent"));

    const notification = (await listNotifications())[0];
    expect(notification?.channel).toBe("webhook");
    expect(notification?.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://notifications.gridproof.test/webhook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer demo-token",
          "Content-Type": "application/json"
        })
      })
    );
  });
});

async function waitFor(assertion: () => Promise<void> | void): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw lastError;
}
