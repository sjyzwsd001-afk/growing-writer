import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Material } from "../types/domain.js";
import { slugify } from "../utils/text.js";
import { writeMarkdownDocument } from "../vault/markdown.js";

function toBulletList(items: string[]): string {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  if (!cleaned.length) {
    return "- ";
  }

  return cleaned.map((item) => `- ${item}`).join("\n");
}

function parseLines(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/\r?\n/)
    .map((item) => item.replace(/^- /, "").trim())
    .filter(Boolean);
}

function buildTaskContent(input: {
  goal?: string;
  targetEffect?: string;
  background?: string;
  facts?: string;
  mustInclude?: string;
  specialRequirements?: string;
  templateId?: string;
  templateMode?: "strict" | "hybrid" | "light";
  templateOverrides?: Record<string, string>;
  selectedMaterials: Material[];
}): string {
  const backgroundLines = parseLines(input.background);
  const factLines = parseLines(input.facts);
  const mustIncludeLines = parseLines(input.mustInclude);
  const specialRequirementLines = parseLines(input.specialRequirements);
  const templateOverrideLines = Object.entries(input.templateOverrides ?? {}).map(
    ([section, instruction]) => `${section}=${instruction}`,
  );
  const selectedMaterialLines = input.selectedMaterials.map(
    (item) => `${item.title}${item.docType ? `（${item.docType}）` : ""}`,
  );

  return `# 写作目标

- 这次要写什么：${input.goal?.trim() || ""}
- 写给谁看：
- 希望达到什么效果：${input.targetEffect?.trim() || ""}

# 原始素材

## 背景

${toBulletList(backgroundLines)}

## 事实与数据

${toBulletList(factLines)}

## 必须包含的信息

${toBulletList(mustIncludeLines)}

## 特殊要求

${toBulletList(specialRequirementLines)}

# 参考材料输入

${toBulletList(selectedMaterialLines)}

# 模板继承设置

- 模板ID：${input.templateId || ""}
- 模式：${input.templateMode || "hybrid"}

## 覆盖规则

${toBulletList(templateOverrideLines)}

# 写前诊断

- 当前缺失的信息：
- 需要补充的因素：
- 建议采用的结构：

# 参考依据

## 相似历史材料

- 

## 已匹配规则

- 

# 提纲

## 一级结构

1. 
2. 
3. 

# 初稿

在这里生成正文。

# 修改记录

- v1：

# 定稿说明

- `;
}

export async function createTask(input: {
  vaultRoot: string;
  title: string;
  docType: string;
  audience?: string;
  scenario?: string;
  priority?: string;
  targetLength?: string;
  deadline?: string;
  goal?: string;
  targetEffect?: string;
  background?: string;
  facts?: string;
  mustInclude?: string;
  specialRequirements?: string;
  templateId?: string;
  templateMode?: "strict" | "hybrid" | "light";
  templateOverrides?: Record<string, string>;
  sourceMaterials?: Material[];
}): Promise<{ path: string; taskId: string }> {
  const now = new Date().toISOString();
  const timestamp = now.replace(/[:.]/g, "-");
  const taskId = `task-${timestamp}`;
  const fileName = `${taskId}-${slugify(input.title)}.md`;
  const path = join(input.vaultRoot, "tasks", fileName);

  const frontmatter = {
    id: taskId,
    title: input.title,
    doc_type: input.docType,
    audience: input.audience ?? "",
    scenario: input.scenario ?? "",
    status: "draft",
    priority: input.priority ?? "medium",
    target_length: input.targetLength ?? "",
    deadline: input.deadline ?? "",
    template_id: input.templateId ?? "",
    template_mode: input.templateMode ?? "hybrid",
    template_overrides: input.templateOverrides ?? {},
    source_materials: (input.sourceMaterials ?? []).map((item) => item.id),
    matched_rules: [],
    created_at: now,
    updated_at: now,
  };

  const content = buildTaskContent({
    goal: input.goal,
    targetEffect: input.targetEffect,
    background: input.background,
    facts: input.facts,
    mustInclude: input.mustInclude,
    specialRequirements: input.specialRequirements,
    templateId: input.templateId,
    templateMode: input.templateMode,
    templateOverrides: input.templateOverrides,
    selectedMaterials: input.sourceMaterials ?? [],
  });

  await mkdir(dirname(path), { recursive: true });
  await writeMarkdownDocument(path, frontmatter, content);

  return { path, taskId };
}
