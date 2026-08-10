import type { ZonesResponse } from "@gridproof/shared-types";

export const sampleZones: ZonesResponse["zones"] = [
  {
    id: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
    zoneKey: `0x${"a".repeat(64)}`,
    name: "Ogbomoso Feeder A",
    discosFeederCode: "IBEDC-OGB-A",
    region: "Oyo",
    centroid: { lat: 8.133, lng: 4.25 },
    latestStatus: "grid_up",
    latestUptimeBps: 9675
  },
  {
    id: "378b2fae-55dd-488f-aefd-c9bc17f8d4ff",
    zoneKey: `0x${"b".repeat(64)}`,
    name: "Ogbomoso Feeder B",
    discosFeederCode: "IBEDC-OGB-B",
    region: "Oyo",
    centroid: { lat: 8.151, lng: 4.238 },
    latestStatus: "grid_down",
    latestUptimeBps: 6420
  },
  {
    id: "4686bfc9-9adb-4da6-aa6c-49e481d3793b",
    zoneKey: `0x${"c".repeat(64)}`,
    name: "Stadium Road Cluster",
    discosFeederCode: "IBEDC-STAD",
    region: "Oyo",
    centroid: { lat: 8.116, lng: 4.266 },
    latestStatus: "unknown",
    latestUptimeBps: null
  }
];
