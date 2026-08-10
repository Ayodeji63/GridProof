import type { EpochScore } from "@gridproof/shared-types";

export type ZoneHealthTrend = "improving" | "stable" | "declining";

const DEFAULT_MIN_DELTA_BPS = 250;

export function computeZoneHealthTrend(
  epochScores: EpochScore[],
  options: { windowSize?: number; minDeltaBps?: number } = {}
): ZoneHealthTrend {
  const windowSize = options.windowSize ?? 3;
  const minDeltaBps = options.minDeltaBps ?? DEFAULT_MIN_DELTA_BPS;
  const ordered = [...epochScores].sort((a, b) => Date.parse(a.epochStart) - Date.parse(b.epochStart));

  if (ordered.length < windowSize * 2) return "stable";

  const recent = ordered.slice(-windowSize);
  const baseline = ordered.slice(ordered.length - windowSize * 2, ordered.length - windowSize);

  const delta = average(recent.map((score) => score.uptimeBps)) - average(baseline.map((score) => score.uptimeBps));
  if (delta >= minDeltaBps) return "improving";
  if (delta <= -minDeltaBps) return "declining";
  return "stable";
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
