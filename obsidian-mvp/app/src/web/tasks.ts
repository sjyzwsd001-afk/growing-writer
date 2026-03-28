import { resolve } from "node:path";

import { VaultRepository } from "../vault/repository.js";
import { sendJson } from "./http.js";
import type { TaskCreateRequest } from "./task-engine.js";

export async function handleCreateTaskRoute(input: {
  vaultRoot: string;
  body: Record<string, unknown>;
  res: Parameters<typeof sendJson>[0];
  toTaskCreateRequest: (body: Record<string, unknown>) => TaskCreateRequest;
  createTaskFromRequest: (input: {
    vaultRoot: string;
    request: TaskCreateRequest;
  }) => Promise<{ created: unknown }>;
}) {
  const request = input.toTaskCreateRequest(input.body);
  if (!request.title || !request.docType) {
    sendJson(input.res, 400, { error: "title 和 docType 是必填项。" });
    return true;
  }

  const { created } = await input.createTaskFromRequest({
    vaultRoot: input.vaultRoot,
    request,
  });

  sendJson(input.res, 200, created);
  return true;
}

export async function handleRunTaskRoute(input: {
  vaultRoot: string;
  body: Record<string, string | undefined>;
  res: Parameters<typeof sendJson>[0];
  runTaskAction: (input: {
    vaultRoot: string;
    taskPath: string;
    action: "diagnose" | "outline" | "draft";
  }) => Promise<unknown>;
}) {
  if (!input.body.path || !input.body.action) {
    sendJson(input.res, 400, { error: "Missing task path or action." });
    return true;
  }

  const result = await input.runTaskAction({
    vaultRoot: input.vaultRoot,
    taskPath: resolve(input.body.path),
    action: input.body.action as "diagnose" | "outline" | "draft",
  });
  sendJson(input.res, 200, result);
  return true;
}

export async function handleUpdateTaskDraftRoute(input: {
  vaultRoot: string;
  body: Record<string, string | undefined>;
  res: Parameters<typeof sendJson>[0];
  replaceSection: typeof import("../vault/markdown.js").replaceSection;
  writeMarkdownDocument: typeof import("../vault/markdown.js").writeMarkdownDocument;
  normalizeTaskFeedbackSignals: (value: unknown) => Record<
    string,
    {
      count: number;
      latest_reason: string;
      latest_updated_at: string;
      latest_version: string;
      recent_reasons: string[];
    }
  >;
}) {
  if (!input.body.path) {
    sendJson(input.res, 400, { error: "Missing task path." });
    return true;
  }

  const taskPath = resolve(input.body.path);
  const repo = new VaultRepository(input.vaultRoot);
  const task = await repo.loadTask(taskPath);
  const now = new Date().toISOString();
  const draft = (input.body.draft ?? "").trim();
  const reason = (input.body.reason ?? "").trim();
  const location = (input.body.location ?? "").trim();
  const finalized = input.body.finalized === "true";
  const version = (input.body.version ?? "").trim();
  const currentUpdated = typeof task.frontmatter.updated_at === "string" ? task.frontmatter.updated_at : "";
  const logLine = `- ${now}${version ? ` [${version}]` : ""}${location ? ` [${location}]` : ""}${reason ? `：${reason}` : ""}`;
  const historyBody = String(task.content.match(/# 修改记录\n\n([\s\S]*?)(?=\n# )/)?.[1] ?? "- v1：");
  const mergedHistory = `${historyBody.trim()}\n${logLine}`.trim();

  let nextContent = input.replaceSection(task.content, "初稿", draft || "在这里生成正文。");
  nextContent = input.replaceSection(nextContent, "修改记录", mergedHistory);
  if (finalized) {
    const existingFinal = String(task.content.match(/# 定稿说明\n\n([\s\S]*?)(?=\n# )/)?.[1] ?? "- ");
    const finalLine = `- ${now}：已在前端定稿。`;
    nextContent = input.replaceSection(nextContent, "定稿说明", `${existingFinal.trim()}\n${finalLine}`.trim());
  }

  const ignoreReasons = new Set(["手动保存", "直接定稿"]);
  const feedbackSignals = input.normalizeTaskFeedbackSignals(task.frontmatter.feedback_signals);
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
  const nextReasons = shouldCountFeedback ? [...existingSignal.recent_reasons, reason].slice(-5) : existingSignal.recent_reasons;
  feedbackSignals[normalizedLocation] = {
    count: nextCount,
    latest_reason: reason || existingSignal.latest_reason,
    latest_updated_at: now,
    latest_version: version || existingSignal.latest_version,
    recent_reasons: nextReasons,
  };

  await input.writeMarkdownDocument(
    task.path,
    {
      ...task.frontmatter,
      status: finalized ? "finalized" : "draft",
      updated_at: now || currentUpdated,
      feedback_signals: feedbackSignals,
    },
    nextContent,
  );

  sendJson(input.res, 200, {
    path: task.path,
    updatedAt: now,
    finalized,
    feedbackSignal: feedbackSignals[normalizedLocation],
  });
  return true;
}
