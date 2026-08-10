import { describe, expect, it } from "vitest";
import type { EpochScore } from "@gridproof/shared-types";
import { computeZoneHealthTrend } from "./trend.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";

describe("computeZoneHealthTrend", () => {
  it("marks improving trends when the recent moving average rises enough", () => {
    expect(computeZoneHealthTrend(scores([6000, 6200, 6500, 8100, 8300, 8400]))).toBe("improving");
  });

  it("marks declining trends when the recent moving average falls enough", () => {
    expect(computeZoneHealthTrend(scores([9400, 9300, 9200, 7600, 7500, 7200]))).toBe("declining");
  });

  it("keeps small movements stable", () => {
    expect(computeZoneHealthTrend(scores([8900, 9000, 8950, 9025]))).toBe("stable");
  });

  it("keeps sparse history stable", () => {
    expect(computeZoneHealthTrend(scores([9000]))).toBe("stable");
  });
});

function scores(values: number[]): EpochScore[] {
  return values.map((uptimeBps, index) => ({
    id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    zoneId,
    epochStart: new Date(Date.UTC(2026, 7, 9, index)).toISOString(),
    uptimeBps,
    evidenceHash: `0x${(index + 1).toString(16).repeat(64).slice(0, 64)}`,
    createdAt: new Date(Date.UTC(2026, 7, 9, index, 1)).toISOString()
  }));
}
