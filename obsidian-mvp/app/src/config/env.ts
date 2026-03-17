import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_VAULT_ROOT,
  LLM_SETTINGS_FILE_NAME,
  OPENAI_CODEX_AUTH_URL,
  OPENAI_CODEX_BASE_URL,
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_CODEX_ALLOWED_MODELS,
  OPENAI_CODEX_MODEL,
  OPENAI_CODEX_PROVIDER,
  OPENAI_CODEX_SCOPE,
  OPENAI_CODEX_TOKEN_URL,
  OPENAI_KEY_PROVIDER,
} from "./constants.js";

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
  provider: string;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  oauthAccessToken?: string;
  oauthIdToken?: string;
  refreshToken?: string;
  routingEnabled?: boolean;
  fastModel?: string;
  strongModel?: string;
  fallbackModels?: string[];
  updatedAt?: string;
};

function normalizeProvider(provider: unknown): string {
  if (typeof provider !== "string" || !provider.trim()) {
    return OPENAI_CODEX_PROVIDER;
  }

  if (provider === OPENAI_CODEX_PROVIDER || provider === OPENAI_KEY_PROVIDER) {
    return provider;
  }

  return OPENAI_KEY_PROVIDER;
}

function getSettingsPath(vaultRoot: string): string {
  return join(vaultRoot, LLM_SETTINGS_FILE_NAME);
}

function normalizeCodexModel(model: unknown): string {
  if (typeof model !== "string" || !model.trim()) {
    return OPENAI_CODEX_MODEL;
  }

  return OPENAI_CODEX_ALLOWED_MODELS.includes(model as (typeof OPENAI_CODEX_ALLOWED_MODELS)[number])
    ? model
    : OPENAI_CODEX_MODEL;
}

function normalizeStoredSettings(input: Partial<StoredLlmSettings> | null): StoredLlmSettings {
  const provider = normalizeProvider(input?.provider);
  const isCodexProvider = provider === OPENAI_CODEX_PROVIDER;

  return {
    bearerToken: typeof input?.bearerToken === "string" ? input.bearerToken : "",
    baseUrl: isCodexProvider
      ? OPENAI_CODEX_BASE_URL
      : typeof input?.baseUrl === "string" && input.baseUrl.trim()
        ? input.baseUrl
        : OPENAI_CODEX_BASE_URL,
    model: isCodexProvider ? normalizeCodexModel(input?.model) : typeof input?.model === "string" && input.model.trim() ? input.model : OPENAI_CODEX_MODEL,
    provider,
    authUrl:
      isCodexProvider
        ? OPENAI_CODEX_AUTH_URL
        : typeof input?.authUrl === "string" && input.authUrl.trim()
        ? input.authUrl
        : OPENAI_CODEX_AUTH_URL,
    tokenUrl:
      isCodexProvider
        ? OPENAI_CODEX_TOKEN_URL
        : typeof input?.tokenUrl === "string" && input.tokenUrl.trim()
        ? input.tokenUrl
        : OPENAI_CODEX_TOKEN_URL,
    clientId:
      isCodexProvider
        ? OPENAI_CODEX_CLIENT_ID
        : typeof input?.clientId === "string" && input.clientId.trim()
        ? input.clientId
        : OPENAI_CODEX_CLIENT_ID,
    scope:
      isCodexProvider
        ? OPENAI_CODEX_SCOPE
        : typeof input?.scope === "string" && input.scope.trim()
        ? input.scope
        : OPENAI_CODEX_SCOPE,
    oauthAccessToken:
      typeof input?.oauthAccessToken === "string" ? input.oauthAccessToken : undefined,
    oauthIdToken: typeof input?.oauthIdToken === "string" ? input.oauthIdToken : undefined,
    refreshToken: typeof input?.refreshToken === "string" ? input.refreshToken : undefined,
    routingEnabled: typeof input?.routingEnabled === "boolean" ? input.routingEnabled : false,
    fastModel: typeof input?.fastModel === "string" && input.fastModel.trim() ? input.fastModel.trim() : OPENAI_CODEX_MODEL,
    strongModel:
      typeof input?.strongModel === "string" && input.strongModel.trim()
        ? input.strongModel.trim()
        : OPENAI_CODEX_MODEL,
    fallbackModels: Array.isArray(input?.fallbackModels)
      ? input.fallbackModels
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [],
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
  const existing = getStoredLlmSettings(vaultRoot);
  const nextSettings = normalizeStoredSettings({
    ...existing,
    ...settings,
    updatedAt: new Date().toISOString(),
  });

  writeFileSync(getSettingsPath(vaultRoot), JSON.stringify(nextSettings, null, 2) + "\n", "utf8");
  return nextSettings;
}

export function getLlmConfig(vaultRoot = DEFAULT_VAULT_ROOT): LlmConfig {
  const saved = getStoredLlmSettings(vaultRoot);
  const envBearerToken = process.env.OPENAI_BEARER_TOKEN ?? process.env.OPENAI_API_KEY ?? null;
  const envBaseUrl = process.env.OPENAI_BASE_URL ?? OPENAI_CODEX_BASE_URL;
  const envModel = process.env.OPENAI_MODEL ?? OPENAI_CODEX_MODEL;

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
