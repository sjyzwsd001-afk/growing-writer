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

function buildProfileContentFallback(rules: Rule[]): string {
  const confirmedRules = rules.filter((rule) => rule.status === "confirmed");
  const highPriority = dedupe(confirmedRules.map(extractPreference));
  const taboos = dedupe(confirmedRules.flatMap(extractTaboo));
  const stable = dedupe(confirmedRules.map((rule) => `${rule.title} (${rule.id})`));
  const leadership = dedupe(confirmedRules.flatMap((rule) => extractSceneRule(rule, "领导")));
  const proposals = dedupe(confirmedRules.flatMap((rule) => extractSceneRule(rule, "方案")));
  const reviews = dedupe(confirmedRules.flatMap((rule) => extractSceneRule(rule, "复盘")));

  return `# 写作画像

## 总体风格

- 语气特点：以正式、客观、可交付表达为主
- 句式特点：优先完整陈述句，避免碎片化口语表达
- 常见篇幅：根据任务场景调整，倾向先成结构再补细节
- 偏好详略：先结论后展开，重点信息优先

## 结构习惯

- 开头通常怎么写：先交代背景、任务目标或总体判断
- 主体通常怎么展开：按事实、分析、措施或安排展开
- 结尾通常怎么收：落到结论、态度或下一步动作

## 高优先级偏好

${listOrPlaceholder(highPriority).map((item) => `- ${item}`).join("\n")}

## 常见禁忌

${listOrPlaceholder(taboos).map((item) => `- ${item}`).join("\n")}

## 分场景差异

### 领导汇报

${listOrPlaceholder(leadership).map((item) => `- ${item}`).join("\n")}

### 方案材料

${listOrPlaceholder(proposals).map((item) => `- ${item}`).join("\n")}

### 总结复盘

${listOrPlaceholder(reviews).map((item) => `- ${item}`).join("\n")}

## 当前稳定规则摘要

${listOrPlaceholder(stable).map((item) => `- ${item}`).join("\n")}

## 待确认观察

- `;
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
    updated_at: now,
    generated_by: llmContent ? "llm" : "fallback",
  };
  const nextContent = llmContent ?? buildProfileContentFallback(input.rules);
  await writeMarkdownDocument(profile.path, nextFrontmatter, nextContent);
  return profile.path;
}
