/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewQueue } from "./ReviewQueue.js";
import { apiClient } from "../../lib/api-client.js";
import { ApiError } from "../../lib/api-error.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    reviewQueue: vi.fn(),
    resolveReview: vi.fn()
  }
}));

const reviewQueueMock = vi.mocked(apiClient.reviewQueue);
const resolveReviewMock = vi.mocked(apiClient.resolveReview);

const candidate = {
  id: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
  zoneId: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  status: "restored" as const,
  confidence: 0.65,
  windowStart: "2026-08-09T11:45:00.000Z",
  windowEnd: "2026-08-09T12:00:00.000Z",
  evidenceEventIds: ["6a670093-7823-44e1-80e4-ac608f9e75bd"],
  createdAt: "2026-08-09T12:01:00.000Z"
};

const reviewItem = {
  id: "4f80f256-d4a8-4e51-8d58-ff7b8a605fd2",
  candidateEventId: candidate.id,
  agentName: "deterministic-policy-gate",
  confidence: 0.65,
  decision: "escalate" as const,
  hypothesis: "Candidate restoration is plausible but needs reviewer confirmation.",
  supportingEvidenceIds: candidate.evidenceEventIds,
  reasoningTrace: { source: "deterministic" },
  createdAt: "2026-08-09T12:02:00.000Z",
  candidate
};

describe("ReviewQueue", () => {
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

  it("renders an honest empty state when there are no escalations", async () => {
    reviewQueueMock.mockResolvedValue({ items: [] });

    container = renderReviewQueue();

    await waitFor(() => expect(container?.textContent).toContain("No escalations waiting"));

    expect(container.textContent).toContain("No escalations waiting");
  });

  it("requires a reviewer note before approving an item", async () => {
    reviewQueueMock.mockResolvedValue({ items: [reviewItem] });
    resolveReviewMock.mockResolvedValue({
      accepted: true,
      reviewId: reviewItem.id,
      decision: { ...reviewItem, decision: "approve" },
      epochScore: null,
      commitment: null
    });

    container = renderReviewQueue();

    await waitFor(() => expect(container?.textContent).toContain("Possible restoration"));

    const approve = buttonByText(container, "Approve");
    expect(approve.disabled).toBe(true);

    const note = container.querySelector("textarea");
    if (!note) throw new Error("Expected reviewer note textarea");

    await act(async () => {
      setTextareaValue(note, "Confirmed with latest neighborhood report.");
      note.dispatchEvent(new Event("input", { bubbles: true }));
      note.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitFor(() => expect(approve.disabled).toBe(false));

    await act(async () => {
      approve.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(resolveReviewMock).toHaveBeenCalledWith(reviewItem.id, {
      decision: "approve",
      note: "Confirmed with latest neighborhood report."
    });
  });

  it("directs unauthenticated operators to Settings", async () => {
    reviewQueueMock.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", "A valid bearer token is required"));

    container = renderReviewQueue();

    await waitFor(() => expect(container?.textContent).toContain("Reviewer sign-in required"));
    expect(container.querySelector('a[href="/settings"]')).not.toBeNull();
  });

  function renderReviewQueue(): HTMLDivElement {
    const element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);

    act(() => {
      root?.render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <ReviewQueue />
          </QueryClientProvider>
        </MemoryRouter>
      );
    });

    return element;
  }
});

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("Unable to set textarea value");
  setter.call(textarea, value);
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  }

  throw lastError;
}
