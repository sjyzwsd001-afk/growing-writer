import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_VAULT_ROOT, LLM_SETTINGS_FILE_NAME } from "./constants.js";

export type LlmConfig = {
  bearerToken: string | null;
  baseUrl: string;
  model: string;
  enabled: boolean;
  source: "saved" | "env" | "default";
};

export type StoredLlmSettings = {
  bearerToken: string;
  baseUrl: string;
  model: string;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  updatedAt?: string;
};

function getSettingsPath(vaultRoot: string): string {
  return join(vaultRoot, LLM_SETTINGS_FILE_NAME);
}

function normalizeStoredSettings(input: Partial<StoredLlmSettings> | null): StoredLlmSettings {
  return {
    bearerToken: typeof input?.bearerToken === "string" ? input.bearerToken : "",
    baseUrl:
      typeof input?.baseUrl === "string" && input.baseUrl.trim()
        ? input.baseUrl
        : "https://api.openai.com/v1",
    model:
      typeof input?.model === "string" && input.model.trim()
        ? input.model
        : "gpt-4.1-mini",
    authUrl: typeof input?.authUrl === "string" ? input.authUrl : "",
    tokenUrl: typeof input?.tokenUrl === "string" ? input.tokenUrl : "",
    clientId: typeof input?.clientId === "string" ? input.clientId : "",
    scope: typeof input?.scope === "string" ? input.scope : "",
    updatedAt: typeof input?.updatedAt === "string" ? input.updatedAt : undefined,
  };
}

export function getStoredLlmSettings(vaultRoot = DEFAULT_VAULT_ROOT): StoredLlmSettings | null {
  const path = getSettingsPath(vaultRoot);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf8");
    return normalizeStoredSettings(JSON.parse(raw) as Partial<StoredLlmSettings>);
  } catch {
    return null;
  }
}

export function saveStoredLlmSettings(
  vaultRoot = DEFAULT_VAULT_ROOT,
  settings: Partial<StoredLlmSettings>,
): StoredLlmSettings {
  const nextSettings = normalizeStoredSettings({
    ...settings,
    updatedAt: new Date().toISOString(),
  });

  writeFileSync(getSettingsPath(vaultRoot), JSON.stringify(nextSettings, null, 2) + "\n", "utf8");
  return nextSettings;
}

export function getLlmConfig(vaultRoot = DEFAULT_VAULT_ROOT): LlmConfig {
  const saved = getStoredLlmSettings(vaultRoot);
  const envBearerToken = process.env.OPENAI_BEARER_TOKEN ?? process.env.OPENAI_API_KEY ?? null;
  const envBaseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const envModel = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  const bearerToken = saved?.bearerToken?.trim() || envBearerToken || null;
  const baseUrl = saved?.baseUrl?.trim() || envBaseUrl;
  const model = saved?.model?.trim() || envModel;
  const source = saved ? "saved" : envBearerToken ? "env" : "default";

  return {
    bearerToken,
    baseUrl,
    model,
    enabled: Boolean(bearerToken),
    source,
  };
}
