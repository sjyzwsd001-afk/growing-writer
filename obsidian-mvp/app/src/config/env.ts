export type LlmConfig = {
  bearerToken: string | null;
  baseUrl: string;
  model: string;
  enabled: boolean;
};

export function getLlmConfig(): LlmConfig {
  const bearerToken =
    process.env.OPENAI_BEARER_TOKEN ?? process.env.OPENAI_API_KEY ?? null;
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  return {
    bearerToken,
    baseUrl,
    model,
    enabled: Boolean(bearerToken),
  };
}
