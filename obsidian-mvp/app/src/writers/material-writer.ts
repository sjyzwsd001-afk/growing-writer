import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import fg from "fast-glob";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

import { OpenAiCompatibleClient } from "../llm/openai-compatible.js";
import { BASE_SYSTEM_PROMPT } from "../prompts/common.js";
import { buildAnalyzeMaterialPrompt } from "../prompts/analyze-material.js";
import { materialAnalysisSchema, type MaterialAnalysis } from "../types/schemas.js";
import { replaceSection, writeMarkdownDocument } from "../vault/markdown.js";
import { readMarkdownDocument } from "../vault/markdown.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function analyzeMaterialHeuristically(text: string, docType: string): MaterialAnalysis {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  const first = paragraphs[0] ?? "";
  const last = paragraphs[paragraphs.length - 1] ?? "";
  const bodyParts = paragraphs.slice(0, 3).map((item, index) => {
    const shortened = item.replace(/\n/g, " ").slice(0, 36);
    return `第${index + 1}部分可围绕“${shortened}”展开`;
  });

  const isFormal = /项目|工作|推进|完成|风险|措施|情况|阶段/.test(normalized);
  const hasConclusion = /总体|整体|下一步|后续|建议|措施|计划/.test(last);

  return {
    opening:
      first.length > 0
        ? `开头大概率在交代${docType || "该材料"}的背景或总体情况，可参考首段“${first.slice(0, 28)}”。`
        : "开头大概率在交代背景、目标或当前总体情况。",
    body_parts:
      bodyParts.length > 0
        ? bodyParts
        : ["第一部分可写背景", "第二部分可写主体信息", "第三部分可写结尾安排"],
    ending: hasConclusion
      ? `结尾倾向于落在总结、措施或下一步安排，可参考末段“${last.slice(0, 28)}”。`
      : "结尾建议补充总结判断、态度表述或下一步安排。",
    tone: isFormal ? "正式、客观、偏工作汇报语气" : "偏说明性语气，建议进一步统一正式表达",
    sentence_style:
      normalized.length > 120 ? "以完整陈述句为主，适合做正式材料" : "篇幅较短，后续可补充更完整的陈述句",
    logic_order: "通常可按背景/现状 -> 重点事项 -> 结论或安排的顺序组织",
    taboo: "避免口语化、空泛表述，避免只有结论没有事实支撑",
    candidate_rules: ["待人工确认"],
  };
}

function buildMaterialContent(input: {
  title: string;
  docType: string;
  source?: string;
  scenario?: string;
  audience?: string;
  quality?: string;
  rawBody: string;
  analysis: MaterialAnalysis;
}): string {
  return `# 文档信息

- 标题：${input.title}
- 类型：${input.docType}
- 来源：${input.source ?? ""}
- 使用场景：${input.scenario ?? ""}
- 面向对象：${input.audience ?? ""}
- 质量判断：${input.quality ?? "high"}

# 原文内容

${input.rawBody || "在这里粘贴或整理历史材料正文。"}

# 结构拆解

## 开头功能

- ${input.analysis.opening}

## 主体结构

- ${input.analysis.body_parts[0] ?? "第一部分待补充"}
- ${input.analysis.body_parts[1] ?? "第二部分待补充"}
- ${input.analysis.body_parts[2] ?? "第三部分待补充"}

## 结尾功能

- ${input.analysis.ending}

# 风格观察

- 常用语气：${input.analysis.tone}
- 常用句式：${input.analysis.sentence_style}
- 常见逻辑顺序：${input.analysis.logic_order}
- 明显禁忌：${input.analysis.taboo}

# 可提炼规则

- 候选规则 1：${input.analysis.candidate_rules[0] ?? "待人工确认"}
- 候选规则 2：${input.analysis.candidate_rules[1] ?? "待人工确认"}
- 候选规则 3：${input.analysis.candidate_rules[2] ?? "待人工确认"}

# 备注

- `;
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
  analysis?: MaterialAnalysis;
}): Promise<{ path: string; materialId: string }> {
  const now = new Date().toISOString();
  const timestamp = now.replace(/[:.]/g, "-");
  const materialId = `material-${timestamp}`;
  const fileName = `${materialId}-${slugify(input.title)}.md`;
  const path = join(input.vaultRoot, "materials", fileName);

  const importedBody = input.sourceFile ? await extractTextFromFile(input.sourceFile) : "";
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

  const content = buildMaterialContent({
    title: input.title,
    docType: input.docType,
    source: input.source ?? input.sourceFile ?? "",
    scenario: input.scenario,
    audience: input.audience,
    quality: input.quality ?? "high",
    rawBody,
    analysis: input.analysis ?? analyzeMaterialHeuristically(rawBody, input.docType),
  });

  await mkdir(dirname(path), { recursive: true });
  await writeMarkdownDocument(path, frontmatter, content);

  return { path, materialId };
}

export async function importMaterialsFromDirectory(input: {
  vaultRoot: string;
  sourceDir: string;
  docType: string;
  audience?: string;
  scenario?: string;
  source?: string;
  quality?: string;
  analyze?: (payload: { title: string; rawBody: string; docType: string; audience?: string; scenario?: string }) => Promise<MaterialAnalysis>;
}): Promise<Array<{ path: string; materialId: string; sourceFile: string }>> {
  const files = await fg(["**/*.md", "**/*.txt", "**/*.docx", "**/*.pdf"], {
    cwd: input.sourceDir,
    absolute: true,
    onlyFiles: true,
  });

  const results: Array<{ path: string; materialId: string; sourceFile: string }> = [];

  for (const file of files) {
    const content = (await extractTextFromFile(file)).trim();
    if (!content) {
      continue;
    }

    const title = basename(file, extname(file));
    const analysis = input.analyze
      ? await input.analyze({
          title,
          rawBody: content,
          docType: input.docType,
          audience: input.audience,
          scenario: input.scenario,
        })
      : analyzeMaterialHeuristically(content, input.docType);
    const imported = await importMaterial({
      vaultRoot: input.vaultRoot,
      title,
      docType: input.docType,
      audience: input.audience,
      scenario: input.scenario,
      source: input.source ?? file,
      quality: input.quality,
      body: content,
      analysis,
    });

    results.push({
      ...imported,
      sourceFile: file,
    });
  }

  return results;
}

async function extractTextFromFile(path: string): Promise<string> {
  const extension = extname(path).toLowerCase();

  if (extension === ".txt" || extension === ".md") {
    return readFile(path, "utf8");
  }

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path });
    return result.value;
  }

  if (extension === ".pdf") {
    const buffer = await readFile(path);
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }

  throw new Error(`Unsupported material file type: ${extension}`);
}

export async function analyzeImportedMaterial(
  materialPath: string,
  options?: { analyze?: (payload: { title: string; rawBody: string; docType: string; audience?: string; scenario?: string }) => Promise<MaterialAnalysis> },
): Promise<void> {
  const doc = await readMarkdownDocument(materialPath);
  const title = typeof doc.frontmatter.title === "string" ? doc.frontmatter.title : "";
  const docType = typeof doc.frontmatter.doc_type === "string" ? doc.frontmatter.doc_type : "";
  const source = typeof doc.frontmatter.source === "string" ? doc.frontmatter.source : "";
  const scenario = typeof doc.frontmatter.scenario === "string" ? doc.frontmatter.scenario : "";
  const audience = typeof doc.frontmatter.audience === "string" ? doc.frontmatter.audience : "";
  const quality = typeof doc.frontmatter.quality === "string" ? doc.frontmatter.quality : "high";

  const rawBodyMatch = doc.content.match(/# 原文内容\n\n([\s\S]*?)(?=\n# )/);
  const rawBody = rawBodyMatch?.[1]?.trim() ?? "";
  const analysis = options?.analyze
    ? await options.analyze({
        title,
        rawBody,
        docType,
        audience,
        scenario,
      })
    : analyzeMaterialHeuristically(rawBody, docType);
  const rebuilt = buildMaterialContent({
    title,
    docType,
    source,
    scenario,
    audience,
    quality,
    rawBody,
    analysis,
  });

  await writeMarkdownDocument(materialPath, doc.frontmatter, rebuilt);
}

export async function analyzeMaterialWithLlm(
  client: OpenAiCompatibleClient,
  input: {
    title: string;
    docType: string;
    audience?: string;
    scenario?: string;
    rawBody: string;
  },
): Promise<MaterialAnalysis> {
  return client.generateJson({
    system: BASE_SYSTEM_PROMPT,
    user: buildAnalyzeMaterialPrompt(input),
    schema: materialAnalysisSchema,
  });
}

export function createMaterialAnalyzer(client: OpenAiCompatibleClient | null) {
  return async (payload: {
    title: string;
    rawBody: string;
    docType: string;
    audience?: string;
    scenario?: string;
  }): Promise<MaterialAnalysis> => {
    if (!client || !client.isEnabled()) {
      return analyzeMaterialHeuristically(payload.rawBody, payload.docType);
    }

    try {
      return await analyzeMaterialWithLlm(client, {
        title: payload.title,
        rawBody: payload.rawBody,
        docType: payload.docType,
        audience: payload.audience,
        scenario: payload.scenario,
      });
    } catch {
      return analyzeMaterialHeuristically(payload.rawBody, payload.docType);
    }
  };
}
