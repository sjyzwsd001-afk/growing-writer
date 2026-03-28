import { resolve } from "node:path";

import type { OpenAiCompatibleClient } from "../llm/openai-compatible.js";
import type { Feedback, Rule, Task } from "../types/domain.js";
import type { FeedbackAnalysis, TaskAnalysis } from "../types/schemas.js";
import { VaultRepository } from "../vault/repository.js";
import { sendJson } from "./http.js";

export async function handleLearnFeedbackRoute(input: {
  vaultRoot: string;
  body: Record<string, string | undefined>;
  res: Parameters<typeof sendJson>[0];
  createLlmClient: (vaultRoot: string) => OpenAiCompatibleClient;
  parseTaskWithLlm: (client: OpenAiCompatibleClient, task: Task) => Promise<TaskAnalysis>;
  parseTask: (task: Task) => TaskAnalysis;
  learnFeedbackWithLlm: (
    client: OpenAiCompatibleClient,
    input: { feedback: Feedback; task: Task | null; taskAnalysis: TaskAnalysis | null },
  ) => Promise<FeedbackAnalysis>;
  learnFeedback: (feedback: Feedback) => FeedbackAnalysis;
  writeCandidateRule: (input: { vaultRoot: string; feedback: Feedback; analysis: FeedbackAnalysis }) => Promise<{ path: string; ruleId: string } | null>;
  writeFeedbackResult: (input: { feedback: Feedback; analysis: FeedbackAnalysis; ruleId: string | null }) => Promise<unknown>;
  attachRuleToTask: (input: { task: Task; ruleId: string | null; feedbackId: string }) => Promise<unknown>;
}) {
  if (!input.body.path) {
    sendJson(input.res, 400, { error: "Missing feedback path." });
    return true;
  }

  const repo = new VaultRepository(input.vaultRoot);
  const client = input.createLlmClient(input.vaultRoot);
  const feedback = await repo.loadFeedback(resolve(input.body.path));
  const task = await repo.findTaskById(feedback.taskId);
  const taskAnalysis = task
    ? client.isEnabled()
      ? await input.parseTaskWithLlm(client, task)
      : input.parseTask(task)
    : null;
  const analysis = client.isEnabled()
    ? await input.learnFeedbackWithLlm(client, { feedback, task, taskAnalysis })
    : input.learnFeedback(feedback);
  const candidateRule = await input.writeCandidateRule({
    vaultRoot: input.vaultRoot,
    feedback,
    analysis,
  });
  await input.writeFeedbackResult({
    feedback,
    analysis,
    ruleId: candidateRule?.ruleId ?? null,
  });
  if (task) {
    await input.attachRuleToTask({
      task,
      ruleId: candidateRule?.ruleId ?? null,
      feedbackId: feedback.id,
    });
  }

  sendJson(input.res, 200, {
    analysis,
    candidateRulePath: candidateRule?.path ?? null,
    candidateRuleId: candidateRule?.ruleId ?? null,
  });
  return true;
}

export async function handleCreateFeedbackRoute(input: {
  vaultRoot: string;
  body: Record<string, unknown>;
  res: Parameters<typeof sendJson>[0];
  createFeedback: (input: {
    vaultRoot: string;
    taskId?: string;
    feedbackType?: string;
    severity?: string;
    action?: string;
    rawFeedback: string;
    affectedParagraph?: string;
    affectedSection?: string;
    affectsStructure?: string;
    selectedText?: string;
    selectionStart?: number;
    selectionEnd?: number;
    annotations?: Array<{
      location?: string;
      reason?: string;
      comment?: string;
      isReusable?: boolean;
      priority?: string;
      selectedText?: string;
      selectionStart?: number;
      selectionEnd?: number;
    }>;
  }) => Promise<unknown>;
}) {
  if (typeof input.body.rawFeedback !== "string" || !input.body.rawFeedback.trim()) {
    sendJson(input.res, 400, { error: "rawFeedback 是必填项。" });
    return true;
  }

  const result = await input.createFeedback({
    vaultRoot: input.vaultRoot,
    taskId: typeof input.body.taskId === "string" ? input.body.taskId : "",
    feedbackType: typeof input.body.feedbackType === "string" ? input.body.feedbackType : "",
    severity: typeof input.body.severity === "string" ? input.body.severity : "medium",
    action: typeof input.body.action === "string" ? input.body.action : "review",
    rawFeedback: input.body.rawFeedback,
    affectedParagraph: typeof input.body.affectedParagraph === "string" ? input.body.affectedParagraph : "",
    affectedSection: typeof input.body.affectedSection === "string" ? input.body.affectedSection : "",
    affectsStructure: typeof input.body.affectsStructure === "string" ? input.body.affectsStructure : "",
    selectedText: typeof input.body.selectedText === "string" ? input.body.selectedText : "",
    selectionStart:
      typeof input.body.selectionStart === "number"
        ? input.body.selectionStart
        : Number.isFinite(Number(input.body.selectionStart))
          ? Number(input.body.selectionStart)
          : undefined,
    selectionEnd:
      typeof input.body.selectionEnd === "number"
        ? input.body.selectionEnd
        : Number.isFinite(Number(input.body.selectionEnd))
          ? Number(input.body.selectionEnd)
          : undefined,
    annotations: Array.isArray(input.body.annotations)
      ? input.body.annotations.map((item) => ({
          location: typeof item?.location === "string" ? item.location : "",
          reason: typeof item?.reason === "string" ? item.reason : "",
          comment: typeof item?.comment === "string" ? item.comment : "",
          isReusable: Boolean(item?.isReusable),
          priority: typeof item?.priority === "string" && item.priority.trim() ? item.priority.trim() : "medium",
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

  sendJson(input.res, 200, result);
  return true;
}

export async function handleEvaluateFeedbackRoute(input: {
  body: Record<string, unknown>;
  res: Parameters<typeof sendJson>[0];
  evaluateFeedbackAbsorption: (input: {
    beforeDraft: string;
    afterDraft: string;
    reason: string;
    comment: string;
    selectedText: string;
  }) => {
    score: number;
    level: string;
    absorbed: boolean;
    notes: string[];
    changedRatio: number;
    keywordHitRatio: number;
  };
  persistFeedbackEvaluation: (input: {
    feedbackPath: string;
    evaluation: {
      score: number;
      level: string;
      absorbed: boolean;
      notes: string[];
      changedRatio: number;
      keywordHitRatio: number;
    };
  }) => Promise<unknown>;
}) {
  const beforeDraft = typeof input.body.beforeDraft === "string" ? input.body.beforeDraft : "";
  const afterDraft = typeof input.body.afterDraft === "string" ? input.body.afterDraft : "";
  if (!afterDraft.trim()) {
    sendJson(input.res, 400, { error: "afterDraft 是必填项。" });
    return true;
  }

  const evaluation = input.evaluateFeedbackAbsorption({
    beforeDraft,
    afterDraft,
    reason: typeof input.body.reason === "string" ? input.body.reason : "",
    comment: typeof input.body.comment === "string" ? input.body.comment : "",
    selectedText: typeof input.body.selectedText === "string" ? input.body.selectedText : "",
  });

  if (typeof input.body.feedbackPath === "string" && input.body.feedbackPath.trim()) {
    await input.persistFeedbackEvaluation({
      feedbackPath: resolve(input.body.feedbackPath),
      evaluation,
    });
  }

  sendJson(input.res, 200, { evaluation });
  return true;
}

export async function handleRuleActionRoute(input: {
  vaultRoot: string;
  body: Record<string, string | undefined>;
  res: Parameters<typeof sendJson>[0];
  applyRuleAction: (input: {
    action: "confirm" | "disable" | "reject";
    vaultRoot: string;
    rulePath: string;
    reason?: string;
  }) => Promise<{
    rule: Pick<Rule, "id" | "status">;
    profilePath: string;
    updatedTasks: unknown;
    snapshot: unknown;
  }>;
}) {
  if (!input.body.path || !input.body.action) {
    sendJson(input.res, 400, { error: "Missing rule path or action." });
    return true;
  }

  const result = await input.applyRuleAction({
    action: input.body.action as "confirm" | "disable" | "reject",
    vaultRoot: input.vaultRoot,
    rulePath: resolve(input.body.path),
    reason: input.body.reason,
  });
  sendJson(input.res, 200, {
    ruleId: result.rule.id,
    status: result.rule.status,
    profilePath: result.profilePath,
    updatedTasks: result.updatedTasks,
    snapshot: result.snapshot,
  });
  return true;
}

export async function handleRuleVersionsRoute(input: {
  vaultRoot: string;
  path: string | null;
  res: Parameters<typeof sendJson>[0];
  listRuleVersions: (vaultRoot: string, ruleId: string) => Promise<unknown>;
}) {
  if (!input.path) {
    sendJson(input.res, 400, { error: "Missing rule path." });
    return true;
  }
  const repo = new VaultRepository(input.vaultRoot);
  const rule = await repo.loadRule(resolve(input.path));
  const versions = await input.listRuleVersions(input.vaultRoot, rule.id);
  sendJson(input.res, 200, {
    ruleId: rule.id,
    ruleTitle: rule.title,
    versions,
  });
  return true;
}

export async function handleRuleScopeRoute(input: {
  vaultRoot: string;
  body: Record<string, unknown>;
  res: Parameters<typeof sendJson>[0];
  normalizeTagList: (input: unknown) => string[];
  applyRuleScopeUpdate: (input: {
    vaultRoot: string;
    rulePath: string;
    scope: string;
    docTypes: string[];
    audiences: string[];
    reason?: string;
  }) => Promise<{
    rule: Pick<Rule, "id" | "scope" | "docTypes" | "audiences">;
    profilePath: string;
    updatedTasks: unknown;
    snapshot: unknown;
  }>;
}) {
  if (typeof input.body.path !== "string" || !input.body.path.trim()) {
    sendJson(input.res, 400, { error: "Missing rule path." });
    return true;
  }

  const result = await input.applyRuleScopeUpdate({
    vaultRoot: input.vaultRoot,
    rulePath: resolve(input.body.path),
    scope: typeof input.body.scope === "string" ? input.body.scope.trim() : "",
    docTypes: input.normalizeTagList(input.body.docTypes),
    audiences: input.normalizeTagList(input.body.audiences),
    reason: typeof input.body.reason === "string" ? input.body.reason : "",
  });
  sendJson(input.res, 200, {
    ruleId: result.rule.id,
    scope: result.rule.scope,
    docTypes: result.rule.docTypes,
    audiences: result.rule.audiences,
    profilePath: result.profilePath,
    updatedTasks: result.updatedTasks,
    snapshot: result.snapshot,
  });
  return true;
}

export async function handleRuleRollbackRoute(input: {
  vaultRoot: string;
  body: Record<string, string | undefined>;
  res: Parameters<typeof sendJson>[0];
  rollbackRuleVersion: (input: {
    vaultRoot: string;
    rulePath: string;
    versionId: string;
    reason?: string;
  }) => Promise<{
    rule: Pick<Rule, "id" | "status" | "scope" | "docTypes" | "audiences">;
    profilePath: string;
    updatedTasks: unknown;
    rollbackTo: unknown;
    snapshot: unknown;
    rollbackLog: unknown;
  }>;
}) {
  if (!input.body.path || !input.body.versionId) {
    sendJson(input.res, 400, { error: "Missing rule path or versionId." });
    return true;
  }

  const result = await input.rollbackRuleVersion({
    vaultRoot: input.vaultRoot,
    rulePath: resolve(input.body.path),
    versionId: input.body.versionId,
    reason: input.body.reason,
  });
  sendJson(input.res, 200, {
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
  return true;
}
