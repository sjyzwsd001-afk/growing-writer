import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { writeMarkdownDocument } from "../vault/markdown.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function importMaterial(input: {
  vaultRoot: string;
  title: string;
  docType: string;
  audience?: string;
  scenario?: string;
  source?: string;
  quality?: string;
  body?: string;
  sourceFile?: string;
}): Promise<{ path: string; materialId: string }> {
  const now = new Date().toISOString();
  const timestamp = now.replace(/[:.]/g, "-");
  const materialId = `material-${timestamp}`;
  const fileName = `${materialId}-${slugify(input.title)}.md`;
  const path = join(input.vaultRoot, "materials", fileName);

  const importedBody = input.sourceFile ? await readFile(input.sourceFile, "utf8") : "";
  const rawBody = (input.body ?? importedBody).trim();

  const frontmatter = {
    id: materialId,
    title: input.title,
    doc_type: input.docType,
    source: input.source ?? input.sourceFile ?? "",
    quality: input.quality ?? "high",
    status: "active",
    audience: input.audience ?? "",
    scenario: input.scenario ?? "",
    tags: [],
    created_at: now,
    updated_at: now,
  };

  const content = `# 文档信息

- 标题：${input.title}
- 类型：${input.docType}
- 来源：${input.source ?? input.sourceFile ?? ""}
- 使用场景：${input.scenario ?? ""}
- 面向对象：${input.audience ?? ""}
- 质量判断：${input.quality ?? "high"}

# 原文内容

${rawBody || "在这里粘贴或整理历史材料正文。"}

# 结构拆解

## 开头功能

- 这篇材料开头在做什么：

## 主体结构

- 第一部分：
- 第二部分：
- 第三部分：

## 结尾功能

- 结尾如何收束：

# 风格观察

- 常用语气：
- 常用句式：
- 常见逻辑顺序：
- 明显禁忌：

# 可提炼规则

- 候选规则 1：
- 候选规则 2：

# 备注

- `;

  await mkdir(dirname(path), { recursive: true });
  await writeMarkdownDocument(path, frontmatter, content);

  return { path, materialId };
}
