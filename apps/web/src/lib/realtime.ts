import { useEffect } from "react";
import { io } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import type { ChainCommitmentStatus, EvidenceStatus, ZonesResponse } from "@gridproof/shared-types";
import { useDashboardStore } from "../stores/dashboard-store.js";

const realtimeUrl = import.meta.env.VITE_REALTIME_URL ?? "http://localhost:4000";
const authTokenStorageKey = "gridproof.authToken";

type ZoneStatusChangedEvent = {
  zoneId: string;
  status: EvidenceStatus;
  observedAt?: string;
};

type ChainCommittedEvent = {
  zoneId: string;
  txHash: string | null;
  status: ChainCommitmentStatus;
};

type ReviewRequiredEvent = {
  candidateEventId: string;
  reason: string;
};

export function useRealtime(zoneId?: string) {
  const queryClient = useQueryClient();
  const applyStatus = useDashboardStore((state) => state.applyRealtimeStatus);

  useEffect(() => {
    const socket = io(realtimeUrl, {
      auth: realtimeAuth(),
      query: zoneId ? { zoneId } : undefined,
      transports: ["websocket", "polling"]
    });

    const refreshRestFallback = () => {
      void queryClient.invalidateQueries({ queryKey: ["zones"] });
      void queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      if (zoneId) {
        void queryClient.invalidateQueries({ queryKey: ["zone-history", zoneId] });
        void queryClient.invalidateQueries({ queryKey: ["proof", zoneId] });
      }
    };

    socket.on("zone.status_changed", (event: ZoneStatusChangedEvent) => {
      applyStatus(event.zoneId, event.status);
      queryClient.setQueryData<ZonesResponse>(["zones"], (current) =>
        current
          ? {
              zones: current.zones.map((zone) =>
                zone.id === event.zoneId
                  ? {
                      ...zone,
                      latestStatus: event.status
                    }
                  : zone
              )
            }
          : current
      );
      void queryClient.invalidateQueries({ queryKey: ["zone-history", event.zoneId] });
    });

    socket.on("chain.committed", (event: ChainCommittedEvent) => {
      void queryClient.invalidateQueries({ queryKey: ["zones"] });
      void queryClient.invalidateQueries({ queryKey: ["zone-history", event.zoneId] });
      void queryClient.invalidateQueries({ queryKey: ["proof", event.zoneId] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });

    socket.on("review.required", (_event: ReviewRequiredEvent) => {
      void queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });

    socket.on("connect_error", refreshRestFallback);
    socket.on("disconnect", refreshRestFallback);

    return () => {
      socket.disconnect();
    };
  }, [applyStatus, queryClient, zoneId]);
}

function realtimeAuth(): { token?: string } {
  const envToken = import.meta.env.VITE_DEMO_AUTH_TOKEN;
  if (typeof envToken === "string" && envToken.length > 0) return { token: envToken };
  if (typeof localStorage === "undefined") return {};
  const token = localStorage.getItem(authTokenStorageKey);
  return token ? { token } : {};
}
