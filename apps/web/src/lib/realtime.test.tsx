/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZonesResponse } from "@gridproof/shared-types";
import { useDashboardStore } from "../stores/dashboard-store.js";
import { useRealtime } from "./realtime.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (payload?: unknown) => void;

const socketMocks = vi.hoisted(() => {
  const sockets: Array<{
    handlers: Map<string, Handler>;
    disconnect: ReturnType<typeof vi.fn>;
    emitEvent: (eventName: string, payload?: unknown) => void;
  }> = [];
  const io = vi.fn(() => {
    const socket = {
      handlers: new Map<string, Handler>(),
      disconnect: vi.fn(),
      emitEvent(eventName: string, payload?: unknown) {
        this.handlers.get(eventName)?.(payload);
      },
      on(eventName: string, handler: Handler) {
        this.handlers.set(eventName, handler);
        return this;
      }
    };
    sockets.push(socket);
    return socket;
  });

  return { io, sockets };
});

vi.mock("socket.io-client", () => ({
  io: socketMocks.io
}));

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const zones: ZonesResponse = {
  zones: [
    {
      id: zoneId,
      zoneKey: `0x${"a".repeat(64)}`,
      name: "Ogbomoso Feeder A",
      discosFeederCode: "IBEDC-OGB-A",
      region: "Oyo",
      centroid: { lat: 8.133, lng: 4.25 },
      latestStatus: "grid_up",
      latestUptimeBps: 9800
    }
  ]
};

describe("useRealtime", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container = null;
    socketMocks.io.mockClear();
    socketMocks.sockets.length = 0;
    window.localStorage.clear();
    useDashboardStore.setState({ selectedZoneId: null, realtimeStatuses: {} });
  });

  it("applies public zone status events to Zustand and the zones query cache", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["zones"], zones);

    renderHook(queryClient);

    act(() => {
      socketMocks.sockets[0]?.emitEvent("zone.status_changed", {
        zoneId,
        status: "grid_down",
        observedAt: "2026-08-09T12:05:00.000Z"
      });
    });

    expect(useDashboardStore.getState().realtimeStatuses[zoneId]).toBe("grid_down");
    expect(queryClient.getQueryData<ZonesResponse>(["zones"])?.zones[0]?.latestStatus).toBe("grid_down");
  });

  it("refreshes proof, history, zone, and notification data when chain confirmations arrive", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(queryClient, zoneId);

    act(() => {
      socketMocks.sockets[0]?.emitEvent("chain.committed", {
        zoneId,
        txHash: `0x${"f".repeat(64)}`,
        status: "confirmed"
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["zones"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["zone-history", zoneId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["proof", zoneId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["notifications"] });
  });

  it("refreshes reviewer-facing REST queries on review events and socket failures", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(queryClient, zoneId);

    act(() => {
      socketMocks.sockets[0]?.emitEvent("review.required", {
        candidateEventId: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
        reason: "Ambiguous reporter evidence"
      });
      socketMocks.sockets[0]?.emitEvent("connect_error");
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["review-queue"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["alerts"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["notifications"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["zone-history", zoneId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["proof", zoneId] });
  });

  it("passes the saved auth token and zone room to the Socket.io client", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.localStorage.setItem("gridproof.authToken", "reviewer.jwt");

    renderHook(queryClient, zoneId);

    expect(socketMocks.io).toHaveBeenCalledWith(
      "http://localhost:4000",
      expect.objectContaining({
        auth: { token: "reviewer.jwt" },
        query: { zoneId }
      })
    );
  });

  function renderHook(queryClient: QueryClient, scopedZoneId?: string): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    function RealtimeHarness() {
      useRealtime(scopedZoneId);
      return null;
    }

    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <RealtimeHarness />
        </QueryClientProvider>
      );
    });
  }
});
