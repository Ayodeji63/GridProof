/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/api-client.js";
import { AlertsFeed } from "./AlertsFeed.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    alerts: vi.fn()
  }
}));

const alertsMock = vi.mocked(apiClient.alerts);
const alert = {
  id: "4f80f256-d4a8-4e51-8d58-ff7b8a605fd2",
  candidateEventId: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
  zoneId: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  status: "outage" as const,
  confidence: 0.95,
  decision: "approve" as const,
  hypothesis: "Candidate outage passed deterministic confidence threshold.",
  supportingEvidenceIds: ["6a670093-7823-44e1-80e4-ac608f9e75bd"],
  review: null,
  createdAt: "2026-08-09T12:03:00.000Z",
  candidateCreatedAt: "2026-08-09T12:02:00.000Z"
};

describe("AlertsFeed", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  it("renders public alert details and proof links", async () => {
    alertsMock.mockResolvedValue({ alerts: [alert] });

    container = renderAlertsFeed();

    await waitFor(() => expect(container?.textContent).toContain("Outage"));

    expect(container.textContent).toContain("95% automated confidence");
    expect(container.textContent).toContain("auto-approved");
    expect(container.textContent).toContain(alert.hypothesis);
    expect(container.textContent).toContain(alert.supportingEvidenceIds[0]);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(`/proof/${alert.zoneId}/latest`);
  });

  it("separates reviewer approval from the automated assessment", async () => {
    alertsMock.mockResolvedValue({
      alerts: [{
        ...alert,
        confidence: 0.65,
        hypothesis: "Candidate outage is plausible but below auto-approval confidence; reviewer confirmation required.",
        review: {
          initialDecision: "escalate",
          decision: "approve",
          note: "Field crew confirmed the outage.",
          reviewedAt: "2026-08-09T12:10:00.000Z"
        }
      }]
    });

    container = renderAlertsFeed();

    await waitFor(() => expect(container?.textContent).toContain("reviewer approved"));
    expect(container.textContent).toContain("65% automated confidence");
    expect(container.textContent).toContain("Initial policy decision: escalated");
    expect(container.textContent).toContain("Initial assessment:");
    expect(container.textContent).toContain("Reviewer confirmation: Field crew confirmed the outage.");
    expect(container.textContent).toContain("Reviewed9 Aug 2026 at 1:10 PM WAT");
    expect(container.textContent).toContain("Automated assessment9 Aug 2026 at 1:03 PM WAT");
    expect(container.querySelector('time[datetime="2026-08-09T12:10:00.000Z"]')).not.toBeNull();
  });

  it("renders an empty state when no public alerts exist", async () => {
    alertsMock.mockResolvedValue({ alerts: [] });

    container = renderAlertsFeed();

    await waitFor(() => expect(container?.textContent).toContain("No public alerts yet"));

    expect(container.textContent).toContain("New outage/restoration candidates");
  });

  it("filters alerts by status and search text", async () => {
    alertsMock.mockResolvedValue({
      alerts: [
        alert,
        {
          ...alert,
          id: "00000000-0000-4000-8000-000000000002",
          candidateEventId: "00000000-0000-4000-8000-000000000003",
          status: "restored",
          hypothesis: "Power restored after feeder maintenance."
        }
      ]
    });

    container = renderAlertsFeed();
    await waitFor(() => expect(container?.querySelectorAll("article")).toHaveLength(2));

    const status = selectByLabel(container, "Filter by grid status");
    act(() => {
      setSelectValue(status, "restored");
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitFor(() => expect(container?.querySelectorAll("article")).toHaveLength(1));
    expect(container.textContent).toContain("Restoration");

    const search = inputByLabel(container, "Search alerts");
    act(() => {
      setInputValue(search, "no matching identifier");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await waitFor(() => expect(container?.textContent).toContain("No alerts match these filters"));
  });

  it("paginates long alert lists", async () => {
    alertsMock.mockResolvedValue({
      alerts: Array.from({ length: 10 }, (_, index) => ({
        ...alert,
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        candidateEventId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
      }))
    });

    container = renderAlertsFeed();
    await waitFor(() => expect(container?.querySelectorAll("article")).toHaveLength(8));
    expect(container.textContent).toContain("Page 1 of 2");

    const next = buttonByText(container, "Next");
    act(() => next.click());

    await waitFor(() => expect(container?.querySelectorAll("article")).toHaveLength(2));
    expect(container.textContent).toContain("Page 2 of 2");
    expect(buttonByText(container, "Next").disabled).toBe(true);
  });

  function renderAlertsFeed(): HTMLDivElement {
    const element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);

    act(() => {
      root?.render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <AlertsFeed />
          </QueryClientProvider>
        </MemoryRouter>
      );
    });

    return element;
  }
});

function selectByLabel(container: HTMLElement, label: string): HTMLSelectElement {
  const select = container.querySelector(`[aria-label="${label}"]`);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`Select not found: ${label}`);
  return select;
}

function inputByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const input = container.querySelector(`[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${label}`);
  return input;
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (!setter) throw new Error("Unable to set select value");
  setter.call(select, value);
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Unable to set input value");
  setter.call(input, value);
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
