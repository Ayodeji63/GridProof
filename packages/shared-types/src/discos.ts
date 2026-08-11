import { z } from "zod";

export const discoCodeSchema = z.enum([
  "AEDC",
  "BEDC",
  "EEDC",
  "EKEDC",
  "IBEDC",
  "IKEDC",
  "JED",
  "KAEDCO",
  "KEDCO",
  "PHED",
  "YEDC"
]);
export type DiscoCode = z.infer<typeof discoCodeSchema>;

export const discoSchema = z.object({
  code: discoCodeSchema,
  name: z.string().min(1),
  headquarters: z.string().min(1),
  states: z.array(z.string().min(1)).min(1),
  centroid: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  })
});
export type Disco = z.infer<typeof discoSchema>;

/**
 * The 11 successor distribution companies from the 2013 PHCN unbundling.
 * Centroids are approximate service-territory centres, used to place DisCo-level
 * markers when a feeder has no surveyed coordinates of its own.
 */
export const DISCOS: readonly Disco[] = [
  {
    code: "AEDC",
    name: "Abuja Electricity Distribution Company",
    headquarters: "Abuja",
    states: ["FCT", "Niger", "Kogi", "Nasarawa"],
    centroid: { lat: 9.0765, lng: 7.3986 }
  },
  {
    code: "BEDC",
    name: "Benin Electricity Distribution Company",
    headquarters: "Benin City",
    states: ["Edo", "Delta", "Ondo", "Ekiti"],
    centroid: { lat: 6.335, lng: 5.6037 }
  },
  {
    code: "EEDC",
    name: "Enugu Electricity Distribution Company",
    headquarters: "Enugu",
    states: ["Enugu", "Anambra", "Imo", "Abia", "Ebonyi"],
    centroid: { lat: 6.4584, lng: 7.5464 }
  },
  {
    code: "EKEDC",
    name: "Eko Electricity Distribution Company",
    headquarters: "Lagos",
    states: ["Lagos"],
    centroid: { lat: 6.4474, lng: 3.3903 }
  },
  {
    code: "IBEDC",
    name: "Ibadan Electricity Distribution Company",
    headquarters: "Ibadan",
    states: ["Oyo", "Ogun", "Osun", "Kwara"],
    centroid: { lat: 7.3775, lng: 3.947 }
  },
  {
    code: "IKEDC",
    name: "Ikeja Electric",
    headquarters: "Lagos",
    states: ["Lagos"],
    centroid: { lat: 6.6018, lng: 3.3515 }
  },
  {
    code: "JED",
    name: "Jos Electricity Distribution Company",
    headquarters: "Jos",
    states: ["Plateau", "Bauchi", "Benue", "Gombe"],
    centroid: { lat: 9.8965, lng: 8.8583 }
  },
  {
    code: "KAEDCO",
    name: "Kaduna Electricity Distribution Company",
    headquarters: "Kaduna",
    states: ["Kaduna", "Sokoto", "Kebbi", "Zamfara"],
    centroid: { lat: 10.5222, lng: 7.4383 }
  },
  {
    code: "KEDCO",
    name: "Kano Electricity Distribution Company",
    headquarters: "Kano",
    states: ["Kano", "Jigawa", "Katsina"],
    centroid: { lat: 12.0022, lng: 8.592 }
  },
  {
    code: "PHED",
    name: "Port Harcourt Electricity Distribution Company",
    headquarters: "Port Harcourt",
    states: ["Rivers", "Bayelsa", "Cross River", "Akwa Ibom"],
    centroid: { lat: 4.8156, lng: 7.0498 }
  },
  {
    code: "YEDC",
    name: "Yola Electricity Distribution Company",
    headquarters: "Yola",
    states: ["Adamawa", "Borno", "Yobe", "Taraba"],
    centroid: { lat: 9.2035, lng: 12.4954 }
  }
] as const;

const discoByCode = new Map<DiscoCode, Disco>(DISCOS.map((disco) => [disco.code, disco]));

export function getDisco(code: DiscoCode): Disco {
  const disco = discoByCode.get(code);
  if (!disco) throw new Error(`Unknown DisCo code: ${code}`);
  return disco;
}

/**
 * Feeder codes are formatted `<DISCO>-<AREA>-<FEEDER>` (e.g. `IBEDC-OGB-A`),
 * so the DisCo is the segment before the first hyphen. Returns null rather than
 * throwing: feeder codes arrive from operator-entered data and a malformed one
 * should degrade to "unassigned", not break the dashboard.
 */
export function discoCodeFromFeederCode(feederCode: string): DiscoCode | null {
  const prefix = feederCode.trim().toUpperCase().split("-")[0];
  if (!prefix) return null;
  const parsed = discoCodeSchema.safeParse(prefix);
  return parsed.success ? parsed.data : null;
}
