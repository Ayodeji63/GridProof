import { create } from "zustand";
import type { EvidenceStatus } from "@gridproof/shared-types";

type DashboardState = {
  selectedZoneId: string | null;
  realtimeStatuses: Record<string, EvidenceStatus>;
  selectZone: (zoneId: string) => void;
  applyRealtimeStatus: (zoneId: string, status: EvidenceStatus) => void;
};

export const useDashboardStore = create<DashboardState>((set) => ({
  selectedZoneId: null,
  realtimeStatuses: {},
  selectZone: (zoneId) => set({ selectedZoneId: zoneId }),
  applyRealtimeStatus: (zoneId, status) =>
    set((state) => ({
      realtimeStatuses: {
        ...state.realtimeStatuses,
        [zoneId]: status
      }
    }))
}));
