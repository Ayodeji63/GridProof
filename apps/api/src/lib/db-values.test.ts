import { describe, expect, it } from "vitest";
import { blockNumberFromDatabase } from "./db-values.js";

describe("blockNumberFromDatabase", () => {
  it("converts PostgreSQL bigint strings to API numbers", () => {
    expect(blockNumberFromDatabase("12345")).toBe(12_345);
  });

  it("preserves null and valid numeric values", () => {
    expect(blockNumberFromDatabase(null)).toBeNull();
    expect(blockNumberFromDatabase(0)).toBe(0);
  });

  it.each(["not-a-number", "1.5", "-1", "9007199254740992"])("rejects an unsafe block number: %s", (value) => {
    expect(() => blockNumberFromDatabase(value)).toThrow("Invalid database block number");
  });
});
