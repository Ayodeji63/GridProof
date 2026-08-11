import { z } from "zod";

const chatChoiceSchema = z.object({
  message: z.object({
    content: z.string()
  })
});

const chatCompletionSchema = z.object({
  choices: z.array(chatChoiceSchema).min(1)
});

export type LlmClientOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function completeJson<T>(
  options: LlmClientOptions,
  messages: ChatMessage[],
  schema: z.ZodSchema<T>
): Promise<T> {
  const controller = new AbortController();
  // Callers should pass timeoutMs explicitly (the worker does, from
  // LLM_TIMEOUT_MS). This fallback matches that default so a caller who omits
  // it does not silently get a tighter budget than the docs promise: a router
  // that fails over between providers can spend seconds before first token.
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

  try {
    const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        temperature: 0.1,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`LLM request failed with ${response.status}`);
    }

    const completion = chatCompletionSchema.parse(await response.json());
    const firstChoice = completion.choices[0];
    if (!firstChoice) {
      throw new Error("LLM response did not include a completion choice");
    }

    return schema.parse(JSON.parse(firstChoice.message.content));
  } finally {
    clearTimeout(timeout);
  }
}
