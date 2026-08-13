import { createHmac } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { domainEvents } from "../../lib/events.js";
import { attachRealtime } from "./socket.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const reviewerToken = signJwt({
  sub: "7af7b612-2b58-4ed4-87bc-a2eb02225729",
  email: "reviewer@gridproof.test",
  app_metadata: { role: "reviewer" }
});

describe("realtime socket gateway", () => {
  let httpServer: HttpServer | null = null;
  let realtimeServer: ReturnType<typeof attachRealtime> | null = null;
  let clients: Socket[] = [];

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    clients = [];
    await new Promise<void>((resolve) => realtimeServer?.close(() => resolve()) ?? resolve());
    await new Promise<void>((resolve, reject) => {
      if (!httpServer?.listening) return resolve();
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
    realtimeServer = null;
    httpServer = null;
  });

  it("broadcasts evidence.received as a public zone status update", async () => {
    const url = await startRealtimeServer();
    const client = await connectClient(url, { zoneId });
    const statusChanged = onceEvent<{ zoneId: string; status: "grid_down"; observedAt: string }>(client, "zone.status_changed");
    const zoneEvidence = onceEvent<{ id: string; zoneId: string; status: "grid_down" }>(client, "evidence.received");

    domainEvents.emit("evidence.received", {
      id: "6a670093-7823-44e1-80e4-ac608f9e75bd",
      providerId: "2084fca3-725c-4a2d-b521-bc82de112c64",
      zoneId,
      idempotencyKey: "esp32-ogb-a-1-2026-08-09T10:00:00Z",
      source: "sensor",
      status: "grid_down",
      voltage: 0,
      rawPayload: {},
      observedAt: "2026-08-09T10:00:00.000Z",
      receivedAt: "2026-08-09T10:00:01.000Z"
    });

    await expect(statusChanged).resolves.toMatchObject({ zoneId, status: "grid_down" });
    await expect(zoneEvidence).resolves.toMatchObject({ zoneId, status: "grid_down" });
  });

  it("sends reviewer escalations only to sockets with reviewer/admin tokens", async () => {
    const url = await startRealtimeServer();
    const anonymous = await connectClient(url);
    const reviewer = await connectClient(url, {}, reviewerToken);
    const anonymousReview = onceEvent(anonymous, "review.required", 80);
    const reviewerReview = onceEvent<{ candidateEventId: string; reason: string }>(reviewer, "review.required");

    domainEvents.emit("review.required", {
      candidateEventId: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
      zoneId: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
      reason: "Below auto-approval threshold."
    });

    await expect(reviewerReview).resolves.toMatchObject({
      candidateEventId: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77"
    });
    await expect(anonymousReview).rejects.toThrow("Timed out waiting for review.required");
  });

  it("broadcasts chain commitment updates publicly", async () => {
    const url = await startRealtimeServer();
    const client = await connectClient(url);
    const chainCommitted = onceEvent<{ zoneId: string; txHash: string; status: "confirmed" }>(client, "chain.committed");

    domainEvents.emit("chain.committed", {
      zoneId,
      txHash: `0x${"9".repeat(64)}`,
      status: "confirmed"
    });

    await expect(chainCommitted).resolves.toEqual({
      zoneId,
      txHash: `0x${"9".repeat(64)}`,
      status: "confirmed"
    });
  });

  async function startRealtimeServer(): Promise<string> {
    httpServer = createServer();
    realtimeServer = attachRealtime(httpServer, "http://localhost:5173");
    await new Promise<void>((resolve) => httpServer?.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server address");
    return `http://127.0.0.1:${(address as AddressInfo).port}`;
  }

  async function connectClient(url: string, query?: Record<string, string>, token?: string): Promise<Socket> {
    const client = createClient(url, {
      auth: token ? { token } : undefined,
      query,
      transports: ["websocket"]
    });
    clients.push(client);
    await onceEvent(client, "connect");
    return client;
  }
});

function onceEvent<T = unknown>(socket: Socket, eventName: string, timeoutMs = 500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);
    const onEvent = (payload: T) => {
      cleanup();
      resolve(payload);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off(eventName, onEvent);
    };

    socket.once(eventName, onEvent);
  });
}

function signJwt(payload: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const body = base64UrlJson({
    iat: now,
    exp: now + 60 * 60,
    ...payload
  });
  const signature = createHmac("sha256", "gridproof-local-dev-jwt-secret")
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
