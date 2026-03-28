import type {
  DiagnosisResult,
  DraftResult,
  FeedbackAnalysis,
  OutlineResult,
  TaskAnalysis,
} from "../types/schemas.js";
import type {
  EvidenceCard,
  Feedback,
  Material,
  MatchedRule,
  Profile,
  Task,
  TemplateRewriteStep,
} from "../types/domain.js";
import { OpenAiCompatibleClient } from "../llm/openai-compatible.js";
import { buildOutlinePrompt } from "../prompts/build-outline.js";
import { BASE_SYSTEM_PROMPT } from "../prompts/common.js";
import { buildDiagnoseTaskPrompt } from "../prompts/diagnose-task.js";
import { buildGenerateDraftPrompt } from "../prompts/generate-draft.js";
import { buildLearnFeedbackPrompt } from "../prompts/learn-feedback.js";
import { buildParseTaskPrompt } from "../prompts/parse-task.js";
import { summarizeMaterial } from "../retrieve/summaries.js";
import {
  diagnosisResultSchema,
  draftResultSchema,
  feedbackAnalysisSchema,
  outlineResultSchema,
  taskAnalysisSchema,
} from "../types/schemas.js";

function applyTemplateRewritePlanToOutline(
  outline: OutlineResult,
  templateRewritePlan: TemplateRewriteStep[],
): OutlineResult {
  if (!templateRewritePlan.length) {
    return outline;
  }

  const alignedSections = templateRewritePlan.slice(0, 6).map((step, index) => {
    const existing = outline.sections[index];
    const sourceBasis = [
      `模板槽位:${step.section}`,
      ...(step.logic_after
        ? [`逻辑承接:${step.logic_after.from} -> ${step.logic_after.to}（${step.logic_after.reason}）`]
        : []),
      ...(existing?.source_basis ?? []),
    ].filter(Boolean);
    const keyPoints = [
      ...step.assigned_requirements.map((item) => `必须覆盖：${item}`),
      step.fill_strategy,
      ...(existing?.key_points ?? []),
    ].filter(Boolean);
    return {
      heading: step.section,
      purpose: existing?.purpose || step.intent,
      key_points: [...new Set(keyPoints)].slice(0, 5),
      source_basis: [...new Set(sourceBasis)].slice(0, 5),
    };
  });

  return {
    ...outline,
    sections: alignedSections,
    coverage_check: [
      ...new Set([
        ...(outline.coverage_check ?? []),
        `模板改写步骤已对齐 ${alignedSections.length} 节`,
      ]),
    ].slice(0, 6),
  };
}

function splitMarkdownSections(markdown: string): Array<{ heading: string; body: string }> {
  const normalized = String(markdown || "").trim();
  if (!normalized) {
    return [];
  }

  const matches = [...normalized.matchAll(/^###?\s+(.+)$/gm)];
  if (!matches.length) {
    return [{ heading: "", body: normalized }];
  }

  return matches.map((match, index) => {
    const heading = String(match[1] || "").trim();
    const start = match.index ?? 0;
    const bodyStart = start + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? normalized.length) : normalized.length;
    const body = normalized.slice(bodyStart, end).trim();
    return { heading, body };
  });
}

function alignDraftToOutline(draft: DraftResult, outline: OutlineResult): DraftResult {
  if (!draft.draft_markdown.trim() || !outline.sections.length) {
    return draft;
  }

  const draftSections = splitMarkdownSections(draft.draft_markdown);
  const alignedMarkdown = outline.sections
    .map((section, index) => {
      const matched =
        draftSections.find((item) => item.heading === section.heading) ||
        draftSections[index] ||
        null;
      const body = matched?.body?.trim() || section.purpose;
      return `### ${section.heading}\n\n${body}`;
    })
    .join("\n\n");

  return {
    ...draft,
    draft_markdown: alignedMarkdown,
  };
}

const TASK_ANALYSIS_SCHEMA_HINT = `{
  "task_type": "string",
  "audience": "string",
  "scenario": "string",
  "goal": "string",
  "must_include": ["string"],
  "constraints": ["string"],
  "raw_facts": ["string"],
  "missing_info": ["string"],
  "risk_flags": ["string"],
  "confidence": 0.0
}`;

const DIAGNOSIS_SCHEMA_HINT = `{
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

const OUTLINE_SCHEMA_HINT = `{
  "outline_title": "string",
  "sections": [
    {
      "heading": "string",
      "purpose": "string",
      "key_points": ["string"],
      "source_basis": ["string"]
    }
  ],
  "tone_notes": ["string"],
  "coverage_check": ["string"]
}`;

const DRAFT_SCHEMA_HINT = `{
  "draft_markdown": "string",
  "self_review": {
    "strengths": ["string"],
    "risks": ["string"],
    "missing_points": ["string"],
    "rule_violations": ["string"]
  },
  "revision_suggestions": ["string"]
}`;

const FEEDBACK_SCHEMA_HINT = `{
  "feedback_type": "wording | structure | order | logic | missing_info | scenario_mismatch | factual_fix",
  "feedback_summary": "string",
  "is_reusable_rule": true,
  "candidate_rule": {
    "title": "string",
    "content": "string",
    "scope": "string",
    "doc_types": ["string"],
    "audiences": ["string"],
    "confidence": 0.0
  },
  "reasoning": "string",
  "suggested_update": "string"
}`;

export function parseTask(task: Task): TaskAnalysis {
  return {
    task_type: task.docType || "未识别文体",
    audience: task.audience || "未识别受众",
    scenario: task.scenario || "未识别场景",
    goal: task.title || "待补充写作目标",
    must_include: [],
    constraints: [],
    raw_facts: [],
    missing_info: ["待接入 LLM 解析任务原文和素材"],
    risk_flags: [],
    confidence: 0.35,
  };
}

export async function parseTaskWithLlm(
  client: OpenAiCompatibleClient,
  task: Task,
): Promise<TaskAnalysis> {
  return client.generateJson({
    system: BASE_SYSTEM_PROMPT,
    user: buildParseTaskPrompt(task),
    schema: taskAnalysisSchema,
    schemaHint: TASK_ANALYSIS_SCHEMA_HINT,
    maxTokens: 900,
    timeoutMs: 45_000,
  });
}

export function diagnoseTask(input: {
  task: Task;
  analysis: TaskAnalysis;
  matchedRules: MatchedRule[];
  matchedMaterials: Material[];
  evidenceCards?: EvidenceCard[];
  profiles: Profile[];
}): DiagnosisResult {
  return {
    readiness: "partial",
    diagnosis_summary: `任务《${input.task.title}》已完成基础匹配，待接入 LLM 生成正式诊断。`,
    recommended_structure: [
      {
        section: "背景与目标",
        purpose: "交代写作背景和本次目标",
        must_cover: ["任务背景", "写作目的"],
      },
      {
        section: "主体内容",
        purpose: "展开关键事实、问题或方案",
        must_cover: ["核心事实", "重点分析"],
      },
    ],
    missing_info: input.analysis.missing_info,
    applied_rules: input.matchedRules.map((rule) => rule.title),
    reference_materials: input.matchedMaterials.map((material) => material.title),
    writing_risks: ["待接入诊断 prompt，当前结果仅为骨架"],
    next_action: "补充 LLM 实现后生成正式写前诊断",
  };
}

export async function diagnoseTaskWithLlm(
  client: OpenAiCompatibleClient,
  input: {
    task: Task;
    analysis: TaskAnalysis;
    matchedRules: MatchedRule[];
    matchedMaterials: Material[];
    evidenceCards?: EvidenceCard[];
    profiles: Profile[];
    templateRewritePlan?: TemplateRewriteStep[];
  },
): Promise<DiagnosisResult> {
  return client.generateJson({
    system: BASE_SYSTEM_PROMPT,
    user: buildDiagnoseTaskPrompt({
      taskAnalysis: input.analysis,
      matchedRules: input.matchedRules,
      materialSummaries: input.matchedMaterials.map(summarizeMaterial),
      evidenceCards: input.evidenceCards ?? [],
      profiles: input.profiles,
      templateRewritePlan: input.templateRewritePlan ?? [],
    }),
    schema: diagnosisResultSchema,
    schemaHint: DIAGNOSIS_SCHEMA_HINT,
    maxTokens: 1200,
    timeoutMs: 75_000,
  });
}

export function buildOutline(input: {
  task: Task;
  analysis: TaskAnalysis;
  diagnosis: DiagnosisResult;
  matchedRules: MatchedRule[];
  matchedMaterials: Material[];
  evidenceCards?: EvidenceCard[];
  profiles?: Profile[];
  templateRewritePlan?: TemplateRewriteStep[];
}): OutlineResult {
  const baseOutline = {
    outline_title: input.task.title,
    sections:
      input.templateRewritePlan?.length
        ? input.templateRewritePlan.slice(0, 6).map((step) => ({
            heading: step.section,
            purpose: step.intent,
            key_points: [
              ...step.assigned_requirements.map((item) => `必须覆盖：${item}`),
              step.fill_strategy,
            ].slice(0, 5),
            source_basis: [
              `模板槽位:${step.section}`,
              ...(step.logic_after
                ? [`逻辑承接:${step.logic_after.from} -> ${step.logic_after.to}（${step.logic_after.reason}）`]
                : []),
              ...input.matchedRules.slice(0, 2).map((rule) => rule.title),
            ].slice(0, 5),
          }))
        : input.diagnosis.recommended_structure.map((section) => ({
            heading: section.section,
            purpose: section.purpose,
            key_points: section.must_cover,
            source_basis: [
              ...input.matchedRules.slice(0, 2).map((rule) => rule.title),
              ...input.matchedMaterials.slice(0, 1).map((material) => material.title),
            ],
          })),
    tone_notes: ["正式", "克制", "先结论后展开"],
    coverage_check: ["待接入 LLM 细化覆盖检查"],
  };
  return applyTemplateRewritePlanToOutline(baseOutline, input.templateRewritePlan ?? []);
}

export async function buildOutlineWithLlm(
  client: OpenAiCompatibleClient,
  input: {
    task: Task;
    analysis: TaskAnalysis;
    diagnosis: DiagnosisResult;
    matchedRules: MatchedRule[];
    matchedMaterials: Material[];
    evidenceCards?: EvidenceCard[];
    profiles: Profile[];
    templateRewritePlan?: TemplateRewriteStep[];
  },
): Promise<OutlineResult> {
  const outline = await client.generateJson({
    system: BASE_SYSTEM_PROMPT,
    user: buildOutlinePrompt({
      taskAnalysis: input.analysis,
      diagnosis: input.diagnosis,
      matchedRules: input.matchedRules,
      materialSummaries: input.matchedMaterials.map(summarizeMaterial),
      evidenceCards: input.evidenceCards ?? [],
      profiles: input.profiles,
      templateRewritePlan: input.templateRewritePlan ?? [],
    }),
    schema: outlineResultSchema,
    schemaHint: OUTLINE_SCHEMA_HINT,
    maxTokens: 1400,
    timeoutMs: 75_000,
  });
  return applyTemplateRewritePlanToOutline(outline, input.templateRewritePlan ?? []);
}

export function generateDraft(input: {
  task: Task;
  analysis?: TaskAnalysis;
  diagnosis?: DiagnosisResult;
  outline: OutlineResult;
  evidenceCards?: EvidenceCard[];
}): DraftResult {
  const paragraphs = input.outline.sections.map(
    (section, index) => {
      const evidenceId = input.evidenceCards?.[index]?.card_id;
      return `### ${section.heading}\n\n${section.purpose}。这里将根据后续接入的模型生成正式内容。${evidenceId ? ` [证据卡:${evidenceId}]` : ""}`;
    },
  );

  return alignDraftToOutline({
    draft_markdown: paragraphs.join("\n\n"),
    self_review: {
      strengths: ["已经按照提纲生成占位草稿"],
      risks: ["尚未接入模型，正文仍为占位内容"],
      missing_points: ["待结合任务事实生成完整内容"],
      rule_violations: [],
    },
    revision_suggestions: ["接入 LLM 后替换占位正文", "补充事实输入来源"],
  }, input.outline);
}

export async function generateDraftWithLlm(
  client: OpenAiCompatibleClient,
  input: {
    task: Task;
    analysis: TaskAnalysis;
    diagnosis: DiagnosisResult;
    outline: OutlineResult;
    matchedRules: MatchedRule[];
    matchedMaterials: Material[];
    evidenceCards?: EvidenceCard[];
    profiles: Profile[];
    templateRewritePlan?: TemplateRewriteStep[];
  },
): Promise<DraftResult> {
  const draft = await client.generateJson({
    system: BASE_SYSTEM_PROMPT,
    user: buildGenerateDraftPrompt({
      taskAnalysis: input.analysis,
      diagnosis: input.diagnosis,
      outline: input.outline,
      matchedRules: input.matchedRules,
      materialSummaries: input.matchedMaterials.map(summarizeMaterial),
      evidenceCards: input.evidenceCards ?? [],
      profiles: input.profiles,
      templateRewritePlan: input.templateRewritePlan ?? [],
    }),
    schema: draftResultSchema,
    schemaHint: DRAFT_SCHEMA_HINT,
    maxTokens: 1600,
    timeoutMs: 60_000,
  });
  return alignDraftToOutline(draft, input.outline);
}

export function learnFeedback(feedback: Feedback): FeedbackAnalysis {
  return {
    feedback_type: "logic",
    feedback_summary: feedback.content.slice(0, 120) || "待分析反馈",
    is_reusable_rule: false,
    candidate_rule: null,
    reasoning: "当前为占位实现，待接入反馈学习 prompt。",
    suggested_update: "补充 LLM 分析后生成候选规则。",
  };
}

export async function learnFeedbackWithLlm(
  client: OpenAiCompatibleClient,
  input: {
    feedback: Feedback;
    task: Task | null;
    taskAnalysis: TaskAnalysis | null;
  },
): Promise<FeedbackAnalysis> {
  return client.generateJson({
    system: BASE_SYSTEM_PROMPT,
    user: buildLearnFeedbackPrompt(input),
    schema: feedbackAnalysisSchema,
    schemaHint: FEEDBACK_SCHEMA_HINT,
    maxTokens: 1000,
    timeoutMs: 60_000,
  });
}
