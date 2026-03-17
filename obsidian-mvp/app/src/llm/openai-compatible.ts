import { z, type ZodType } from "zod";

import type { LlmConfig } from "../config/env.js";

const LLM_REQUEST_TIMEOUT_MS = 45_000;

const chatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
});

const anthropicMessageSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    }),
  ),
});

type ChatJsonOptions<T> = {
  system: string;
  user: string;
  schema: ZodType<T>;
};

export class OpenAiCompatibleClient {
  constructor(private readonly config: LlmConfig) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }

  async generateJson<T>(options: ChatJsonOptions<T>): Promise<T> {
    if (!this.config.bearerToken) {
      throw new Error("OPENAI_BEARER_TOKEN or OPENAI_API_KEY is not configured.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response =
        this.config.apiType === "anthropic-messages"
          ? await fetch(`${this.config.baseUrl}/messages`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": this.config.bearerToken,
                "anthropic-version": "2023-06-01",
              },
              signal: controller.signal,
              body: JSON.stringify({
                model: this.config.model,
                max_tokens: 4096,
                temperature: 0.2,
                system: `${options.system}\n\nReturn only valid JSON matching the requested schema.`,
                messages: [
                  {
                    role: "user",
                    content: options.user,
                  },
                ],
              }),
            })
          : await fetch(`${this.config.baseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.config.bearerToken}`,
              },
              signal: controller.signal,
              body: JSON.stringify({
                model: this.config.model,
                temperature: 0.2,
                response_format: { type: "json_object" },
                messages: [
                  { role: "system", content: options.system },
                  { role: "user", content: options.user },
                ],
              }),
            });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`LLM request timed out after ${LLM_REQUEST_TIMEOUT_MS}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed: ${response.status} ${body}`);
    }

    const rawJson = await response.json();
    const content =
      this.config.apiType === "anthropic-messages"
        ? anthropicMessageSchema.parse(rawJson).content
            .filter((item) => item.type === "text" && typeof item.text === "string")
            .map((item) => item.text ?? "")
            .join("\n")
        : chatCompletionSchema.parse(rawJson).choices[0]?.message.content;
    if (!content) {
      throw new Error("LLM returned empty content.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse model JSON: ${String(error)}`);
    }

    return options.schema.parse(parsed);
  }
}
