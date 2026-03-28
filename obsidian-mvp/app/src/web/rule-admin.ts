import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { VaultRepository } from "../vault/repository.js";
import { disableRule, rejectRule, confirmRule } from "../writers/rule-confirm-writer.js";
import { refreshDefaultProfile } from "../writers/profile-writer.js";
import { syncRuleInTasks } from "../writers/task-rule-sync-writer.js";
import { writeMarkdownDocument } from "../vault/markdown.js";

export type RuleAction = "confirm" | "disable" | "reject";
export type RuleVersionAction =
  | "confirm"
  | "disable"
  | "reject"
  | "update_scope"
  | "rollback"
  | "pre_rollback";

export type RuleVersionMeta = {
  versionId: string;
  ruleId: string;
  action: RuleVersionAction;
  reason: string;
  createdAt: string;
  snapshotPath: string;
  metadataPath: string;
};

function toSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
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

export async function listRuleVersions(vaultRoot: string, ruleId: string): Promise<RuleVersionMeta[]> {
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
  createAllAvailableLlmClients: (vaultRoot: string) => import("../llm/openai-compatible.js").OpenAiCompatibleClient[];
}) {
  const repo = new VaultRepository(input.vaultRoot);
  const clients = input.createAllAvailableLlmClients(input.vaultRoot);
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
    client: clients,
  });

  return { updatedTasks, profilePath };
}

function normalizeTextForCompare(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function hasOverlap(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) {
    return true;
  }
  const set = new Set(a.map((item) => item.trim()).filter(Boolean));
  return b.some((item) => set.has(item.trim()));
}

export function detectRuleConflictHints(
  rules: Array<{
    id: string;
    title: string;
    status: "candidate" | "confirmed" | "disabled";
    scope: string;
    docTypes: string[];
    audiences: string[];
    content: string;
  }>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const orderKeywords = ["意义", "现状", "问题", "成绩", "措施", "建议", "结论", "背景"];

  for (let i = 0; i < rules.length; i += 1) {
    const current = rules[i];
    const currentText = `${current.title} ${current.content}`;
    const currentOrder = orderKeywords.find((item) => currentText.includes(`先写${item}`));
    const currentConclusionFirst = /结论前置/.test(currentText);

    for (let j = i + 1; j < rules.length; j += 1) {
      const other = rules[j];
      if (current.status !== other.status || current.status === "disabled") {
        continue;
      }
      if (!hasOverlap(current.docTypes, other.docTypes) || !hasOverlap(current.audiences, other.audiences)) {
        continue;
      }
      const currentScope = normalizeTextForCompare(current.scope || "");
      const otherScope = normalizeTextForCompare(other.scope || "");
      if (currentScope && otherScope && currentScope !== otherScope) {
        continue;
      }
      const otherText = `${other.title} ${other.content}`;
      const otherOrder = orderKeywords.find((item) => otherText.includes(`先写${item}`));
      const otherConclusionFirst = /结论前置/.test(otherText);

      const hints: string[] = [];
      if (currentOrder && otherOrder && currentOrder !== otherOrder) {
        hints.push(`与「${other.title}」的段落顺序偏好可能冲突`);
      }
      if (currentConclusionFirst !== otherConclusionFirst && (currentConclusionFirst || otherConclusionFirst)) {
        hints.push(`与「${other.title}」的“结论前置”偏好可能冲突`);
      }
      if (hints.length) {
        result.set(current.id, [...(result.get(current.id) || []), ...hints]);
        result.set(other.id, [...(result.get(other.id) || []), ...hints.map((hint) => hint.replace(other.title, current.title))]);
      }
    }
  }

  return result;
}

export async function applyRuleAction(input: {
  action: RuleAction;
  vaultRoot: string;
  rulePath: string;
  reason?: string;
  createAllAvailableLlmClients: (vaultRoot: string) => import("../llm/openai-compatible.js").OpenAiCompatibleClient[];
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
    createAllAvailableLlmClients: input.createAllAvailableLlmClients,
  });

  return {
    rule: updatedRule,
    updatedTasks: sync.updatedTasks,
    profilePath: sync.profilePath,
    snapshot,
  };
}

export async function applyRuleScopeUpdate(input: {
  vaultRoot: string;
  rulePath: string;
  scope?: string;
  docTypes?: string[];
  audiences?: string[];
  reason?: string;
  createAllAvailableLlmClients: (vaultRoot: string) => import("../llm/openai-compatible.js").OpenAiCompatibleClient[];
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
    createAllAvailableLlmClients: input.createAllAvailableLlmClients,
  });

  return {
    rule: updatedRule,
    updatedTasks: sync.updatedTasks,
    profilePath: sync.profilePath,
    snapshot,
  };
}

export async function rollbackRuleVersion(input: {
  vaultRoot: string;
  rulePath: string;
  versionId: string;
  reason?: string;
  createAllAvailableLlmClients: (vaultRoot: string) => import("../llm/openai-compatible.js").OpenAiCompatibleClient[];
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
    createAllAvailableLlmClients: input.createAllAvailableLlmClients,
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
