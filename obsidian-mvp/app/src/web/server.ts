import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

import {
  DEFAULT_VAULT_ROOT,
  OPENAI_CODEX_AUTH_URL,
  OPENAI_CODEX_ALLOWED_MODELS,
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
import { OpenAiCompatibleClient } from "../llm/openai-compatible.js";
import { matchMaterials, matchRules, matchRulesWithPolicy } from "../retrieve/matchers.js";
import { buildEvidenceCards, summarizeMaterial } from "../retrieve/summaries.js";
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
import {
  appendWorkflowEvent,
  createWorkflowRun,
  listWorkflowRuns,
  loadWorkflowRun,
  transitionWorkflowRun,
  type WorkflowRun,
} from "../workflows/orchestration.js";
import { loadWorkflowDefinition, saveWorkflowDefinition } from "../workflows/definition.js";
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
import { readMarkdownDocument, replaceSection, writeMarkdownDocument } from "../vault/markdown.js";

type ServerOptions = {
  vaultRoot: string;
  port: number;
};

type RuleAction = "confirm" | "disable" | "reject";
type RuleVersionAction =
  | "confirm"
  | "disable"
  | "reject"
  | "update_scope"
  | "rollback"
  | "pre_rollback";
type WorkflowAdvanceAction = "regenerate" | "finalize";
type PendingOauthRequest = {
  state: string;
  profileId: string;
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

const execFileAsync = promisify(execFile);

type RuleVersionMeta = {
  versionId: string;
  ruleId: string;
  action: RuleVersionAction;
  reason: string;
  createdAt: string;
  snapshotPath: string;
  metadataPath: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "public");
const pendingOauthRequests = new Map<string, PendingOauthRequest>();
let oauthCallbackServerState: OauthCallbackServerState | null = null;

function normalizeCodexModel(model: unknown): string {
  if (typeof model !== "string" || !model.trim()) {
    return OPENAI_CODEX_MODEL;
  }

  return OPENAI_CODEX_ALLOWED_MODELS.includes(model as (typeof OPENAI_CODEX_ALLOWED_MODELS)[number])
    ? model
    : OPENAI_CODEX_MODEL;
}

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

type TaskCreateRequest = {
  title: string;
  docType: string;
  audience: string;
  scenario: string;
  priority: string;
  targetLength: string;
  deadline: string;
  goal: string;
  targetEffect: string;
  background: string;
  facts: string;
  mustInclude: string;
  specialRequirements: string;
  templateId: string;
  templateMode: "strict" | "hybrid" | "light";
  templateOverrides: string;
  sourceMaterialIds: string[];
};

function normalizeTemplateMode(value: unknown): "strict" | "hybrid" | "light" {
  if (value === "strict" || value === "hybrid" || value === "light") {
    return value;
  }
  return "hybrid";
}

function extractProfileBulletSection(content: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=^##\\s+|^#\\s+|\\Z)`, "m");
  const match = regex.exec(content);
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean)
    .filter((line) => line !== "-");
}

function extractProfileField(content: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^-\\s+${escaped}\\s*(.+)$`, "m");
  return regex.exec(content)?.[1]?.trim() || "";
}

function extractProfileScenarioBullets(content: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^###\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=^###\\s+|^##\\s+|^#\\s+|\\Z)`, "m");
  const match = regex.exec(content);
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean)
    .filter((line) => line !== "-");
}

function parseTemplateOverrideMap(raw: string): Record<string, string> {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      if (index < 1) {
        return ["", ""];
      }
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    })
    .filter(([section, instruction]) => section && instruction)
    .reduce<Record<string, string>>((acc, [section, instruction]) => {
      acc[section] = instruction;
      return acc;
    }, {});
}

function toTaskCreateRequest(body: Record<string, unknown>): TaskCreateRequest {
  return {
    title: typeof body.title === "string" ? body.title.trim() : "",
    docType: typeof body.docType === "string" ? body.docType.trim() : "",
    audience: typeof body.audience === "string" ? body.audience.trim() : "",
    scenario: typeof body.scenario === "string" ? body.scenario.trim() : "",
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
    templateId: typeof body.templateId === "string" ? body.templateId.trim() : "",
    templateMode: normalizeTemplateMode(body.templateMode),
    templateOverrides:
      typeof body.templateOverrides === "string" ? body.templateOverrides : "",
    sourceMaterialIds: Array.isArray(body.sourceMaterialIds)
      ? body.sourceMaterialIds.filter((item): item is string => typeof item === "string")
      : [],
  };
}

type TaskFeedbackSignal = {
  count: number;
  latest_reason: string;
  latest_updated_at: string;
  latest_version: string;
  recent_reasons: string[];
};

function normalizeTaskFeedbackSignals(value: unknown): Record<string, TaskFeedbackSignal> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, TaskFeedbackSignal> = {};
  for (const [key, rawEntry] of Object.entries(value as Record<string, unknown>)) {
    if (!key || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }
    const entry = rawEntry as Record<string, unknown>;
    const count = typeof entry.count === "number" ? entry.count : Number(entry.count ?? 0);
    result[key] = {
      count: Number.isFinite(count) ? Math.max(0, count) : 0,
      latest_reason:
        typeof entry.latest_reason === "string"
          ? entry.latest_reason
          : typeof entry.reason === "string"
            ? entry.reason
            : "",
      latest_updated_at:
        typeof entry.latest_updated_at === "string"
          ? entry.latest_updated_at
          : typeof entry.updated_at === "string"
            ? entry.updated_at
            : "",
      latest_version:
        typeof entry.latest_version === "string"
          ? entry.latest_version
          : typeof entry.version === "string"
            ? entry.version
            : "",
      recent_reasons: Array.isArray(entry.recent_reasons)
        ? entry.recent_reasons.filter((item): item is string => typeof item === "string")
        : [],
    };
  }
  return result;
}

function createLlmClient(vaultRoot: string): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient(getLlmConfig(vaultRoot));
}

function createLlmClientWithModel(vaultRoot: string, modelOverride?: string): OpenAiCompatibleClient {
  const config = getLlmConfig(vaultRoot);
  const model = typeof modelOverride === "string" && modelOverride.trim() ? modelOverride.trim() : config.model;
  return new OpenAiCompatibleClient({
    ...config,
    model,
  });
}

const autoCalibrationSchema = z.object({
  readiness: z.enum(["ready", "partial", "blocked"]),
  diagnosis_summary: z.string(),
  recommended_structure: z.array(
    z.object({
      section: z.string(),
      purpose: z.string(),
      must_cover: z.array(z.string()),
    }),
  ),
  missing_info: z.array(z.string()),
  applied_rules: z.array(z.string()),
  reference_materials: z.array(z.string()),
  writing_risks: z.array(z.string()),
  next_action: z.string(),
});

const AUTO_CALIBRATION_SCHEMA_HINT = `{
  "readiness": "ready | partial | blocked",
  "diagnosis_summary": "string",
  "recommended_structure": [
    {
      "section": "string",
      "purpose": "string",
      "must_cover": ["string"]
    }
  ],
  "missing_info": ["string"],
  "applied_rules": ["string"],
  "reference_materials": ["string"],
  "writing_risks": ["string"],
  "next_action": "string"
}`;

async function runLlmConnectivityTest(settings: StoredLlmSettings) {
  const validation = validateStoredLlmProfile(settings);
  if (validation.errors.length) {
    return {
      ok: false,
      validation,
      message: validation.errors[0] ?? "配置校验失败。",
      provider: settings.provider,
      model: settings.model,
      apiType: settings.apiType || "openai-completions",
    };
  }

  if (!settings.bearerToken.trim()) {
    return {
      ok: false,
      validation,
      message:
        settings.provider === OPENAI_CODEX_PROVIDER
          ? "这张 OAuth 卡片还没有拿到可用 token，请先完成 OAuth 登录。"
          : "这张卡片还没有填写 API Key / Bearer Token。",
      provider: settings.provider,
      model: settings.model,
      apiType: settings.apiType || "openai-completions",
    };
  }

  const client = new OpenAiCompatibleClient({
    bearerToken: settings.bearerToken.trim(),
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiType: settings.apiType || "openai-completions",
    enabled: true,
    source: "saved",
  });

  try {
    const result = await client.generateJson({
      system:
        "You are a connectivity test for a writing assistant. Respond with JSON only.",
      user: 'Return exactly this JSON: {"reply":"GW_LLM_OK"}',
      schema: z.object({
        reply: z.string(),
      }),
    });

    return {
      ok: true,
      validation,
      message: `模型连通成功：${settings.model}`,
      provider: settings.provider,
      model: settings.model,
      apiType: settings.apiType || "openai-completions",
      response: result,
    };
  } catch (error) {
    return {
      ok: false,
      validation,
      message: error instanceof Error ? error.message : String(error),
      provider: settings.provider,
      model: settings.model,
      apiType: settings.apiType || "openai-completions",
    };
  }
}

async function runLlmAutoCalibration(settings: StoredLlmSettings) {
  const connectivity = await runLlmConnectivityTest(settings);
  if (!connectivity.ok) {
    return {
      ok: false,
      usable: false,
      message: connectivity.message,
      structuredOutput: "unknown" as const,
    };
  }

  const client = new OpenAiCompatibleClient({
    bearerToken: settings.bearerToken.trim(),
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiType: settings.apiType || "openai-completions",
    enabled: true,
    source: "saved",
  });

  try {
    await client.generateJson({
      system:
        "你是写作助手的模型入驻校准程序。必须严格按给定 schema 返回 JSON，字段名不允许改写。",
      user: `请输出一份极短的写前诊断，用于验证结构化输出能力。

任务分析:
{
  "task_type": "情况说明",
  "audience": "内部",
  "scenario": "模型自动校准",
  "goal": "验证结构化输出能力",
  "must_include": ["本次目的", "当前结果", "后续建议"],
  "constraints": ["不要编造事实"],
  "raw_facts": ["基础连通已通过"],
  "missing_info": [],
  "risk_flags": [],
  "confidence": 0.9
}

命中规则:
[]

相似材料摘要:
[]

证据卡片:
[]

写作画像:
[]`,
      schema: autoCalibrationSchema,
      schemaHint: AUTO_CALIBRATION_SCHEMA_HINT,
      maxTokens: 900,
      timeoutMs: 45_000,
    });

    return {
      ok: true,
      usable: true,
      message: "自动校准完成，可直接用于正式写作。",
      structuredOutput: "strict-schema" as const,
    };
  } catch (error) {
    return {
      ok: false,
      usable: false,
      message: error instanceof Error ? error.message : String(error),
      structuredOutput: "connectivity-only" as const,
    };
  }
}

async function calibrateAndPersistLlmProfile(vaultRoot: string, profile: StoredLlmSettings) {
  updateStoredLlmProfileCalibration(vaultRoot, profile.id, {
    status: "running",
    usable: false,
    message: "正在自动校准…",
    checkedAt: new Date().toISOString(),
    structuredOutput: "unknown",
  });

  const result = await runLlmAutoCalibration(profile);
  const calibration = updateStoredLlmProfileCalibration(vaultRoot, profile.id, {
    status: result.ok ? "ready" : "failed",
    usable: result.usable,
    message: result.message,
    checkedAt: new Date().toISOString(),
    structuredOutput: result.structuredOutput,
  }).profile.calibration;

  return {
    ok: result.ok,
    calibration,
    message: result.message,
  };
}

function getRoutingSettings(vaultRoot: string): {
  enabled: boolean;
  fastModel: string;
  strongModel: string;
  fallbackModels: string[];
} {
  const llm = getLlmConfig(vaultRoot);
  const stored = getStoredLlmSettings(vaultRoot);
  return {
    enabled: Boolean(stored?.routingEnabled),
    fastModel: stored?.fastModel || llm.model,
    strongModel: stored?.strongModel || llm.model,
    fallbackModels: Array.isArray(stored?.fallbackModels) ? stored.fallbackModels.filter(Boolean) : [],
  };
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

function buildCodexAuthorizeUrl(input: {
  redirectUri: string;
  state: string;
  challenge: string;
  originator: string;
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
  authUrl.searchParams.set("originator", input.originator);
  return authUrl.toString();
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

async function closeOauthCallbackServerIfIdle() {
  if (!oauthCallbackServerState || pendingOauthRequests.size > 0) {
    return;
  }

  const serverState = oauthCallbackServerState;
  try {
    await serverState.close();
  } catch {
    // The callback server is best-effort cleanup. A later login attempt will
    // still surface a concrete port conflict if the listener did not stop.
  }
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

function replaceBulletLine(content: string, prefix: string, value: string): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^- ${escaped}.*$`, "m");
  const nextLine = `- ${prefix}${value}`;
  if (pattern.test(content)) {
    return content.replace(pattern, nextLine);
  }
  return `${content.trim()}\n${nextLine}\n`;
}

function ruleVersionDir(vaultRoot: string, ruleId: string): string {
  return join(vaultRoot, "rule-versions", toSafeId(ruleId));
}

function versionTimestampId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function snapshotRuleVersion(input: {
  vaultRoot: string;
  ruleId: string;
  rulePath: string;
  action: RuleVersionAction;
  reason?: string;
}): Promise<RuleVersionMeta> {
  const createdAt = new Date().toISOString();
  const versionId = `${versionTimestampId()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = ruleVersionDir(input.vaultRoot, input.ruleId);
  await mkdir(dir, { recursive: true });

  const snapshotPath = join(dir, `${versionId}.md`);
  const metadataPath = join(dir, `${versionId}.json`);
  const raw = await readFile(input.rulePath, "utf8");
  await writeFile(snapshotPath, raw, "utf8");

  const metadata: RuleVersionMeta = {
    versionId,
    ruleId: input.ruleId,
    action: input.action,
    reason: input.reason || "",
    createdAt,
    snapshotPath,
    metadataPath,
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return metadata;
}

async function listRuleVersions(vaultRoot: string, ruleId: string): Promise<RuleVersionMeta[]> {
  const dir = ruleVersionDir(vaultRoot, ruleId);
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const metas: RuleVersionMeta[] = [];
  for (const entry of entries.filter((item) => item.endsWith(".json"))) {
    try {
      const raw = await readFile(join(dir, entry), "utf8");
      const parsed = JSON.parse(raw) as Partial<RuleVersionMeta>;
      if (!parsed.versionId || !parsed.ruleId || !parsed.snapshotPath || !parsed.metadataPath) {
        continue;
      }
      metas.push({
        versionId: parsed.versionId,
        ruleId: parsed.ruleId,
        action: (parsed.action as RuleVersionAction) || "update_scope",
        reason: parsed.reason || "",
        createdAt: parsed.createdAt || "",
        snapshotPath: parsed.snapshotPath,
        metadataPath: parsed.metadataPath,
      });
    } catch {
      // ignore broken metadata entry
    }
  }

  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function syncAfterRuleMutation(input: {
  vaultRoot: string;
  updatedRuleId: string;
  updatedRuleStatus: string;
}) {
  const repo = new VaultRepository(input.vaultRoot);
  const client = createLlmClient(input.vaultRoot);
  const [rules, profiles, tasks, materials, feedbackEntries] = await Promise.all([
    repo.loadRules(),
    repo.loadProfiles(),
    repo.loadTasks(),
    repo.loadMaterials(),
    repo.loadFeedbackEntries(),
  ]);

  const updatedTasks = await syncRuleInTasks({
    tasks,
    ruleId: input.updatedRuleId,
    enabled: input.updatedRuleStatus === "confirmed",
  });

  const profilePath = await refreshDefaultProfile({
    vaultRoot: input.vaultRoot,
    profiles,
    rules,
    materials,
    feedbackEntries,
    client,
  });

  return { updatedTasks, profilePath };
}

function normalizeTextForCompare(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractKeywords(text: string): string[] {
  const raw = text
    .toLowerCase()
    .split(/[\s,.;:!?，。；：！？、（）()\[\]{}"'`~\-_/\\]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return [...new Set(raw)].slice(0, 20);
}

function tokenSet(text: string): Set<string> {
  return new Set(extractKeywords(text));
}

function evaluateFeedbackAbsorption(input: {
  beforeDraft: string;
  afterDraft: string;
  reason: string;
  comment: string;
  selectedText: string;
}) {
  const before = normalizeTextForCompare(input.beforeDraft || "");
  const after = normalizeTextForCompare(input.afterDraft || "");
  const reasonText = `${input.reason || ""} ${input.comment || ""}`.trim();
  const notes: string[] = [];
  if (!after) {
    return {
      score: 0,
      level: "weak",
      absorbed: false,
      notes: ["再生成结果为空，无法判定反馈吸收情况。"],
      changedRatio: 0,
      keywordHitRatio: 0,
    };
  }

  const beforeTokens = tokenSet(before);
  const afterTokens = tokenSet(after);
  const union = new Set([...beforeTokens, ...afterTokens]);
  let overlap = 0;
  for (const token of beforeTokens) {
    if (afterTokens.has(token)) {
      overlap += 1;
    }
  }
  const changedRatio = union.size ? 1 - overlap / union.size : before === after ? 0 : 1;
  let score = 40 + changedRatio * 30;

  if (before === after) {
    score = 5;
    notes.push("改前改后正文无变化。");
  } else {
    notes.push(`正文变化比例约 ${(changedRatio * 100).toFixed(1)}%。`);
  }

  const keywords = extractKeywords(reasonText);
  let keywordHits = 0;
  for (const keyword of keywords) {
    if (after.includes(keyword) && !before.includes(keyword)) {
      keywordHits += 1;
    }
  }
  const keywordHitRatio = keywords.length ? keywordHits / keywords.length : 0;
  score += keywordHitRatio * 20;
  if (keywords.length) {
    notes.push(`反馈关键词新增命中 ${keywordHits}/${keywords.length}。`);
  }

  if (input.selectedText) {
    const selected = normalizeTextForCompare(input.selectedText);
    if (selected && !after.includes(selected)) {
      score += 12;
      notes.push("选区原文已被改写。");
    } else if (selected && after.includes(selected) && before.includes(selected)) {
      score -= 6;
      notes.push("选区原文仍基本保持不变。");
    }
  }

  if (/补充|具体|数据|量化|完善|展开/.test(reasonText)) {
    if (after.length > before.length * 1.02) {
      score += 8;
      notes.push("正文长度增长，符合“补充/展开”倾向。");
    }
  }
  if (/精简|简洁|压缩|删减/.test(reasonText)) {
    if (after.length < before.length * 0.98) {
      score += 8;
      notes.push("正文长度收敛，符合“精简”倾向。");
    }
  }

  score = Math.max(0, Math.min(100, Number(score.toFixed(1))));
  const level = score >= 80 ? "strong" : score >= 60 ? "partial" : "weak";
  const absorbed = level !== "weak";
  return {
    score,
    level,
    absorbed,
    notes,
    changedRatio: Number(changedRatio.toFixed(3)),
    keywordHitRatio: Number(keywordHitRatio.toFixed(3)),
  };
}

async function persistFeedbackEvaluation(input: {
  feedbackPath: string;
  evaluation: ReturnType<typeof evaluateFeedbackAbsorption>;
}) {
  const doc = await readMarkdownDocument(input.feedbackPath);
  const now = new Date().toISOString();
  const nextFrontmatter = {
    ...doc.frontmatter,
    absorption_score: input.evaluation.score,
    absorption_level: input.evaluation.level,
    absorption_updated_at: now,
  };
  const evaluationBody = [
    `- 评分：${input.evaluation.score}`,
    `- 等级：${input.evaluation.level}`,
    `- 是否吸收：${input.evaluation.absorbed ? "是" : "否"}`,
    `- 正文变化比例：${input.evaluation.changedRatio}`,
    `- 关键词命中比例：${input.evaluation.keywordHitRatio}`,
    `- 评估时间：${now}`,
    `- 说明：${input.evaluation.notes.join("；") || "无"}`,
  ].join("\n");
  const nextContent = replaceSection(doc.content, "学习评估", evaluationBody);
  await writeMarkdownDocument(doc.path, nextFrontmatter, nextContent);
}

type ObservabilityEvent = {
  id: string;
  at: string;
  taskId: string;
  taskPath: string;
  stage: string;
  action: "diagnose" | "outline" | "draft";
  usedModel: string;
  triedModels: string[];
  durationMs: number;
  success: boolean;
  errors: string[];
  matchedRuleCount: number;
  matchedMaterialCount: number;
  evidenceCardCount: number;
};

function observabilityLogPath(vaultRoot: string): string {
  return join(vaultRoot, "observability", "llm-events.jsonl");
}

async function appendObservabilityEvent(vaultRoot: string, event: ObservabilityEvent): Promise<void> {
  const path = observabilityLogPath(vaultRoot);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}

async function readRecentObservabilityEvents(vaultRoot: string, limit = 80): Promise<ObservabilityEvent[]> {
  try {
    const raw = await readFile(observabilityLogPath(vaultRoot), "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const items: ObservabilityEvent[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        items.push(JSON.parse(line) as ObservabilityEvent);
      } catch {
        // ignore malformed lines
      }
    }
    return items.sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

async function applyRuleAction(input: {
  action: RuleAction;
  vaultRoot: string;
  rulePath: string;
  reason?: string;
}) {
  const repo = new VaultRepository(input.vaultRoot);
  const rule = await repo.loadRule(input.rulePath);
  const snapshot = await snapshotRuleVersion({
    vaultRoot: input.vaultRoot,
    ruleId: rule.id,
    rulePath: rule.path,
    action: input.action,
    reason: input.reason,
  });
  const updatedRule =
    input.action === "confirm"
      ? await confirmRule(rule, input.reason)
      : input.action === "disable"
        ? await disableRule(rule, input.reason)
        : await rejectRule(rule, input.reason);

  const sync = await syncAfterRuleMutation({
    vaultRoot: input.vaultRoot,
    updatedRuleId: updatedRule.id,
    updatedRuleStatus: updatedRule.status,
  });

  return {
    rule: updatedRule,
    updatedTasks: sync.updatedTasks,
    profilePath: sync.profilePath,
    snapshot,
  };
}

async function applyRuleScopeUpdate(input: {
  vaultRoot: string;
  rulePath: string;
  scope?: string;
  docTypes?: string[];
  audiences?: string[];
  reason?: string;
}) {
  const repo = new VaultRepository(input.vaultRoot);
  const rule = await repo.loadRule(input.rulePath);
  const snapshot = await snapshotRuleVersion({
    vaultRoot: input.vaultRoot,
    ruleId: rule.id,
    rulePath: rule.path,
    action: "update_scope",
    reason: input.reason,
  });

  const nextFrontmatter = {
    ...rule.frontmatter,
    scope: typeof input.scope === "string" ? input.scope : rule.scope,
    doc_types: Array.isArray(input.docTypes) ? input.docTypes : rule.docTypes,
    audiences: Array.isArray(input.audiences) ? input.audiences : rule.audiences,
    updated_at: new Date().toISOString(),
    scope_reason: input.reason || rule.frontmatter.scope_reason,
  };
  const nextScope = String(nextFrontmatter.scope || "");
  const nextContent = replaceBulletLine(rule.content, "适用范围：", nextScope || "待补充");
  await writeMarkdownDocument(rule.path, nextFrontmatter, nextContent);

  const updatedRule = await repo.loadRule(rule.path);
  const sync = await syncAfterRuleMutation({
    vaultRoot: input.vaultRoot,
    updatedRuleId: updatedRule.id,
    updatedRuleStatus: updatedRule.status,
  });

  return {
    rule: updatedRule,
    updatedTasks: sync.updatedTasks,
    profilePath: sync.profilePath,
    snapshot,
  };
}

async function rollbackRuleVersion(input: {
  vaultRoot: string;
  rulePath: string;
  versionId: string;
  reason?: string;
}) {
  const repo = new VaultRepository(input.vaultRoot);
  const rule = await repo.loadRule(input.rulePath);
  const versions = await listRuleVersions(input.vaultRoot, rule.id);
  const target = versions.find((item) => item.versionId === input.versionId);
  if (!target) {
    throw new Error(`Rule version ${input.versionId} not found.`);
  }

  const snapshot = await snapshotRuleVersion({
    vaultRoot: input.vaultRoot,
    ruleId: rule.id,
    rulePath: rule.path,
    action: "pre_rollback",
    reason: input.reason || `before rollback to ${input.versionId}`,
  });

  const rawSnapshot = await readFile(target.snapshotPath, "utf8");
  await writeFile(rule.path, rawSnapshot, "utf8");

  const updatedRule = await repo.loadRule(rule.path);
  const sync = await syncAfterRuleMutation({
    vaultRoot: input.vaultRoot,
    updatedRuleId: updatedRule.id,
    updatedRuleStatus: updatedRule.status,
  });

  const rollbackLog = await snapshotRuleVersion({
    vaultRoot: input.vaultRoot,
    ruleId: updatedRule.id,
    rulePath: updatedRule.path,
    action: "rollback",
    reason: input.reason || `rollback to ${input.versionId}`,
  });

  return {
    rule: updatedRule,
    updatedTasks: sync.updatedTasks,
    profilePath: sync.profilePath,
    rollbackTo: target,
    snapshot,
    rollbackLog,
  };
}

async function buildTaskSnapshot(vaultRoot: string, taskPath: string) {
  const repo = new VaultRepository(vaultRoot);
  const client = createLlmClient(vaultRoot);
  const task = await repo.loadTask(taskPath);
  const [materials, rules, profiles, feedbackEntries] = await Promise.all([
    repo.loadMaterials(),
    repo.loadRules(),
    repo.loadProfiles(),
    repo.loadFeedbackEntries(),
  ]);
  const analysisResult = await executeWithModelRouting({
    vaultRoot,
    route: "fast",
    stageLabel: "parse_task",
    runWithClient: (client) => parseTaskWithLlm(client, task),
    fallback: () => parseTask(task),
  });
  const analysis = analysisResult.value;
  const ruleMatch = matchRulesWithPolicy({
    task,
    rules,
    materials,
    profiles,
    feedbackEntries,
  });
  const baseMatchedRules = ruleMatch.matchedRules;
  const baseMatchedMaterials = matchMaterials(task, materials);

  const templateId =
    typeof task.frontmatter.template_id === "string" ? task.frontmatter.template_id : "";
  const templateMode = normalizeTemplateMode(task.frontmatter.template_mode);
  const templateOverridesRaw = task.frontmatter.template_overrides;
  const templateOverrides =
    templateOverridesRaw && typeof templateOverridesRaw === "object" && !Array.isArray(templateOverridesRaw)
      ? Object.entries(templateOverridesRaw as Record<string, unknown>)
          .filter(([section, instruction]) => section && typeof instruction === "string" && instruction.trim())
          .reduce<Record<string, string>>((acc, [section, instruction]) => {
            acc[section] = String(instruction).trim();
            return acc;
          }, {})
      : {};

  const selectedTemplate =
    (templateId && materials.find((item) => item.id === templateId)) ||
    baseMatchedMaterials.find((item) =>
      isTemplateMaterial({
        tags: item.tags,
        source: typeof item.frontmatter.source === "string" ? item.frontmatter.source : "",
        docType: item.docType,
      }),
    ) ||
    null;

  const templateRules = selectedTemplate
    ? [
        {
          rule_id: `template-inherit:${selectedTemplate.id}`,
          title: `模板继承(${templateMode})：${selectedTemplate.title}`,
          priority: 1,
          reason: `继承模板结构与语气（mode=${templateMode}）`,
          source: "template" as const,
          effective_score: templateMode === "strict" ? 2.5 : templateMode === "hybrid" ? 2.1 : 1.6,
        },
        ...Object.entries(templateOverrides).map(([section, instruction], index) => ({
          rule_id: `template-override:${selectedTemplate.id}:${index + 1}`,
          title: `模板覆盖：${section}`,
          priority: 2 + index,
          reason: instruction,
          source: "template" as const,
          effective_score: 2.35 - Math.min(0.5, index * 0.05),
        })),
      ]
    : [];

  const matchedRules = [...templateRules, ...baseMatchedRules]
    .sort((a, b) => (b.effective_score || 0) - (a.effective_score || 0))
    .slice(0, 10);
  const matchedMaterials = selectedTemplate
    ? [selectedTemplate, ...baseMatchedMaterials.filter((item) => item.id !== selectedTemplate.id)]
    : baseMatchedMaterials;
  const ruleDecisionLog = [
    ...ruleMatch.decisionLog,
    selectedTemplate
      ? `模板继承：启用 ${selectedTemplate.title}（mode=${templateMode}，overrides=${Object.keys(templateOverrides).length}）`
      : "模板继承：未指定模板，使用常规规则匹配。",
  ];

  return {
    repo,
    client,
    task,
    profiles,
    analysis,
    matchedRules,
    matchedMaterials,
    ruleDecisionLog,
  };
}

async function executeWithModelRouting<T>(input: {
  vaultRoot: string;
  route: "fast" | "strong";
  stageLabel: string;
  runWithClient: (client: OpenAiCompatibleClient) => Promise<T>;
  fallback: () => T | Promise<T>;
}) {
  const startedAt = Date.now();
  const baseClient = createLlmClient(input.vaultRoot);
  if (!baseClient.isEnabled()) {
    return {
      value: await input.fallback(),
      routeMeta: {
        stage: input.stageLabel,
        usedModel: "heuristic-fallback",
        triedModels: [] as string[],
        errors: [] as string[],
        durationMs: Date.now() - startedAt,
        success: true,
      },
    };
  }

  const llm = getLlmConfig(input.vaultRoot);
  const routing = getRoutingSettings(input.vaultRoot);
  const preferredModel = routing.enabled
    ? input.route === "fast"
      ? routing.fastModel
      : routing.strongModel
    : llm.model;
  const triedModels = [preferredModel, ...(routing.enabled ? routing.fallbackModels : [])]
    .map((item) => item.trim())
    .filter(Boolean);
  const uniqueModels = [...new Set(triedModels)];
  const errors: string[] = [];

  for (const model of uniqueModels) {
    try {
      const routedClient = createLlmClientWithModel(input.vaultRoot, model);
      const value = await input.runWithClient(routedClient);
      return {
        value,
        routeMeta: {
          stage: input.stageLabel,
          usedModel: model,
          triedModels: uniqueModels,
          errors,
          durationMs: Date.now() - startedAt,
          success: true,
        },
      };
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const fallbackValue = await input.fallback();
  return {
    value: fallbackValue,
    routeMeta: {
      stage: input.stageLabel,
      usedModel: "heuristic-fallback",
      triedModels: uniqueModels,
      errors,
      durationMs: Date.now() - startedAt,
      success: false,
    },
  };
}

async function runTaskAction(input: {
  vaultRoot: string;
  taskPath: string;
  action: "diagnose" | "outline" | "draft";
}) {
  const { task, profiles, analysis, matchedRules, matchedMaterials, ruleDecisionLog } =
    await buildTaskSnapshot(
    input.vaultRoot,
    input.taskPath,
    );
  const evidenceCards = buildEvidenceCards({
    task,
    materials: matchedMaterials,
    maxCards: 8,
  });

  const diagnosisInput = {
    task,
    analysis,
    matchedRules,
    matchedMaterials,
    evidenceCards,
    profiles,
  };

  const routeMetas: Array<{
    stage: string;
    usedModel: string;
    triedModels: string[];
    errors: string[];
    durationMs: number;
    success: boolean;
  }> = [];
  const diagnosisResult = await executeWithModelRouting({
    vaultRoot: input.vaultRoot,
    route: "fast",
    stageLabel: "diagnose",
    runWithClient: (client) => diagnoseTaskWithLlm(client, diagnosisInput),
    fallback: () => diagnoseTask(diagnosisInput),
  });
  const diagnosis = diagnosisResult.value;
  routeMetas.push(diagnosisResult.routeMeta);
  const withRoutingDecisionLog = [...ruleDecisionLog];
  withRoutingDecisionLog.push(
    `模型路由[diagnose]：used=${diagnosisResult.routeMeta.usedModel} / tried=${diagnosisResult.routeMeta.triedModels.join(",") || "-"}${diagnosisResult.routeMeta.errors.length ? ` / fallbackErrors=${diagnosisResult.routeMeta.errors.length}` : ""}`,
  );
  await appendObservabilityEvent(input.vaultRoot, {
    id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    taskId: task.id,
    taskPath: task.path,
    stage: "diagnose",
    action: input.action,
    usedModel: diagnosisResult.routeMeta.usedModel,
    triedModels: diagnosisResult.routeMeta.triedModels,
    durationMs: diagnosisResult.routeMeta.durationMs,
    success: diagnosisResult.routeMeta.success,
    errors: diagnosisResult.routeMeta.errors,
    matchedRuleCount: matchedRules.length,
    matchedMaterialCount: matchedMaterials.length,
    evidenceCardCount: evidenceCards.length,
  }).catch(() => undefined);

  if (input.action === "diagnose") {
    await writeTaskSections({
      task,
      diagnosis,
      matchedRules,
      matchedMaterials,
      evidenceCards,
      decisionLog: withRoutingDecisionLog,
    });
    return {
      analysis,
      diagnosis,
      evidenceCards,
      modelRouting: routeMetas,
      ruleDecisionLog: withRoutingDecisionLog,
      matchedRules,
      matchedMaterials,
    };
  }

  const outlineInput = {
    task,
    analysis,
    diagnosis,
    matchedRules,
    matchedMaterials,
    evidenceCards,
    profiles,
  };

  const outlineResult = await executeWithModelRouting({
    vaultRoot: input.vaultRoot,
    route: "fast",
    stageLabel: "outline",
    runWithClient: (client) => buildOutlineWithLlm(client, outlineInput),
    fallback: () => buildOutline(outlineInput),
  });
  const outline = outlineResult.value;
  routeMetas.push(outlineResult.routeMeta);
  withRoutingDecisionLog.push(
    `模型路由[outline]：used=${outlineResult.routeMeta.usedModel} / tried=${outlineResult.routeMeta.triedModels.join(",") || "-"}${outlineResult.routeMeta.errors.length ? ` / fallbackErrors=${outlineResult.routeMeta.errors.length}` : ""}`,
  );
  await appendObservabilityEvent(input.vaultRoot, {
    id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    taskId: task.id,
    taskPath: task.path,
    stage: "outline",
    action: input.action,
    usedModel: outlineResult.routeMeta.usedModel,
    triedModels: outlineResult.routeMeta.triedModels,
    durationMs: outlineResult.routeMeta.durationMs,
    success: outlineResult.routeMeta.success,
    errors: outlineResult.routeMeta.errors,
    matchedRuleCount: matchedRules.length,
    matchedMaterialCount: matchedMaterials.length,
    evidenceCardCount: evidenceCards.length,
  }).catch(() => undefined);

  if (input.action === "outline") {
    await writeTaskSections({
      task,
      diagnosis,
      outline,
      matchedRules,
      matchedMaterials,
      evidenceCards,
      decisionLog: withRoutingDecisionLog,
    });
    return {
      analysis,
      diagnosis,
      outline,
      evidenceCards,
      modelRouting: routeMetas,
      ruleDecisionLog: withRoutingDecisionLog,
      matchedRules,
      matchedMaterials,
    };
  }

  const draftResult = await executeWithModelRouting({
    vaultRoot: input.vaultRoot,
    route: "strong",
    stageLabel: "draft",
    runWithClient: (client) =>
      generateDraftWithLlm(client, {
        task,
        analysis,
        diagnosis,
        outline,
        matchedRules,
        matchedMaterials,
        evidenceCards,
        profiles,
      }),
    fallback: () =>
      generateDraft({
        task,
        analysis,
        diagnosis,
        outline,
        evidenceCards,
      }),
  });
  const draft = draftResult.value;
  routeMetas.push(draftResult.routeMeta);
  withRoutingDecisionLog.push(
    `模型路由[draft]：used=${draftResult.routeMeta.usedModel} / tried=${draftResult.routeMeta.triedModels.join(",") || "-"}${draftResult.routeMeta.errors.length ? ` / fallbackErrors=${draftResult.routeMeta.errors.length}` : ""}`,
  );
  await appendObservabilityEvent(input.vaultRoot, {
    id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    taskId: task.id,
    taskPath: task.path,
    stage: "draft",
    action: input.action,
    usedModel: draftResult.routeMeta.usedModel,
    triedModels: draftResult.routeMeta.triedModels,
    durationMs: draftResult.routeMeta.durationMs,
    success: draftResult.routeMeta.success,
    errors: draftResult.routeMeta.errors,
    matchedRuleCount: matchedRules.length,
    matchedMaterialCount: matchedMaterials.length,
    evidenceCardCount: evidenceCards.length,
  }).catch(() => undefined);

  await writeTaskSections({
    task,
    diagnosis,
    outline,
    draft,
    matchedRules,
    matchedMaterials,
    evidenceCards,
    decisionLog: withRoutingDecisionLog,
  });

  return {
    analysis,
    diagnosis,
    outline,
    draft,
    evidenceCards,
    modelRouting: routeMetas,
    ruleDecisionLog: withRoutingDecisionLog,
    matchedRules,
    matchedMaterials,
  };
}

async function createTaskFromRequest(input: {
  vaultRoot: string;
  request: TaskCreateRequest;
}) {
  if (!input.request.title || !input.request.docType) {
    throw new Error("title 和 docType 是必填项。");
  }

  const repo = new VaultRepository(input.vaultRoot);
  const materials = await repo.loadMaterials();
  const selectedMaterials = materials.filter((item) =>
    input.request.sourceMaterialIds.includes(item.id),
  );

  const created = await createTask({
    vaultRoot: input.vaultRoot,
    title: input.request.title,
    docType: input.request.docType,
    audience: input.request.audience,
    scenario: input.request.scenario,
    priority: input.request.priority,
    targetLength: input.request.targetLength,
    deadline: input.request.deadline,
    goal: input.request.goal,
    targetEffect: input.request.targetEffect,
    background: input.request.background,
    facts: input.request.facts,
    mustInclude: input.request.mustInclude,
    specialRequirements: input.request.specialRequirements,
    templateId: input.request.templateId,
    templateMode: input.request.templateMode,
    templateOverrides: parseTemplateOverrideMap(input.request.templateOverrides),
    sourceMaterials: selectedMaterials,
  });

  return {
    created,
    selectedMaterials,
  };
}

async function startWorkflowRunForTask(input: {
  vaultRoot: string;
  request: TaskCreateRequest;
}) {
  const workflowDefinition = await loadWorkflowDefinition(input.vaultRoot);
  const { created, selectedMaterials } = await createTaskFromRequest({
    vaultRoot: input.vaultRoot,
    request: input.request,
  });

  let run = await createWorkflowRun(input.vaultRoot, {
    taskId: created.taskId,
    taskPath: created.path,
    title: input.request.title,
    definition: workflowDefinition.definition,
  });

  const hasBackground = Boolean(input.request.background.trim());
  run = await appendWorkflowEvent(input.vaultRoot, {
    runId: run.runId,
    stage: "INTAKE_BACKGROUND",
    type: hasBackground ? "completed" : "action",
    summary: hasBackground ? "Background captured." : "Background is partially empty.",
  });

  run = await transitionWorkflowRun(input.vaultRoot, {
    runId: run.runId,
    toStage: "INTAKE_MATERIALS",
    summary: "Entered material intake stage.",
    details: { selectedMaterials: selectedMaterials.length },
    definition: workflowDefinition.definition,
  });

  run = await appendWorkflowEvent(input.vaultRoot, {
    runId: run.runId,
    stage: "INTAKE_MATERIALS",
    type: "completed",
    summary: `Selected ${selectedMaterials.length} materials.`,
    details: { selectedMaterialIds: selectedMaterials.map((item) => item.id) },
  });

  run = await transitionWorkflowRun(input.vaultRoot, {
    runId: run.runId,
    toStage: "SELECT_TEMPLATE",
    summary: "Entered template selection stage.",
    definition: workflowDefinition.definition,
  });

  const hasTemplate = selectedMaterials.some((item) =>
    isTemplateMaterial({
      tags: item.tags,
      source: typeof item.frontmatter.source === "string" ? item.frontmatter.source : "",
      docType: item.docType,
    }),
  );
  run = await appendWorkflowEvent(input.vaultRoot, {
    runId: run.runId,
    stage: "SELECT_TEMPLATE",
    type: "completed",
    summary: hasTemplate ? "Template selected." : "No template selected.",
  });

  run = await transitionWorkflowRun(input.vaultRoot, {
    runId: run.runId,
    toStage: "GENERATE_DRAFT",
    summary: "Entered draft generation stage.",
    definition: workflowDefinition.definition,
  });

  const generated = await runTaskAction({
    vaultRoot: input.vaultRoot,
    taskPath: created.path,
    action: "draft",
  });

  run = await appendWorkflowEvent(input.vaultRoot, {
    runId: run.runId,
    stage: "GENERATE_DRAFT",
    type: "completed",
    summary: "Draft generated.",
    details: {
      diagnosisReadiness: generated.diagnosis?.readiness ?? "unknown",
      outlineSections: generated.outline?.sections?.length ?? 0,
      ruleDecisionLog: generated.ruleDecisionLog ?? [],
    },
  });

  run = await transitionWorkflowRun(input.vaultRoot, {
    runId: run.runId,
    toStage: "REVIEW_DIAGNOSE",
    summary: "Entered review/diagnose stage.",
    definition: workflowDefinition.definition,
  });

  run = await appendWorkflowEvent(input.vaultRoot, {
    runId: run.runId,
    stage: "REVIEW_DIAGNOSE",
    type: "completed",
    summary: "Pre-write diagnosis reviewed.",
    details: {
      missingInfo: generated.diagnosis?.missing_info ?? [],
      risks: generated.diagnosis?.writing_risks ?? [],
      ruleDecisionLog: generated.ruleDecisionLog ?? [],
    },
  });

  run = await transitionWorkflowRun(input.vaultRoot, {
    runId: run.runId,
    toStage: "USER_CONFIRM_OR_EDIT",
    summary: "Waiting for user confirmation or feedback edits.",
    definition: workflowDefinition.definition,
  });

  return {
    run,
    created,
    generated,
    workflowDefinition,
  };
}

async function advanceWorkflowRunForAction(input: {
  vaultRoot: string;
  runId: string;
  action: WorkflowAdvanceAction;
  taskPath?: string;
}): Promise<{
  run: WorkflowRun;
  generated?: Awaited<ReturnType<typeof runTaskAction>>;
  profilePath?: string;
  workflowDefinition: Awaited<ReturnType<typeof loadWorkflowDefinition>>;
}> {
  const workflowDefinition = await loadWorkflowDefinition(input.vaultRoot);
  const existing = await loadWorkflowRun(input.vaultRoot, input.runId);
  const taskPath = input.taskPath ? resolve(input.taskPath) : existing.taskPath;

  if (input.action === "regenerate") {
    if (existing.currentStage !== "USER_CONFIRM_OR_EDIT") {
      throw new Error(
        `Workflow can regenerate only in USER_CONFIRM_OR_EDIT stage. Current: ${existing.currentStage}`,
      );
    }

    let run = await transitionWorkflowRun(input.vaultRoot, {
      runId: input.runId,
      toStage: "GENERATE_DRAFT",
      summary: "Feedback accepted, regenerate draft.",
      definition: workflowDefinition.definition,
    });

    const generated = await runTaskAction({
      vaultRoot: input.vaultRoot,
      taskPath,
      action: "draft",
    });

    run = await appendWorkflowEvent(input.vaultRoot, {
      runId: input.runId,
      stage: "GENERATE_DRAFT",
      type: "completed",
      summary: "Regenerated draft.",
      details: {
        diagnosisReadiness: generated.diagnosis?.readiness ?? "unknown",
        outlineSections: generated.outline?.sections?.length ?? 0,
        ruleDecisionLog: generated.ruleDecisionLog ?? [],
      },
    });

    run = await transitionWorkflowRun(input.vaultRoot, {
      runId: input.runId,
      toStage: "REVIEW_DIAGNOSE",
      summary: "Entered review/diagnose stage after regeneration.",
      definition: workflowDefinition.definition,
    });

    run = await appendWorkflowEvent(input.vaultRoot, {
      runId: input.runId,
      stage: "REVIEW_DIAGNOSE",
      type: "completed",
      summary: "Regenerated diagnosis reviewed.",
      details: {
        missingInfo: generated.diagnosis?.missing_info ?? [],
        risks: generated.diagnosis?.writing_risks ?? [],
        ruleDecisionLog: generated.ruleDecisionLog ?? [],
      },
    });

    run = await transitionWorkflowRun(input.vaultRoot, {
      runId: input.runId,
      toStage: "USER_CONFIRM_OR_EDIT",
      summary: "Returned to user confirmation/edit stage.",
      definition: workflowDefinition.definition,
    });

    return { run, generated, workflowDefinition };
  }

  if (existing.currentStage !== "USER_CONFIRM_OR_EDIT") {
    throw new Error(
      `Workflow can finalize only in USER_CONFIRM_OR_EDIT stage. Current: ${existing.currentStage}`,
    );
  }

  let run = await transitionWorkflowRun(input.vaultRoot, {
    runId: input.runId,
    toStage: "FINALIZE_AND_LEARN",
    summary: "User finalized draft, entering finalize/learn stage.",
    definition: workflowDefinition.definition,
  });

  const repo = new VaultRepository(input.vaultRoot);
  const client = createLlmClient(input.vaultRoot);
  const [profiles, rules, materials, feedbackEntries] = await Promise.all([
    repo.loadProfiles(),
    repo.loadRules(),
    repo.loadMaterials(),
    repo.loadFeedbackEntries(),
  ]);
  const profilePath = await refreshDefaultProfile({
    vaultRoot: input.vaultRoot,
    profiles,
    rules,
    materials,
    feedbackEntries,
    client,
  });

  run = await appendWorkflowEvent(input.vaultRoot, {
    runId: input.runId,
    stage: "FINALIZE_AND_LEARN",
    type: "completed",
    summary: "Finalize/learn completed.",
    details: { profilePath },
  });

  run = await transitionWorkflowRun(input.vaultRoot, {
    runId: input.runId,
    toStage: "FINALIZE_AND_LEARN",
    summary: "Workflow completed.",
    status: "completed",
    definition: workflowDefinition.definition,
  });

  return { run, profilePath, workflowDefinition };
}

async function buildDashboard(vaultRoot: string) {
  const repo = new VaultRepository(vaultRoot);
  const [materials, tasks, rules, feedbackEntries, profiles, workflowRuns, workflowDefinition, observabilityEvents] =
    await Promise.all([
    repo.loadMaterials(),
    repo.loadTasks(),
    repo.loadRules(),
    repo.loadFeedbackEntries(),
    repo.loadProfiles(),
    listWorkflowRuns(vaultRoot),
    loadWorkflowDefinition(vaultRoot),
    readRecentObservabilityEvents(vaultRoot, 80),
    ]);

  const llmConfig = getLlmConfig(vaultRoot);
  const stored = getStoredLlmSettings(vaultRoot);
  const llmProfiles = listStoredLlmProfiles(vaultRoot);
  const activeValidation = stored ? validateStoredLlmProfile(stored) : { ok: true, errors: [], warnings: [] };
  const provider =
    stored?.provider === OPENAI_KEY_PROVIDER ? OPENAI_KEY_PROVIDER : OPENAI_CODEX_PROVIDER;
  const providerLabel =
    provider === OPENAI_KEY_PROVIDER ? OPENAI_KEY_PROVIDER_LABEL : OPENAI_CODEX_PROVIDER_LABEL;
  const materialItems = materials
    .map((item) => {
      const summary = summarizeMaterial(item);
      return {
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
        structureSummary: summary.structure_summary,
        styleSummary: summary.style_summary,
        usefulPhrases: summary.useful_phrases,
        path: item.path,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  const materialTitleById = new Map(materialItems.map((item) => [item.id, item.title]));
  const taskTitleById = new Map(tasks.map((item) => [item.id, item.title]));

  const ruleItems = await Promise.all(
    rules.map(async (item) => {
      const versions = await listRuleVersions(vaultRoot, item.id);
      const linkedTaskCount = tasks.filter((task) => Array.isArray(task.matchedRules) && task.matchedRules.includes(item.id)).length;
      return {
        id: item.id,
        title: item.title,
        status: item.status,
        scope: item.scope,
        docTypes: item.docTypes,
        audiences: item.audiences,
        sourceMaterials: item.sourceMaterials,
        sourceMaterialTitles: item.sourceMaterials
          .map((materialId) => materialTitleById.get(materialId) || materialId)
          .filter(Boolean),
        confidence: item.confidence,
        versionCount: versions.length,
        latestVersionAt: versions[0]?.createdAt || "",
        linkedTaskCount,
        path: item.path,
      };
    }),
  );
  const ruleTitleById = new Map(ruleItems.map((item) => [item.id, item.title]));

  return {
    vaultRoot,
    llm: {
      activeProfileId: llmProfiles.activeProfileId,
      activeProfileName: stored?.name || "",
      provider,
      providerLabel,
      enabled: llmConfig.enabled,
      source: llmConfig.source,
      baseUrl: llmConfig.baseUrl,
      model: llmConfig.model,
      apiType: llmConfig.apiType,
      hasSavedSettings: Boolean(stored),
      updatedAt: stored?.updatedAt ?? null,
      oauthReady: Boolean(stored?.oauthAccessToken && stored?.oauthIdToken),
      validation: activeValidation,
      routingEnabled: Boolean(stored?.routingEnabled),
      fastModel: stored?.fastModel || llmConfig.model,
      strongModel: stored?.strongModel || llmConfig.model,
      fallbackModels: Array.isArray(stored?.fallbackModels) ? stored.fallbackModels : [],
      calibration: stored?.calibration ?? null,
      cards: llmProfiles.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        provider: profile.provider,
        providerLabel:
          profile.provider === OPENAI_KEY_PROVIDER
            ? OPENAI_KEY_PROVIDER_LABEL
            : OPENAI_CODEX_PROVIDER_LABEL,
        model: profile.model,
        apiType: profile.apiType || "openai-completions",
        baseUrl: profile.baseUrl,
        authUrl: profile.authUrl,
        routingEnabled: Boolean(profile.routingEnabled),
        fastModel: profile.fastModel || profile.model,
        strongModel: profile.strongModel || profile.model,
        fallbackModels: Array.isArray(profile.fallbackModels) ? profile.fallbackModels : [],
        enabled: Boolean(profile.bearerToken?.trim()),
        hasBearerToken: Boolean(profile.bearerToken?.trim()),
        oauthReady: Boolean(profile.oauthAccessToken && profile.oauthIdToken),
        validation: validateStoredLlmProfile(profile),
        calibration: profile.calibration ?? null,
        updatedAt: profile.updatedAt ?? null,
        createdAt: profile.createdAt ?? null,
        isActive: profile.id === llmProfiles.activeProfileId,
      })),
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
    rules: ruleItems
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN")),
    feedback: feedbackEntries
      .map((item) => ({
        id: item.id,
        taskId: item.taskId,
        taskTitle: taskTitleById.get(item.taskId) || item.taskId,
        feedbackType: item.feedbackType,
        relatedRuleIds: item.relatedRuleIds,
        relatedRuleTitles: item.relatedRuleIds
          .map((ruleId) => ruleTitleById.get(ruleId) || ruleId)
          .filter(Boolean),
        reusableSuggestion:
          typeof item.frontmatter.is_reusable_rule === "boolean"
            ? item.frontmatter.is_reusable_rule
            : typeof item.frontmatter.reusable_suggestion === "boolean"
              ? item.frontmatter.reusable_suggestion
              : null,
        affectedParagraph:
          typeof item.frontmatter.affected_paragraph === "string" ? item.frontmatter.affected_paragraph : "",
        createdAt: item.createdAt,
        path: item.path,
      }))
      .sort((a, b) => a.id.localeCompare(b.id, "zh-CN")),
    profiles: profiles.map((item) => ({
      id: item.id,
      name: item.name,
      version: item.version,
      generatedBy:
        typeof item.frontmatter.generated_by === "string" ? item.frontmatter.generated_by : "unknown",
      updatedAt:
        typeof item.frontmatter.updated_at === "string" ? item.frontmatter.updated_at : "",
      sourceStats:
        item.frontmatter.source_stats && typeof item.frontmatter.source_stats === "object"
          ? item.frontmatter.source_stats
          : null,
      overview: {
        tone: extractProfileField(item.content, "语气特点："),
        sentenceStyle: extractProfileField(item.content, "句式特点："),
        opening: extractProfileField(item.content, "开头通常怎么写："),
        body: extractProfileField(item.content, "主体通常怎么展开："),
        ending: extractProfileField(item.content, "结尾通常怎么收："),
      },
      highPriorityPreferences: extractProfileBulletSection(item.content, "高优先级偏好").slice(0, 4),
      commonTaboos: extractProfileBulletSection(item.content, "常见禁忌").slice(0, 4),
      stableRuleSummary: extractProfileBulletSection(item.content, "当前稳定规则摘要").slice(0, 4),
      pendingObservations: extractProfileBulletSection(item.content, "待确认观察").slice(0, 4),
      scenarioGuidance: {
        leadershipReport: extractProfileScenarioBullets(item.content, "领导汇报").slice(0, 3),
        proposalDoc: extractProfileScenarioBullets(item.content, "方案材料").slice(0, 3),
        reviewDoc: extractProfileScenarioBullets(item.content, "总结复盘").slice(0, 3),
      },
      path: item.path,
    })),
    workflowRuns: workflowRuns.slice(0, 30).map((item) => ({
      runId: item.runId,
      taskId: item.taskId,
      title: item.title,
      status: item.status,
      currentStage: item.currentStage,
      updatedAt: item.updatedAt,
    })),
    workflowDefinition: {
      id: workflowDefinition.definition.id,
      version: workflowDefinition.definition.version,
      source: workflowDefinition.source,
      path: workflowDefinition.path,
      initialStage: workflowDefinition.definition.initialStage,
      stageCount: workflowDefinition.definition.stages.length,
    },
    observability: observabilityEvents.slice(0, 60),
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
  const oauthErrorDescription = input.url.searchParams.get("error_description");

  if (oauthError) {
    if (state) {
      pendingOauthRequests.delete(state);
    }
    input.res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    input.res.end(
      buildOauthErrorPage({
        title: "OAuth 登录失败",
        message: `OAuth failed: ${oauthError}`,
        details: oauthErrorDescription || "No error_description returned from OAuth callback.",
      }),
    );
    void closeOauthCallbackServerIfIdle();
    return;
  }
  if (!code || !state) {
    sendText(input.res, 400, "Missing code or state.");
    void closeOauthCallbackServerIfIdle();
    return;
  }

  const pending = pendingOauthRequests.get(state);
  if (!pending) {
    sendText(input.res, 400, "OAuth state is invalid or expired.");
    void closeOauthCallbackServerIfIdle();
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
      void closeOauthCallbackServerIfIdle();
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
    await calibrateAndPersistLlmProfile(input.vaultRoot, savedProfile);
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
    void closeOauthCallbackServerIfIdle();
    return;
  }

  input.res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  input.res.end(buildOauthSuccessPage(pending.frontendOrigin));
  void closeOauthCallbackServerIfIdle();
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
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        void describeListeningProcess(OPENAI_CODEX_CALLBACK_PORT).then((occupant) => {
          const suffix = occupant
            ? ` 当前监听进程：${occupant}`
            : " 无法自动识别监听进程。";
          rejectPromise(
            new Error(
              `OAuth 回调端口 ${OPENAI_CODEX_CALLBACK_PORT} 已被占用。请关闭旧的本地监听后重试。${suffix}`,
            ),
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
        const body = (await readBody(req)) as Record<string, unknown>;
        const provider =
          body.provider === OPENAI_CODEX_PROVIDER ? OPENAI_CODEX_PROVIDER : OPENAI_KEY_PROVIDER;
        const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
        const profiles = listStoredLlmProfiles(vaultRoot);
        const existing =
          profiles.profiles.find((profile) => profile.id === profileId) ??
          getStoredLlmSettings(vaultRoot);
        const profileName = typeof body.name === "string" ? body.name.trim() : "";
        const isCodex = provider === OPENAI_CODEX_PROVIDER;
        const model = isCodex
          ? normalizeCodexModel(body.model ?? existing?.model)
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

        const tokenInput = typeof body.bearerToken === "string" ? body.bearerToken : "";
        if (isCodex && tokenInput.trim()) {
          sendJson(res, 400, {
            error: "OAuth 卡片不支持手工填写 token。请保存卡片后点击“开始 OAuth 登录”。",
          });
          return;
        }
        const preserveExistingToken =
          Boolean(profileId) &&
          !tokenInput &&
          existing?.id === profileId;

        const candidateSettings: StoredLlmSettings = {
          id: profileId || existing?.id || `llm-preview-${Date.now()}`,
          name: profileName || existing?.name || "",
          provider,
          apiType:
            isCodex
              ? "openai-completions"
              : body.apiType === "anthropic-messages"
                ? "anthropic-messages"
                : "openai-completions",
          bearerToken:
            preserveExistingToken
              ? existing?.bearerToken ?? ""
              : tokenInput,
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
              : typeof body.authUrl === "string" && body.authUrl.trim()
                ? body.authUrl.trim()
                : existing?.authUrl || "",
          tokenUrl:
            isCodex
              ? OPENAI_CODEX_TOKEN_URL
              : typeof body.tokenUrl === "string" && body.tokenUrl.trim()
                ? body.tokenUrl.trim()
                : existing?.tokenUrl || "",
          clientId:
            isCodex
              ? OPENAI_CODEX_CLIENT_ID
              : typeof body.clientId === "string" && body.clientId.trim()
                ? body.clientId.trim()
                : existing?.clientId || "",
          scope:
            isCodex
              ? OPENAI_CODEX_SCOPE
              : typeof body.scope === "string" && body.scope.trim()
                ? body.scope.trim()
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
        const validation = validateStoredLlmProfile(candidateSettings);
        if (validation.errors.length) {
          sendJson(res, 400, {
            error: validation.errors[0],
            validation,
          });
          return;
        }

        const shouldActivate =
          !profiles.activeProfileId || !profileId || profiles.activeProfileId === profileId;
        const settings = upsertStoredLlmProfile(vaultRoot, {
          ...candidateSettings,
        }, { activate: shouldActivate }).profile;
        const calibration = settings.bearerToken.trim()
          ? await calibrateAndPersistLlmProfile(vaultRoot, settings)
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
          listStoredLlmProfiles(vaultRoot).profiles.find((profile) => profile.id === settings.id) ??
          settings;
        const resolved = getLlmConfig(vaultRoot);
        sendJson(res, 200, { settings: latestSettings, resolved, validation, calibration });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/test") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
        const profiles = listStoredLlmProfiles(vaultRoot);
        const existing =
          profiles.profiles.find((profile) => profile.id === profileId) ??
          getStoredLlmSettings(vaultRoot);

        let candidate: StoredLlmSettings | null = null;
        if (profileId && existing?.id === profileId) {
          candidate = existing;
        } else if (typeof body.provider === "string") {
          const provider =
            body.provider === OPENAI_CODEX_PROVIDER ? OPENAI_CODEX_PROVIDER : OPENAI_KEY_PROVIDER;
          const isCodex = provider === OPENAI_CODEX_PROVIDER;
          const model = isCodex
            ? normalizeCodexModel(body.model ?? existing?.model)
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
            return;
          }
          const preserveExistingToken = Boolean(profileId) && !tokenInput && existing?.id === profileId;
          candidate = {
            id: profileId || existing?.id || `llm-preview-${Date.now()}`,
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
            bearerToken:
              preserveExistingToken
                ? existing?.bearerToken ?? ""
                : tokenInput,
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
                : typeof body.authUrl === "string" && body.authUrl.trim()
                  ? body.authUrl.trim()
                  : existing?.authUrl || "",
            tokenUrl:
              isCodex
                ? OPENAI_CODEX_TOKEN_URL
                : typeof body.tokenUrl === "string" && body.tokenUrl.trim()
                  ? body.tokenUrl.trim()
                  : existing?.tokenUrl || "",
            clientId:
              isCodex
                ? OPENAI_CODEX_CLIENT_ID
                : typeof body.clientId === "string" && body.clientId.trim()
                  ? body.clientId.trim()
                  : existing?.clientId || "",
            scope:
              isCodex
                ? OPENAI_CODEX_SCOPE
                : typeof body.scope === "string" && body.scope.trim()
                  ? body.scope.trim()
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
          return;
        }

        const result = await runLlmConnectivityTest(candidate);
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/select") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
        if (!profileId) {
          sendJson(res, 400, { error: "Missing profileId." });
          return;
        }
        const store = activateStoredLlmProfile(vaultRoot, profileId);
        sendJson(res, 200, { activeProfileId: store.activeProfileId });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/delete") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
        if (!profileId) {
          sendJson(res, 400, { error: "Missing profileId." });
          return;
        }
        const store = deleteStoredLlmProfile(vaultRoot, profileId);
        sendJson(res, 200, {
          activeProfileId: store.activeProfileId,
          remaining: store.profiles.length,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/oauth/start") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        const frontendOrigin = req.headers.host
          ? `http://${req.headers.host}`
          : `http://127.0.0.1:${port}`;
        const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
        const profiles = listStoredLlmProfiles(vaultRoot);
        const existing =
          profiles.profiles.find((profile) => profile.id === profileId) ??
          getStoredLlmSettings(vaultRoot);
        await ensureOauthCallbackServer(vaultRoot);
        const selectedModel = normalizeCodexModel(body.model ?? existing?.model);
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
        const state = toBase64Url(randomBytes(18));
        const redirectUri = `http://localhost:${OPENAI_CODEX_CALLBACK_PORT}/auth/callback`;
        pendingOauthRequests.set(state, {
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

      if (req.method === "GET" && url.pathname === "/api/workflow/run") {
        const runId = url.searchParams.get("runId");
        if (!runId) {
          sendJson(res, 400, { error: "Missing runId parameter." });
          return;
        }

        const run = await loadWorkflowRun(vaultRoot, runId);
        sendJson(res, 200, { run });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/workflow/definition") {
        const workflowDefinition = await loadWorkflowDefinition(vaultRoot);
        sendJson(res, 200, workflowDefinition);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/workflow/definition") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const rawDefinition = body.definition ?? body;
        const saved = await saveWorkflowDefinition(vaultRoot, rawDefinition);
        const reloaded = await loadWorkflowDefinition(vaultRoot);
        sendJson(res, 200, {
          saved,
          reloaded,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/workflow/start") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const request = toTaskCreateRequest(body);
        if (!request.title || !request.docType) {
          sendJson(res, 400, { error: "title 和 docType 是必填项。" });
          return;
        }

        const result = await startWorkflowRunForTask({
          vaultRoot,
          request,
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/workflow/advance") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const runId = typeof body.runId === "string" ? body.runId : "";
        const action = typeof body.action === "string" ? body.action : "";
        const taskPath = typeof body.taskPath === "string" ? body.taskPath : undefined;

        if (!runId || !action) {
          sendJson(res, 400, { error: "Missing runId or action." });
          return;
        }

        if (action !== "regenerate" && action !== "finalize") {
          sendJson(res, 400, { error: "Unsupported workflow action." });
          return;
        }

        const result = await advanceWorkflowRunForAction({
          vaultRoot,
          runId,
          action,
          taskPath,
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/create") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const request = toTaskCreateRequest(body);
        if (!request.title || !request.docType) {
          sendJson(res, 400, { error: "title 和 docType 是必填项。" });
          return;
        }

        const { created } = await createTaskFromRequest({
          vaultRoot,
          request,
        });

        sendJson(res, 200, created);
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

        const ignoreReasons = new Set(["手动保存", "直接定稿"]);
        const feedbackSignals = normalizeTaskFeedbackSignals(task.frontmatter.feedback_signals);
        const normalizedLocation = location || "全文";
        const existingSignal = feedbackSignals[normalizedLocation] ?? {
          count: 0,
          latest_reason: "",
          latest_updated_at: "",
          latest_version: "",
          recent_reasons: [],
        };
        const shouldCountFeedback = Boolean(reason) && !ignoreReasons.has(reason);
        const nextCount = shouldCountFeedback ? existingSignal.count + 1 : existingSignal.count;
        const nextReasons = shouldCountFeedback
          ? [...existingSignal.recent_reasons, reason].slice(-5)
          : existingSignal.recent_reasons;
        feedbackSignals[normalizedLocation] = {
          count: nextCount,
          latest_reason: reason || existingSignal.latest_reason,
          latest_updated_at: now,
          latest_version: version || existingSignal.latest_version,
          recent_reasons: nextReasons,
        };

        await writeMarkdownDocument(task.path, {
          ...task.frontmatter,
          status: finalized ? "finalized" : "draft",
          updated_at: now || currentUpdated,
          feedback_signals: feedbackSignals,
        }, nextContent);

        sendJson(res, 200, {
          path: task.path,
          updatedAt: now,
          finalized,
          feedbackSignal: feedbackSignals[normalizedLocation],
        });
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
        const body = (await readBody(req)) as Record<string, unknown>;
        if (typeof body.rawFeedback !== "string" || !body.rawFeedback.trim()) {
          sendJson(res, 400, { error: "rawFeedback 是必填项。" });
          return;
        }

        const result = await createFeedback({
          vaultRoot,
          taskId: typeof body.taskId === "string" ? body.taskId : "",
          feedbackType: typeof body.feedbackType === "string" ? body.feedbackType : "",
          severity: typeof body.severity === "string" ? body.severity : "medium",
          action: typeof body.action === "string" ? body.action : "review",
          rawFeedback: body.rawFeedback,
          affectedParagraph: typeof body.affectedParagraph === "string" ? body.affectedParagraph : "",
          affectedSection: typeof body.affectedSection === "string" ? body.affectedSection : "",
          affectsStructure: typeof body.affectsStructure === "string" ? body.affectsStructure : "",
          selectedText: typeof body.selectedText === "string" ? body.selectedText : "",
          selectionStart:
            typeof body.selectionStart === "number"
              ? body.selectionStart
              : Number.isFinite(Number(body.selectionStart))
                ? Number(body.selectionStart)
                : undefined,
          selectionEnd:
            typeof body.selectionEnd === "number"
              ? body.selectionEnd
              : Number.isFinite(Number(body.selectionEnd))
                ? Number(body.selectionEnd)
                : undefined,
          annotations: Array.isArray(body.annotations)
            ? body.annotations.map((item) => ({
                location: typeof item?.location === "string" ? item.location : "",
                reason: typeof item?.reason === "string" ? item.reason : "",
                comment: typeof item?.comment === "string" ? item.comment : "",
                isReusable: Boolean(item?.isReusable),
                priority:
                  typeof item?.priority === "string" && item.priority.trim()
                    ? item.priority.trim()
                    : "medium",
                selectedText: typeof item?.selectedText === "string" ? item.selectedText : "",
                selectionStart:
                  typeof item?.selectionStart === "number"
                    ? item.selectionStart
                    : Number.isFinite(Number(item?.selectionStart))
                      ? Number(item.selectionStart)
                      : undefined,
                selectionEnd:
                  typeof item?.selectionEnd === "number"
                    ? item.selectionEnd
                    : Number.isFinite(Number(item?.selectionEnd))
                      ? Number(item.selectionEnd)
                      : undefined,
              }))
            : [],
        });

        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/feedback/evaluate") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const beforeDraft = typeof body.beforeDraft === "string" ? body.beforeDraft : "";
        const afterDraft = typeof body.afterDraft === "string" ? body.afterDraft : "";
        if (!afterDraft.trim()) {
          sendJson(res, 400, { error: "afterDraft 是必填项。" });
          return;
        }

        const evaluation = evaluateFeedbackAbsorption({
          beforeDraft,
          afterDraft,
          reason: typeof body.reason === "string" ? body.reason : "",
          comment: typeof body.comment === "string" ? body.comment : "",
          selectedText: typeof body.selectedText === "string" ? body.selectedText : "",
        });

        if (typeof body.feedbackPath === "string" && body.feedbackPath.trim()) {
          await persistFeedbackEvaluation({
            feedbackPath: resolve(body.feedbackPath),
            evaluation,
          });
        }

        sendJson(res, 200, { evaluation });
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
          snapshot: result.snapshot,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/rules/versions") {
        const path = url.searchParams.get("path");
        if (!path) {
          sendJson(res, 400, { error: "Missing rule path." });
          return;
        }
        const repo = new VaultRepository(vaultRoot);
        const rule = await repo.loadRule(resolve(path));
        const versions = await listRuleVersions(vaultRoot, rule.id);
        sendJson(res, 200, {
          ruleId: rule.id,
          ruleTitle: rule.title,
          versions,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rules/scope") {
        const body = (await readBody(req)) as Record<string, unknown>;
        if (typeof body.path !== "string" || !body.path.trim()) {
          sendJson(res, 400, { error: "Missing rule path." });
          return;
        }

        const docTypes = normalizeTagList(body.docTypes);
        const audiences = normalizeTagList(body.audiences);
        const result = await applyRuleScopeUpdate({
          vaultRoot,
          rulePath: resolve(body.path),
          scope: typeof body.scope === "string" ? body.scope.trim() : "",
          docTypes,
          audiences,
          reason: typeof body.reason === "string" ? body.reason : "",
        });
        sendJson(res, 200, {
          ruleId: result.rule.id,
          scope: result.rule.scope,
          docTypes: result.rule.docTypes,
          audiences: result.rule.audiences,
          profilePath: result.profilePath,
          updatedTasks: result.updatedTasks,
          snapshot: result.snapshot,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rules/rollback") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        if (!body.path || !body.versionId) {
          sendJson(res, 400, { error: "Missing rule path or versionId." });
          return;
        }

        const result = await rollbackRuleVersion({
          vaultRoot,
          rulePath: resolve(body.path),
          versionId: body.versionId,
          reason: body.reason,
        });
        sendJson(res, 200, {
          ruleId: result.rule.id,
          status: result.rule.status,
          scope: result.rule.scope,
          docTypes: result.rule.docTypes,
          audiences: result.rule.audiences,
          profilePath: result.profilePath,
          updatedTasks: result.updatedTasks,
          rollbackTo: result.rollbackTo,
          snapshot: result.snapshot,
          rollbackLog: result.rollbackLog,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/refresh/tasks") {
        const repo = new VaultRepository(vaultRoot);
        const [tasks, materials, rules, profiles, feedbackEntries] = await Promise.all([
          repo.loadTasks(),
          repo.loadMaterials(),
          repo.loadRules(),
          repo.loadProfiles(),
          repo.loadFeedbackEntries(),
        ]);

        const results = [];
        for (const task of tasks) {
          const ruleMatch = matchRulesWithPolicy({
            task,
            rules,
            materials,
            profiles,
            feedbackEntries,
          });
          const matchedRules = ruleMatch.matchedRules;
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
            decisionLog: ruleMatch.decisionLog,
          });
        }

        sendJson(res, 200, results);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/refresh/profile") {
        const repo = new VaultRepository(vaultRoot);
        const client = createLlmClient(vaultRoot);
        const [profiles, rules, materials, feedbackEntries] = await Promise.all([
          repo.loadProfiles(),
          repo.loadRules(),
          repo.loadMaterials(),
          repo.loadFeedbackEntries(),
        ]);
        const profilePath = await refreshDefaultProfile({
          vaultRoot,
          profiles,
          rules,
          materials,
          feedbackEntries,
          client,
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
