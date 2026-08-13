/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/api-client.js";
import { AuthSettings } from "./AuthSettings.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/api-client.js", () => ({
  apiClient: {
    authTokenStorageKey: "gridproof.authToken",
    authMe: vi.fn(),
    authRegister: vi.fn(),
    authLogin: vi.fn()
  }
}));

const authMeMock = vi.mocked(apiClient.authMe);
const authRegisterMock = vi.mocked(apiClient.authRegister);
const authLoginMock = vi.mocked(apiClient.authLogin);
const user = {
  id: "7af7b612-2b58-4ed4-87bc-a2eb02225729",
  role: "reviewer" as const,
  phoneOrEmail: "reviewer@gridproof.test",
  createdAt: "2026-08-09T12:00:00.000Z"
};

describe("AuthSettings", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let storage: Map<string, string>;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container = null;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders current auth role and saves a local bearer token", async () => {
    authMeMock.mockResolvedValue({ user });
    stubLocalStorage();

    container = renderAuthSettings();

    await waitFor(() => expect(container?.textContent).toContain("Authenticated"));
    expect(container.textContent).toContain("reviewer@gridproof.test");

    const tokenInput = textareaByPlaceholder(container, "Paste a reviewer/admin/report token for local demo flows");
    await act(async () => {
      setTextAreaValue(tokenInput, " reviewer.jwt ");
      tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = container.querySelector("form");
    if (!form) throw new Error("Expected auth settings form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(storage.get("gridproof.authToken")).toBe("reviewer.jwt");
    await waitFor(() => expect(container?.textContent).toContain("Local auth token saved."));
  });

  it("clears local bearer tokens", async () => {
    authMeMock.mockResolvedValue({ user: null });
    stubLocalStorage([["gridproof.authToken", "old.jwt"]]);

    container = renderAuthSettings();

    await waitFor(() => expect(container?.textContent).toContain("Public access"));
    const clearButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Clear local token")
    );
    if (!clearButton) throw new Error("Expected clear token button");

    await act(async () => {
      clearButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(storage.has("gridproof.authToken")).toBe(false);
    await waitFor(() => expect(container?.textContent).toContain("Local auth token cleared."));
  });

  it("registers demo sessions and saves returned bearer tokens", async () => {
    authMeMock.mockResolvedValue({ user: null });
    authRegisterMock.mockResolvedValue({
      user: {
        id: "c9674aa0-5116-476e-9c26-92b7692893b7",
        role: "reporter",
        phoneOrEmail: "reporter@gridproof.test",
        createdAt: "2026-08-09T12:00:00.000Z"
      },
      token: "issued.jwt",
      expiresAt: "2026-08-09T13:00:00.000Z"
    });
    stubLocalStorage();

    container = renderAuthSettings();

    await waitFor(() => expect(container?.textContent).toContain("Sign in or change access"));
    const identityInput = inputByPlaceholder(container, "reporter@gridproof.test");
    const registerForm = Array.from(container.querySelectorAll("form")).find((form) =>
      form.textContent?.includes("Register / upgrade account")
    );
    if (!registerForm) throw new Error("Expected register form");

    await act(async () => {
      setInputValue(identityInput, "reporter@gridproof.test");
      identityInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      registerForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(authRegisterMock).toHaveBeenCalledWith({
      phoneOrEmail: "reporter@gridproof.test",
      role: "reporter",
      inviteCode: undefined
    });
    expect(storage.get("gridproof.authToken")).toBe("issued.jwt");
    await waitFor(() => expect(container?.textContent).toContain("Registered reporter session"));
  });

  it("logs in demo sessions and saves returned bearer tokens", async () => {
    authMeMock.mockResolvedValue({ user: null });
    authLoginMock.mockResolvedValue({
      user,
      token: "login.jwt",
      expiresAt: "2026-08-09T13:00:00.000Z"
    });
    stubLocalStorage();

    container = renderAuthSettings();

    await waitFor(() => expect(container?.textContent).toContain("Sign in or change access"));
    const identityInput = inputByPlaceholder(container, "reporter@gridproof.test");
    const loginButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Sign in to existing account")
    );
    if (!loginButton) throw new Error("Expected login button");

    await act(async () => {
      setInputValue(identityInput, "reviewer@gridproof.test");
      identityInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      loginButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(authLoginMock).toHaveBeenCalledWith({ phoneOrEmail: "reviewer@gridproof.test" });
    expect(storage.get("gridproof.authToken")).toBe("login.jwt");
    await waitFor(() => expect(container?.textContent).toContain("Logged in as reviewer."));
  });

  function renderAuthSettings(): HTMLDivElement {
    const element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);

    act(() => {
      root?.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <AuthSettings />
        </QueryClientProvider>
      );
    });

    return element;
  }

  function stubLocalStorage(entries: Array<[string, string]> = []): void {
    storage = new Map(entries);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      })
    });
  }
});

function textareaByPlaceholder(container: HTMLElement | null, placeholder: string): HTMLTextAreaElement {
  const textarea = Array.from(container?.querySelectorAll("textarea") ?? []).find(
    (item) => item.placeholder === placeholder
  );
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error(`Textarea not found: ${placeholder}`);
  return textarea;
}

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("Unable to set textarea value");
  setter.call(textarea, value);
}

function inputByPlaceholder(container: HTMLElement | null, placeholder: string): HTMLInputElement {
  const input = Array.from(container?.querySelectorAll("input") ?? []).find((item) => item.placeholder === placeholder);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${placeholder}`);
  return input;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
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
