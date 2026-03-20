import { join } from "node:path";

import { OpenAiCompatibleClient } from "../llm/openai-compatible.js";
import { buildProfilePrompt } from "../prompts/build-profile.js";
import { BASE_SYSTEM_PROMPT } from "../prompts/common.js";
import type { Feedback, Material, Profile, Rule } from "../types/domain.js";
import { profileSummarySchema, type ProfileSummary } from "../types/schemas.js";
import { writeMarkdownDocument } from "../vault/markdown.js";

function listOrPlaceholder(items: string[]): string[] {
  return items.length ? items : [""];
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function extractPreference(rule: Rule): string {
  return `${rule.title}：${String(rule.frontmatter.scope ?? rule.scope ?? "通用规则")}`;
}

function extractTaboo(rule: Rule): string[] {
  const content = rule.content;
  const results: string[] = [];
  if (/避免|不要/.test(content)) {
    results.push(`${rule.title}：关注避免口语化、空泛表述或结构缺失`);
  }
  return results;
}

function extractSceneRule(rule: Rule, scene: string): string[] {
  return rule.audiences.includes(scene) || rule.content.includes(scene) ? [rule.title] : [];
}

function extractFeedbackReason(feedback: Feedback): string {
  const rawSection = feedback.content.match(/# 原始反馈\s*\n+([\s\S]*?)(?=\n# |\Z)/)?.[1]?.trim();
  if (rawSection) {
    return rawSection.replace(/\s+/g, " ").trim();
  }
  const match = feedback.content.match(/修改原因：(.+)/);
  return match?.[1]?.trim() || "";
}

function extractFeedbackSuggestion(feedback: Feedback): string {
  const match = feedback.content.match(/本次如何修改：(.+)/);
  const value = match?.[1]?.trim() || "";
  return /LLM|候选规则|待补充|待人工确认/.test(value) ? "" : value;
}

function extractMaterialCoreText(material: Material): string {
  const rawContentSection = material.content.match(/# 原文内容\s*\n+([\s\S]*?)(?=\n# |\Z)/)?.[1]?.trim();
  if (rawContentSection) {
    return rawContentSection;
  }
  return material.content
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^#\s+文档信息[\s\S]*?(?=^#\s+|\Z)/m, "")
    .trim();
}

function extractMaterialStructureHint(material: Material, heading: "主体结构" | "结尾功能"): string {
  const match = material.content.match(new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=^##\\s+|^#\\s+|\\Z)`, "m"));
  if (!match?.[1]) {
    return "";
  }
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("- ") && !/待补充|待人工确认/.test(line))
    ?.replace(/^- /, "")
    .trim() || "";
}

function extractMaterialSignal(materials: Material[], type: "opening" | "body" | "ending"): string {
  for (const material of materials) {
    const coreLines = extractMaterialCoreText(material)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (type === "opening" && coreLines[0]) {
      return coreLines[0];
    }
    if (type === "body") {
      const hint = extractMaterialStructureHint(material, "主体结构");
      if (hint) {
        return hint;
      }
      if (coreLines.length > 1) {
        return coreLines.slice(0, 2).join(" / ");
      }
    }
    if (type === "ending") {
      const hint = extractMaterialStructureHint(material, "结尾功能");
      if (hint) {
        return hint;
      }
      if (coreLines[coreLines.length - 1]) {
        return coreLines[coreLines.length - 1];
      }
    }
  }
  return "";
}

function buildProfileContentFallback(input: {
  rules: Rule[];
  materials: Material[];
  feedbackEntries: Feedback[];
}): string {
  const confirmedRules = input.rules.filter((rule) => rule.status === "confirmed");
  const highPriority = dedupe(confirmedRules.map(extractPreference));
  const taboos = dedupe(confirmedRules.flatMap(extractTaboo));
  const stable = dedupe(confirmedRules.map((rule) => `${rule.title} (${rule.id})`));
  const leadership = dedupe(confirmedRules.flatMap((rule) => extractSceneRule(rule, "领导")));
  const proposals = dedupe(confirmedRules.flatMap((rule) => extractSceneRule(rule, "方案")));
  const reviews = dedupe(confirmedRules.flatMap((rule) => extractSceneRule(rule, "复盘")));
  const feedbackReasons = dedupe(input.feedbackEntries.map(extractFeedbackReason).filter(Boolean));
  const feedbackSuggestions = dedupe(input.feedbackEntries.map(extractFeedbackSuggestion).filter(Boolean));
  const templateTitles = dedupe(
    input.materials
      .filter((material) => material.tags.some((tag) => /template|模板/i.test(tag)) || /模板/i.test(material.docType))
      .map((material) => material.title),
  );
  const openingSignal = extractMaterialSignal(input.materials, "opening");
  const bodySignal = extractMaterialSignal(input.materials, "body");
  const endingSignal = extractMaterialSignal(input.materials, "ending");
  const materialTone = input.materials.some((material) => material.audience.includes("领导"))
    ? "偏正式、偏汇报，强调结论前置和决策支撑"
    : "偏正式、客观，优先保证信息完整和结构清楚";

  return `# 写作画像

## 总体风格

- 语气特点：${materialTone}
- 句式特点：优先完整陈述句，避免碎片化口语表达
- 常见篇幅：根据任务场景调整，倾向先成结构再补细节
- 偏好详略：先结论后展开，重点信息优先

## 结构习惯

- 开头通常怎么写：${openingSignal || "先交代背景、任务目标或总体判断"}
- 主体通常怎么展开：${bodySignal || "按事实、分析、措施或安排展开"}
- 结尾通常怎么收：${endingSignal || "落到结论、态度或下一步动作"}

## 高优先级偏好

${listOrPlaceholder(dedupe([...highPriority, ...feedbackSuggestions]).slice(0, 8)).map((item) => `- ${item}`).join("\n")}

## 常见禁忌

${listOrPlaceholder(dedupe([...taboos, ...feedbackReasons.filter((item) => /空泛|顺序|逻辑|遗漏|不对/.test(item)).map((item) => `反馈反复指出：${item}`)]).slice(0, 8)).map((item) => `- ${item}`).join("\n")}

## 分场景差异

### 领导汇报

${listOrPlaceholder(dedupe([...leadership, ...input.materials.filter((material) => material.audience.includes("领导")).map((material) => material.title)]).slice(0, 6)).map((item) => `- ${item}`).join("\n")}

### 方案材料

${listOrPlaceholder(dedupe([...proposals, ...input.materials.filter((material) => /方案|计划/.test(material.docType + material.scenario)).map((material) => material.title)]).slice(0, 6)).map((item) => `- ${item}`).join("\n")}

### 总结复盘

${listOrPlaceholder(dedupe([...reviews, ...input.materials.filter((material) => /复盘|总结/.test(material.docType + material.scenario)).map((material) => material.title)]).slice(0, 6)).map((item) => `- ${item}`).join("\n")}

## 当前稳定规则摘要

${listOrPlaceholder(dedupe([...stable, ...templateTitles.map((item) => `高权重模板：${item}`)]).slice(0, 8)).map((item) => `- ${item}`).join("\n")}

## 待确认观察

${listOrPlaceholder(feedbackReasons.slice(0, 6)).map((item) => `- ${item}`).join("\n")}
`;
}

function buildProfileContentFromLlm(summary: ProfileSummary): string {
  return `# 写作画像

## 总体风格

- 语气特点：${summary.overall_style.tone}
- 句式特点：${summary.overall_style.sentence_style}
- 常见篇幅：${summary.overall_style.typical_length}
- 偏好详略：${summary.overall_style.detail_preference}

## 结构习惯

- 开头通常怎么写：${summary.structure_habits.opening}
- 主体通常怎么展开：${summary.structure_habits.body}
- 结尾通常怎么收：${summary.structure_habits.ending}

## 高优先级偏好

${listOrPlaceholder(summary.high_priority_preferences).map((item) => `- ${item}`).join("\n")}

## 常见禁忌

${listOrPlaceholder(summary.common_taboos).map((item) => `- ${item}`).join("\n")}

## 分场景差异

### 领导汇报

${listOrPlaceholder(summary.scenario_guidance.leadership_report).map((item) => `- ${item}`).join("\n")}

### 方案材料

${listOrPlaceholder(summary.scenario_guidance.proposal_doc).map((item) => `- ${item}`).join("\n")}

### 总结复盘

${listOrPlaceholder(summary.scenario_guidance.review_doc).map((item) => `- ${item}`).join("\n")}

## 当前稳定规则摘要

${listOrPlaceholder(summary.stable_rule_summary).map((item) => `- ${item}`).join("\n")}

## 待确认观察

${listOrPlaceholder(summary.pending_observations).map((item) => `- ${item}`).join("\n")}
`;
}

async function buildProfileContentWithLlm(input: {
  client: OpenAiCompatibleClient;
  rules: Rule[];
  materials: Material[];
  feedbackEntries: Feedback[];
}): Promise<string | null> {
  if (!input.client.isEnabled()) {
    return null;
  }

  const confirmedRules = input.rules.filter((rule) => rule.status === "confirmed");
  if (!confirmedRules.length) {
    return null;
  }

  try {
    const summary = await input.client.generateJson({
      system: BASE_SYSTEM_PROMPT,
      user: buildProfilePrompt({
        confirmedRules,
        materials: input.materials,
        feedbackEntries: input.feedbackEntries,
      }),
      schema: profileSummarySchema,
    });

    return buildProfileContentFromLlm(summary);
  } catch {
    return null;
  }
}

export async function refreshDefaultProfile(input: {
  vaultRoot: string;
  profiles: Profile[];
  rules: Rule[];
  materials?: Material[];
  feedbackEntries?: Feedback[];
  client?: OpenAiCompatibleClient;
}): Promise<string> {
  const now = new Date().toISOString();
  const profile =
    input.profiles[0] ??
    ({
      path: join(input.vaultRoot, "profiles", "default-profile.md"),
      frontmatter: {
        id: "profile-default",
        name: "default",
        version: 1,
        updated_at: now,
      },
      content: "",
      id: "profile-default",
      name: "default",
      version: 1,
    } satisfies Profile);

  const llmContent =
    input.client
      ? await buildProfileContentWithLlm({
          client: input.client,
          rules: input.rules,
          materials: input.materials ?? [],
          feedbackEntries: input.feedbackEntries ?? [],
        })
      : null;

  const nextFrontmatter = {
    ...profile.frontmatter,
    version: Number(profile.frontmatter.version ?? profile.version ?? 1) + (profile.content ? 1 : 0),
    updated_at: now,
    generated_by: llmContent ? "llm" : "fallback",
    source_stats: {
      confirmed_rules: input.rules.filter((rule) => rule.status === "confirmed").length,
      materials: (input.materials ?? []).length,
      feedback_entries: (input.feedbackEntries ?? []).length,
    },
  };
  const nextContent =
    llmContent ??
    buildProfileContentFallback({
      rules: input.rules,
      materials: input.materials ?? [],
      feedbackEntries: input.feedbackEntries ?? [],
    });
  await writeMarkdownDocument(profile.path, nextFrontmatter, nextContent);
  return profile.path;
}
