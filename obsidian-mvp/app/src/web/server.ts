import { createReadStream } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_VAULT_ROOT,
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
  OPENAI_KEY_PROVIDER_LABEL,
} from "../config/constants.js";
import {
  getLlmConfig,
  getStoredLlmSettings,
  saveStoredLlmSettings,
} from "../config/env.js";
import { OpenAiCompatibleClient } from "../llm/openai-compatible.js";
import { matchMaterials, matchRules } from "../retrieve/matchers.js";
import { VaultRepository } from "../vault/repository.js";
import {
  buildOutline,
  buildOutlineWithLlm,
  diagnoseTask,
  diagnoseTaskWithLlm,
  generateDraft,
  generateDraftWithLlm,
  learnFeedback,
  learnFeedbackWithLlm,
  parseTask,
  parseTaskWithLlm,
} from "../workflows/stubs.js";
import { writeFeedbackResult } from "../writers/feedback-writer.js";
import {
  analyzeImportedMaterial,
  createMaterialAnalyzer,
  extractTextFromBuffer,
  importMaterial,
} from "../writers/material-writer.js";
import { refreshDefaultProfile } from "../writers/profile-writer.js";
import {
  confirmRule,
  disableRule,
  rejectRule,
} from "../writers/rule-confirm-writer.js";
import { syncRuleInTasks } from "../writers/task-rule-sync-writer.js";
import { refreshTaskReferences } from "../writers/task-refresh-writer.js";
import { attachRuleToTask } from "../writers/task-link-writer.js";
import { writeTaskSections } from "../writers/task-writer.js";
import { writeCandidateRule } from "../writers/rule-writer.js";
import { createTask } from "../writers/task-create-writer.js";
import { createFeedback } from "../writers/feedback-create-writer.js";
import { replaceSection, writeMarkdownDocument } from "../vault/markdown.js";

type ServerOptions = {
  vaultRoot: string;
  port: number;
};

type RuleAction = "confirm" | "disable" | "reject";
type PendingOauthRequest = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  baseUrl: string;
  model: string;
  frontendOrigin: string;
  createdAt: number;
};

type OauthCallbackServerState = {
  port: number;
  close: () => Promise<void>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "public");
const pendingOauthRequests = new Map<string, PendingOauthRequest>();
let oauthCallbackServerState: OauthCallbackServerState | null = null;

function normalizeTagList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof input === "string") {
    return input
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function isTemplateMaterial(input: { tags?: string[]; source?: string; docType?: string }): boolean {
  const tags = (input.tags ?? []).map((item) => item.toLowerCase());
  if (tags.includes("template") || tags.includes("模板")) {
    return true;
  }

  const source = (input.source ?? "").toLowerCase();
  const docType = (input.docType ?? "").toLowerCase();
  return source.includes("template") || source.includes("模板") || docType.includes("模板");
}

function createLlmClient(vaultRoot: string): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient(getLlmConfig(vaultRoot));
}

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
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

function toBase64Padding(input: string): string {
  const remainder = input.length % 4;
  return remainder === 0 ? input : `${input}${"=".repeat(4 - remainder)}`;
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

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function sendText(res: ServerResponse, statusCode: number, message: string) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function toSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

function getStaticContentType(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".js") {
    return "application/javascript; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

async function serveStatic(res: ServerResponse, requestPath: string) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const localPath = join(publicDir, normalized);
  await access(localPath);
  res.writeHead(200, { "Content-Type": getStaticContentType(localPath) });
  createReadStream(localPath).pipe(res);
}

async function applyRuleAction(input: {
  action: RuleAction;
  vaultRoot: string;
  rulePath: string;
  reason?: string;
}) {
  const repo = new VaultRepository(input.vaultRoot);
  const [rule, rules, profiles, tasks] = await Promise.all([
    repo.loadRule(input.rulePath),
    repo.loadRules(),
    repo.loadProfiles(),
    repo.loadTasks(),
  ]);

  const updatedRule =
    input.action === "confirm"
      ? await confirmRule(rule, input.reason)
      : input.action === "disable"
        ? await disableRule(rule, input.reason)
        : await rejectRule(rule, input.reason);

  const updatedTasks = await syncRuleInTasks({
    tasks,
    ruleId: updatedRule.id,
    enabled: input.action === "confirm",
  });

  const profilePath = await refreshDefaultProfile({
    vaultRoot: input.vaultRoot,
    profiles,
    rules: rules.map((item) => (item.id === updatedRule.id ? updatedRule : item)),
  });

  return {
    rule: updatedRule,
    updatedTasks,
    profilePath,
  };
}

async function buildTaskSnapshot(vaultRoot: string, taskPath: string) {
  const repo = new VaultRepository(vaultRoot);
  const client = createLlmClient(vaultRoot);
  const task = await repo.loadTask(taskPath);
  const [materials, rules, profiles] = await Promise.all([
    repo.loadMaterials(),
    repo.loadRules(),
    repo.loadProfiles(),
  ]);
  const analysis = client.isEnabled() ? await parseTaskWithLlm(client, task) : parseTask(task);
  const matchedRules = matchRules(task, rules);
  const matchedMaterials = matchMaterials(task, materials);

  return {
    repo,
    client,
    task,
    profiles,
    analysis,
    matchedRules,
    matchedMaterials,
  };
}

async function runTaskAction(input: {
  vaultRoot: string;
  taskPath: string;
  action: "diagnose" | "outline" | "draft";
}) {
  const { client, task, profiles, analysis, matchedRules, matchedMaterials } = await buildTaskSnapshot(
    input.vaultRoot,
    input.taskPath,
  );

  const diagnosisInput = {
    task,
    analysis,
    matchedRules,
    matchedMaterials,
    profiles,
  };

  const diagnosis = client.isEnabled()
    ? await diagnoseTaskWithLlm(client, diagnosisInput)
    : diagnoseTask(diagnosisInput);

  if (input.action === "diagnose") {
    await writeTaskSections({
      task,
      diagnosis,
      matchedRules,
      matchedMaterials,
    });
    return { analysis, diagnosis };
  }

  const outlineInput = {
    task,
    analysis,
    diagnosis,
    matchedRules,
    matchedMaterials,
    profiles,
  };

  const outline = client.isEnabled()
    ? await buildOutlineWithLlm(client, outlineInput)
    : buildOutline(outlineInput);

  if (input.action === "outline") {
    await writeTaskSections({
      task,
      diagnosis,
      outline,
      matchedRules,
      matchedMaterials,
    });
    return { analysis, diagnosis, outline };
  }

  const draft = client.isEnabled()
    ? await generateDraftWithLlm(client, {
        task,
        analysis,
        diagnosis,
        outline,
        matchedRules,
        matchedMaterials,
        profiles,
      })
    : generateDraft({
        task,
        analysis,
        diagnosis,
        outline,
      });

  await writeTaskSections({
    task,
    diagnosis,
    outline,
    draft,
    matchedRules,
    matchedMaterials,
  });

  return { analysis, diagnosis, outline, draft };
}

async function buildDashboard(vaultRoot: string) {
  const repo = new VaultRepository(vaultRoot);
  const [materials, tasks, rules, feedbackEntries, profiles] = await Promise.all([
    repo.loadMaterials(),
    repo.loadTasks(),
    repo.loadRules(),
    repo.loadFeedbackEntries(),
    repo.loadProfiles(),
  ]);

  const llmConfig = getLlmConfig(vaultRoot);
  const stored = getStoredLlmSettings(vaultRoot);
  const provider =
    stored?.provider === OPENAI_KEY_PROVIDER ? OPENAI_KEY_PROVIDER : OPENAI_CODEX_PROVIDER;
  const providerLabel =
    provider === OPENAI_KEY_PROVIDER ? OPENAI_KEY_PROVIDER_LABEL : OPENAI_CODEX_PROVIDER_LABEL;
  const materialItems = materials
    .map((item) => ({
      id: item.id,
      title: item.title,
      docType: item.docType,
      audience: item.audience,
      scenario: item.scenario,
      quality: item.quality,
      source: typeof item.frontmatter.source === "string" ? item.frontmatter.source : "",
      tags: item.tags,
      isTemplate: isTemplateMaterial({
        tags: item.tags,
        source: typeof item.frontmatter.source === "string" ? item.frontmatter.source : "",
        docType: item.docType,
      }),
      path: item.path,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));

  return {
    vaultRoot,
    llm: {
      provider,
      providerLabel,
      enabled: llmConfig.enabled,
      source: llmConfig.source,
      baseUrl: llmConfig.baseUrl,
      model: llmConfig.model,
      hasSavedSettings: Boolean(stored),
      updatedAt: stored?.updatedAt ?? null,
      oauthReady: Boolean(stored?.oauthAccessToken && stored?.oauthIdToken),
    },
    materials: materialItems,
    templates: materialItems.filter((item) => item.isTemplate || item.quality === "high"),
    tasks: tasks
      .map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        docType: item.docType,
        audience: item.audience,
        scenario: item.scenario,
        matchedRules: item.matchedRules,
        path: item.path,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN")),
    rules: rules
      .map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        scope: item.scope,
        confidence: item.confidence,
        path: item.path,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN")),
    feedback: feedbackEntries
      .map((item) => ({
        id: item.id,
        taskId: item.taskId,
        feedbackType: item.feedbackType,
        relatedRuleIds: item.relatedRuleIds,
        path: item.path,
      }))
      .sort((a, b) => a.id.localeCompare(b.id, "zh-CN")),
    profiles: profiles.map((item) => ({
      id: item.id,
      name: item.name,
      version: item.version,
      path: item.path,
    })),
  };
}

async function readDocumentByPath(path: string) {
  const raw = await readFile(path, "utf8");
  return { path, raw };
}

async function handleOauthCallbackRequest(input: {
  req: IncomingMessage;
  res: ServerResponse;
  vaultRoot: string;
  url: URL;
}) {
  const code = input.url.searchParams.get("code");
  const state = input.url.searchParams.get("state");
  const oauthError = input.url.searchParams.get("error");

  if (oauthError) {
    sendText(input.res, 400, `OAuth failed: ${oauthError}`);
    return;
  }
  if (!code || !state) {
    sendText(input.res, 400, "Missing code or state.");
    return;
  }

  const pending = pendingOauthRequests.get(state);
  if (!pending) {
    sendText(input.res, 400, "OAuth state is invalid or expired.");
    return;
  }
  pendingOauthRequests.delete(state);

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
      return;
    }

    saveStoredLlmSettings(input.vaultRoot, {
      provider: OPENAI_CODEX_PROVIDER,
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
    });
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
    return;
  }

  input.res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  input.res.end(buildOauthSuccessPage(pending.frontendOrigin));
}

async function ensureOauthCallbackServer(vaultRoot: string) {
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
        await handleOauthCallbackRequest({ req, res, vaultRoot, url });
        return;
      }

      sendJson(res, 404, { error: `Unsupported route: ${toSafeId(url.pathname) || url.pathname}` });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unknown callback server error",
      });
    }
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    callbackServer.once("error", rejectPromise);
    callbackServer.listen(OPENAI_CODEX_CALLBACK_PORT, "127.0.0.1", () => {
      callbackServer.off("error", rejectPromise);
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

export async function startWebServer(options?: Partial<ServerOptions>) {
  const vaultRoot = resolve(options?.vaultRoot ?? DEFAULT_VAULT_ROOT);
  const port = options?.port ?? 4318;

  const server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        sendText(res, 400, "Bad request");
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${port}`);

      if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) {
        const staticPath = url.pathname === "/" ? "/index.html" : url.pathname.replace(/^\/assets/, "");
        await serveStatic(res, staticPath);
        return;
      }

      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/dashboard") {
        sendJson(res, 200, await buildDashboard(vaultRoot));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        const provider =
          body.provider === OPENAI_CODEX_PROVIDER ? OPENAI_CODEX_PROVIDER : OPENAI_KEY_PROVIDER;
        const existing = getStoredLlmSettings(vaultRoot);
        const isCodex = provider === OPENAI_CODEX_PROVIDER;

        const settings = saveStoredLlmSettings(vaultRoot, {
          provider,
          bearerToken: body.bearerToken ?? existing?.bearerToken ?? "",
          baseUrl:
            isCodex
              ? OPENAI_CODEX_BASE_URL
              : body.baseUrl?.trim() || existing?.baseUrl || OPENAI_CODEX_BASE_URL,
          model: body.model ?? OPENAI_CODEX_MODEL,
          authUrl: isCodex ? OPENAI_CODEX_AUTH_URL : body.authUrl?.trim() || existing?.authUrl || "",
          tokenUrl:
            isCodex ? OPENAI_CODEX_TOKEN_URL : body.tokenUrl?.trim() || existing?.tokenUrl || "",
          clientId: isCodex ? OPENAI_CODEX_CLIENT_ID : body.clientId?.trim() || existing?.clientId || "",
          scope: isCodex ? OPENAI_CODEX_SCOPE : body.scope?.trim() || existing?.scope || "",
          oauthAccessToken: isCodex ? existing?.oauthAccessToken : undefined,
          oauthIdToken: isCodex ? existing?.oauthIdToken : undefined,
          refreshToken: isCodex ? existing?.refreshToken : undefined,
        });
        const resolved = getLlmConfig(vaultRoot);
        sendJson(res, 200, { settings, resolved });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/oauth/start") {
        const frontendOrigin = req.headers.host
          ? `http://${req.headers.host}`
          : `http://127.0.0.1:${port}`;
        const existing = getStoredLlmSettings(vaultRoot);
        await ensureOauthCallbackServer(vaultRoot);

        const settings = saveStoredLlmSettings(vaultRoot, {
          provider: OPENAI_CODEX_PROVIDER,
          bearerToken: existing?.bearerToken ?? "",
          baseUrl: OPENAI_CODEX_BASE_URL,
          model: OPENAI_CODEX_MODEL,
          authUrl: OPENAI_CODEX_AUTH_URL,
          tokenUrl: OPENAI_CODEX_TOKEN_URL,
          clientId: OPENAI_CODEX_CLIENT_ID,
          scope: OPENAI_CODEX_SCOPE,
          oauthAccessToken: existing?.oauthAccessToken,
          oauthIdToken: existing?.oauthIdToken,
          refreshToken: existing?.refreshToken,
        });

        const { verifier, challenge } = createPkcePair();
        const state = toBase64Url(randomBytes(18));
        const redirectUri = `http://localhost:${OPENAI_CODEX_CALLBACK_PORT}/auth/callback`;
        pendingOauthRequests.set(state, {
          state,
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

        const authUrl = new URL(OPENAI_CODEX_AUTH_URL);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("client_id", OPENAI_CODEX_CLIENT_ID);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge_method", "S256");
        authUrl.searchParams.set("code_challenge", challenge);
        authUrl.searchParams.set("scope", OPENAI_CODEX_SCOPE);
        authUrl.searchParams.set("id_token_add_organizations", "true");
        authUrl.searchParams.set("codex_cli_simplified_flow", "true");
        authUrl.searchParams.set("originator", OPENAI_CODEX_ORIGINATOR);

        sendJson(res, 200, {
          authUrl: authUrl.toString(),
          redirectUri,
          state,
          provider: OPENAI_CODEX_PROVIDER_LABEL,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/document") {
        const targetPath = url.searchParams.get("path");
        if (!targetPath) {
          sendJson(res, 400, { error: "Missing path parameter." });
          return;
        }
        sendJson(res, 200, await readDocumentByPath(targetPath));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/import") {
        const body = (await readBody(req)) as Record<string, string | string[] | undefined>;
        if (!body.title || !body.docType || (!body.body && !body.sourceFile && !body.uploadName)) {
          sendJson(res, 400, { error: "title、docType，以及正文/文件路径/浏览器上传文件至少要提供一项。" });
          return;
        }

        const client = createLlmClient(vaultRoot);
        const analyzer = createMaterialAnalyzer(client);
        const uploadedBody =
          body.uploadName && body.uploadBase64
            ? await extractTextFromBuffer({
                fileName: String(body.uploadName),
                buffer: Buffer.from(String(body.uploadBase64), "base64"),
              })
            : "";
        const rawBody = (typeof body.body === "string" ? body.body : "") || uploadedBody;
        const tags = normalizeTagList(body.tags);
        const isTemplate = body.isTemplate === "true" || body.mode === "template";
        if (isTemplate) {
          tags.push("template");
        }
        const analysis = rawBody
          ? await analyzer({
              title: String(body.title),
              rawBody,
              docType: String(body.docType),
              audience: typeof body.audience === "string" ? body.audience : "",
              scenario: typeof body.scenario === "string" ? body.scenario : "",
            })
          : undefined;

        const result = await importMaterial({
          vaultRoot,
          title: String(body.title),
          docType: String(body.docType),
          audience: typeof body.audience === "string" ? body.audience : "",
          scenario: typeof body.scenario === "string" ? body.scenario : "",
          source: typeof body.source === "string" ? body.source : "",
          quality: isTemplate ? "high" : typeof body.quality === "string" ? body.quality : "high",
          tags,
          body: rawBody,
          sourceFile: typeof body.sourceFile === "string" && body.sourceFile ? resolve(body.sourceFile) : undefined,
          analysis,
        });

        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/create") {
        const body = (await readBody(req)) as Record<string, string | string[] | undefined>;
        if (!body.title || !body.docType) {
          sendJson(res, 400, { error: "title 和 docType 是必填项。" });
          return;
        }

        const repo = new VaultRepository(vaultRoot);
        const materials = await repo.loadMaterials();
        const selectedMaterialIds = Array.isArray(body.sourceMaterialIds)
          ? body.sourceMaterialIds.filter((item): item is string => typeof item === "string")
          : [];
        const selectedMaterials = materials.filter((item) => selectedMaterialIds.includes(item.id));

        const result = await createTask({
          vaultRoot,
          title: String(body.title),
          docType: String(body.docType),
          audience: typeof body.audience === "string" ? body.audience : "",
          scenario: typeof body.scenario === "string" ? body.scenario : "",
          priority: typeof body.priority === "string" ? body.priority : "medium",
          targetLength: typeof body.targetLength === "string" ? body.targetLength : "",
          deadline: typeof body.deadline === "string" ? body.deadline : "",
          goal: typeof body.goal === "string" ? body.goal : "",
          targetEffect: typeof body.targetEffect === "string" ? body.targetEffect : "",
          background: typeof body.background === "string" ? body.background : "",
          facts: typeof body.facts === "string" ? body.facts : "",
          mustInclude: typeof body.mustInclude === "string" ? body.mustInclude : "",
          specialRequirements:
            typeof body.specialRequirements === "string" ? body.specialRequirements : "",
          sourceMaterials: selectedMaterials,
        });

        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/analyze") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        if (!body.path) {
          sendJson(res, 400, { error: "Missing material path." });
          return;
        }

        await analyzeImportedMaterial(resolve(body.path), {
          analyze: createMaterialAnalyzer(createLlmClient(vaultRoot)),
        });
        sendJson(res, 200, { path: resolve(body.path), status: "analyzed" });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/run") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        if (!body.path || !body.action) {
          sendJson(res, 400, { error: "Missing task path or action." });
          return;
        }

        const result = await runTaskAction({
          vaultRoot,
          taskPath: resolve(body.path),
          action: body.action as "diagnose" | "outline" | "draft",
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/update-draft") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        if (!body.path) {
          sendJson(res, 400, { error: "Missing task path." });
          return;
        }

        const taskPath = resolve(body.path);
        const repo = new VaultRepository(vaultRoot);
        const task = await repo.loadTask(taskPath);
        const now = new Date().toISOString();
        const draft = (body.draft ?? "").trim();
        const reason = (body.reason ?? "").trim();
        const location = (body.location ?? "").trim();
        const finalized = body.finalized === "true";
        const version = (body.version ?? "").trim();
        const currentUpdated = typeof task.frontmatter.updated_at === "string" ? task.frontmatter.updated_at : "";
        const logLine = `- ${now}${version ? ` [${version}]` : ""}${location ? ` [${location}]` : ""}${reason ? `：${reason}` : ""}`;
        const historyBody = String(task.content.match(/# 修改记录\n\n([\s\S]*?)(?=\n# )/)?.[1] ?? "- v1：");
        const mergedHistory = `${historyBody.trim()}\n${logLine}`.trim();

        let nextContent = replaceSection(task.content, "初稿", draft || "在这里生成正文。");
        nextContent = replaceSection(nextContent, "修改记录", mergedHistory);
        if (finalized) {
          const existingFinal = String(task.content.match(/# 定稿说明\n\n([\s\S]*?)(?=\n# )/)?.[1] ?? "- ");
          const finalLine = `- ${now}：已在前端定稿。`;
          nextContent = replaceSection(nextContent, "定稿说明", `${existingFinal.trim()}\n${finalLine}`.trim());
        }

        await writeMarkdownDocument(task.path, {
          ...task.frontmatter,
          status: finalized ? "finalized" : "draft",
          updated_at: now || currentUpdated,
        }, nextContent);

        sendJson(res, 200, { path: task.path, updatedAt: now, finalized });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/feedback/learn") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        if (!body.path) {
          sendJson(res, 400, { error: "Missing feedback path." });
          return;
        }

        const repo = new VaultRepository(vaultRoot);
        const client = createLlmClient(vaultRoot);
        const feedback = await repo.loadFeedback(resolve(body.path));
        const task = await repo.findTaskById(feedback.taskId);
        const taskAnalysis = task
          ? client.isEnabled()
            ? await parseTaskWithLlm(client, task)
            : parseTask(task)
          : null;
        const analysis = client.isEnabled()
          ? await learnFeedbackWithLlm(client, { feedback, task, taskAnalysis })
          : learnFeedback(feedback);
        const candidateRule = await writeCandidateRule({
          vaultRoot,
          feedback,
          analysis,
        });
        await writeFeedbackResult({
          feedback,
          analysis,
          ruleId: candidateRule?.ruleId ?? null,
        });
        if (task) {
          await attachRuleToTask({
            task,
            ruleId: candidateRule?.ruleId ?? null,
            feedbackId: feedback.id,
          });
        }
        sendJson(res, 200, {
          analysis,
          candidateRulePath: candidateRule?.path ?? null,
          candidateRuleId: candidateRule?.ruleId ?? null,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/feedback/create") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        if (!body.rawFeedback) {
          sendJson(res, 400, { error: "rawFeedback 是必填项。" });
          return;
        }

        const result = await createFeedback({
          vaultRoot,
          taskId: body.taskId,
          feedbackType: body.feedbackType,
          severity: body.severity,
          action: body.action,
          rawFeedback: body.rawFeedback,
          affectedParagraph: body.affectedParagraph,
          affectedSection: body.affectedSection,
          affectsStructure: body.affectsStructure,
        });

        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rules/action") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        if (!body.path || !body.action) {
          sendJson(res, 400, { error: "Missing rule path or action." });
          return;
        }

        const result = await applyRuleAction({
          action: body.action as RuleAction,
          vaultRoot,
          rulePath: resolve(body.path),
          reason: body.reason,
        });
        sendJson(res, 200, {
          ruleId: result.rule.id,
          status: result.rule.status,
          profilePath: result.profilePath,
          updatedTasks: result.updatedTasks,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/refresh/tasks") {
        const repo = new VaultRepository(vaultRoot);
        const [tasks, materials, rules] = await Promise.all([
          repo.loadTasks(),
          repo.loadMaterials(),
          repo.loadRules(),
        ]);

        const results = [];
        for (const task of tasks) {
          const matchedRules = matchRules(task, rules);
          const matchedMaterials = matchMaterials(task, materials);
          await refreshTaskReferences({
            task,
            matchedRules,
            matchedMaterials,
          });
          results.push({
            taskId: task.id,
            matchedRules: matchedRules.map((rule) => rule.rule_id),
            matchedMaterials: matchedMaterials.map((material) => material.id),
          });
        }

        sendJson(res, 200, results);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/refresh/profile") {
        const repo = new VaultRepository(vaultRoot);
        const [profiles, rules] = await Promise.all([repo.loadProfiles(), repo.loadRules()]);
        const profilePath = await refreshDefaultProfile({
          vaultRoot,
          profiles,
          rules,
        });
        sendJson(res, 200, {
          profilePath,
          confirmedRules: rules.filter((rule) => rule.status === "confirmed").length,
        });
        return;
      }

      sendJson(res, 404, { error: `Unsupported route: ${toSafeId(url.pathname) || url.pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      sendJson(res, 500, { error: message });
    }
  });

  return new Promise<void>((resolvePromise) => {
    server.listen(port, "127.0.0.1", () => {
      console.log(`Writing assistant web console running at http://127.0.0.1:${port}`);
      resolvePromise();
    });
  });
}

const maybeRunDirectly = process.argv[1] === __filename;
if (maybeRunDirectly) {
  const portArg = process.argv.find((item) => item.startsWith("--port="));
  const vaultArg = process.argv.find((item) => item.startsWith("--vault="));

  await startWebServer({
    port: portArg ? Number(portArg.split("=")[1]) : 4318,
    vaultRoot: vaultArg ? resolve(vaultArg.split("=")[1]) : DEFAULT_VAULT_ROOT,
  });
}
