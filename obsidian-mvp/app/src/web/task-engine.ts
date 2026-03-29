import { resolve } from "node:path";

import { OPENAI_CODEX_BASE_URL, OPENAI_CODEX_MODEL } from "../config/constants.js";
import {
  getLlmConfig,
  getStoredLlmSettings,
  listStoredLlmProfiles,
  type StoredLlmSettings,
} from "../config/env.js";
import { OpenAiCompatibleClient } from "../llm/openai-compatible.js";
import { matchMaterials, matchRulesWithPolicy } from "../retrieve/matchers.js";
import { buildEvidenceCards, buildTemplateRewriteHint, normalizeStructureLabel } from "../retrieve/summaries.js";
import { VaultRepository } from "../vault/repository.js";
import {
  buildOutline,
  buildOutlineWithLlm,
  diagnoseTask,
  diagnoseTaskWithLlm,
  generateDraft,
  generateDraftWithLlm,
  parseTask,
  parseTaskWithLlm,
} from "../workflows/stubs.js";
import {
  appendWorkflowEvent,
  createWorkflowRun,
  loadWorkflowRun,
  transitionWorkflowRun,
  type WorkflowRun,
} from "../workflows/orchestration.js";
import { loadWorkflowDefinition } from "../workflows/definition.js";
import { refreshDefaultProfile } from "../writers/profile-writer.js";
import { createTask } from "../writers/task-create-writer.js";
import { writeTaskSections } from "../writers/task-writer.js";
import { appendObservabilityEvent } from "./observability.js";
import { isTemplateMaterial } from "./materials.js";

export type TaskCreateRequest = {
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

export type WorkflowAdvanceAction = "regenerate" | "finalize";

export function normalizeTemplateMode(value: unknown): "strict" | "hybrid" | "light" {
  if (value === "strict" || value === "hybrid" || value === "light") {
    return value;
  }
  return "hybrid";
}

export function parseTemplateOverrideMap(raw: string): Record<string, string> {
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

export function toTaskCreateRequest(body: Record<string, unknown>): TaskCreateRequest {
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

function createLlmClient(vaultRoot: string): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient(getLlmConfig(vaultRoot));
}

export function createAllAvailableLlmClients(vaultRoot: string): OpenAiCompatibleClient[] {
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

type RouteMeta = {
  stage: string;
  usedModel: string;
  triedModels: string[];
  errors: string[];
  durationMs: number;
  success: boolean;
};

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
  const triedProfileIds = [preferredProfileId, ...(routing.enabled ? routing.fallbackProfileIds : [])]
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

async function buildTaskSnapshot(vaultRoot: string, taskPath: string) {
  const repo = new VaultRepository(vaultRoot);
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

export async function runTaskAction(input: {
  vaultRoot: string;
  taskPath: string;
  action: "diagnose" | "outline" | "draft";
}) {
  const { task, profiles, analysis, matchedRules, matchedMaterials, templateRewriteHint, evidenceCards, ruleDecisionLog } =
    await buildTaskSnapshot(input.vaultRoot, input.taskPath);

  const diagnosisInput = {
    task,
    analysis,
    matchedRules,
    matchedMaterials,
    evidenceCards,
    profiles,
    templateRewritePlan: templateRewriteHint?.rewrite_steps ?? [],
    templateQualityAssessment: {
      mode: templateRewriteHint?.fallback_mode ?? "structured",
      warnings: templateRewriteHint?.warnings ?? [],
    },
  };

  const routeMetas: RouteMeta[] = [];
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
  const refinedTemplateRewriteHint = !templateRewriteHint
    ? null
    : {
        ...templateRewriteHint,
        warnings: [
          ...(templateRewriteHint.warnings ?? []),
          ...((diagnosis.input_quality_assessment?.warnings ?? []).map((item) => `诊断提醒：${item}`)),
        ].slice(0, 10),
        rewrite_steps: (templateRewriteHint.rewrite_steps ?? []).map((step) => {
          const matchedMappings = (diagnosis.fact_section_mapping ?? [])
            .filter((item) => {
              const left = normalizeStructureLabel(item.recommended_section);
              const right = normalizeStructureLabel(step.section);
              return left === right || left.includes(right) || right.includes(left);
            })
            .sort((left, right) => right.confidence - left.confidence);
          return {
            ...step,
            assigned_facts: [...new Set([...matchedMappings.map((item) => item.fact), ...step.assigned_facts])].slice(0, 5),
            assignment_confidence:
              typeof matchedMappings[0]?.confidence === "number"
                ? Math.max(step.assignment_confidence ?? 0, matchedMappings[0].confidence)
                : step.assignment_confidence,
          };
        }),
      };
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
      templateRewriteHint: refinedTemplateRewriteHint,
    });
    return {
      analysis,
      diagnosis,
      evidenceCards,
      modelRouting: routeMetas,
      ruleDecisionLog: withRoutingDecisionLog,
      matchedRules,
      matchedMaterials,
      templateRewriteHint: refinedTemplateRewriteHint,
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
    templateRewritePlan: refinedTemplateRewriteHint?.rewrite_steps ?? [],
    templateQualityAssessment: {
      mode: refinedTemplateRewriteHint?.fallback_mode ?? "structured",
      warnings: refinedTemplateRewriteHint?.warnings ?? [],
    },
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
      templateRewriteHint: refinedTemplateRewriteHint,
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
      templateRewriteHint: refinedTemplateRewriteHint,
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
        templateRewritePlan: refinedTemplateRewriteHint?.rewrite_steps ?? [],
        templateQualityAssessment: {
          mode: refinedTemplateRewriteHint?.fallback_mode ?? "structured",
          warnings: refinedTemplateRewriteHint?.warnings ?? [],
        },
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
    templateRewriteHint: refinedTemplateRewriteHint,
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
    templateRewriteHint: refinedTemplateRewriteHint,
  };
}

export async function createTaskFromRequest(input: {
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

export async function startWorkflowRunForTask(input: {
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

export async function advanceWorkflowRunForAction(input: {
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
