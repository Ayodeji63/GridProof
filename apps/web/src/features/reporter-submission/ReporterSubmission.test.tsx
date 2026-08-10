/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/api-client.js";
import { ReporterSubmission } from "./ReporterSubmission.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    submitReport: vi.fn()
  }
}));

const submitReportMock = vi.mocked(apiClient.submitReport);
const walletAddress = "0x1111111111111111111111111111111111111111";
const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const candidateEvent = {
  id: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
  zoneId,
  status: "outage" as const,
  confidence: 0.65,
  windowStart: "2026-08-09T12:03:00.000Z",
  windowEnd: "2026-08-09T12:03:00.000Z",
  evidenceEventIds: ["6a670093-7823-44e1-80e4-ac608f9e75bd"],
  createdAt: "2026-08-09T12:03:01.000Z"
};
const ingestResponse = {
  accepted: true as const,
  duplicate: false,
  evidenceEvent: {
    id: "6a670093-7823-44e1-80e4-ac608f9e75bd",
    providerId: "2084fca3-725c-4a2d-b521-bc82de112c64",
    zoneId,
    idempotencyKey: "web-report:0x1111111111111111111111111111111111111111:2026-08-09T12:03:00.000Z",
    source: "reporter" as const,
    status: "grid_down" as const,
    rawPayload: {
      reporterWallet: walletAddress,
      note: "Power is out near the transformer."
    },
    observedAt: "2026-08-09T12:03:00.000Z",
    receivedAt: "2026-08-09T12:03:01.000Z"
  },
  candidateEvent
};

describe("ReporterSubmission", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container = null;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("submits reporter evidence and renders candidate feedback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:03:00.000Z"));
    submitReportMock.mockResolvedValue(ingestResponse);

    container = renderReporterSubmission();

    await act(async () => {
      setInputValue(inputByPlaceholder(container, "0x…"), walletAddress);
      inputByPlaceholder(container, "0x…").dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(inputByPlaceholder(container, "8a27f3e2-2608-4a88-b8db-efce68be2a59"), zoneId);
      inputByPlaceholder(container, "8a27f3e2-2608-4a88-b8db-efce68be2a59").dispatchEvent(
        new Event("input", { bubbles: true })
      );
      const note = textareaByPlaceholder(container, "e.g. Transformer area has been off for 20 minutes.");
      setTextAreaValue(note, "Power is out near the transformer.");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = container.querySelector("form");
    if (!form) throw new Error("Expected reporter form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    vi.useRealTimers();

    expect(submitReportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterWallet: walletAddress,
        zoneId,
        status: "grid_down",
        note: "Power is out near the transformer.",
        observedAt: "2026-08-09T12:03:00.000Z",
        idempotencyKey: expect.stringContaining(`web-report:${walletAddress}:`)
      })
    );
    await waitFor(() => expect(container?.textContent).toContain("Candidate outage event opened at 65% confidence."));
  });

  it("renders accepted evidence feedback when no candidate is opened", async () => {
    submitReportMock.mockResolvedValue({ ...ingestResponse, candidateEvent: null });

    container = renderReporterSubmission();

    await act(async () => {
      setInputValue(inputByPlaceholder(container, "0x…"), walletAddress);
      inputByPlaceholder(container, "0x…").dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(inputByPlaceholder(container, "8a27f3e2-2608-4a88-b8db-efce68be2a59"), zoneId);
      inputByPlaceholder(container, "8a27f3e2-2608-4a88-b8db-efce68be2a59").dispatchEvent(
        new Event("input", { bubbles: true })
      );
    });

    const form = container.querySelector("form");
    if (!form) throw new Error("Expected reporter form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await waitFor(() => expect(container?.textContent).toContain("Evidence accepted; no new candidate event was needed."));
  });

  function renderReporterSubmission(): HTMLDivElement {
    const element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);

    act(() => {
      root?.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ReporterSubmission />
        </QueryClientProvider>
      );
    });

    return element;
  }
});

function inputByPlaceholder(container: HTMLElement | null, placeholder: string): HTMLInputElement {
  const input = Array.from(container?.querySelectorAll("input") ?? []).find((item) => item.placeholder === placeholder);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${placeholder}`);
  return input;
}

function textareaByPlaceholder(container: HTMLElement | null, placeholder: string): HTMLTextAreaElement {
  const textarea = Array.from(container?.querySelectorAll("textarea") ?? []).find(
    (item) => item.placeholder === placeholder
  );
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error(`Textarea not found: ${placeholder}`);
  return textarea;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Unable to set input value");
  setter.call(input, value);
}

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("Unable to set textarea value");
  setter.call(textarea, value);
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  throw lastError;
}
