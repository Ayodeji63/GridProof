import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:4100/api/v1";
const telemetryHmacSecret = process.env.PLAYWRIGHT_TELEMETRY_HMAC_SECRET ?? "playwright-telemetry-secret";
const authTokenStorageKey = "gridproof.authToken";
const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const reporterWallet = "0x1111111111111111111111111111111111111111";
const sensorWallet = "0x2222222222222222222222222222222222222222";

test("browser demo flow: sensor proof, reporter escalation, reviewer approval, and operations counters", async ({
  page,
  request
}) => {
  const runId = randomUUID();
  const reporterToken = await registerSession(request, `reporter-${runId}@gridproof.test`, "reporter");
  const reviewerToken = await registerSession(request, `reviewer-${runId}@gridproof.test`, "reviewer");

  await ingestTelemetry(request, {
    deviceId: `playwright-sensor-${runId}`,
    idempotencyKey: `playwright-sensor-down-${runId}`,
    status: "grid_down",
    voltage: 0
  });

  await page.goto(`/proof/${zoneId}/latest`);
  await expect(page.getByRole("heading", { name: "Proof Explorer" })).toBeVisible();
  await expect(page.getByText("0.00%")).toBeVisible();
  await expect(page.getByText("pending", { exact: true })).toBeVisible();
  await expect(page.getByText("Waiting for BOT Chain transaction")).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "GridProof Operations" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open proof explorer" }).first()).toBeVisible();

  await saveToken(page, reporterToken);
  await page.goto("/report");
  await page.getByLabel("Reporter wallet").fill(reporterWallet);
  await page.getByLabel("Zone UUID").fill(zoneId);
  await page.getByLabel("Grid status").selectOption("grid_up");
  await page.getByLabel("Note").fill("Power is restored during the Playwright demo flow.");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Candidate restored event opened at 65% confidence.")).toBeVisible();

  await saveToken(page, reviewerToken);
  await page.goto("/review");
  const reviewItem = page.locator("section.review-item").filter({ hasText: zoneId }).first();
  await expect(reviewItem.getByRole("heading", { name: "Possible restoration" })).toBeVisible();
  await reviewItem.getByLabel("Reviewer note").fill("Playwright reviewer confirmed restoration.");
  await reviewItem.getByRole("button", { name: "Approve" }).click();

  await page.goto(`/proof/${zoneId}/latest`);
  await expect(page.getByText("50.00%")).toBeVisible();
  await expect(page.getByText("pending", { exact: true })).toBeVisible();

  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "Operations Health" })).toBeVisible();
  await expect(page.getByText("Evidence ingested")).toBeVisible();
  await expect(page.getByText("Candidates detected")).toBeVisible();
  await expect(page.getByText("Agent decisions")).toBeVisible();
});

async function registerSession(
  request: APIRequestContext,
  phoneOrEmail: string,
  role: "reporter" | "reviewer"
): Promise<string> {
  const response = await request.post(`${apiBaseUrl}/auth/register`, {
    data: {
      phoneOrEmail,
      role,
      inviteCode: role === "reviewer" ? "playwright-invite" : undefined
    }
  });

  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { token: string };
  expect(body.token).toEqual(expect.any(String));
  return body.token;
}

async function ingestTelemetry(
  request: APIRequestContext,
  input: {
    deviceId: string;
    idempotencyKey: string;
    status: "grid_down";
    voltage: number;
  }
): Promise<void> {
  const payload = {
    deviceId: input.deviceId,
    providerWallet: sensorWallet,
    zoneId,
    idempotencyKey: input.idempotencyKey,
    observedAt: new Date().toISOString(),
    status: input.status,
    voltage: input.voltage
  };

  const response = await request.post(`${apiBaseUrl}/ingest/telemetry`, {
    data: { ...payload, signature: signTelemetry(payload) }
  });

  expect(response.status()).toBe(202);
}

function signTelemetry(payload: {
  deviceId: string;
  providerWallet: string;
  zoneId: string;
  idempotencyKey: string;
  observedAt: string;
  status: string;
  voltage?: number;
}): string {
  const signedPayload = [
    payload.deviceId,
    payload.providerWallet.toLowerCase(),
    payload.zoneId,
    payload.idempotencyKey,
    payload.observedAt,
    payload.status,
    payload.voltage ?? ""
  ].join(".");

  return createHmac("sha256", telemetryHmacSecret).update(signedPayload).digest("hex");
}

async function saveToken(page: Page, token: string): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: authTokenStorageKey, value: token }
  );
}
