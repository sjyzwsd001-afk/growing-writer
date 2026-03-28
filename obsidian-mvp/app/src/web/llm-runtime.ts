import { z } from "zod";

import {
  OPENAI_CODEX_BASE_URL,
  OPENAI_CODEX_MODEL,
} from "../config/constants.js";
import {
  getLlmConfig,
  updateStoredLlmProfileCalibration,
  validateStoredLlmProfile,
  type StoredLlmSettings,
} from "../config/env.js";
import { OpenAiCompatibleClient } from "../llm/openai-compatible.js";

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

export function createLlmClient(vaultRoot: string): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient(getLlmConfig(vaultRoot));
}

function isLikelyLocalLlmProfile(settings: StoredLlmSettings): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(settings.baseUrl.trim());
}

export async function runLlmConnectivityTest(settings: StoredLlmSettings) {
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
        settings.provider === "openai-codex-oauth"
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

export async function calibrateAndPersistLlmProfile(vaultRoot: string, profile: StoredLlmSettings) {
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

export function createLlmClientWithModel(vaultRoot: string, modelOverride?: string): OpenAiCompatibleClient {
  const config = getLlmConfig(vaultRoot);
  const model = typeof modelOverride === "string" && modelOverride.trim() ? modelOverride.trim() : config.model;
  return new OpenAiCompatibleClient({
    ...config,
    model,
  });
}

export function createLlmClientWithProfile(profile: StoredLlmSettings): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient({
    bearerToken: profile.bearerToken?.trim() || null,
    baseUrl: profile.baseUrl?.trim() || OPENAI_CODEX_BASE_URL,
    model: profile.model?.trim() || OPENAI_CODEX_MODEL,
    apiType: profile.apiType || "openai-completions",
    enabled: Boolean(profile.bearerToken?.trim()),
    source: "saved",
  });
}
