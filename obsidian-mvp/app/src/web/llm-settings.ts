import {
  OPENAI_CODEX_AUTH_URL,
  OPENAI_CODEX_BASE_URL,
  OPENAI_CODEX_CALLBACK_PORT,
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_CODEX_MODEL,
  OPENAI_CODEX_ORIGINATOR,
  OPENAI_CODEX_PROVIDER,
  OPENAI_CODEX_PROVIDER_LABEL,
  OPENAI_CODEX_SCOPE,
  OPENAI_CODEX_TOKEN_URL,
  OPENAI_KEY_PROVIDER,
} from "../config/constants.js";
import {
  activateStoredLlmProfile,
  deleteStoredLlmProfile,
  getLlmConfig,
  listStoredLlmProfiles,
  getStoredLlmSettings,
  updateStoredLlmProfileCalibration,
  upsertStoredLlmProfile,
  validateStoredLlmProfile,
  type StoredLlmSettings,
} from "../config/env.js";
import { buildCodexAuthorizeUrl, createOauthState, createPkcePair, ensureOauthCallbackServer } from "./oauth.js";
import { sendJson } from "./http.js";
import { setPendingOauthRequest } from "./oauth-state.js";

type CalibrateProfile = (vaultRoot: string, profile: StoredLlmSettings) => Promise<{
  ok: boolean;
  calibration: unknown;
  message: string;
}>;

type RunConnectivityTest = (settings: StoredLlmSettings) => Promise<unknown>;

function hasBodyField(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function normalizeCodexModel(model: unknown, allowedModels: readonly string[]): string {
  if (typeof model !== "string" || !model.trim()) {
    return OPENAI_CODEX_MODEL;
  }
  return allowedModels.includes(model) ? model : OPENAI_CODEX_MODEL;
}

export async function handleSaveLlmSettings(input: {
  vaultRoot: string;
  body: Record<string, unknown>;
  allowedModels: readonly string[];
  calibrateProfile: CalibrateProfile;
  res: Parameters<typeof sendJson>[0];
}) {
  const { vaultRoot, body, allowedModels, calibrateProfile, res } = input;
  const provider =
    body.provider === OPENAI_CODEX_PROVIDER ? OPENAI_CODEX_PROVIDER : OPENAI_KEY_PROVIDER;
  const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
  const profiles = listStoredLlmProfiles(vaultRoot);
  const existing =
    profileId
      ? profiles.profiles.find((profile) => profile.id === profileId) ?? null
      : null;
  const isEditingExisting = Boolean(profileId && existing?.id === profileId);
  const profileName = typeof body.name === "string" ? body.name.trim() : "";
  const isCodex = provider === OPENAI_CODEX_PROVIDER;
  const model = isCodex
    ? normalizeCodexModel(body.model ?? existing?.model, allowedModels)
    : typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : existing?.model || OPENAI_CODEX_MODEL;
  const fallbackModels =
    Array.isArray(body.fallbackModels)
      ? body.fallbackModels
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : typeof body.fallbackModels === "string"
        ? body.fallbackModels
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : existing?.fallbackModels || [];
  const fallbackProfileIds =
    Array.isArray(body.fallbackProfileIds)
      ? body.fallbackProfileIds
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : typeof body.fallbackProfileIds === "string"
        ? body.fallbackProfileIds
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : existing?.fallbackProfileIds || [];

  const tokenInput = typeof body.bearerToken === "string" ? body.bearerToken : "";
  if (isCodex && tokenInput.trim()) {
    sendJson(res, 400, {
      error: "OAuth 卡片不支持手工填写 token。请保存卡片后点击“开始 OAuth 登录”。",
    });
    return true;
  }
  const preserveExistingToken = isEditingExisting && !tokenInput;

  const candidateSettings: Partial<StoredLlmSettings> = {
    id: isEditingExisting ? profileId : undefined,
    name: profileName || existing?.name || "",
    provider,
    apiType:
      isCodex
        ? "openai-completions"
        : body.apiType === "anthropic-messages"
          ? "anthropic-messages"
          : "openai-completions",
    bearerToken: preserveExistingToken ? existing?.bearerToken ?? "" : tokenInput,
    baseUrl:
      isCodex
        ? OPENAI_CODEX_BASE_URL
        : typeof body.baseUrl === "string" && body.baseUrl.trim()
          ? body.baseUrl.trim()
          : existing?.baseUrl || OPENAI_CODEX_BASE_URL,
    model,
    authUrl:
      isCodex
        ? OPENAI_CODEX_AUTH_URL
        : hasBodyField(body, "authUrl")
          ? typeof body.authUrl === "string"
            ? body.authUrl.trim()
            : ""
          : existing?.authUrl || "",
    tokenUrl:
      isCodex
        ? OPENAI_CODEX_TOKEN_URL
        : hasBodyField(body, "tokenUrl")
          ? typeof body.tokenUrl === "string"
            ? body.tokenUrl.trim()
            : ""
          : existing?.tokenUrl || "",
    clientId:
      isCodex
        ? OPENAI_CODEX_CLIENT_ID
        : hasBodyField(body, "clientId")
          ? typeof body.clientId === "string"
            ? body.clientId.trim()
            : ""
          : existing?.clientId || "",
    scope:
      isCodex
        ? OPENAI_CODEX_SCOPE
        : hasBodyField(body, "scope")
          ? typeof body.scope === "string"
            ? body.scope.trim()
            : ""
          : existing?.scope || "",
    oauthAccessToken: isCodex ? existing?.oauthAccessToken : undefined,
    oauthIdToken: isCodex ? existing?.oauthIdToken : undefined,
    refreshToken: isCodex ? existing?.refreshToken : undefined,
    routingEnabled:
      typeof body.routingEnabled === "boolean"
        ? body.routingEnabled
        : existing?.routingEnabled ?? false,
    fastProfileId:
      typeof body.fastProfileId === "string"
        ? body.fastProfileId.trim()
        : existing?.fastProfileId || "",
    strongProfileId:
      typeof body.strongProfileId === "string"
        ? body.strongProfileId.trim()
        : existing?.strongProfileId || "",
    fallbackProfileIds,
    fastModel:
      typeof body.fastModel === "string" && body.fastModel.trim()
        ? body.fastModel.trim()
        : existing?.fastModel || model,
    strongModel:
      typeof body.strongModel === "string" && body.strongModel.trim()
        ? body.strongModel.trim()
        : existing?.strongModel || model,
    fallbackModels,
  };
  const validProfileIds = new Set(profiles.profiles.map((profile) => profile.id));
  const referencedProfileIds = [
    candidateSettings.fastProfileId || "",
    candidateSettings.strongProfileId || "",
    ...(candidateSettings.fallbackProfileIds || []),
  ]
    .filter(Boolean)
    .filter((id) => id !== profileId);
  const missingProfileId = referencedProfileIds.find((id) => !validProfileIds.has(id));
  if (missingProfileId) {
    sendJson(res, 400, { error: `跨卡路由引用了不存在的模型卡：${missingProfileId}` });
    return true;
  }
  const validation = validateStoredLlmProfile(candidateSettings);
  if (validation.errors.length) {
    sendJson(res, 400, { error: validation.errors[0], validation });
    return true;
  }

  const shouldActivate =
    !profiles.activeProfileId || (Boolean(profileId) && profiles.activeProfileId === profileId);
  const settings = upsertStoredLlmProfile(vaultRoot, { ...candidateSettings }, { activate: shouldActivate }).profile;
  const calibration = settings.bearerToken.trim()
    ? await calibrateProfile(vaultRoot, settings)
    : {
        ok: false,
        calibration: updateStoredLlmProfileCalibration(vaultRoot, settings.id, {
          status: "pending",
          usable: false,
          message:
            settings.provider === OPENAI_CODEX_PROVIDER
              ? "等待 OAuth 登录完成后自动校准。"
              : "等待填写可用 token 后自动校准。",
          checkedAt: new Date().toISOString(),
          structuredOutput: "unknown",
        }).profile.calibration,
        message:
          settings.provider === OPENAI_CODEX_PROVIDER
            ? "等待 OAuth 登录完成后自动校准。"
            : "等待填写可用 token 后自动校准。",
      };
  const latestSettings =
    listStoredLlmProfiles(vaultRoot).profiles.find((profile) => profile.id === settings.id) ?? settings;
  const resolved = getLlmConfig(vaultRoot);
  sendJson(res, 200, { settings: latestSettings, resolved, validation, calibration });
  return true;
}

export async function handleTestLlmSettings(input: {
  vaultRoot: string;
  body: Record<string, unknown>;
  allowedModels: readonly string[];
  runConnectivityTest: RunConnectivityTest;
  res: Parameters<typeof sendJson>[0];
}) {
  const { vaultRoot, body, allowedModels, runConnectivityTest, res } = input;
  const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
  const profiles = listStoredLlmProfiles(vaultRoot);
  const existing =
    profileId
      ? profiles.profiles.find((profile) => profile.id === profileId) ?? null
      : null;
  const isEditingExisting = Boolean(profileId && existing?.id === profileId);

  let candidate: Partial<StoredLlmSettings> | StoredLlmSettings | null = null;
  if (profileId && existing?.id === profileId) {
    candidate = existing;
  } else if (typeof body.provider === "string") {
    const provider =
      body.provider === OPENAI_CODEX_PROVIDER ? OPENAI_CODEX_PROVIDER : OPENAI_KEY_PROVIDER;
    const isCodex = provider === OPENAI_CODEX_PROVIDER;
    const model = isCodex
      ? normalizeCodexModel(body.model ?? existing?.model, allowedModels)
      : typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : existing?.model || OPENAI_CODEX_MODEL;
    const fallbackModels =
      Array.isArray(body.fallbackModels)
        ? body.fallbackModels
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
    const tokenInput = typeof body.bearerToken === "string" ? body.bearerToken : "";
    if (isCodex && tokenInput.trim()) {
      sendJson(res, 400, {
        error: "OAuth 卡片不支持手工填写 token。请保存卡片后点击“开始 OAuth 登录”。",
      });
      return true;
    }
    const preserveExistingToken = isEditingExisting && !tokenInput;
    candidate = {
      id: isEditingExisting ? profileId : undefined,
      name:
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : existing?.name || "",
      provider,
      apiType:
        isCodex
          ? "openai-completions"
          : body.apiType === "anthropic-messages"
            ? "anthropic-messages"
            : "openai-completions",
      bearerToken: preserveExistingToken ? existing?.bearerToken ?? "" : tokenInput,
      baseUrl:
        isCodex
          ? OPENAI_CODEX_BASE_URL
          : typeof body.baseUrl === "string" && body.baseUrl.trim()
            ? body.baseUrl.trim()
            : existing?.baseUrl || OPENAI_CODEX_BASE_URL,
      model,
      authUrl:
        isCodex
          ? OPENAI_CODEX_AUTH_URL
          : hasBodyField(body, "authUrl")
            ? typeof body.authUrl === "string"
              ? body.authUrl.trim()
              : ""
            : existing?.authUrl || "",
      tokenUrl:
        isCodex
          ? OPENAI_CODEX_TOKEN_URL
          : hasBodyField(body, "tokenUrl")
            ? typeof body.tokenUrl === "string"
              ? body.tokenUrl.trim()
              : ""
            : existing?.tokenUrl || "",
      clientId:
        isCodex
          ? OPENAI_CODEX_CLIENT_ID
          : hasBodyField(body, "clientId")
            ? typeof body.clientId === "string"
              ? body.clientId.trim()
              : ""
            : existing?.clientId || "",
      scope:
        isCodex
          ? OPENAI_CODEX_SCOPE
          : hasBodyField(body, "scope")
            ? typeof body.scope === "string"
              ? body.scope.trim()
              : ""
            : existing?.scope || "",
      oauthAccessToken: isCodex ? existing?.oauthAccessToken : undefined,
      oauthIdToken: isCodex ? existing?.oauthIdToken : undefined,
      refreshToken: isCodex ? existing?.refreshToken : undefined,
      routingEnabled:
        typeof body.routingEnabled === "boolean"
          ? body.routingEnabled
          : existing?.routingEnabled ?? false,
      fastModel:
        typeof body.fastModel === "string" && body.fastModel.trim()
          ? body.fastModel.trim()
          : existing?.fastModel || model,
      strongModel:
        typeof body.strongModel === "string" && body.strongModel.trim()
          ? body.strongModel.trim()
          : existing?.strongModel || model,
      fallbackModels,
    };
  }

  if (!candidate) {
    sendJson(res, 400, { error: "Missing profileId or model config payload." });
    return true;
  }

  const result = await runConnectivityTest({
    ...candidate,
    id:
      typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id
        : `llm-preview-${Date.now()}`,
  } as StoredLlmSettings);
  sendJson(res, (result as { ok?: boolean }).ok ? 200 : 400, result);
  return true;
}

export async function handleSelectLlmProfile(input: {
  vaultRoot: string;
  body: Record<string, unknown>;
  res: Parameters<typeof sendJson>[0];
}) {
  const profileId = typeof input.body.profileId === "string" ? input.body.profileId.trim() : "";
  if (!profileId) {
    sendJson(input.res, 400, { error: "Missing profileId." });
    return true;
  }
  const profiles = listStoredLlmProfiles(input.vaultRoot);
  if (!profiles.profiles.some((profile) => profile.id === profileId)) {
    sendJson(input.res, 404, { error: `Model profile not found: ${profileId}` });
    return true;
  }
  const store = activateStoredLlmProfile(input.vaultRoot, profileId);
  sendJson(input.res, 200, { activeProfileId: store.activeProfileId });
  return true;
}

export async function handleDeleteLlmProfile(input: {
  vaultRoot: string;
  body: Record<string, unknown>;
  res: Parameters<typeof sendJson>[0];
}) {
  const profileId = typeof input.body.profileId === "string" ? input.body.profileId.trim() : "";
  if (!profileId) {
    sendJson(input.res, 400, { error: "Missing profileId." });
    return true;
  }
  const profiles = listStoredLlmProfiles(input.vaultRoot);
  if (!profiles.profiles.some((profile) => profile.id === profileId)) {
    sendJson(input.res, 404, { error: `Model profile not found: ${profileId}` });
    return true;
  }
  const store = deleteStoredLlmProfile(input.vaultRoot, profileId);
  sendJson(input.res, 200, {
    activeProfileId: store.activeProfileId,
    remaining: store.profiles.length,
  });
  return true;
}

export async function handleStartCodexOauth(input: {
  vaultRoot: string;
  port: number;
  body: Record<string, string | undefined>;
  allowedModels: readonly string[];
  calibrateProfile: CalibrateProfile;
  res: Parameters<typeof sendJson>[0];
}) {
  const { vaultRoot, port, body, allowedModels, calibrateProfile, res } = input;
  const frontendOrigin = `http://127.0.0.1:${port}`;
  const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
  const profiles = listStoredLlmProfiles(vaultRoot);
  const existing =
    profiles.profiles.find((profile) => profile.id === profileId) ??
    getStoredLlmSettings(vaultRoot);
  await ensureOauthCallbackServer({
    vaultRoot,
    calibrateProfile,
  });
  const selectedModel = normalizeCodexModel(body.model ?? existing?.model, allowedModels);
  const profileName = typeof body.name === "string" ? body.name.trim() : "";

  const settings = upsertStoredLlmProfile(vaultRoot, {
    id: profileId || undefined,
    name: profileName || undefined,
    provider: OPENAI_CODEX_PROVIDER,
    apiType: "openai-completions",
    bearerToken: existing?.bearerToken ?? "",
    baseUrl: OPENAI_CODEX_BASE_URL,
    model: selectedModel,
    authUrl: OPENAI_CODEX_AUTH_URL,
    tokenUrl: OPENAI_CODEX_TOKEN_URL,
    clientId: OPENAI_CODEX_CLIENT_ID,
    scope: OPENAI_CODEX_SCOPE,
    oauthAccessToken: existing?.oauthAccessToken,
    oauthIdToken: existing?.oauthIdToken,
    refreshToken: existing?.refreshToken,
  }, { activate: profiles.activeProfileId === profileId || !profiles.activeProfileId || !profileId }).profile;

  const { verifier, challenge } = createPkcePair();
  const state = createOauthState();
  const redirectUri = `http://localhost:${OPENAI_CODEX_CALLBACK_PORT}/auth/callback`;
  await setPendingOauthRequest(vaultRoot, {
    state,
    profileId: settings.id,
    codeVerifier: verifier,
    redirectUri,
    tokenUrl: settings.tokenUrl,
    clientId: settings.clientId,
    scope: settings.scope,
    baseUrl: settings.baseUrl,
    model: settings.model,
    frontendOrigin,
    createdAt: Date.now(),
  });

  const authUrl = buildCodexAuthorizeUrl({
    redirectUri,
    state,
    challenge,
    originator: OPENAI_CODEX_ORIGINATOR,
  });
  const fallbackOriginator = OPENAI_CODEX_ORIGINATOR === "pi" ? "codex_cli_rs" : "pi";
  const fallbackAuthUrl = buildCodexAuthorizeUrl({
    redirectUri,
    state,
    challenge,
    originator: fallbackOriginator,
  });

  sendJson(res, 200, {
    authUrl,
    fallbackAuthUrl,
    redirectUri,
    state,
    profileId: settings.id,
    provider: OPENAI_CODEX_PROVIDER_LABEL,
  });
  return true;
}
