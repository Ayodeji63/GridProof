import { describe, expect, it } from "vitest";
import { corsOptionsFromConfig, getCorsConfig, isCorsOriginAllowed } from "./cors.js";

describe("CORS configuration", () => {
  it("uses explicit comma-separated deployment origins when configured", () => {
    const config = getCorsConfig({
      CORS_ORIGINS: "https://gridproof.example, https://demo.gridproof.example/",
      NODE_ENV: "production"
    });

    expect(config).toEqual({
      origins: ["https://gridproof.example", "https://demo.gridproof.example"],
      source: "configured"
    });
    expect(isCorsOriginAllowed(config, "https://gridproof.example")).toBe(true);
    expect(isCorsOriginAllowed(config, "https://attacker.example")).toBe(false);
  });

  it("keeps a local-only default outside production", () => {
    const config = getCorsConfig({ NODE_ENV: "test" });

    expect(config).toEqual({
      origins: ["http://localhost:5173", "http://127.0.0.1:5173"],
      source: "local-default"
    });
  });

  it("fails closed in production without configured origins", () => {
    expect(() => getCorsConfig({ NODE_ENV: "production" })).toThrow("CORS_ORIGINS");
  });

  it("rejects wildcard and malformed origins", () => {
    expect(() => getCorsConfig({ CORS_ORIGINS: "*", NODE_ENV: "production" })).toThrow("Wildcard");
    expect(() => getCorsConfig({ CORS_ORIGINS: "gridproof.example", NODE_ENV: "production" })).toThrow("Invalid");
  });

  it("allows server-to-server requests without browser Origin headers", () => {
    const config = getCorsConfig({ CORS_ORIGINS: "https://gridproof.example", NODE_ENV: "production" });
    const options = corsOptionsFromConfig(config);

    expect(isCorsOriginAllowed(config, undefined)).toBe(true);
    expect(options.origin).toEqual(expect.any(Function));
  });
});
