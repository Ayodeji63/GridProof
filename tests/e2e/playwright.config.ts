import { defineConfig, devices } from "@playwright/test";

const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 4100);
const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 5174);
const apiBaseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;
// Pinned so the browser demo signs real sensor telemetry instead of inheriting a
// developer's TELEMETRY_HMAC_SECRET. Shared with the spec via the environment.
const telemetryHmacSecret = process.env.PLAYWRIGHT_TELEMETRY_HMAC_SECRET ?? "playwright-telemetry-secret";

process.env.PLAYWRIGHT_TELEMETRY_HMAC_SECRET = telemetryHmacSecret;

export default defineConfig({
  testDir: "./playwright",
  timeout: 30_000,
  expect: {
    timeout: 7_500
  },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: webBaseUrl,
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "pnpm --dir ../.. --filter @gridproof/api dev",
      url: `${apiBaseUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(apiPort),
        CORS_ORIGINS: `${webBaseUrl},http://localhost:${webPort}`,
        GRIDPROOF_AUTH_INVITE_CODE: "playwright-invite",
        GRIDPROOF_EVIDENCE_MODE: "hybrid",
        TELEMETRY_HMAC_SECRET: telemetryHmacSecret,
        // The browser demo runs against the deterministic in-memory stores, exactly
        // like tests/e2e/test/demo-flow.test.ts. Set (not unset) DATABASE_URL: the API
        // loads dotenv/config, which only fills keys absent from process.env, so an
        // empty value here reliably wins over a developer's local apps/api/.env.
        DATABASE_URL: ""
      }
    },
    {
      command: `pnpm --dir ../.. --filter @gridproof/web exec vite --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: webBaseUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      env: {
        ...process.env,
        VITE_API_BASE_URL: apiBaseUrl,
        VITE_REALTIME_URL: `http://127.0.0.1:${apiPort}`
      }
    }
  ]
});
