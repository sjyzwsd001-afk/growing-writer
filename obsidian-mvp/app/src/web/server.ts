import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import { buildEvidenceCards, buildTemplateRewriteHint, summarizeMaterial } from "../retrieve/summaries.js";
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
import { refreshDefaultProfile } from "../writers/profile-writer.js";
import { syncRuleInTasks } from "../writers/task-rule-sync-writer.js";
import { refreshTaskReferences } from "../writers/task-refresh-writer.js";
import { attachRuleToTask } from "../writers/task-link-writer.js";
import { writeTaskSections } from "../writers/task-writer.js";
import { writeCandidateRule } from "../writers/rule-writer.js";
import { createTask } from "../writers/task-create-writer.js";
import { createFeedback } from "../writers/feedback-create-writer.js";
import { readMarkdownDocument, replaceSection, writeMarkdownDocument } from "../vault/markdown.js";
import { HttpError, ensureLocalApiRequest, readBody, sendJson, sendText } from "./http.js";
import {
  handleDeleteLlmProfile,
  handleSaveLlmSettings,
  handleSelectLlmProfile,
  handleStartCodexOauth,
  handleTestLlmSettings,
} from "./llm-settings.js";
import {
  classifyMaterialRole,
  handleAnalyzeMaterial,
  handleAnalyzeMaterialsBatch,
  handleDeleteMaterials,
  handleDeleteMaterialsBatch,
  handleImportMaterials,
  handleUpdateMaterialRole,
  handleUpdateMaterialRoleBatch,
  isTemplateMaterial,
  normalizeTagList,
} from "./materials.js";
import { buildCodexAuthorizeUrl, createOauthState, createPkcePair, ensureOauthCallbackServer } from "./oauth.js";
import {
  setPendingOauthRequest,
} from "./oauth-state.js";
import { attachApiSessionCookie, ensureApiSession } from "./session.js";
import { serveStatic } from "./static.js";
import {
  handleDashboardRoute,
  handleDocumentRoute,
  handleRefreshProfileRoute,
  handleRefreshTasksRoute,
} from "./read-models.js";
import {
  handleCreateTaskRoute,
  handleRunTaskRoute,
  handleUpdateTaskDraftRoute,
} from "./tasks.js";
import {
  handleWorkflowAdvanceRoute,
  handleWorkflowDefinitionGetRoute,
  handleWorkflowDefinitionSaveRoute,
  handleWorkflowRunRoute,
  handleWorkflowStartRoute,
} from "./workflow.js";
import {
  handleCreateFeedbackRoute,
  handleEvaluateFeedbackRoute,
  handleLearnFeedbackRoute,
  handleRuleActionRoute,
  handleRuleRollbackRoute,
  handleRuleScopeRoute,
  handleRuleVersionsRoute,
} from "./rules-feedback.js";
import {
  applyRuleAction,
  applyRuleScopeUpdate,
  detectRuleConflictHints,
  listRuleVersions,
  rollbackRuleVersion,
} from "./rule-admin.js";
import {
  appendObservabilityEvent,
  readRecentObservabilityEvents,
} from "./observability.js";

type ServerOptions = {
  vaultRoot: string;
  port: number;
};

type WorkflowAdvanceAction = "regenerate" | "finalize";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "public");

function normalizeCodexModel(model: unknown): string {
  if (typeof model !== "string" || !model.trim()) {
    return OPENAI_CODEX_MODEL;
  }

  return OPENAI_CODEX_ALLOWED_MODELS.includes(model as (typeof OPENAI_CODEX_ALLOWED_MODELS)[number])
    ? model
    : OPENAI_CODEX_MODEL;
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

function createAllAvailableLlmClients(vaultRoot: string): OpenAiCompatibleClient[] {
  const stored = listStoredLlmProfiles(vaultRoot);
  const activeId = stored.activeProfileId || "";
  const orderedProfiles = [...stored.profiles].sort((left, right) => {
    const activeDelta = Number(right.id === activeId) - Number(left.id === activeId);
    if (activeDelta !== 0) {
      return activeDelta;
    }
    const usableDelta =
      Number(Boolean(right.calibration?.usable)) - Number(Boolean(left.calibration?.usable));
    if (usableDelta !== 0) {
      return usableDelta;
    }
    return String(left.name || "").localeCompare(String(right.name || ""), "zh-CN");
  });

  return orderedProfiles
    .filter((profile) => Boolean(profile.bearerToken?.trim()))
    .map((profile) => createLlmClientWithProfile(profile));
}

function createLlmClientWithProfile(profile: StoredLlmSettings): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient({
    bearerToken: profile.bearerToken?.trim() || null,
    baseUrl: profile.baseUrl?.trim() || OPENAI_CODEX_BASE_URL,
    model: profile.model?.trim() || OPENAI_CODEX_MODEL,
    apiType: profile.apiType || "openai-completions",
    enabled: Boolean(profile.bearerToken?.trim()),
    source: "saved",
  });
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
const LLM_CALIBRATION_TIMEOUT_MS = 120_000;

function isLikelyLocalLlmProfile(settings: StoredLlmSettings): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(settings.baseUrl.trim());
}

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
    const result = isLikelyLocalLlmProfile(settings)
      ? await client.generateText({
          system:
            "You are a connectivity test for a writing assistant. Reply with plain text only.",
          user: "Reply exactly with GW_LLM_OK",
          timeoutMs: LLM_CALIBRATION_TIMEOUT_MS,
          maxTokens: 64,
        })
      : await client.generateJson({
          system:
            "You are a connectivity test for a writing assistant. Respond with JSON only.",
          user: 'Return exactly this JSON: {"reply":"GW_LLM_OK"}',
          schema: z.object({
            reply: z.string(),
          }),
          timeoutMs: LLM_CALIBRATION_TIMEOUT_MS,
        });

    const connectivityOk = isLikelyLocalLlmProfile(settings)
      ? String(result).trim().includes("GW_LLM_OK")
      : z.object({ reply: z.string() }).parse(result).reply.trim() === "GW_LLM_OK";

    if (!connectivityOk) {
      throw new Error("Connectivity probe did not return the expected confirmation text.");
    }

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
      timeoutMs: LLM_CALIBRATION_TIMEOUT_MS,
    });

    return {
      ok: true,
      usable: true,
      message: "自动校准完成，可直接用于正式写作。",
      structuredOutput: "strict-schema" as const,
    };
  } catch (error) {
    if (isLikelyLocalLlmProfile(settings)) {
      return {
        ok: true,
        usable: true,
        message:
          "轻量校准通过：纯文本连通正常，可先用于普通写作；结构化输出仍较弱，复杂 schema 任务可能不稳定。",
        structuredOutput: "connectivity-only" as const,
      };
    }
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
  fastProfileId: string;
  strongProfileId: string;
  fallbackProfileIds: string[];
  fastModel: string;
  strongModel: string;
  fallbackModels: string[];
} {
  const llm = getLlmConfig(vaultRoot);
  const stored = getStoredLlmSettings(vaultRoot);
  return {
    enabled: Boolean(stored?.routingEnabled),
    fastProfileId: stored?.fastProfileId || "",
    strongProfileId: stored?.strongProfileId || "",
    fallbackProfileIds: Array.isArray(stored?.fallbackProfileIds) ? stored.fallbackProfileIds.filter(Boolean) : [],
    fastModel: stored?.fastModel || llm.model,
    strongModel: stored?.strongModel || llm.model,
    fallbackModels: Array.isArray(stored?.fallbackModels) ? stored.fallbackModels.filter(Boolean) : [],
  };
}

function toSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

function extractKeywords(text: string): string[] {
  const raw = text
    .toLowerCase()
    .split(/[\s,.;:!?，。；：！？、（）()\[\]{}"'`~\-_/\\]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return [...new Set(raw)].slice(0, 20);
}

function normalizeTextForCompare(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
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
    requireLlm: true,
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
  const evidenceCards = buildEvidenceCards({
    task,
    materials: matchedMaterials,
    maxCards: 8,
  });
  const templateRewriteHint = buildTemplateRewriteHint({
    selectedTemplate,
    task,
    taskAnalysis: analysis,
    evidenceCards,
    referenceMaterials: matchedMaterials,
  });
  const ruleDecisionLog = [
    ...ruleMatch.decisionLog,
    selectedTemplate
      ? `模板继承：启用 ${selectedTemplate.title}（mode=${templateMode}，overrides=${Object.keys(templateOverrides).length}）`
      : "模板继承：未指定模板，使用常规规则匹配。",
    templateRewriteHint
      ? `模板改写计划：${templateRewriteHint.rewrite_plan.length} 条`
      : "模板改写计划：当前未生成。",
  ];

  return {
    repo,
    client,
    task,
    profiles,
    analysis,
    matchedRules,
    matchedMaterials,
    templateRewriteHint,
    evidenceCards,
    ruleDecisionLog,
  };
}

async function executeWithModelRouting<T>(input: {
  vaultRoot: string;
  route: "fast" | "strong";
  stageLabel: string;
  runWithClient: (client: OpenAiCompatibleClient) => Promise<T>;
  fallback: () => T | Promise<T>;
  requireLlm?: boolean;
}) {
  const startedAt = Date.now();
  const baseClient = createLlmClient(input.vaultRoot);
  if (!baseClient.isEnabled()) {
    if (input.requireLlm) {
      throw new Error(`LLM_REQUIRED:${input.stageLabel}: 当前没有可用的大模型配置，无法继续执行。`);
    }
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
  const profileStore = listStoredLlmProfiles(input.vaultRoot);
  const profileById = new Map(profileStore.profiles.map((profile) => [profile.id, profile]));
  const activeProfile = getStoredLlmSettings(input.vaultRoot);
  const preferredProfileId = routing.enabled
    ? input.route === "fast"
      ? routing.fastProfileId || activeProfile?.id || ""
      : routing.strongProfileId || activeProfile?.id || ""
    : activeProfile?.id || "";
  const triedProfileIds = [
    preferredProfileId,
    ...(routing.enabled ? routing.fallbackProfileIds : []),
  ]
    .map((item) => item.trim())
    .filter(Boolean);
  const uniqueProfileIds = [...new Set(triedProfileIds)];
  const uniqueModels = routing.enabled
    ? []
    : [...new Set([llm.model, ...(routing.fallbackModels || [])].map((item) => item.trim()).filter(Boolean))];
  const errors: string[] = [];

  if (routing.enabled && uniqueProfileIds.length) {
    for (const profileId of uniqueProfileIds) {
      const profile = profileById.get(profileId);
      if (!profile) {
        errors.push(`${profileId}: 未找到模型卡`);
        continue;
      }
      try {
        const routedClient = createLlmClientWithProfile(profile);
        const value = await input.runWithClient(routedClient);
        return {
          value,
          routeMeta: {
            stage: input.stageLabel,
            usedModel: `${profile.name || profile.id} / ${profile.model}`,
            triedModels: uniqueProfileIds.map((id) => {
              const item = profileById.get(id);
              return item ? `${item.name || item.id} / ${item.model}` : id;
            }),
            errors,
            durationMs: Date.now() - startedAt,
            success: true,
          },
        };
      } catch (error) {
        errors.push(`${profile.name || profile.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } else {
    const preferredModel = input.route === "fast" ? routing.fastModel : routing.strongModel;
    const triedModels = [preferredModel, ...(routing.enabled ? routing.fallbackModels : [])]
      .map((item) => item.trim())
      .filter(Boolean);
    const perModel = [...new Set(triedModels.length ? triedModels : uniqueModels)];
    for (const model of perModel) {
      try {
        const routedClient = createLlmClientWithModel(input.vaultRoot, model);
        const value = await input.runWithClient(routedClient);
        return {
          value,
          routeMeta: {
            stage: input.stageLabel,
            usedModel: model,
            triedModels: perModel,
            errors,
            durationMs: Date.now() - startedAt,
            success: true,
          },
        };
      } catch (error) {
        errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const resolvedTriedModels = routing.enabled
    ? uniqueProfileIds.map((id) => {
        const item = profileById.get(id);
        return item ? `${item.name || item.id} / ${item.model}` : id;
      })
    : uniqueModels;

  if (input.requireLlm) {
    throw new Error(
      `LLM_REQUIRED:${input.stageLabel}: 所有模型卡均调用失败。tried=${resolvedTriedModels.join(" | ") || "-"} errors=${errors.join(" | ") || "-"}`,
    );
  }

  const fallbackValue = await input.fallback();
  return {
    value: fallbackValue,
    routeMeta: {
      stage: input.stageLabel,
      usedModel: "heuristic-fallback",
      triedModels: resolvedTriedModels,
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
  const { task, profiles, analysis, matchedRules, matchedMaterials, templateRewriteHint, evidenceCards, ruleDecisionLog } =
    await buildTaskSnapshot(
    input.vaultRoot,
    input.taskPath,
    );

  const diagnosisInput = {
    task,
    analysis,
    matchedRules,
    matchedMaterials,
    evidenceCards,
    profiles,
    templateRewritePlan: templateRewriteHint?.rewrite_steps ?? [],
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
    requireLlm: true,
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
      templateRewriteHint,
    });
    return {
      analysis,
      diagnosis,
      evidenceCards,
      modelRouting: routeMetas,
      ruleDecisionLog: withRoutingDecisionLog,
      matchedRules,
      matchedMaterials,
      templateRewriteHint,
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
    templateRewritePlan: templateRewriteHint?.rewrite_steps ?? [],
  };

  const outlineResult = await executeWithModelRouting({
    vaultRoot: input.vaultRoot,
    route: "fast",
    stageLabel: "outline",
    runWithClient: (client) => buildOutlineWithLlm(client, outlineInput),
    fallback: () => buildOutline(outlineInput),
    requireLlm: true,
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
      templateRewriteHint,
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
      templateRewriteHint,
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
        templateRewritePlan: templateRewriteHint?.rewrite_steps ?? [],
      }),
    fallback: () =>
      generateDraft({
        task,
        analysis,
        diagnosis,
        outline,
        evidenceCards,
      }),
    requireLlm: true,
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
    templateRewriteHint,
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
    templateRewriteHint,
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
  const clients = createAllAvailableLlmClients(input.vaultRoot);
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
    client: clients,
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
      if (url.pathname.startsWith("/api/")) {
        ensureLocalApiRequest(req);
        ensureApiSession(req);
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) {
        const staticPath = url.pathname === "/" ? "/index.html" : url.pathname.replace(/^\/assets/, "");
        attachApiSessionCookie(res);
        await serveStatic(publicDir, res, staticPath);
        return;
      }

      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        attachApiSessionCookie(res);
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/dashboard") {
        await handleDashboardRoute({
          vaultRoot,
          res,
          detectRuleConflictHints,
          listRuleVersions,
          readRecentObservabilityEvents,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleSaveLlmSettings({
          vaultRoot,
          body,
          allowedModels: OPENAI_CODEX_ALLOWED_MODELS,
          calibrateProfile: calibrateAndPersistLlmProfile,
          res,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/test") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleTestLlmSettings({
          vaultRoot,
          body,
          allowedModels: OPENAI_CODEX_ALLOWED_MODELS,
          runConnectivityTest: runLlmConnectivityTest,
          res,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/select") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleSelectLlmProfile({ vaultRoot, body, res });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/delete") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleDeleteLlmProfile({ vaultRoot, body, res });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/oauth/start") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleStartCodexOauth({
          vaultRoot,
          port,
          body,
          allowedModels: OPENAI_CODEX_ALLOWED_MODELS,
          calibrateProfile: calibrateAndPersistLlmProfile,
          res,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/document") {
        await handleDocumentRoute({
          targetPath: url.searchParams.get("path"),
          res,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/import") {
        const body = (await readBody(req)) as Record<string, string | string[] | undefined>;
        await handleImportMaterials({
          vaultRoot,
          body,
          createClients: () => createAllAvailableLlmClients(vaultRoot),
          res,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/delete") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleDeleteMaterials({ vaultRoot, body, res });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/delete-batch") {
        const body = (await readBody(req)) as Record<string, string[] | undefined>;
        await handleDeleteMaterialsBatch({ vaultRoot, body, res });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/workflow/run") {
        await handleWorkflowRunRoute({
          vaultRoot,
          runId: url.searchParams.get("runId"),
          res,
          loadWorkflowRun,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/workflow/definition") {
        await handleWorkflowDefinitionGetRoute({
          vaultRoot,
          res,
          loadWorkflowDefinition,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/workflow/definition") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleWorkflowDefinitionSaveRoute({
          vaultRoot,
          body,
          res,
          saveWorkflowDefinition,
          loadWorkflowDefinition,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/workflow/start") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleWorkflowStartRoute({
          vaultRoot,
          body,
          res,
          toTaskCreateRequest,
          startWorkflowRunForTask,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/workflow/advance") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleWorkflowAdvanceRoute({
          vaultRoot,
          body,
          res,
          advanceWorkflowRunForAction,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/create") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleCreateTaskRoute({
          vaultRoot,
          body,
          res,
          toTaskCreateRequest,
          createTaskFromRequest,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/analyze") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleAnalyzeMaterial({
          vaultRoot,
          body,
          createClients: () => createAllAvailableLlmClients(vaultRoot),
          res,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/analyze/batch") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleAnalyzeMaterialsBatch({
          vaultRoot,
          body,
          createClients: () => createAllAvailableLlmClients(vaultRoot),
          res,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/role") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleUpdateMaterialRole({
          vaultRoot,
          body,
          res,
          readMarkdownDocument,
          writeMarkdownDocument,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/role/batch") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleUpdateMaterialRoleBatch({
          vaultRoot,
          body,
          res,
          readMarkdownDocument,
          writeMarkdownDocument,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/run") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleRunTaskRoute({
          vaultRoot,
          body,
          res,
          runTaskAction,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/update-draft") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleUpdateTaskDraftRoute({
          vaultRoot,
          body,
          res,
          replaceSection,
          writeMarkdownDocument,
          normalizeTaskFeedbackSignals,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/feedback/learn") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleLearnFeedbackRoute({
          vaultRoot,
          body,
          res,
          createLlmClient,
          parseTaskWithLlm,
          parseTask,
          learnFeedbackWithLlm,
          learnFeedback,
          writeCandidateRule,
          writeFeedbackResult,
          attachRuleToTask,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/feedback/create") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleCreateFeedbackRoute({
          vaultRoot,
          body,
          res,
          createFeedback,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/feedback/evaluate") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleEvaluateFeedbackRoute({
          body,
          res,
          evaluateFeedbackAbsorption,
          persistFeedbackEvaluation,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rules/action") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleRuleActionRoute({
          vaultRoot,
          body,
          res,
          applyRuleAction: (input) =>
            applyRuleAction({
              ...input,
              createAllAvailableLlmClients,
            }),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/rules/versions") {
        await handleRuleVersionsRoute({
          vaultRoot,
          path: url.searchParams.get("path"),
          res,
          listRuleVersions,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rules/scope") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleRuleScopeRoute({
          vaultRoot,
          body,
          res,
          normalizeTagList,
          applyRuleScopeUpdate: (input) =>
            applyRuleScopeUpdate({
              ...input,
              createAllAvailableLlmClients,
            }),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rules/rollback") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleRuleRollbackRoute({
          vaultRoot,
          body,
          res,
          rollbackRuleVersion: (input) =>
            rollbackRuleVersion({
              ...input,
              createAllAvailableLlmClients,
            }),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/refresh/tasks") {
        await handleRefreshTasksRoute({
          vaultRoot,
          res,
          matchRulesWithPolicy,
          matchMaterials,
          refreshTaskReferences,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/refresh/profile") {
        await handleRefreshProfileRoute({
          vaultRoot,
          res,
          createLlmClient,
          refreshDefaultProfile,
        });
        return;
      }

      sendJson(res, 404, { error: `Unsupported route: ${toSafeId(url.pathname) || url.pathname}` });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }
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
