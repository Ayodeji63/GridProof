import type { DiscoCode } from "./discos.js";

/**
 * Demo fixture: two feeders per DisCo so every one of the 11 distribution
 * companies appears on the dashboard without a database or live ingestion.
 * Shared by the API (no DATABASE_URL) and the web app (API unreachable) so the
 * two fallbacks cannot drift apart. Coordinates are real settlements inside
 * each DisCo's licensed territory; statuses and uptimes are illustrative.
 */
export type DemoZone = {
  id: string;
  zoneKey: string;
  name: string;
  discosFeederCode: string;
  region: string;
  centroid: { lat: number; lng: number };
  latestStatus: "grid_up" | "grid_down" | "unknown";
  latestUptimeBps: number | null;
  latestVoltage: number | null;
  latestCurrentAmps: number | null;
};

function zoneKey(seed: number): string {
  return `0x${seed.toString(16).padStart(4, "0").repeat(16)}`;
}

type Seed = {
  disco: DiscoCode;
  area: string;
  feeder: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  status: "grid_up" | "grid_down" | "unknown";
  uptimeBps: number | null;
};

const SEEDS: Seed[] = [
  { disco: "IBEDC", area: "OGB", feeder: "A", name: "Ogbomoso Feeder A", region: "Oyo", lat: 8.133, lng: 4.25, status: "grid_up", uptimeBps: 9675 },
  { disco: "IBEDC", area: "OGB", feeder: "B", name: "Ogbomoso Feeder B", region: "Oyo", lat: 8.151, lng: 4.238, status: "grid_down", uptimeBps: 6420 },
  { disco: "IBEDC", area: "STAD", feeder: "1", name: "Stadium Road Cluster", region: "Oyo", lat: 8.116, lng: 4.266, status: "unknown", uptimeBps: null },
  { disco: "AEDC", area: "GRK", feeder: "1", name: "Garki District Feeder", region: "FCT", lat: 9.0333, lng: 7.4894, status: "grid_up", uptimeBps: 9210 },
  { disco: "AEDC", area: "LOK", feeder: "2", name: "Lokoja Township", region: "Kogi", lat: 7.8023, lng: 6.7333, status: "grid_down", uptimeBps: 5840 },
  { disco: "BEDC", area: "BEN", feeder: "1", name: "Benin Ring Road", region: "Edo", lat: 6.3392, lng: 5.6175, status: "grid_up", uptimeBps: 8890 },
  { disco: "BEDC", area: "AKR", feeder: "2", name: "Akure Oba-Ile", region: "Ondo", lat: 7.2571, lng: 5.2058, status: "grid_up", uptimeBps: 8420 },
  { disco: "EEDC", area: "ENU", feeder: "1", name: "Enugu New Haven", region: "Enugu", lat: 6.4413, lng: 7.4988, status: "grid_down", uptimeBps: 6110 },
  { disco: "EEDC", area: "ONI", feeder: "2", name: "Onitsha Main Market", region: "Anambra", lat: 6.1418, lng: 6.8021, status: "grid_up", uptimeBps: 7930 },
  { disco: "EKEDC", area: "VIC", feeder: "1", name: "Victoria Island 33kV", region: "Lagos", lat: 6.4281, lng: 3.4219, status: "grid_up", uptimeBps: 9540 },
  { disco: "EKEDC", area: "LEK", feeder: "2", name: "Lekki Phase 1", region: "Lagos", lat: 6.4478, lng: 3.4723, status: "grid_up", uptimeBps: 9380 },
  { disco: "IKEDC", area: "IKJ", feeder: "1", name: "Ikeja GRA", region: "Lagos", lat: 6.5833, lng: 3.3417, status: "grid_up", uptimeBps: 9120 },
  { disco: "IKEDC", area: "AGE", feeder: "2", name: "Agege Feeder", region: "Lagos", lat: 6.6152, lng: 3.3242, status: "grid_down", uptimeBps: 7260 },
  { disco: "JED", area: "JOS", feeder: "1", name: "Jos Bukuru", region: "Plateau", lat: 9.8004, lng: 8.8583, status: "grid_up", uptimeBps: 8050 },
  { disco: "JED", area: "MKD", feeder: "2", name: "Makurdi Township", region: "Benue", lat: 7.7322, lng: 8.5391, status: "unknown", uptimeBps: null },
  { disco: "KAEDCO", area: "KAD", feeder: "1", name: "Kaduna Barnawa", region: "Kaduna", lat: 10.4806, lng: 7.4239, status: "grid_up", uptimeBps: 8360 },
  { disco: "KAEDCO", area: "SOK", feeder: "2", name: "Sokoto Central", region: "Sokoto", lat: 13.0059, lng: 5.2476, status: "grid_down", uptimeBps: 5320 },
  { disco: "KEDCO", area: "KAN", feeder: "1", name: "Kano Bompai", region: "Kano", lat: 12.0102, lng: 8.5445, status: "grid_up", uptimeBps: 8710 },
  { disco: "KEDCO", area: "KTS", feeder: "2", name: "Katsina Central", region: "Katsina", lat: 12.9908, lng: 7.6018, status: "grid_up", uptimeBps: 7880 },
  { disco: "PHED", area: "PHC", feeder: "1", name: "Port Harcourt Trans-Amadi", region: "Rivers", lat: 4.8156, lng: 7.0134, status: "grid_down", uptimeBps: 6640 },
  { disco: "PHED", area: "UYO", feeder: "2", name: "Uyo Ikot Ekpene Road", region: "Akwa Ibom", lat: 5.0378, lng: 7.9128, status: "grid_up", uptimeBps: 8240 },
  { disco: "YEDC", area: "YOL", feeder: "1", name: "Yola Jimeta", region: "Adamawa", lat: 9.2795, lng: 12.4553, status: "grid_up", uptimeBps: 7410 },
  { disco: "YEDC", area: "MAI", feeder: "2", name: "Maiduguri Bolori", region: "Borno", lat: 11.8333, lng: 13.15, status: "unknown", uptimeBps: null }
];

/** Stable UUIDs so selections and links survive reloads across demo runs. */
function demoId(index: number): string {
  const hex = (index + 1).toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

export const DEMO_NATIONAL_ZONES: DemoZone[] = SEEDS.map((seed, index) => ({
  id: index === 0 ? "8a27f3e2-2608-4a88-b8db-efce68be2a59" : index === 1 ? "378b2fae-55dd-488f-aefd-c9bc17f8d4ff" : demoId(index),
  zoneKey: index === 0 ? `0x${"a".repeat(64)}` : index === 1 ? `0x${"b".repeat(64)}` : zoneKey(index + 16),
  name: seed.name,
  discosFeederCode: `${seed.disco}-${seed.area}-${seed.feeder}`,
  region: seed.region,
  centroid: { lat: seed.lat, lng: seed.lng },
  latestStatus: seed.status,
  latestUptimeBps: seed.uptimeBps,
  latestVoltage: seed.status === "grid_up" ? 220 + (index % 4) * 3 : seed.status === "grid_down" ? 0 : null,
  latestCurrentAmps: seed.status === "grid_up" ? 7 + (index % 6) * 2 : seed.status === "grid_down" ? 0 : null
}));
