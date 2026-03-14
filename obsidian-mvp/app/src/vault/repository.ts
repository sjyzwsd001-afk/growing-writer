import fg from "fast-glob";
import { join } from "node:path";

import { readMarkdownDocument } from "./markdown.js";
import type { Feedback, Material, Profile, Rule, Task } from "../types/domain.js";

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

export class VaultRepository {
  constructor(private readonly vaultRoot: string) {}

  async loadMaterials(): Promise<Material[]> {
    const docs = await this.readCollection("materials");
    return docs.map((doc) => ({
      ...doc,
      id: normalizeString(doc.frontmatter.id, doc.path),
      title: normalizeString(doc.frontmatter.title, "Untitled Material"),
      docType: normalizeString(doc.frontmatter.doc_type),
      audience: normalizeString(doc.frontmatter.audience),
      scenario: normalizeString(doc.frontmatter.scenario),
      quality: normalizeString(doc.frontmatter.quality, "medium"),
      tags: normalizeStringArray(doc.frontmatter.tags),
    }));
  }

  async loadRules(): Promise<Rule[]> {
    const docs = await this.readCollection("rules");
    return docs.map((doc) => ({
      ...doc,
      id: normalizeString(doc.frontmatter.id, doc.path),
      title: normalizeString(doc.frontmatter.title, "Untitled Rule"),
      status: (normalizeString(doc.frontmatter.status, "candidate") as Rule["status"]),
      scope: normalizeString(doc.frontmatter.scope),
      docTypes: normalizeStringArray(doc.frontmatter.doc_types),
      audiences: normalizeStringArray(doc.frontmatter.audiences),
      confidence: normalizeNumber(doc.frontmatter.confidence, 0),
    }));
  }

  async loadTask(taskFile: string): Promise<Task> {
    const doc = await readMarkdownDocument(taskFile);
    return {
      ...doc,
      id: normalizeString(doc.frontmatter.id, taskFile),
      title: normalizeString(doc.frontmatter.title, "Untitled Task"),
      docType: normalizeString(doc.frontmatter.doc_type),
      audience: normalizeString(doc.frontmatter.audience),
      scenario: normalizeString(doc.frontmatter.scenario),
      status: normalizeString(doc.frontmatter.status, "draft"),
      sourceMaterials: normalizeStringArray(doc.frontmatter.source_materials),
      matchedRules: normalizeStringArray(doc.frontmatter.matched_rules),
    };
  }

  async loadFeedback(feedbackFile: string): Promise<Feedback> {
    const doc = await readMarkdownDocument(feedbackFile);
    return {
      ...doc,
      id: normalizeString(doc.frontmatter.id, feedbackFile),
      taskId: normalizeString(doc.frontmatter.task_id),
      relatedRuleIds: normalizeStringArray(doc.frontmatter.related_rule_ids),
      feedbackType: normalizeString(doc.frontmatter.feedback_type),
    };
  }

  async findTaskById(taskId: string): Promise<Task | null> {
    if (!taskId) {
      return null;
    }

    const tasks = await this.readCollection("tasks");
    const matched = tasks.find((doc) => normalizeString(doc.frontmatter.id) === taskId);
    if (!matched) {
      return null;
    }

    return {
      ...matched,
      id: normalizeString(matched.frontmatter.id, matched.path),
      title: normalizeString(matched.frontmatter.title, "Untitled Task"),
      docType: normalizeString(matched.frontmatter.doc_type),
      audience: normalizeString(matched.frontmatter.audience),
      scenario: normalizeString(matched.frontmatter.scenario),
      status: normalizeString(matched.frontmatter.status, "draft"),
      sourceMaterials: normalizeStringArray(matched.frontmatter.source_materials),
      matchedRules: normalizeStringArray(matched.frontmatter.matched_rules),
    };
  }

  async loadProfiles(): Promise<Profile[]> {
    const docs = await this.readCollection("profiles");
    return docs.map((doc) => ({
      ...doc,
      id: normalizeString(doc.frontmatter.id, doc.path),
      name: normalizeString(doc.frontmatter.name, "default"),
      version: normalizeNumber(doc.frontmatter.version, 1),
    }));
  }

  private async readCollection(dirName: string) {
    const baseDir = join(this.vaultRoot, dirName);
    const entries = await fg("**/*.md", { cwd: baseDir, absolute: true });
    return Promise.all(entries.map((path) => readMarkdownDocument(path)));
  }
}
