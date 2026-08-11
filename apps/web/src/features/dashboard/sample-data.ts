import { DEMO_NATIONAL_ZONES } from "@gridproof/shared-types";
import type { ZonesResponse } from "@gridproof/shared-types";

/** Fallback shown when the API is unreachable; covers all 11 DisCos. */
export const sampleZones: ZonesResponse["zones"] = DEMO_NATIONAL_ZONES;
