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
import { normalizeStructureLabel, summarizeMaterial } from "../retrieve/summaries.js";
import {
  diagnosisResultSchema,
  draftResultSchema,
  feedbackAnalysisSchema,
  outlineResultSchema,
  taskAnalysisSchema,
} from "../types/schemas.js";

function buildOutlineRepairPrompt(input: {
  outline: OutlineResult;
  rewritePlan: TemplateRewriteStep[];
}) {
  return `请修补这份提纲，使其更严格符合模板改写计划。

修补要求：
1. 必须补齐缺失的模板段落
2. 每一段 key_points 要覆盖 assigned_requirements
3. 如果 rewritePlan 中给出了 logic_after，提纲中的段落顺序必须体现 from -> to
4. 不要新增无关段落
5. 保持 JSON schema 不变

当前提纲:
${JSON.stringify(input.outline, null, 2)}

模板改写计划:
${JSON.stringify(input.rewritePlan, null, 2)}
`;
}

function buildDraftRepairPrompt(input: {
  draft: DraftResult;
  outline: OutlineResult;
  rewritePlan: TemplateRewriteStep[];
}) {
  const highConfidenceFactViolations = (input.draft.constraint_checks?.fact_coverage ?? [])
    .filter((item, index) => {
      const confidence = input.rewritePlan[index]?.assignment_confidence ?? 0;
      return confidence >= 0.45 && item.unmatched.length > 0 && item.matched.length === 0;
    })
    .map((item) => `${item.section}：${item.unmatched.slice(0, 3).join("；")}`)
    .slice(0, 6);
  return `请修补这份正文，使其更严格符合提纲和模板改写计划。

修补要求：
1. 保留已有可用内容
2. 优先补齐 missing_points 和 rule_violations 里指出的缺口
3. 每段优先覆盖 assigned_requirements，并尽量落到 assigned_facts
4. 对“高置信但未明显使用已分配事实”的段落，优先修补事实落点，不要只调整语气或格式
5. 如果 rewritePlan 中给出了 logic_after，正文段落顺序必须体现 from -> to
6. assignment_confidence 偏低的段落要用保守表达，不要把猜测写成确定事实
7. 不要编造事实
8. 保持 JSON schema 不变

当前正文结果:
${JSON.stringify(input.draft, null, 2)}

提纲:
${JSON.stringify(input.outline, null, 2)}

模板改写计划:
${JSON.stringify(input.rewritePlan, null, 2)}

高置信事实缺口:
${JSON.stringify(highConfidenceFactViolations, null, 2)}
`;
}

function hasOutlineConstraintIssues(outline: OutlineResult): boolean {
  return Boolean(
    outline.constraint_checks &&
      (!outline.constraint_checks.section_order_ok ||
        outline.constraint_checks.requirement_gaps.length > 0 ||
        (outline.constraint_checks.logic_gaps?.length ?? 0) > 0),
  );
}

function hasDraftConstraintIssues(draft: DraftResult): boolean {
  const cc = draft.constraint_checks;
  if (!cc) {
    return false;
  }
  return Boolean(
    !cc.section_order_ok ||
      cc.requirement_gaps.length > 0 ||
      (cc.logic_gaps?.length ?? 0) > 0 ||
      cc.warnings.length > 0,
  );
}

function normalizeHeadingKey(text: string): string {
  return normalizeStructureLabel(text);
}

function resolveHeadingIndex(headings: string[], target: string): number | undefined {
  const normalizedTarget = normalizeHeadingKey(target);
  if (!normalizedTarget) {
    return undefined;
  }
  const exactIndex = headings.findIndex((heading) => normalizeHeadingKey(heading) === normalizedTarget);
  if (exactIndex >= 0) {
    return exactIndex;
  }
  const fuzzyIndex = headings.findIndex((heading) => {
    const normalizedHeading = normalizeHeadingKey(heading);
    return normalizedHeading.includes(normalizedTarget) || normalizedTarget.includes(normalizedHeading);
  });
  return fuzzyIndex >= 0 ? fuzzyIndex : undefined;
}

function collectLogicGapWarnings(headings: string[], rewritePlan: TemplateRewriteStep[]): string[] {
  return rewritePlan
    .flatMap((step) => {
      const logic = step.logic_after;
      if (!logic) {
        return [];
      }
      const fromIndex = resolveHeadingIndex(headings, logic.from);
      const toIndex = resolveHeadingIndex(headings, logic.to);
      if (fromIndex === undefined || toIndex === undefined) {
        return [`未能在当前结构中完整找到逻辑承接：${logic.from} -> ${logic.to}`];
      }
      if (toIndex <= fromIndex) {
        return [`当前结构未体现逻辑承接顺序：${logic.from} 应先于 ${logic.to}`];
      }
      return [];
    })
    .slice(0, 6);
}

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

function validateOutlineAgainstRewritePlan(
  outline: OutlineResult,
  rewritePlan: TemplateRewriteStep[],
): OutlineResult {
  if (!rewritePlan.length) {
    return outline;
  }

  const sectionOrderMissing = rewritePlan
    .filter((step) => !outline.sections.some((section) => section.heading === step.section))
    .map((step) => step.section);

  const requirementGaps = rewritePlan.map((step) => {
    const matchedSection = outline.sections.find((section) => section.heading === step.section);
    const keyPointsText = matchedSection ? matchedSection.key_points.join(" ") : "";
    const missing = (step.assigned_requirements || []).filter(
      (requirement) => !textContainsComparable(keyPointsText, requirement),
    );
    return {
      section: step.section,
      missing,
    };
  });
  const logicGaps = collectLogicGapWarnings(
    outline.sections.map((section) => section.heading),
    rewritePlan,
  );

  const warnings = [
    ...(sectionOrderMissing.length
      ? [`提纲还未覆盖这些模板段落：${sectionOrderMissing.join("、")}`]
      : []),
    ...requirementGaps
      .filter((item) => item.missing.length)
      .map((item) => `提纲段落「${item.section}」仍缺少：${item.missing.join("；")}`),
    ...logicGaps,
  ].slice(0, 6);

  return {
    ...outline,
    coverage_check: [...new Set([...(outline.coverage_check || []), ...warnings])].slice(0, 8),
    constraint_checks: {
      section_order_ok: sectionOrderMissing.length === 0,
      section_order_missing: sectionOrderMissing,
      requirement_gaps: requirementGaps.filter((item) => item.missing.length),
      logic_gaps: logicGaps,
      warnings,
    },
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

function normalizeComparableText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。；：、“”‘’"'`()（）【】\[\]\-—_]/g, "");
}

function textContainsComparable(text: string, fragment: string): boolean {
  const normalizedText = normalizeComparableText(text);
  const normalizedFragment = normalizeComparableText(fragment);
  if (!normalizedText || !normalizedFragment) {
    return false;
  }
  return normalizedText.includes(normalizedFragment) || normalizedFragment.includes(normalizedText);
}

function validateDraftAgainstRewritePlan(
  draft: DraftResult,
  outline: OutlineResult,
  rewritePlan: TemplateRewriteStep[],
): DraftResult {
  if (!rewritePlan.length) {
    return draft;
  }

  const sections = splitMarkdownSections(draft.draft_markdown);
  const sectionMap = new Map(sections.map((item) => [item.heading || "", item.body || ""] as const));
  const sectionOrderMissing = rewritePlan
    .filter((step) => !outline.sections.some((section) => section.heading === step.section))
    .map((step) => step.section);

  const requirementGaps = rewritePlan.map((step) => {
    const body = sectionMap.get(step.section) || "";
    const missing = (step.assigned_requirements || []).filter((requirement) => !textContainsComparable(body, requirement));
    return { section: step.section, missing };
  });

  const factCoverage = rewritePlan.map((step) => {
    const body = sectionMap.get(step.section) || "";
    const matched = (step.assigned_facts || []).filter((fact) => textContainsComparable(body, fact));
    const unmatched = (step.assigned_facts || []).filter((fact) => !textContainsComparable(body, fact));
    return { section: step.section, matched, unmatched };
  });
  const logicGaps = collectLogicGapWarnings(
    sections.map((section) => section.heading),
    rewritePlan,
  );

  const warnings = [
    ...requirementGaps
      .filter((item) => item.missing.length)
      .map((item) => `段落「${item.section}」仍缺少：${item.missing.join("；")}`),
    ...factCoverage
      .filter((item) => item.unmatched.length && item.matched.length === 0)
      .map((item) => `段落「${item.section}」还没有明显使用分配事实：${item.unmatched.slice(0, 2).join("；")}`),
    ...logicGaps,
  ].slice(0, 6);
  const factViolations = factCoverage
    .filter((item, index) => {
      const confidence = rewritePlan[index]?.assignment_confidence ?? 0;
      return confidence >= 0.45 && item.unmatched.length > 0 && item.matched.length === 0;
    })
    .map((item) => `高置信段落「${item.section}」尚未落到已分配事实，请优先修补。`);

  return {
    ...draft,
    self_review: {
      ...draft.self_review,
      missing_points: [...new Set([...(draft.self_review.missing_points || []), ...warnings])].slice(0, 6),
      rule_violations: [...new Set([
        ...(draft.self_review.rule_violations || []),
        ...(sectionOrderMissing.length ? [`提纲/正文未完整覆盖这些模板段落：${sectionOrderMissing.join("、")}`] : []),
        ...factViolations,
      ])].slice(0, 6),
    },
    constraint_checks: {
      section_order_ok: sectionOrderMissing.length === 0,
      section_order_missing: sectionOrderMissing,
      requirement_gaps: requirementGaps.filter((item) => item.missing.length),
      fact_coverage: factCoverage,
      logic_gaps: logicGaps,
      warnings,
    },
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
  "input_quality_assessment": {
    "template_quality": "strong | partial | weak",
    "history_material_quality": "strong | partial | weak",
    "fact_coverage_quality": "strong | partial | weak",
    "warnings": ["string"]
  },
  "fact_section_mapping": [
    {
      "fact": "string",
      "recommended_section": "string",
      "recommended_requirements": ["string"],
      "reason": "string",
      "confidence": 0.0
    }
  ],
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
    confidence: 0.1,
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
  templateRewritePlan?: TemplateRewriteStep[];
}): DiagnosisResult {
  const weakTaskAnalysis =
    input.analysis.confidence < 0.2 ||
    (!input.analysis.raw_facts.length && !input.analysis.must_include.length);
  const recommendedStructure =
    input.templateRewritePlan?.length
      ? input.templateRewritePlan.slice(0, 6).map((step) => ({
          section: step.section,
          purpose: step.intent,
          must_cover: step.assigned_requirements.length
            ? step.assigned_requirements.slice(0, 4)
            : [step.fill_strategy].filter(Boolean),
        }))
      : [
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
        ];
  return {
    readiness: weakTaskAnalysis ? "blocked" : "partial",
    diagnosis_summary: `任务《${input.task.title}》已完成基础匹配，待接入 LLM 生成正式诊断。`,
    recommended_structure: recommendedStructure,
    missing_info: weakTaskAnalysis
      ? [...input.analysis.missing_info, "任务解析结果过弱，后续阶段会缺少足够事实支撑。"]
      : input.analysis.missing_info,
    applied_rules: input.matchedRules.map((rule) => rule.title),
    reference_materials: input.matchedMaterials.map((material) => material.title),
    writing_risks: weakTaskAnalysis
      ? ["任务解析结果过弱：raw_facts / must_include 基本为空，建议先补背景材料或重试任务解析。"]
      : [
          input.templateRewritePlan?.length
            ? "已按模板改写计划生成诊断骨架；若要更细的段落裁决，仍建议走 LLM 诊断。"
            : "待接入诊断 prompt，当前结果仅为骨架",
        ],
    input_quality_assessment: {
      template_quality: input.templateRewritePlan?.length ? "partial" : "weak",
      history_material_quality: input.matchedMaterials.length > 1 ? "partial" : "weak",
      fact_coverage_quality: weakTaskAnalysis ? "weak" : "partial",
      warnings: weakTaskAnalysis
        ? ["任务解析结果过弱，背景事实不足。"]
        : [
            input.templateRewritePlan?.length
              ? "已按模板改写计划生成诊断骨架，但仍建议使用 LLM 做事实-章节匹配。"
              : "当前模板结构较弱，诊断主要依赖任务事实和规则。",
          ],
    },
    fact_section_mapping: (input.templateRewritePlan ?? [])
      .flatMap((step) =>
        (step.assigned_facts ?? []).slice(0, 3).map((fact) => ({
          fact,
          recommended_section: step.section,
          recommended_requirements: (step.assigned_requirements ?? []).slice(0, 3),
          reason: `本地兜底按段落意图「${step.intent}」做了初步分配。`,
          confidence: typeof step.assignment_confidence === "number" ? step.assignment_confidence : 0.3,
        })),
      )
      .slice(0, 8),
    next_action: weakTaskAnalysis ? "先补充背景事实并重新解析任务，再继续写作。" : "补充 LLM 实现后生成正式写前诊断",
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
    templateQualityAssessment?: {
      mode: "structured" | "derived-sections" | "generic-outline";
      warnings: string[];
    };
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
      templateQualityAssessment: input.templateQualityAssessment,
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
  return validateOutlineAgainstRewritePlan(
    applyTemplateRewritePlanToOutline(baseOutline, input.templateRewritePlan ?? []),
    input.templateRewritePlan ?? [],
  );
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
    templateQualityAssessment?: {
      mode: "structured" | "derived-sections" | "generic-outline";
      warnings: string[];
    };
    factSectionHints?: DiagnosisResult["fact_section_mapping"];
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
      templateQualityAssessment: input.templateQualityAssessment,
      factSectionHints: input.factSectionHints,
    }),
    schema: outlineResultSchema,
    schemaHint: OUTLINE_SCHEMA_HINT,
    maxTokens: 1400,
    timeoutMs: 75_000,
  });
  let validated = validateOutlineAgainstRewritePlan(
    applyTemplateRewritePlanToOutline(outline, input.templateRewritePlan ?? []),
    input.templateRewritePlan ?? [],
  );
  if (hasOutlineConstraintIssues(validated) && (input.templateRewritePlan ?? []).length) {
    const beforeWarnings = validated.constraint_checks?.warnings ?? [];
    const repaired = await client.generateJson({
      system: BASE_SYSTEM_PROMPT,
      user: buildOutlineRepairPrompt({
        outline: validated,
        rewritePlan: input.templateRewritePlan ?? [],
      }),
      schema: outlineResultSchema,
      schemaHint: OUTLINE_SCHEMA_HINT,
      maxTokens: 1500,
      timeoutMs: 60_000,
    });
    validated = validateOutlineAgainstRewritePlan(
      applyTemplateRewritePlanToOutline(repaired, input.templateRewritePlan ?? []),
      input.templateRewritePlan ?? [],
    );
    validated = {
      ...validated,
      repair_trace: [
        ...((validated.repair_trace ?? []).slice(0, 8)),
        {
          stage: "outline",
          applied: true,
          reason: "程序化校验发现提纲存在模板段落或 requirement 缺口，已触发一轮定向修补。",
          before_warnings: beforeWarnings.slice(0, 6),
          after_warnings: (validated.constraint_checks?.warnings ?? []).slice(0, 6),
        },
      ],
    };
  }
  return validated;
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

  const draft = alignDraftToOutline({
    draft_markdown: paragraphs.join("\n\n"),
    self_review: {
      strengths: ["已经按照提纲生成占位草稿"],
      risks: ["尚未接入模型，正文仍为占位内容"],
      missing_points: ["待结合任务事实生成完整内容"],
      rule_violations: [],
    },
    revision_suggestions: ["接入 LLM 后替换占位正文", "补充事实输入来源"],
  }, input.outline);
  return validateDraftAgainstRewritePlan(draft, input.outline, []);
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
    templateQualityAssessment?: {
      mode: "structured" | "derived-sections" | "generic-outline";
      warnings: string[];
    };
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
      templateQualityAssessment: input.templateQualityAssessment,
    }),
    schema: draftResultSchema,
    schemaHint: DRAFT_SCHEMA_HINT,
    maxTokens: 1600,
    timeoutMs: 60_000,
  });
  let validated = validateDraftAgainstRewritePlan(
    alignDraftToOutline(draft, input.outline),
    input.outline,
    input.templateRewritePlan ?? [],
  );
  if (hasDraftConstraintIssues(validated) && (input.templateRewritePlan ?? []).length) {
    const beforeWarnings = validated.constraint_checks?.warnings ?? [];
    const repaired = await client.generateJson({
      system: BASE_SYSTEM_PROMPT,
      user: buildDraftRepairPrompt({
        draft: validated,
        outline: input.outline,
        rewritePlan: input.templateRewritePlan ?? [],
      }),
      schema: draftResultSchema,
      schemaHint: DRAFT_SCHEMA_HINT,
      maxTokens: 1800,
      timeoutMs: 60_000,
    });
    validated = validateDraftAgainstRewritePlan(
      alignDraftToOutline(repaired, input.outline),
      input.outline,
      input.templateRewritePlan ?? [],
    );
    validated = {
      ...validated,
      repair_trace: [
        ...((validated.repair_trace ?? []).slice(0, 8)),
        {
          stage: "draft",
          applied: true,
          reason: "程序化校验发现正文仍有段落缺口，已触发一轮定向修补。",
          before_warnings: beforeWarnings.slice(0, 6),
          after_warnings: (validated.constraint_checks?.warnings ?? []).slice(0, 6),
        },
      ],
    };
  }
  return validated;
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
