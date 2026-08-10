import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeJson } from "../src/llm-client.js";

const options = {
  baseUrl: "https://llm.example/",
  apiKey: "test-key",
  model: "test-model"
};

describe("completeJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts chat completions and parses JSON content through the supplied schema", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ ok: true, confidence: 0.91 })
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const parsed = await completeJson(
      options,
      [{ role: "user", content: "Check this evidence" }],
      z.object({ ok: z.literal(true), confidence: z.number().min(0).max(1) })
    );

    expect(parsed).toEqual({ ok: true, confidence: 0.91 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://llm.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" })
      })
    );
  });

  it("throws when the LLM provider returns a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));

    await expect(
      completeJson(options, [{ role: "user", content: "hello" }], z.object({ ok: z.boolean() }))
    ).rejects.toThrow("LLM request failed with 429");
  });

  it("throws when the completion JSON does not match the requested schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ ok: "yes" }) } }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(
      completeJson(options, [{ role: "user", content: "hello" }], z.object({ ok: z.boolean() }))
    ).rejects.toThrow();
  });
});
