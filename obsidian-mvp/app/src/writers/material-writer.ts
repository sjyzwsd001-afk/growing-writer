import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import AdmZip, { type IZipEntry } from "adm-zip";
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

function decodeXmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function readZipEntryText(zip: AdmZip, entryName: string): string {
  const entry = zip.getEntry(entryName);
  if (!entry) {
    return "";
  }
  return zip.readAsText(entry, "utf8");
}

function extractSpreadsheetTextFromZip(zip: AdmZip): string {
  const sharedStringsXml = readZipEntryText(zip, "xl/sharedStrings.xml");
  const sharedStrings = [...sharedStringsXml.matchAll(/<si[\s\S]*?<\/si>/g)].map((match) =>
    decodeXmlText(match[0]),
  );
  const worksheetEntries = zip
    .getEntries()
    .filter((entry: IZipEntry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.entryName))
    .sort((a: IZipEntry, b: IZipEntry) => a.entryName.localeCompare(b.entryName));

  const sheetTexts = worksheetEntries
    .map((entry: IZipEntry, index: number) => {
      const xml = zip.readAsText(entry, "utf8");
      const cellValues = [...xml.matchAll(/<c\b[^>]*?(?:\st="([^"]+)")?[^>]*>[\s\S]*?<v>([\s\S]*?)<\/v>[\s\S]*?<\/c>/g)]
        .map((match) => {
          const cellType = String(match[1] || "").trim();
          const rawValue = decodeXmlText(match[2]);
          if (cellType === "s") {
            const shared = sharedStrings[Number(rawValue)] || "";
            return shared.trim();
          }
          return rawValue.trim();
        })
        .filter(Boolean);
      if (!cellValues.length) {
        return "";
      }
      return `工作表 ${index + 1}\n${cellValues.join("\n")}`;
    })
    .filter(Boolean);

  return sheetTexts.join("\n\n");
}

function extractPresentationTextFromZip(zip: AdmZip): string {
  const slideEntries = zip
    .getEntries()
    .filter((entry: IZipEntry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.entryName))
    .sort((a: IZipEntry, b: IZipEntry) => a.entryName.localeCompare(b.entryName));

  const slideTexts = slideEntries
    .map((entry: IZipEntry, index: number) => {
      const xml = zip.readAsText(entry, "utf8");
      const textRuns = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
        .map((match) => decodeXmlText(match[1]))
        .filter(Boolean);
      if (!textRuns.length) {
        return "";
      }
      return `第 ${index + 1} 页\n${textRuns.join("\n")}`;
    })
    .filter(Boolean);

  return slideTexts.join("\n\n");
}

function extractTextFromOfficeZipBuffer(input: { fileName: string; buffer: Buffer }): string {
  const extension = extname(input.fileName).toLowerCase();
  const zip = new AdmZip(input.buffer);
  if (extension === ".xlsx") {
    return extractSpreadsheetTextFromZip(zip);
  }
  if (extension === ".pptx") {
    return extractPresentationTextFromZip(zip);
  }
  return "";
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
    logic_chain: [
      {
        from: "背景/现状",
        to: "重点事项",
        reason: "先给读者建立上下文，再展开主体内容。",
      },
      {
        from: "重点事项",
        to: "结论/安排",
        reason: "主体事实说清后，再落到判断或下一步动作。",
      },
    ],
    template_slots: [
      {
        section: "开头",
        slot_name: "背景与对象",
        fill_rule: "结合本次项目背景、对象和场景替换开头中的固定表述。",
        source_hint: "优先取本次背景材料与任务表单中的核心信息。",
      },
      {
        section: "主体",
        slot_name: "事实与数据",
        fill_rule: "将项目进展、风险、措施或数据替换进对应段落，不保留空泛占位句。",
        source_hint: "优先使用本次背景材料中的事实、数据和动作信息。",
      },
    ],
    section_intents: [
      {
        section: "开头",
        intent: "交代背景并建立阅读上下文",
        trigger: "当任务需要先说明来龙去脉时优先使用",
      },
      {
        section: "主体",
        intent: "展开关键事实、风险、措施或进展",
        trigger: "当需要说明事情为何如此以及下一步怎么做时使用",
      },
      {
        section: "结尾",
        intent: "收束结论并给出后续安排",
        trigger: "当材料需要明确态度、建议或下一步动作时使用",
      },
    ],
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

# 逻辑关系

${input.analysis.logic_chain.length
  ? input.analysis.logic_chain
      .map((item, index) => `- 逻辑${index + 1}：先写「${item.from}」再写「${item.to}」；原因：${item.reason}`)
      .join("\n")
  : "- 待补充"}

# 模板槽位

${input.analysis.template_slots.length
  ? input.analysis.template_slots
      .map(
        (item, index) =>
          `- 槽位${index + 1}：${item.section} / ${item.slot_name}；替换规则：${item.fill_rule}；取材依据：${item.source_hint}`,
      )
      .join("\n")
  : "- 暂未识别出明确的模板槽位"}

# 段落意图

${input.analysis.section_intents.length
  ? input.analysis.section_intents
      .map(
        (item, index) =>
          `- 意图${index + 1}：${item.section}；写作意图：${item.intent}；触发条件：${item.trigger}`,
      )
      .join("\n")
  : "- 待补充"}

# 备注

- `;
}

function hashMaterialBody(input: { title: string; docType: string; rawBody: string }): string {
  return createHash("sha256")
    .update(`${input.title}\n${input.docType}\n${input.rawBody}`)
    .digest("hex");
}

async function findExistingMaterialPath(input: {
  vaultRoot: string;
  title: string;
  docType: string;
  rawBody: string;
}): Promise<{ path: string; frontmatter: Record<string, unknown> } | null> {
  const expectedHash = hashMaterialBody(input);
  const materialFiles = await fg("materials/*.md", {
    cwd: input.vaultRoot,
    absolute: true,
  });

  for (const materialPath of materialFiles) {
    const doc = await readMarkdownDocument(materialPath);
    const title = typeof doc.frontmatter.title === "string" ? doc.frontmatter.title : "";
    const docType = typeof doc.frontmatter.doc_type === "string" ? doc.frontmatter.doc_type : "";
    const bodyHash =
      typeof doc.frontmatter.body_hash === "string" ? doc.frontmatter.body_hash : "";
    if (title === input.title && docType === input.docType && bodyHash === expectedHash) {
      return {
        path: materialPath,
        frontmatter: doc.frontmatter,
      };
    }
  }

  return null;
}

export async function importMaterial(input: {
  vaultRoot: string;
  title: string;
  docType: string;
  audience?: string;
  scenario?: string;
  source?: string;
  quality?: string;
  tags?: string[];
  body?: string;
  sourceFile?: string;
  analysis?: MaterialAnalysis;
}): Promise<{ path: string; materialId: string }> {
  const now = new Date().toISOString();
  const importedBody = input.sourceFile ? await extractTextFromFile(input.sourceFile) : "";
  const rawBody = (input.body ?? importedBody).trim();
  const bodyHash = hashMaterialBody({
    title: input.title,
    docType: input.docType,
    rawBody,
  });
  const existing = await findExistingMaterialPath({
    vaultRoot: input.vaultRoot,
    title: input.title,
    docType: input.docType,
    rawBody,
  });
  const timestamp = now.replace(/[:.]/g, "-");
  const materialId =
    typeof existing?.frontmatter.id === "string" && existing.frontmatter.id.trim()
      ? existing.frontmatter.id
      : `material-${timestamp}`;
  const fileName = `${materialId}-${slugify(input.title)}.md`;
  const path = existing?.path || join(input.vaultRoot, "materials", fileName);

  const frontmatter = {
    id: materialId,
    title: input.title,
    doc_type: input.docType,
    source: input.source ?? input.sourceFile ?? "",
    quality: input.quality ?? "high",
    status: "active",
    audience: input.audience ?? "",
    scenario: input.scenario ?? "",
    tags: input.tags ?? [],
    created_at: now,
    updated_at: now,
    body_hash: bodyHash,
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
  await writeMarkdownDocument(path, {
    ...frontmatter,
    created_at:
      typeof existing?.frontmatter.created_at === "string" && existing.frontmatter.created_at
        ? existing.frontmatter.created_at
        : now,
  }, content);

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
  const files = await fg(["**/*.md", "**/*.txt", "**/*.docx", "**/*.pdf", "**/*.xlsx", "**/*.pptx"], {
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

  if (extension === ".xlsx" || extension === ".pptx") {
    const buffer = await readFile(path);
    return extractTextFromOfficeZipBuffer({ fileName: path, buffer });
  }

  throw new Error(`Unsupported material file type: ${extension}`);
}

export async function extractTextFromBuffer(input: {
  fileName: string;
  buffer: Buffer;
}): Promise<string> {
  const extension = extname(input.fileName).toLowerCase();

  if (extension === ".txt" || extension === ".md") {
    return input.buffer.toString("utf8");
  }

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer: input.buffer });
    return result.value;
  }

  if (extension === ".pdf") {
    const parser = new PDFParse({ data: input.buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }

  if (extension === ".xlsx" || extension === ".pptx") {
    return extractTextFromOfficeZipBuffer(input);
  }

  throw new Error(`Unsupported uploaded material file type: ${extension}`);
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Material analysis timed out after ${timeoutMs}ms.`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createMaterialAnalyzer(client: OpenAiCompatibleClient | OpenAiCompatibleClient[] | null) {
  const clients = Array.isArray(client)
    ? client.filter((item): item is OpenAiCompatibleClient => Boolean(item?.isEnabled()))
    : client && client.isEnabled()
      ? [client]
      : [];
  return async (payload: {
    title: string;
    rawBody: string;
    docType: string;
    audience?: string;
    scenario?: string;
  }): Promise<MaterialAnalysis> => {
    if (!clients.length) {
      return analyzeMaterialHeuristically(payload.rawBody, payload.docType);
    }

    for (const llmClient of clients) {
      try {
        return await withTimeout(
          analyzeMaterialWithLlm(llmClient, {
            title: payload.title,
            rawBody: payload.rawBody,
            docType: payload.docType,
            audience: payload.audience,
            scenario: payload.scenario,
          }),
          12000,
        );
      } catch {
        // Try the next available model card before falling back locally.
      }
    }

    return analyzeMaterialHeuristically(payload.rawBody, payload.docType);
  };
}
