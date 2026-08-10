/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/api-client.js";
import { ProviderRegistry } from "./ProviderRegistry.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    providers: vi.fn(),
    registerProvider: vi.fn()
  }
}));

const providersMock = vi.mocked(apiClient.providers);
const registerProviderMock = vi.mocked(apiClient.registerProvider);

const provider = {
  id: "2084fca3-725c-4a2d-b521-bc82de112c64",
  userId: null,
  walletAddress: "0x1111111111111111111111111111111111111111",
  providerType: "reporter" as const,
  zoneId: "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  reputationCache: 7,
  active: true,
  lastSeenAt: null
};

describe("ProviderRegistry", () => {
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

  it("renders providers and submits provider registrations", async () => {
    providersMock.mockResolvedValue({ providers: [provider] });
    registerProviderMock.mockResolvedValue({
      provider: { ...provider, providerType: "sensor" },
      duplicate: false,
      chainRegistration: {
        configured: true,
        mode: "wallet_self_service",
        chainId: "12345",
        contractAddress: "0x9999999999999999999999999999999999999999",
        explorerUrl: `https://explorer.botchain.test/address/0x2222222222222222222222222222222222222222`,
        providerWallet: "0x2222222222222222222222222222222222222222",
        providerType: "sensor",
        providerTypeId: 0,
        zoneId: provider.zoneId,
        zoneKey: `0x${"a".repeat(64)}`,
        registerCall: {
          to: "0x9999999999999999999999999999999999999999",
          functionName: "register",
          args: [`0x${"a".repeat(64)}`, 0],
          data: `0x${"1".repeat(8)}`
        },
        onChain: null,
        reason: "Provider must call NodeRegistry.register from their own wallet."
      }
    });

    container = renderProviderRegistry();

    await waitFor(() => expect(container?.textContent).toContain(provider.walletAddress));
    expect(container.textContent).toContain("Human reporter");
    expect(container.textContent).toContain("7");

    const walletInput = inputByPlaceholder(container, "0x…");
    const zoneInput = inputByPlaceholder(container, "8a27f3e2-2608-4a88-b8db-efce68be2a59");
    const providerType = container.querySelector("select");
    const form = container.querySelector("form");
    if (!providerType) throw new Error("Expected provider type select");
    if (!form) throw new Error("Expected provider form");

    await act(async () => {
      setInputValue(walletInput, "0x2222222222222222222222222222222222222222");
      walletInput.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(zoneInput, provider.zoneId);
      zoneInput.dispatchEvent(new Event("input", { bubbles: true }));
      setSelectValue(providerType, "sensor");
      providerType.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(registerProviderMock).toHaveBeenCalledWith({
      walletAddress: "0x2222222222222222222222222222222222222222",
      providerType: "sensor",
      zoneId: provider.zoneId
    });
    await waitFor(() => expect(container?.textContent).toContain("NodeRegistry.register"));
  });

  function renderProviderRegistry(): HTMLDivElement {
    const element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);

    act(() => {
      root?.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ProviderRegistry />
        </QueryClientProvider>
      );
    });

    return element;
  }
});

function inputByPlaceholder(container: HTMLElement, placeholder: string): HTMLInputElement {
  const input = Array.from(container.querySelectorAll("input")).find((item) => item.placeholder === placeholder);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${placeholder}`);
  return input;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Unable to set input value");
  setter.call(input, value);
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
  if (!setter) throw new Error("Unable to set select value");
  setter.call(select, value);
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
