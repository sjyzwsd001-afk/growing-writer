import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { promisify } from "node:util";

import {
  OPENAI_CODEX_AUTH_URL,
  OPENAI_CODEX_CALLBACK_PORT,
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_CODEX_ORIGINATOR,
  OPENAI_CODEX_PROVIDER,
  OPENAI_CODEX_SCOPE,
  OPENAI_CODEX_TOKEN_URL,
} from "../config/constants.js";
import { upsertStoredLlmProfile, type StoredLlmSettings } from "../config/env.js";
import { HttpError, sendJson, sendText } from "./http.js";
import {
  consumePendingOauthRequest,
  getPendingOauthRequestCount,
  loadPendingOauthRequests,
  setPendingOauthRequest,
  type PendingOauthRequest,
} from "./oauth-state.js";

const execFileAsync = promisify(execFile);

type OauthCallbackServerState = {
  port: number;
  close: () => Promise<void>;
};

let oauthCallbackServerState: OauthCallbackServerState | null = null;

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function toBase64Padding(input: string): string {
  const remainder = input.length % 4;
  return remainder === 0 ? input : `${input}${"=".repeat(4 - remainder)}`;
}

function buildOauthSuccessPage(frontendOrigin: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>OAuth 已完成</title>
  <style>
    body { font-family: sans-serif; padding: 32px; background: #f7f1e6; color: #2d2518; }
    .card { max-width: 560px; margin: 48px auto; background: white; border-radius: 16px; padding: 24px; border: 1px solid #d9c7a8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>OpenAI Codex 登录成功</h1>
    <p>Codex OAuth 已完成，系统已经把可直接调用模型的 token 写入本地配置。这个窗口会自动关闭，如果没有关闭，可以手动返回控制台页面。</p>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: "oauth-complete", ok: true }, ${JSON.stringify(frontendOrigin)});
      window.close();
    }
  </script>
</body>
</html>`;
}

function buildOauthErrorPage(input: {
  title: string;
  message: string;
  details?: string;
  frontendOrigin?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>OAuth 登录失败</title>
  <style>
    body { font-family: sans-serif; padding: 32px; background: #f7f1e6; color: #2d2518; }
    .card { max-width: 760px; margin: 48px auto; background: white; border-radius: 16px; padding: 24px; border: 1px solid #d9c7a8; }
    .detail { white-space: pre-wrap; background: #f6efe1; padding: 16px; border-radius: 12px; border: 1px solid #e0cfb4; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${input.title}</h1>
    <p>${input.message}</p>
    ${input.details ? `<div class="detail">${input.details}</div>` : ""}
  </div>
  <script>
    if (window.opener && ${JSON.stringify(Boolean(input.frontendOrigin))}) {
      window.opener.postMessage({ type: "oauth-complete", ok: false }, ${JSON.stringify(input.frontendOrigin ?? "")});
    }
  </script>
</body>
</html>`;
}

function parseJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const raw = Buffer.from(toBase64Padding(payload), "base64").toString("utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractOpenAiAuthClaims(jwt: string): Record<string, unknown> | null {
  const payload = parseJwtPayload(jwt);
  if (!payload) {
    return null;
  }

  const authClaims = payload["https://api.openai.com/auth"];
  if (!authClaims || typeof authClaims !== "object") {
    return null;
  }

  return authClaims as Record<string, unknown>;
}

function buildFriendlyOauthExchangeError(input: {
  error: unknown;
  idToken?: string;
}) {
  const rawMessage = input.error instanceof Error ? input.error.message : "OAuth login failed.";
  const authClaims = input.idToken ? extractOpenAiAuthClaims(input.idToken) : null;
  const chatgptAccountId =
    typeof authClaims?.chatgpt_account_id === "string" ? authClaims.chatgpt_account_id : "";
  const planType = typeof authClaims?.chatgpt_plan_type === "string" ? authClaims.chatgpt_plan_type : "";
  const organizationId =
    typeof authClaims?.organization_id === "string" ? authClaims.organization_id : "";

  if (rawMessage.includes("missing organization_id")) {
    const details = [
      "OAuth 登录本身已经成功，但 OpenAI 返回的身份令牌里没有 organization_id，所以没法继续换出 Codex 可用的 API token。",
      "这通常说明当前登录的是个人 ChatGPT 身份，或者账号还没有加入已开通 Codex 的组织/工作区。",
      "如果你有团队/企业工作区，请在 OpenAI 登录页切换到正确工作区后再试。",
      "如果没有可切换工作区，一般需要管理员完成 workspace setup，或者把你加入正确的组织。",
      chatgptAccountId ? `当前 token 的 workspace/account id: ${chatgptAccountId}` : "",
      planType ? `当前 token 的 plan type: ${planType}` : "",
      organizationId ? `当前 token 的 organization_id: ${organizationId}` : "当前 token 的 organization_id: 缺失",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      title: "账号缺少组织信息",
      message: "这不是本地按钮或回调端口的问题，而是当前 OpenAI 账号没有返回 Codex 所需的组织信息。",
      details,
    };
  }

  return {
    title: "OAuth 登录失败",
    message: "OpenAI Codex 登录在最后一步失败了。",
    details: rawMessage,
  };
}

async function exchangeCodexAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}) {
  const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: OPENAI_CODEX_CLIENT_ID,
      code_verifier: input.codeVerifier,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OAuth token exchange failed: ${response.status} ${body}`);
  }

  const tokenJson = (await response.json()) as {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
  };

  if (!tokenJson.access_token || !tokenJson.id_token || !tokenJson.refresh_token) {
    throw new Error("OAuth token exchange returned incomplete token payload.");
  }

  return {
    accessToken: tokenJson.access_token,
    idToken: tokenJson.id_token,
    refreshToken: tokenJson.refresh_token,
  };
}

async function exchangeCodexApiKey(idToken: string) {
  const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: OPENAI_CODEX_CLIENT_ID,
      requested_token: "openai-api-key",
      subject_token: idToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Codex API key exchange failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Codex API key exchange returned no access_token.");
  }

  return data.access_token;
}

async function describeListeningProcess(port: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-n",
      "-P",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
    ]);
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length <= 1) {
      return null;
    }
    return lines[1] ?? null;
  } catch {
    return null;
  }
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createOauthState(): string {
  return toBase64Url(randomBytes(18));
}

export function buildCodexAuthorizeUrl(input: {
  redirectUri: string;
  state: string;
  challenge: string;
  originator?: string;
}): string {
  const authUrl = new URL(OPENAI_CODEX_AUTH_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", OPENAI_CODEX_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", input.redirectUri);
  authUrl.searchParams.set("state", input.state);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("code_challenge", input.challenge);
  authUrl.searchParams.set("scope", OPENAI_CODEX_SCOPE);
  authUrl.searchParams.set("id_token_add_organizations", "true");
  authUrl.searchParams.set("codex_cli_simplified_flow", "true");
  authUrl.searchParams.set("originator", input.originator || OPENAI_CODEX_ORIGINATOR);
  return authUrl.toString();
}

async function closeOauthCallbackServerIfIdle(vaultRoot?: string) {
  if (vaultRoot) {
    await loadPendingOauthRequests(vaultRoot);
  }
  if (!oauthCallbackServerState || getPendingOauthRequestCount() > 0) {
    return;
  }

  const serverState = oauthCallbackServerState;
  try {
    await serverState.close();
  } catch {
    // Best-effort cleanup.
  }
}

async function handleOauthCallbackRequest(input: {
  vaultRoot: string;
  url: URL;
  res: Parameters<ReturnType<typeof createServer>["emit"]>[1] extends never ? never : any;
  calibrateProfile: (vaultRoot: string, profile: StoredLlmSettings) => Promise<unknown>;
}) {
  const code = input.url.searchParams.get("code");
  const state = input.url.searchParams.get("state");
  const oauthError = input.url.searchParams.get("error");
  const oauthErrorDescription = input.url.searchParams.get("error_description");

  if (oauthError) {
    if (state) {
      await consumePendingOauthRequest(input.vaultRoot, state);
    }
    input.res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    input.res.end(
      buildOauthErrorPage({
        title: "OAuth 登录失败",
        message: `OAuth failed: ${oauthError}`,
        details: oauthErrorDescription || "No error_description returned from OAuth callback.",
      }),
    );
    void closeOauthCallbackServerIfIdle(input.vaultRoot);
    return;
  }
  if (!code || !state) {
    sendText(input.res, 400, "Missing code or state.");
    void closeOauthCallbackServerIfIdle(input.vaultRoot);
    return;
  }

  const pending = await consumePendingOauthRequest(input.vaultRoot, state);
  if (!pending) {
    sendText(input.res, 400, "OAuth state is invalid or expired.");
    void closeOauthCallbackServerIfIdle(input.vaultRoot);
    return;
  }

  try {
    const tokens = await exchangeCodexAuthorizationCode({
      code,
      redirectUri: pending.redirectUri,
      codeVerifier: pending.codeVerifier,
    });
    let apiKey: string;
    try {
      apiKey = await exchangeCodexApiKey(tokens.idToken);
    } catch (error) {
      const friendlyError = buildFriendlyOauthExchangeError({
        error,
        idToken: tokens.idToken,
      });
      input.res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      input.res.end(
        buildOauthErrorPage({
          ...friendlyError,
          frontendOrigin: pending.frontendOrigin,
        }),
      );
      void closeOauthCallbackServerIfIdle(input.vaultRoot);
      return;
    }

    const savedProfile = upsertStoredLlmProfile(input.vaultRoot, {
      id: pending.profileId,
      provider: OPENAI_CODEX_PROVIDER,
      apiType: "openai-completions",
      bearerToken: apiKey,
      baseUrl: pending.baseUrl,
      model: pending.model,
      authUrl: OPENAI_CODEX_AUTH_URL,
      tokenUrl: pending.tokenUrl,
      clientId: pending.clientId,
      scope: pending.scope,
      oauthAccessToken: tokens.accessToken,
      oauthIdToken: tokens.idToken,
      refreshToken: tokens.refreshToken,
    }).profile;
    await input.calibrateProfile(input.vaultRoot, savedProfile);
  } catch (error) {
    input.res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    input.res.end(
      buildOauthErrorPage({
        title: "OAuth 登录失败",
        message: "OpenAI OAuth 登录没有完成。",
        details: error instanceof Error ? error.message : "OAuth login failed.",
        frontendOrigin: pending.frontendOrigin,
      }),
    );
    void closeOauthCallbackServerIfIdle(input.vaultRoot);
    return;
  }

  input.res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  input.res.end(buildOauthSuccessPage(pending.frontendOrigin));
  void closeOauthCallbackServerIfIdle(input.vaultRoot);
}

export async function ensureOauthCallbackServer(input: {
  vaultRoot: string;
  calibrateProfile: (vaultRoot: string, profile: StoredLlmSettings) => Promise<unknown>;
}) {
  if (oauthCallbackServerState) {
    return oauthCallbackServerState;
  }

  const callbackServer = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        sendText(res, 400, "Bad request");
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${OPENAI_CODEX_CALLBACK_PORT}`);
      if (req.method === "GET" && url.pathname === "/auth/callback") {
        await handleOauthCallbackRequest({
          vaultRoot: input.vaultRoot,
          url,
          res,
          calibrateProfile: input.calibrateProfile,
        });
        return;
      }

      sendJson(res, 404, { error: url.pathname });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unknown callback server error",
      });
    }
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        void describeListeningProcess(OPENAI_CODEX_CALLBACK_PORT).then((occupant) => {
          const suffix = occupant ? ` 当前监听进程：${occupant}` : " 无法自动识别监听进程。";
          rejectPromise(
            new Error(`OAuth 回调端口 ${OPENAI_CODEX_CALLBACK_PORT} 已被占用。请关闭旧的本地监听后重试。${suffix}`),
          );
        });
        return;
      }
      rejectPromise(error);
    };

    callbackServer.once("error", onError);
    callbackServer.listen(OPENAI_CODEX_CALLBACK_PORT, "127.0.0.1", () => {
      callbackServer.off("error", onError);
      resolvePromise();
    });
  });

  oauthCallbackServerState = {
    port: OPENAI_CODEX_CALLBACK_PORT,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        callbackServer.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          oauthCallbackServerState = null;
          resolvePromise();
        });
      }),
  };

  return oauthCallbackServerState;
}

export async function startCodexOauthFlow(input: {
  vaultRoot: string;
  port: number;
  profileId: string;
  profileName?: string;
  selectedModel: string;
  existing?: StoredLlmSettings | null;
  activeProfileId?: string;
}) {
  await ensureOauthCallbackServer({
    vaultRoot: input.vaultRoot,
    calibrateProfile: async () => undefined,
  });

  const frontendOrigin = `http://127.0.0.1:${input.port}`;
  const settings = upsertStoredLlmProfile(input.vaultRoot, {
    id: input.profileId || undefined,
    name: input.profileName || undefined,
    provider: OPENAI_CODEX_PROVIDER,
    apiType: "openai-completions",
    bearerToken: input.existing?.bearerToken ?? "",
    baseUrl: input.existing?.baseUrl || "https://api.openai.com/v1",
    model: input.selectedModel,
    authUrl: OPENAI_CODEX_AUTH_URL,
    tokenUrl: OPENAI_CODEX_TOKEN_URL,
    clientId: OPENAI_CODEX_CLIENT_ID,
    scope: OPENAI_CODEX_SCOPE,
    oauthAccessToken: input.existing?.oauthAccessToken,
    oauthIdToken: input.existing?.oauthIdToken,
    refreshToken: input.existing?.refreshToken,
  }, {
    activate: input.activeProfileId === input.profileId || !input.activeProfileId || !input.profileId,
  }).profile;

  const { verifier, challenge } = createPkcePair();
  const state = toBase64Url(randomBytes(18));
  const redirectUri = `http://localhost:${OPENAI_CODEX_CALLBACK_PORT}/auth/callback`;
  await setPendingOauthRequest(input.vaultRoot, {
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

  return {
    authUrl,
    fallbackAuthUrl,
    redirectUri,
    state,
    profileId: settings.id,
  };
}
