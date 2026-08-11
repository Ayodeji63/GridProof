import { describe, expect, it } from "vitest";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_TIMEOUT_MS,
  normalizeLlmBaseUrl,
  resolveLlmConfig
} from "../src/llm-config.js";

const VALID_ENV = {
  LLM_BASE_URL: "http://localhost:3001",
  LLM_API_KEY: "freellmapi-unified-key",
  LLM_ANALYSIS_MODEL: "llama-3.1-8b-instant",
  LLM_VERIFICATION_MODEL: "qwen3-32b"
};

describe("normalizeLlmBaseUrl", () => {
  it("strips a trailing /v1 so the client does not build /v1/v1/chat/completions", () => {
    expect(normalizeLlmBaseUrl("http://localhost:3001/v1")).toBe("http://localhost:3001");
    expect(normalizeLlmBaseUrl("http://localhost:3001/v1/")).toBe("http://localhost:3001");
    expect(normalizeLlmBaseUrl("http://localhost:3001/V1")).toBe("http://localhost:3001");
  });

  it("leaves a bare root untouched", () => {
    expect(normalizeLlmBaseUrl("http://localhost:3001")).toBe("http://localhost:3001");
    expect(normalizeLlmBaseUrl("http://localhost:3001/")).toBe("http://localhost:3001");
  });

  it("does not strip a path that merely contains v1", () => {
    expect(normalizeLlmBaseUrl("http://localhost:3001/v1beta")).toBe("http://localhost:3001/v1beta");
  });
});

describe("resolveLlmConfig", () => {
  it("reports no issues for a fully valid configuration", () => {
    const config = resolveLlmConfig(VALID_ENV);

    expect(config.issues).toEqual([]);
    expect(config.analysis.baseUrl).toBe("http://localhost:3001");
    expect(config.analysis.model).toBe("llama-3.1-8b-instant");
    expect(config.verification.model).toBe("qwen3-32b");
    expect(config.analysis.timeoutMs).toBe(DEFAULT_LLM_TIMEOUT_MS);
  });

  it("shares the base URL and key across analysis and verification", () => {
    const config = resolveLlmConfig(VALID_ENV);

    expect(config.verification.baseUrl).toBe(config.analysis.baseUrl);
    expect(config.verification.apiKey).toBe(config.analysis.apiKey);
    expect(config.verification.model).not.toBe(config.analysis.model);
  });

  it("flags a base URL that already includes /v1 and repairs it", () => {
    const config = resolveLlmConfig({ ...VALID_ENV, LLM_BASE_URL: "http://localhost:3001/v1" });

    expect(config.analysis.baseUrl).toBe("http://localhost:3001");
    expect(config.issues).toEqual([
      expect.objectContaining({ env: "LLM_BASE_URL", message: expect.stringContaining("/v1") })
    ]);
  });

  it("flags placeholder model names", () => {
    const config = resolveLlmConfig({
      ...VALID_ENV,
      LLM_ANALYSIS_MODEL: "fast-free-model",
      LLM_VERIFICATION_MODEL: "strong-free-model"
    });

    expect(config.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ env: "LLM_ANALYSIS_MODEL", message: expect.stringContaining("placeholder") }),
        expect.objectContaining({ env: "LLM_VERIFICATION_MODEL", message: expect.stringContaining("placeholder") })
      ])
    );
  });

  it("flags a missing API key and missing models", () => {
    const config = resolveLlmConfig({ LLM_BASE_URL: "http://localhost:3001" });
    const flagged = config.issues.map((issue) => issue.env);

    expect(flagged).toContain("LLM_API_KEY");
    expect(flagged).toContain("LLM_ANALYSIS_MODEL");
    expect(flagged).toContain("LLM_VERIFICATION_MODEL");
  });

  it("defaults the base URL to the FreeLLMAPI router port when unset", () => {
    const config = resolveLlmConfig({});

    expect(config.analysis.baseUrl).toBe(DEFAULT_LLM_BASE_URL);
    expect(config.issues.map((issue) => issue.env)).toContain("LLM_BASE_URL");
  });

  it("honours an explicit timeout and rejects a nonsensical one", () => {
    expect(resolveLlmConfig({ ...VALID_ENV, LLM_TIMEOUT_MS: "30000" }).analysis.timeoutMs).toBe(30_000);

    const bad = resolveLlmConfig({ ...VALID_ENV, LLM_TIMEOUT_MS: "not-a-number" });
    expect(bad.analysis.timeoutMs).toBe(DEFAULT_LLM_TIMEOUT_MS);
    expect(bad.issues.map((issue) => issue.env)).toContain("LLM_TIMEOUT_MS");

    const negative = resolveLlmConfig({ ...VALID_ENV, LLM_TIMEOUT_MS: "-5" });
    expect(negative.analysis.timeoutMs).toBe(DEFAULT_LLM_TIMEOUT_MS);
  });

  it("defaults the timeout above the client's 8s default to absorb failover latency", () => {
    expect(DEFAULT_LLM_TIMEOUT_MS).toBeGreaterThan(8_000);
  });
});
