import { z, type ZodType, ZodError } from "zod";

import type { LlmConfig } from "../config/env.js";

const LLM_REQUEST_TIMEOUT_MS = 45_000;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

const chatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          reasoning_content: z.string().nullable().optional(),
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
  schemaHint?: string;
  maxTokens?: number;
  timeoutMs?: number;
  repairOnParseError?: boolean;
};

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    return fenced[1].trim();
  }
  const fencedAnywhere = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedAnywhere) {
    return fencedAnywhere[1].trim();
  }
  return trimmed;
}

function findBalancedJson(raw: string): string | null {
  const source = raw.trim();
  const start = Math.min(
    ...["{", "["]
      .map((char) => {
        const index = source.indexOf(char);
        return index >= 0 ? index : Number.POSITIVE_INFINITY;
      }),
  );
  if (!Number.isFinite(start)) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1).trim();
      }
    }
  }

  return null;
}

function tryParseJsonCandidates(raw: string): unknown {
  const base = extractJsonPayload(raw);
  const balanced = findBalancedJson(base);
  const balancedFromRaw = findBalancedJson(raw);
  const candidates = [raw.trim(), base, balanced]
    .concat(balancedFromRaw ? [balancedFromRaw] : [])
    .filter((item): item is string => Boolean(item && item.trim()))
    .flatMap((item) => [item, item.replace(/,\s*([}\]])/g, "$1")]);

  const seen = new Set<string>();
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Failed to parse model JSON.");
}

function buildLlmRequestError(status: number, body: string): Error {
  if (/deactivated_workspace/i.test(body)) {
    return new Error(
      "OpenAI Codex OAuth 已失效：当前账号绑定的 workspace 已停用或不再可用。请在模型设置里重新执行 OAuth 登录后再试。",
    );
  }

  return new Error(`LLM request failed: ${status} ${body}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "AbortError") {
    return true;
  }

  return /fetch failed|network|timed out|timeout|econnreset|socket|520|522|524/i.test(error.message);
}

function shouldFallbackToTextResponse(status: number, body: string): boolean {
  if (status !== 400) {
    return false;
  }

  return /response_format\.type.+json_schema.+text/i.test(body);
}

export class OpenAiCompatibleClient {
  constructor(private readonly config: LlmConfig) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }

  private async requestText(options: {
    system: string;
    user: string;
    schemaHint?: string;
    maxTokens?: number;
    timeoutMs?: number;
  }): Promise<string> {
    if (!this.config.bearerToken) {
      throw new Error("OPENAI_BEARER_TOKEN or OPENAI_API_KEY is not configured.");
    }

    const timeoutMs = options.timeoutMs ?? LLM_REQUEST_TIMEOUT_MS;
    const maxAttempts = this.config.apiType === "anthropic-messages" ? 3 : 2;
    let lastError: Error | null = null;
    let openAiResponseFormat: "json_object" | "text" = "json_object";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response =
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
                  max_tokens: options.maxTokens ?? 2048,
                  temperature: 0.1,
                  system: `${options.system}\n\n字段名必须严格匹配目标 JSON 结构，不能自行改名或重组。\n${options.schemaHint ? `目标 JSON 结构示例：\n${options.schemaHint}\n` : ""}\nReturn only valid JSON matching the requested schema.`,
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
                  temperature: 0.1,
                  max_tokens: options.maxTokens,
                  response_format: { type: openAiResponseFormat },
                  messages: [
                    {
                      role: "system",
                      content: `${options.system}\n\n字段名必须严格匹配目标 JSON 结构，不能自行改名或重组。\n${options.schemaHint ? `目标 JSON 结构示例：\n${options.schemaHint}` : ""}`,
                    },
                    { role: "user", content: options.user },
                  ],
                }),
              });

        if (!response.ok) {
          const body = await response.text();
          if (
            this.config.apiType !== "anthropic-messages" &&
            openAiResponseFormat === "json_object" &&
            shouldFallbackToTextResponse(response.status, body)
          ) {
            openAiResponseFormat = "text";
            lastError = new Error(
              `LLM switched to text response mode for compatibility: ${response.status} ${body}`,
            );
            continue;
          }
          const requestError = buildLlmRequestError(response.status, body);
          if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxAttempts) {
            lastError = requestError;
            await delay(500 * attempt);
            continue;
          }
          throw requestError;
        }

        const rawJson = await response.json();
        const content =
          this.config.apiType === "anthropic-messages"
            ? anthropicMessageSchema.parse(rawJson).content
                .filter((item) => item.type === "text" && typeof item.text === "string")
                .map((item) => item.text ?? "")
                .join("\n")
            : (() => {
                const message = chatCompletionSchema.parse(rawJson).choices[0]?.message;
                return message?.content?.trim()
                  ? message.content
                  : message?.reasoning_content?.trim()
                    ? message.reasoning_content
                    : message?.content;
              })();
        if (!content) {
          throw new Error("LLM returned empty content.");
        }

        return content;
      } catch (error) {
        const normalizedError =
          error instanceof Error && error.name === "AbortError"
            ? new Error(`LLM request timed out after ${timeoutMs}ms.`)
            : error instanceof Error
              ? error
              : new Error(String(error));
        lastError = normalizedError;
        if (attempt >= maxAttempts || !isRetryableError(normalizedError)) {
          throw normalizedError;
        }
        await delay(500 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new Error("LLM request failed.");
  }

  async generateJson<T>(options: ChatJsonOptions<T>): Promise<T> {
    const content = await this.requestText(options);

    let parsed: unknown;
    try {
      parsed = tryParseJsonCandidates(content);
    } catch (error) {
      if (options.repairOnParseError !== false) {
        try {
          const repaired = await this.requestText({
            system:
              "You repair almost-valid JSON into strict JSON. Preserve the original meaning and output JSON only.",
            user: `请把下面内容修复为严格合法的 JSON。字段名必须严格匹配目标结构，不要添加解释：\n\n目标结构：\n${options.schemaHint ?? "(未提供)"}\n\n原始内容：\n${content}`,
            schemaHint: options.schemaHint,
            maxTokens: Math.min(options.maxTokens ?? 1800, 1800),
            timeoutMs: Math.min(options.timeoutMs ?? LLM_REQUEST_TIMEOUT_MS, 60_000),
          });
          parsed = tryParseJsonCandidates(repaired);
        } catch (repairError) {
          throw new Error(`Failed to parse model JSON: ${String(repairError)}`);
        }
      } else {
        throw new Error(`Failed to parse model JSON: ${String(error)}`);
      }
    }

    try {
      return options.schema.parse(parsed);
    } catch (error) {
      if (!(error instanceof ZodError) || options.repairOnParseError === false) {
        throw error;
      }

      const repaired = await this.requestText({
        system:
          "You repair JSON so it matches the requested schema exactly. Preserve the original meaning and output JSON only.",
        user: `请把下面 JSON 调整到目标结构要求。字段名必须严格匹配目标结构，不要解释：\n\n目标结构：\n${options.schemaHint ?? "(未提供)"}\n\n原始 JSON：\n${JSON.stringify(parsed, null, 2)}`,
        schemaHint: options.schemaHint,
        maxTokens: Math.min(options.maxTokens ?? 1800, 1800),
        timeoutMs: Math.min(options.timeoutMs ?? LLM_REQUEST_TIMEOUT_MS, 60_000),
      });
      return options.schema.parse(tryParseJsonCandidates(repaired));
    }
  }

  async generateText(options: {
    system: string;
    user: string;
    schemaHint?: string;
    maxTokens?: number;
    timeoutMs?: number;
  }): Promise<string> {
    return this.requestText(options);
  }
}
