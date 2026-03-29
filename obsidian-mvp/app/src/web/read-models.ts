import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import {
  OPENAI_CODEX_PROVIDER,
  OPENAI_CODEX_PROVIDER_LABEL,
  OPENAI_KEY_PROVIDER,
  OPENAI_KEY_PROVIDER_LABEL,
} from "../config/constants.js";
import {
  getLlmConfig,
  getStoredLlmSettings,
  listStoredLlmProfiles,
  validateStoredLlmProfile,
} from "../config/env.js";
import { summarizeMaterial } from "../retrieve/summaries.js";
import { VaultRepository } from "../vault/repository.js";
import { loadWorkflowDefinition } from "../workflows/definition.js";
import { listWorkflowRuns } from "../workflows/orchestration.js";
import { sendJson } from "./http.js";
import { classifyMaterialRole, isTemplateMaterial } from "./materials.js";

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

export async function buildDashboard(input: {
  vaultRoot: string;
  detectRuleConflictHints: (rules: Array<{
    id: string;
    title: string;
    status: "candidate" | "confirmed" | "disabled";
    scope: string;
    docTypes: string[];
    audiences: string[];
    content: string;
  }>) => Map<string, string[]>;
  listRuleVersions: (vaultRoot: string, ruleId: string) => Promise<Array<{ createdAt: string }>>;
  readRecentObservabilityEvents: (vaultRoot: string, limit: number) => Promise<unknown[]>;
}) {
  const repo = new VaultRepository(input.vaultRoot);
  const [materials, tasks, rules, feedbackEntries, profiles, workflowRuns, workflowDefinition, observabilityEvents] =
    await Promise.all([
      repo.loadMaterials(),
      repo.loadTasks(),
      repo.loadRules(),
      repo.loadFeedbackEntries(),
      repo.loadProfiles(),
      listWorkflowRuns(input.vaultRoot),
      loadWorkflowDefinition(input.vaultRoot),
      input.readRecentObservabilityEvents(input.vaultRoot, 80),
    ]);

  const llmConfig = getLlmConfig(input.vaultRoot);
  const stored = getStoredLlmSettings(input.vaultRoot);
  const llmProfiles = listStoredLlmProfiles(input.vaultRoot);
  const activeValidation = stored ? validateStoredLlmProfile(stored) : { ok: true, errors: [], warnings: [] };
  const provider = stored?.provider === OPENAI_KEY_PROVIDER ? OPENAI_KEY_PROVIDER : OPENAI_CODEX_PROVIDER;
  const providerLabel = provider === OPENAI_KEY_PROVIDER ? OPENAI_KEY_PROVIDER_LABEL : OPENAI_CODEX_PROVIDER_LABEL;

  const materialItems = materials
    .map((item) => {
      const summary = summarizeMaterial(item);
      const candidateRuleCount = (item.content.match(/候选规则\s*\d+：/g) || []).length;
      const structureBlockCount = (item.content.match(/^##\s+/gm) || []).length;
      const source = typeof item.frontmatter.source === "string" ? item.frontmatter.source : "";
      const template = isTemplateMaterial({
        tags: item.tags,
        source,
        docType: item.docType,
      });
      const role = classifyMaterialRole({
        isTemplate: template,
        source,
        quality: item.quality,
        docType: item.docType,
        scenario: item.scenario,
      });
      const recommendTemplatePromotion =
        !template &&
        String(item.quality || "") === "high" &&
        candidateRuleCount >= 2 &&
        structureBlockCount >= 3;
      const folderRelative = relative(join(input.vaultRoot, "materials"), dirname(item.path));
      return {
        id: item.id,
        title: item.title,
        docType: item.docType,
        audience: item.audience,
        scenario: item.scenario,
        quality: item.quality,
        source,
        tags: item.tags,
        isTemplate: template,
        roleLabel: role.roleLabel,
        roleReason: role.roleReason,
        structureSummary: summary.structure_summary,
        styleSummary: summary.style_summary,
        usefulPhrases: summary.useful_phrases,
        candidateRuleCount,
        structureBlockCount,
        recommendTemplatePromotion,
        folderPath: folderRelative && folderRelative !== "." ? folderRelative : "",
        folderLabel: folderRelative && folderRelative !== "." ? folderRelative : "根目录",
        path: item.path,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  const materialTitleById = new Map(materialItems.map((item) => [item.id, item.title]));
  const taskTitleById = new Map(tasks.map((item) => [item.id, item.title]));
  const ruleConflictHints = input.detectRuleConflictHints(
    rules.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      scope: item.scope,
      docTypes: item.docTypes,
      audiences: item.audiences,
      content: item.content,
    })),
  );

  const ruleItems = await Promise.all(
    rules.map(async (item) => {
      const versions = await input.listRuleVersions(input.vaultRoot, item.id);
      const linkedTasks = tasks.filter((task) => Array.isArray(task.matchedRules) && task.matchedRules.includes(item.id));
      const linkedFeedbacks = feedbackEntries.filter((feedback) =>
        Array.isArray(feedback.relatedRuleIds) && feedback.relatedRuleIds.includes(item.id),
      );
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
        linkedTaskCount: linkedTasks.length,
        linkedTaskTitles: linkedTasks.slice(0, 3).map((task) => task.title),
        linkedFeedbackCount: linkedFeedbacks.length,
        linkedFeedbackIds: linkedFeedbacks.slice(0, 3).map((feedback) => feedback.id),
        usageCount: item.usageCount,
        positiveFeedbackCount: item.positiveFeedbackCount,
        negativeFeedbackCount: item.negativeFeedbackCount,
        lastFeedbackAt: item.lastFeedbackAt,
        conflictHints: ruleConflictHints.get(item.id) || [],
        path: item.path,
      };
    }),
  );
  const ruleTitleById = new Map(ruleItems.map((item) => [item.id, item.title]));

  return {
    vaultRoot: input.vaultRoot,
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
      fastProfileId: stored?.fastProfileId || "",
      strongProfileId: stored?.strongProfileId || "",
      fallbackProfileIds: Array.isArray(stored?.fallbackProfileIds) ? stored.fallbackProfileIds : [],
      fastModel: stored?.fastModel || llmConfig.model,
      strongModel: stored?.strongModel || llmConfig.model,
      fallbackModels: Array.isArray(stored?.fallbackModels) ? stored.fallbackModels : [],
      calibration: stored?.calibration ?? null,
      cards: llmProfiles.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        provider: profile.provider,
        providerLabel: profile.provider === OPENAI_KEY_PROVIDER ? OPENAI_KEY_PROVIDER_LABEL : OPENAI_CODEX_PROVIDER_LABEL,
        model: profile.model,
        apiType: profile.apiType || "openai-completions",
        baseUrl: profile.baseUrl,
        authUrl: profile.authUrl,
        routingEnabled: Boolean(profile.routingEnabled),
        fastProfileId: profile.fastProfileId || "",
        strongProfileId: profile.strongProfileId || "",
        fallbackProfileIds: Array.isArray(profile.fallbackProfileIds) ? profile.fallbackProfileIds : [],
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
    materials: materialItems.filter((item) => !item.isTemplate),
    templates: materialItems.filter((item) => item.isTemplate),
    templateCandidates: materialItems.filter((item) => item.isTemplate || item.recommendTemplatePromotion || item.quality === "high"),
    tasks: tasks.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      docType: item.docType,
      audience: item.audience,
      scenario: item.scenario,
      matchedRules: item.matchedRules,
      path: item.path,
    })).sort((a, b) => a.title.localeCompare(b.title, "zh-CN")),
    rules: ruleItems.sort((a, b) => a.title.localeCompare(b.title, "zh-CN")),
    feedback: feedbackEntries.map((item) => ({
      id: item.id,
      taskId: item.taskId,
      taskTitle: taskTitleById.get(item.taskId) || item.taskId,
      feedbackType: item.feedbackType,
      relatedRuleIds: item.relatedRuleIds,
      relatedRuleTitles: item.relatedRuleIds.map((ruleId) => ruleTitleById.get(ruleId) || ruleId).filter(Boolean),
      relatedRules: item.relatedRuleIds
        .map((ruleId) => {
          const hit = ruleItems.find((rule) => rule.id === ruleId);
          if (!hit) {
            return null;
          }
          return { id: hit.id, title: hit.title, status: hit.status, path: hit.path };
        })
        .filter(Boolean),
      reusableSuggestion:
        typeof item.frontmatter.is_reusable_rule === "boolean"
          ? item.frontmatter.is_reusable_rule
          : typeof item.frontmatter.reusable_suggestion === "boolean"
            ? item.frontmatter.reusable_suggestion
            : null,
      candidateRuleTitle: typeof item.frontmatter.candidate_rule_title === "string" ? item.frontmatter.candidate_rule_title : "",
      candidateRuleScope: typeof item.frontmatter.candidate_rule_scope === "string" ? item.frontmatter.candidate_rule_scope : "",
      affectedParagraph: typeof item.frontmatter.affected_paragraph === "string" ? item.frontmatter.affected_paragraph : "",
      createdAt: item.createdAt,
      path: item.path,
    })).sort((a, b) => a.id.localeCompare(b.id, "zh-CN")),
    profiles: profiles.map((item) => ({
      id: item.id,
      name: item.name,
      version: item.version,
      generatedBy: typeof item.frontmatter.generated_by === "string" ? item.frontmatter.generated_by : "unknown",
      updatedAt: typeof item.frontmatter.updated_at === "string" ? item.frontmatter.updated_at : "",
      sourceStats: item.frontmatter.source_stats && typeof item.frontmatter.source_stats === "object" ? item.frontmatter.source_stats : null,
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

export async function readDocumentByPath(path: string) {
  const raw = await readFile(path, "utf8");
  return { path, raw };
}

export async function handleDashboardRoute(input: {
  vaultRoot: string;
  res: Parameters<typeof sendJson>[0];
  detectRuleConflictHints: Parameters<typeof buildDashboard>[0]["detectRuleConflictHints"];
  listRuleVersions: Parameters<typeof buildDashboard>[0]["listRuleVersions"];
  readRecentObservabilityEvents: Parameters<typeof buildDashboard>[0]["readRecentObservabilityEvents"];
}) {
  sendJson(input.res, 200, await buildDashboard(input));
  return true;
}

export async function handleDocumentRoute(input: {
  targetPath: string | null;
  res: Parameters<typeof sendJson>[0];
}) {
  if (!input.targetPath) {
    sendJson(input.res, 400, { error: "Missing path parameter." });
    return true;
  }
  sendJson(input.res, 200, await readDocumentByPath(input.targetPath));
  return true;
}

export async function handleRefreshTasksRoute(input: {
  vaultRoot: string;
  res: Parameters<typeof sendJson>[0];
  matchRulesWithPolicy: typeof import("../retrieve/matchers.js").matchRulesWithPolicy;
  matchMaterials: typeof import("../retrieve/matchers.js").matchMaterials;
  refreshTaskReferences: typeof import("../writers/task-refresh-writer.js").refreshTaskReferences;
}) {
  const repo = new VaultRepository(input.vaultRoot);
  const [tasks, materials, rules, profiles, feedbackEntries] = await Promise.all([
    repo.loadTasks(),
    repo.loadMaterials(),
    repo.loadRules(),
    repo.loadProfiles(),
    repo.loadFeedbackEntries(),
  ]);

  const results = [];
  for (const task of tasks) {
    const ruleMatch = input.matchRulesWithPolicy({
      task,
      rules,
      materials,
      profiles,
      feedbackEntries,
    });
    const matchedRules = ruleMatch.matchedRules;
    const matchedMaterials = input.matchMaterials(task, materials);
    await input.refreshTaskReferences({
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

  sendJson(input.res, 200, results);
  return true;
}

export async function handleRefreshProfileRoute(input: {
  vaultRoot: string;
  res: Parameters<typeof sendJson>[0];
  createLlmClient: (vaultRoot: string) => import("../llm/openai-compatible.js").OpenAiCompatibleClient | import("../llm/openai-compatible.js").OpenAiCompatibleClient[] | undefined;
  refreshDefaultProfile: typeof import("../writers/profile-writer.js").refreshDefaultProfile;
}) {
  const repo = new VaultRepository(input.vaultRoot);
  const client = input.createLlmClient(input.vaultRoot);
  const [profiles, rules, materials, feedbackEntries] = await Promise.all([
    repo.loadProfiles(),
    repo.loadRules(),
    repo.loadMaterials(),
    repo.loadFeedbackEntries(),
  ]);
  const profilePath = await input.refreshDefaultProfile({
    vaultRoot: input.vaultRoot,
    profiles,
    rules,
    materials,
    feedbackEntries,
    client,
  });
  sendJson(input.res, 200, {
    profilePath,
    confirmedRules: rules.filter((rule) => rule.status === "confirmed").length,
  });
  return true;
}
