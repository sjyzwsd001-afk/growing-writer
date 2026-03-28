import { rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { VaultRepository } from "../vault/repository.js";
import {
  analyzeImportedMaterial,
  createMaterialAnalyzer,
  extractTextFromBuffer,
  importMaterial,
} from "../writers/material-writer.js";
import { sendJson } from "./http.js";

export function normalizeTagList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof input === "string") {
    return input
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function parseMaterialSourceRole(source: string): "template" | "history" | "" {
  const normalized = source.trim().toLowerCase();
  if (normalized === "template" || normalized.startsWith("template:")) {
    return "template";
  }
  if (normalized === "history" || normalized.startsWith("history:")) {
    return "history";
  }
  return "";
}

function stripMaterialSourceRole(source: string): string {
  return source.replace(/^(template|history)[:：]\s*/i, "").trim();
}

export function isTemplateMaterial(input: { tags?: string[]; source?: string; docType?: string }): boolean {
  const tags = (input.tags ?? []).map((item) => item.toLowerCase());
  if (tags.includes("template") || tags.includes("模板")) {
    return true;
  }

  const source = (input.source ?? "").toLowerCase();
  const docType = (input.docType ?? "").toLowerCase();
  const sourceRole = parseMaterialSourceRole(source);
  return sourceRole === "template" || (sourceRole === "" && (source.includes("template") || source.includes("模板"))) || docType.includes("模板");
}

export function classifyMaterialRole(input: {
  isTemplate: boolean;
  source?: string;
  quality?: string;
  docType?: string;
  scenario?: string;
}) {
  if (input.isTemplate) {
    return {
      roleLabel: "模板",
      roleReason: "会以高权重参与结构和表达约束。",
    };
  }

  const source = String(input.source || "").toLowerCase();
  const docType = String(input.docType || "").toLowerCase();
  const scenario = String(input.scenario || "").toLowerCase();
  const quality = String(input.quality || "").toLowerCase();

  if (
    source.includes("background") ||
    source.includes("upload") ||
    source.includes("上传") ||
    docType.includes("背景") ||
    scenario.includes("背景")
  ) {
    return {
      roleLabel: "背景素材",
      roleReason: "主要提供事实、数据和本次任务上下文。",
    };
  }

  if (quality === "high") {
    return {
      roleLabel: "历史范文",
      roleReason: "更适合提炼结构、语气和常用表达。",
    };
  }

  return {
    roleLabel: "参考材料",
    roleReason: "作为一般补充信息参与检索和引用。",
  };
}

export async function updateMaterialRole(input: {
  vaultRoot: string;
  materialPath: string;
  role: "template" | "history";
  reason?: string;
  readMarkdownDocument: typeof import("../vault/markdown.js").readMarkdownDocument;
  writeMarkdownDocument: typeof import("../vault/markdown.js").writeMarkdownDocument;
}) {
  const doc = await input.readMarkdownDocument(input.materialPath);
  const currentTags = Array.isArray(doc.frontmatter.tags)
    ? doc.frontmatter.tags.filter((item): item is string => typeof item === "string")
    : [];
  const nextTags = currentTags.filter((tag) => !/template|模板/i.test(tag));
  if (input.role === "template") {
    nextTags.push("template");
  }
  const dedupedTags = [...new Set(nextTags)];
  const now = new Date().toISOString();
  const currentSource = typeof doc.frontmatter.source === "string" ? doc.frontmatter.source : "";
  const sourcePrefix = input.role === "template" ? "template" : "history";
  const sourceBody = stripMaterialSourceRole(currentSource);
  const nextSource = sourceBody && sourceBody.toLowerCase() !== sourcePrefix ? `${sourcePrefix}: ${sourceBody}` : sourcePrefix;

  await input.writeMarkdownDocument(
    input.materialPath,
    {
      ...doc.frontmatter,
      tags: dedupedTags,
      quality: input.role === "template" ? "high" : doc.frontmatter.quality ?? "high",
      source: nextSource,
      updated_at: now,
      role_reason: input.reason || (input.role === "template" ? "通过设置页切换为模板材料" : "通过设置页切换为历史材料"),
    },
    doc.content,
  );

  const repo = new VaultRepository(input.vaultRoot);
  const materials = await repo.loadMaterials();
  const material = materials.find((item) => item.path === input.materialPath);
  if (!material) {
    throw new Error("更新后未找到材料。");
  }
  const source = typeof material.frontmatter.source === "string" ? material.frontmatter.source : "";
  const isTemplate = isTemplateMaterial({
    tags: material.tags,
    source,
    docType: material.docType,
  });
  const role = classifyMaterialRole({
    isTemplate,
    source,
    quality: material.quality,
    docType: material.docType,
    scenario: material.scenario,
  });

  return {
    path: input.materialPath,
    title: material.title,
    isTemplate,
    roleLabel: role.roleLabel,
    roleReason: role.roleReason,
    recommendTemplatePromotion:
      !isTemplate &&
      String(material.quality || "") === "high" &&
      ((material.content.match(/候选规则\s*\d+：/g) || []).length >= 2) &&
      ((material.content.match(/^##\s+/gm) || []).length >= 3),
  };
}

export async function updateMaterialRoleBatch(input: {
  vaultRoot: string;
  materialPaths: string[];
  role: "template" | "history";
  reason?: string;
  readMarkdownDocument: typeof import("../vault/markdown.js").readMarkdownDocument;
  writeMarkdownDocument: typeof import("../vault/markdown.js").writeMarkdownDocument;
}) {
  const updated = [];
  for (const materialPath of input.materialPaths) {
    updated.push(
      await updateMaterialRole({
        vaultRoot: input.vaultRoot,
        materialPath,
        role: input.role,
        reason: input.reason,
        readMarkdownDocument: input.readMarkdownDocument,
        writeMarkdownDocument: input.writeMarkdownDocument,
      }),
    );
  }
  return {
    role: input.role,
    updated,
    updatedCount: updated.length,
  };
}

export async function handleImportMaterials(input: {
  vaultRoot: string;
  body: Record<string, string | string[] | undefined>;
  createClients: () => import("../llm/openai-compatible.js").OpenAiCompatibleClient[];
  res: Parameters<typeof sendJson>[0];
}) {
  const { vaultRoot, body, createClients, res } = input;
  const uploadFiles = Array.isArray(body.uploadFiles)
    ? body.uploadFiles
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => {
          try {
            return JSON.parse(String(item)) as { name?: string; base64?: string };
          } catch {
            return null;
          }
        })
        .filter((item): item is { name?: string; base64?: string } => Boolean(item?.name && item?.base64))
    : [];
  const hasUpload = Boolean(body.uploadName && body.uploadBase64) || uploadFiles.length > 0;
  if (
    !body.docType ||
    (!body.title && !hasUpload) ||
    (!body.body && !body.sourceFile && !body.uploadName && uploadFiles.length === 0)
  ) {
    sendJson(res, 400, { error: "docType 必填；标题在手工输入时必填；正文/文件路径/浏览器上传文件至少要提供一项。" });
    return true;
  }

  const analyzer = createMaterialAnalyzer(createClients());
  const tags = normalizeTagList(body.tags);
  const isTemplate = body.isTemplate === "true" || body.mode === "template";
  if (isTemplate) {
    tags.push("template");
  }
  const commonInput = {
    vaultRoot,
    docType: String(body.docType),
    audience: typeof body.audience === "string" ? body.audience : "",
    scenario: typeof body.scenario === "string" ? body.scenario : "",
    quality: isTemplate ? "high" : typeof body.quality === "string" ? body.quality : "high",
    tags,
  };

  if (uploadFiles.length > 0) {
    const imported = [];
    for (const file of uploadFiles) {
      const rawBody = await extractTextFromBuffer({
        fileName: String(file.name),
        buffer: Buffer.from(String(file.base64), "base64"),
      });
      const derivedTitle = String(file.name).replace(/\.[^.]+$/, "");
      const analysis = rawBody
        ? await analyzer({
            title: derivedTitle,
            rawBody,
            docType: commonInput.docType,
            audience: commonInput.audience,
            scenario: commonInput.scenario,
          })
        : undefined;
      imported.push(
        await importMaterial({
          ...commonInput,
          title: derivedTitle,
          source: typeof body.source === "string" && body.source ? `${body.source} / ${file.name}` : file.name,
          body: rawBody,
          analysis,
        }),
      );
    }
    sendJson(res, 200, { imported, count: imported.length, mode: isTemplate ? "template" : "normal" });
    return true;
  }

  const uploadedBody =
    body.uploadName && body.uploadBase64
      ? await extractTextFromBuffer({
          fileName: String(body.uploadName),
          buffer: Buffer.from(String(body.uploadBase64), "base64"),
        })
      : "";
  const rawBody = (typeof body.body === "string" ? body.body : "") || uploadedBody;
  const analysis = rawBody
    ? await analyzer({
        title: String(body.title),
        rawBody,
        docType: commonInput.docType,
        audience: commonInput.audience,
        scenario: commonInput.scenario,
      })
    : undefined;

  const result = await importMaterial({
    ...commonInput,
    title: String(body.title),
    source: typeof body.source === "string" ? body.source : "",
    body: rawBody,
    sourceFile: typeof body.sourceFile === "string" && body.sourceFile ? resolve(body.sourceFile) : undefined,
    analysis,
  });

  sendJson(res, 200, result);
  return true;
}

export async function handleDeleteMaterials(input: {
  vaultRoot: string;
  body: Record<string, string | undefined>;
  res: Parameters<typeof sendJson>[0];
}) {
  const rawPath = typeof input.body.path === "string" ? input.body.path : "";
  if (!rawPath) {
    sendJson(input.res, 400, { error: "Missing material path." });
    return true;
  }
  const resolvedPath = resolve(rawPath);
  const materialsRoot = join(input.vaultRoot, "materials");
  const inMaterialsRoot =
    resolvedPath === materialsRoot ||
    resolvedPath.startsWith(`${materialsRoot}${sep}`);
  if (!inMaterialsRoot || !resolvedPath.endsWith(".md")) {
    sendJson(input.res, 400, { error: "只能删除 materials 目录下的材料或模板文件。" });
    return true;
  }
  await rm(resolvedPath, { force: false });
  sendJson(input.res, 200, { ok: true, path: resolvedPath });
  return true;
}

export async function handleDeleteMaterialsBatch(input: {
  vaultRoot: string;
  body: Record<string, string[] | undefined>;
  res: Parameters<typeof sendJson>[0];
}) {
  const rawPaths = Array.isArray(input.body.paths) ? input.body.paths.filter((item) => typeof item === "string" && item.trim()) : [];
  if (!rawPaths.length) {
    sendJson(input.res, 400, { error: "Missing material paths." });
    return true;
  }
  const materialsRoot = join(input.vaultRoot, "materials");
  const deleted: string[] = [];
  for (const rawPath of rawPaths) {
    const resolvedPath = resolve(String(rawPath));
    const inMaterialsRoot =
      resolvedPath === materialsRoot ||
      resolvedPath.startsWith(`${materialsRoot}${sep}`);
    if (!inMaterialsRoot || !resolvedPath.endsWith(".md")) {
      sendJson(input.res, 400, { error: "只能删除 materials 目录下的材料或模板文件。" });
      return true;
    }
    await rm(resolvedPath, { force: false });
    deleted.push(resolvedPath);
  }
  sendJson(input.res, 200, { ok: true, deleted, count: deleted.length });
  return true;
}

export async function handleAnalyzeMaterial(input: {
  vaultRoot: string;
  body: Record<string, string | undefined>;
  createClients: () => import("../llm/openai-compatible.js").OpenAiCompatibleClient[];
  res: Parameters<typeof sendJson>[0];
}) {
  if (!input.body.path) {
    sendJson(input.res, 400, { error: "Missing material path." });
    return true;
  }
  const materialPath = resolve(input.body.path);

  await analyzeImportedMaterial(materialPath, {
    analyze: createMaterialAnalyzer(input.createClients()),
  });
  const repo = new VaultRepository(input.vaultRoot);
  const materials = await repo.loadMaterials();
  const material = materials.find((item) => item.path === materialPath);
  if (!material) {
    sendJson(input.res, 404, { error: "Material not found after analysis." });
    return true;
  }
  const source = typeof material.frontmatter.source === "string" ? material.frontmatter.source : "";
  const isTemplate = isTemplateMaterial({
    tags: material.tags,
    source,
    docType: material.docType,
  });
  const role = classifyMaterialRole({
    isTemplate,
    source,
    quality: material.quality,
    docType: material.docType,
    scenario: material.scenario,
  });
  sendJson(input.res, 200, {
    path: materialPath,
    status: "analyzed",
    title: material.title,
    roleLabel: role.roleLabel,
    roleReason: role.roleReason,
  });
  return true;
}

export async function handleAnalyzeMaterialsBatch(input: {
  vaultRoot: string;
  body: Record<string, unknown>;
  createClients: () => import("../llm/openai-compatible.js").OpenAiCompatibleClient[];
  res: Parameters<typeof sendJson>[0];
}) {
  const paths = Array.isArray(input.body.paths) ? input.body.paths.map((item) => String(item || "")).filter(Boolean) : [];
  if (!paths.length) {
    sendJson(input.res, 400, { error: "Missing material paths." });
    return true;
  }
  const analyzer = createMaterialAnalyzer(input.createClients());
  const repo = new VaultRepository(input.vaultRoot);
  const updated = [];
  for (const item of paths) {
    const materialPath = resolve(item);
    await analyzeImportedMaterial(materialPath, { analyze: analyzer });
    const materials = await repo.loadMaterials();
    const material = materials.find((entry) => entry.path === materialPath);
    if (!material) {
      continue;
    }
    const source = typeof material.frontmatter.source === "string" ? material.frontmatter.source : "";
    const isTemplate = isTemplateMaterial({
      tags: material.tags,
      source,
      docType: material.docType,
    });
    const role = classifyMaterialRole({
      isTemplate,
      source,
      quality: material.quality,
      docType: material.docType,
      scenario: material.scenario,
    });
    updated.push({
      path: materialPath,
      title: material.title,
      roleLabel: role.roleLabel,
      roleReason: role.roleReason,
    });
  }
  sendJson(input.res, 200, { updated, updatedCount: updated.length });
  return true;
}

export async function handleUpdateMaterialRole(input: {
  vaultRoot: string;
  body: Record<string, string | undefined>;
  res: Parameters<typeof sendJson>[0];
  readMarkdownDocument: typeof import("../vault/markdown.js").readMarkdownDocument;
  writeMarkdownDocument: typeof import("../vault/markdown.js").writeMarkdownDocument;
}) {
  if (!input.body.path || !input.body.role) {
    sendJson(input.res, 400, { error: "Missing material path or role." });
    return true;
  }
  const result = await updateMaterialRole({
    vaultRoot: input.vaultRoot,
    materialPath: resolve(input.body.path),
    role: input.body.role === "template" ? "template" : "history",
    reason: typeof input.body.reason === "string" ? input.body.reason : "",
    readMarkdownDocument: input.readMarkdownDocument,
    writeMarkdownDocument: input.writeMarkdownDocument,
  });
  sendJson(input.res, 200, result);
  return true;
}

export async function handleUpdateMaterialRoleBatch(input: {
  vaultRoot: string;
  body: Record<string, unknown>;
  res: Parameters<typeof sendJson>[0];
  readMarkdownDocument: typeof import("../vault/markdown.js").readMarkdownDocument;
  writeMarkdownDocument: typeof import("../vault/markdown.js").writeMarkdownDocument;
}) {
  const paths = Array.isArray(input.body.paths) ? input.body.paths.map((item) => String(item || "")).filter(Boolean) : [];
  if (!paths.length || !input.body.role) {
    sendJson(input.res, 400, { error: "Missing material paths or role." });
    return true;
  }
  const result = await updateMaterialRoleBatch({
    vaultRoot: input.vaultRoot,
    materialPaths: paths.map((item) => resolve(item)),
    role: input.body.role === "template" ? "template" : "history",
    reason: typeof input.body.reason === "string" ? input.body.reason : "",
    readMarkdownDocument: input.readMarkdownDocument,
    writeMarkdownDocument: input.writeMarkdownDocument,
  });
  sendJson(input.res, 200, result);
  return true;
}
