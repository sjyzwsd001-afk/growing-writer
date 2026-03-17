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
  id: string;
  name: string;
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
  createdAt?: string;
  updatedAt?: string;
};

export type StoredLlmSettingsStore = {
  version: 2;
  activeProfileId: string;
  profiles: StoredLlmSettings[];
  updatedAt?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function makeProfileId(): string {
  return `llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

function defaultProfileName(provider: string, model: string): string {
  if (provider === OPENAI_CODEX_PROVIDER) {
    return `OpenAI Codex ${model || OPENAI_CODEX_MODEL}`;
  }
  return `API Key ${model || OPENAI_CODEX_MODEL}`;
}

function normalizeStoredSettings(
  input: Partial<StoredLlmSettings> | null,
  fallback?: Partial<StoredLlmSettings>,
): StoredLlmSettings {
  const provider = normalizeProvider(input?.provider ?? fallback?.provider);
  const isCodexProvider = provider === OPENAI_CODEX_PROVIDER;
  const rawModel = input?.model ?? fallback?.model;
  const model = isCodexProvider
    ? normalizeCodexModel(rawModel)
    : typeof rawModel === "string" && rawModel.trim()
      ? rawModel.trim()
      : OPENAI_CODEX_MODEL;
  const createdAt =
    typeof input?.createdAt === "string"
      ? input.createdAt
      : typeof fallback?.createdAt === "string"
        ? fallback.createdAt
        : nowIso();
  const updatedAt =
    typeof input?.updatedAt === "string"
      ? input.updatedAt
      : typeof fallback?.updatedAt === "string"
        ? fallback.updatedAt
        : createdAt;

  return {
    id:
      typeof input?.id === "string" && input.id.trim()
        ? input.id.trim()
        : typeof fallback?.id === "string" && fallback.id.trim()
          ? fallback.id.trim()
          : makeProfileId(),
    name:
      typeof input?.name === "string" && input.name.trim()
        ? input.name.trim()
        : typeof fallback?.name === "string" && fallback.name.trim()
          ? fallback.name.trim()
          : defaultProfileName(provider, model),
    bearerToken:
      typeof input?.bearerToken === "string"
        ? input.bearerToken
        : typeof fallback?.bearerToken === "string"
          ? fallback.bearerToken
          : "",
    baseUrl: isCodexProvider
      ? OPENAI_CODEX_BASE_URL
      : typeof input?.baseUrl === "string" && input.baseUrl.trim()
        ? input.baseUrl.trim()
        : typeof fallback?.baseUrl === "string" && fallback.baseUrl.trim()
          ? fallback.baseUrl.trim()
          : OPENAI_CODEX_BASE_URL,
    model,
    provider,
    authUrl:
      isCodexProvider
        ? OPENAI_CODEX_AUTH_URL
        : typeof input?.authUrl === "string" && input.authUrl.trim()
          ? input.authUrl.trim()
          : typeof fallback?.authUrl === "string" && fallback.authUrl.trim()
            ? fallback.authUrl.trim()
            : OPENAI_CODEX_AUTH_URL,
    tokenUrl:
      isCodexProvider
        ? OPENAI_CODEX_TOKEN_URL
        : typeof input?.tokenUrl === "string" && input.tokenUrl.trim()
          ? input.tokenUrl.trim()
          : typeof fallback?.tokenUrl === "string" && fallback.tokenUrl.trim()
            ? fallback.tokenUrl.trim()
            : OPENAI_CODEX_TOKEN_URL,
    clientId:
      isCodexProvider
        ? OPENAI_CODEX_CLIENT_ID
        : typeof input?.clientId === "string" && input.clientId.trim()
          ? input.clientId.trim()
          : typeof fallback?.clientId === "string" && fallback.clientId.trim()
            ? fallback.clientId.trim()
            : OPENAI_CODEX_CLIENT_ID,
    scope:
      isCodexProvider
        ? OPENAI_CODEX_SCOPE
        : typeof input?.scope === "string" && input.scope.trim()
          ? input.scope.trim()
          : typeof fallback?.scope === "string" && fallback.scope.trim()
            ? fallback.scope.trim()
            : OPENAI_CODEX_SCOPE,
    oauthAccessToken:
      typeof input?.oauthAccessToken === "string"
        ? input.oauthAccessToken
        : typeof fallback?.oauthAccessToken === "string"
          ? fallback.oauthAccessToken
          : undefined,
    oauthIdToken:
      typeof input?.oauthIdToken === "string"
        ? input.oauthIdToken
        : typeof fallback?.oauthIdToken === "string"
          ? fallback.oauthIdToken
          : undefined,
    refreshToken:
      typeof input?.refreshToken === "string"
        ? input.refreshToken
        : typeof fallback?.refreshToken === "string"
          ? fallback.refreshToken
          : undefined,
    routingEnabled:
      typeof input?.routingEnabled === "boolean"
        ? input.routingEnabled
        : typeof fallback?.routingEnabled === "boolean"
          ? fallback.routingEnabled
          : false,
    fastModel:
      typeof input?.fastModel === "string" && input.fastModel.trim()
        ? input.fastModel.trim()
        : typeof fallback?.fastModel === "string" && fallback.fastModel.trim()
          ? fallback.fastModel.trim()
          : OPENAI_CODEX_MODEL,
    strongModel:
      typeof input?.strongModel === "string" && input.strongModel.trim()
        ? input.strongModel.trim()
        : typeof fallback?.strongModel === "string" && fallback.strongModel.trim()
          ? fallback.strongModel.trim()
          : OPENAI_CODEX_MODEL,
    fallbackModels: Array.isArray(input?.fallbackModels)
      ? input.fallbackModels
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 6)
      : Array.isArray(fallback?.fallbackModels)
        ? fallback.fallbackModels
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 6)
        : [],
    createdAt,
    updatedAt,
  };
}

function normalizeLegacyStore(input: Partial<StoredLlmSettings> | null): StoredLlmSettingsStore | null {
  if (!input) {
    return null;
  }

  const profile = normalizeStoredSettings(input);
  return {
    version: 2,
    activeProfileId: profile.id,
    profiles: [profile],
    updatedAt: profile.updatedAt,
  };
}

function normalizeStoredSettingsStore(raw: unknown): StoredLlmSettingsStore | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const input = raw as Record<string, unknown>;
  if (!Array.isArray(input.profiles)) {
    return normalizeLegacyStore(input as Partial<StoredLlmSettings>);
  }

  const profiles = input.profiles
    .map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? normalizeStoredSettings(item as Partial<StoredLlmSettings>)
        : null,
    )
    .filter((item): item is StoredLlmSettings => Boolean(item));

  if (!profiles.length) {
    return null;
  }

  const requestedActiveId =
    typeof input.activeProfileId === "string" && input.activeProfileId.trim()
      ? input.activeProfileId.trim()
      : "";
  const activeProfileId = profiles.some((profile) => profile.id === requestedActiveId)
    ? requestedActiveId
    : profiles[0].id;

  return {
    version: 2,
    activeProfileId,
    profiles,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : profiles[0].updatedAt,
  };
}

function readStoredSettingsStore(vaultRoot: string): StoredLlmSettingsStore | null {
  const path = getSettingsPath(vaultRoot);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf8");
    return normalizeStoredSettingsStore(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStoredSettingsStore(
  vaultRoot: string,
  store: StoredLlmSettingsStore,
): StoredLlmSettingsStore {
  const next = {
    ...store,
    updatedAt: nowIso(),
  };
  writeFileSync(getSettingsPath(vaultRoot), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export function getStoredLlmStore(vaultRoot = DEFAULT_VAULT_ROOT): StoredLlmSettingsStore | null {
  return readStoredSettingsStore(vaultRoot);
}

export function listStoredLlmProfiles(vaultRoot = DEFAULT_VAULT_ROOT): {
  activeProfileId: string;
  profiles: StoredLlmSettings[];
} {
  const store = readStoredSettingsStore(vaultRoot);
  return {
    activeProfileId: store?.activeProfileId ?? "",
    profiles: store?.profiles ?? [],
  };
}

export function getStoredLlmSettings(vaultRoot = DEFAULT_VAULT_ROOT): StoredLlmSettings | null {
  const store = readStoredSettingsStore(vaultRoot);
  if (!store) {
    return null;
  }
  return store.profiles.find((profile) => profile.id === store.activeProfileId) ?? store.profiles[0] ?? null;
}

export function saveStoredLlmSettings(
  vaultRoot = DEFAULT_VAULT_ROOT,
  settings: Partial<StoredLlmSettings>,
): StoredLlmSettings {
  const existingStore = readStoredSettingsStore(vaultRoot);
  const existingActive =
    existingStore?.profiles.find((profile) => profile.id === existingStore.activeProfileId) ?? null;
  const profile = normalizeStoredSettings(
    {
      ...existingActive,
      ...settings,
      id: typeof settings.id === "string" && settings.id.trim() ? settings.id.trim() : existingActive?.id,
      createdAt: existingActive?.createdAt,
      updatedAt: nowIso(),
    },
    existingActive ?? undefined,
  );
  const otherProfiles =
    existingStore?.profiles.filter((item) => item.id !== profile.id) ?? [];
  writeStoredSettingsStore(vaultRoot, {
    version: 2,
    activeProfileId: profile.id,
    profiles: [profile, ...otherProfiles],
  });
  return profile;
}

export function upsertStoredLlmProfile(
  vaultRoot = DEFAULT_VAULT_ROOT,
  settings: Partial<StoredLlmSettings> & { id?: string; name?: string },
  options?: { activate?: boolean },
): { profile: StoredLlmSettings; store: StoredLlmSettingsStore } {
  const store = readStoredSettingsStore(vaultRoot);
  const existingProfile =
    store?.profiles.find((profile) => profile.id === settings.id) ?? null;
  const profile = normalizeStoredSettings(
    {
      ...existingProfile,
      ...settings,
      id: typeof settings.id === "string" && settings.id.trim() ? settings.id.trim() : existingProfile?.id,
      createdAt: existingProfile?.createdAt,
      updatedAt: nowIso(),
    },
    existingProfile ?? undefined,
  );

  const profiles = [
    profile,
    ...(store?.profiles.filter((item) => item.id !== profile.id) ?? []),
  ];
  const nextStore = writeStoredSettingsStore(vaultRoot, {
    version: 2,
    activeProfileId:
      options?.activate === false
        ? store?.activeProfileId && profiles.some((item) => item.id === store.activeProfileId)
          ? store.activeProfileId
          : profile.id
        : profile.id,
    profiles,
  });

  return { profile, store: nextStore };
}

export function activateStoredLlmProfile(
  vaultRoot = DEFAULT_VAULT_ROOT,
  profileId: string,
): StoredLlmSettingsStore {
  const store = readStoredSettingsStore(vaultRoot);
  if (!store || !store.profiles.some((profile) => profile.id === profileId)) {
    throw new Error(`LLM profile not found: ${profileId}`);
  }
  return writeStoredSettingsStore(vaultRoot, {
    ...store,
    activeProfileId: profileId,
  });
}

export function deleteStoredLlmProfile(
  vaultRoot = DEFAULT_VAULT_ROOT,
  profileId: string,
): StoredLlmSettingsStore {
  const store = readStoredSettingsStore(vaultRoot);
  if (!store) {
    throw new Error("No saved LLM profiles.");
  }

  const profiles = store.profiles.filter((profile) => profile.id !== profileId);
  if (!profiles.length) {
    const nextStore: StoredLlmSettingsStore = {
      version: 2,
      activeProfileId: "",
      profiles: [],
      updatedAt: nowIso(),
    };
    return writeStoredSettingsStore(vaultRoot, nextStore);
  }

  const activeProfileId =
    store.activeProfileId === profileId ? profiles[0].id : store.activeProfileId;
  return writeStoredSettingsStore(vaultRoot, {
    version: 2,
    activeProfileId,
    profiles,
  });
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
