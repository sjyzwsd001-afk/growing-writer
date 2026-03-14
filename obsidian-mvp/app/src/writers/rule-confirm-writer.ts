import { join } from "node:path";

import { writeMarkdownDocument } from "../vault/markdown.js";
import type { Profile, Rule } from "../types/domain.js";

function replaceLine(content: string, prefix: string, value: string): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^- ${escaped}.*$`, "m");
  const nextLine = `- ${prefix}${value}`;

  if (pattern.test(content)) {
    return content.replace(pattern, nextLine);
  }

  return `${content.trim()}\n${nextLine}\n`;
}

function ensureBulletInSection(content: string, sectionHeading: string, bullet: string): string {
  const escaped = sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionPattern = new RegExp(`(^## ${escaped}\\n\\n)([\\s\\S]*?)(?=\\n## |$)`, "m");

  if (!sectionPattern.test(content)) {
    return `${content.trim()}\n\n## ${sectionHeading}\n\n- ${bullet}\n`;
  }

  return content.replace(sectionPattern, (match, header: string, body: string) => {
    const lines = body
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    if (lines.includes(`- ${bullet}`)) {
      return `${header}${body}`;
    }

    const cleaned = lines.filter((line) => line !== "-" && line !== "- ");
    cleaned.push(`- ${bullet}`);
    return `${header}${cleaned.join("\n")}\n\n`;
  });
}

function removeBulletFromSection(content: string, sectionHeading: string, bullet: string): string {
  const escaped = sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionPattern = new RegExp(`(^## ${escaped}\\n\\n)([\\s\\S]*?)(?=\\n## |$)`, "m");

  if (!sectionPattern.test(content)) {
    return content;
  }

  return content.replace(sectionPattern, (match, header: string, body: string) => {
    const lines = body
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0 && line !== `- ${bullet}`);

    const normalized = lines.length ? lines.join("\n") : "-";
    return `${header}${normalized}\n\n`;
  });
}

function applyStatusReason(content: string, reason?: string): string {
  if (!reason) {
    return content;
  }
  return replaceLine(content, "状态变更原因：", reason);
}

export async function confirmRule(rule: Rule, reason?: string): Promise<Rule> {
  const now = new Date().toISOString();
  const nextFrontmatter = {
    ...rule.frontmatter,
    status: "confirmed",
    updated_at: now,
    confirmed_at: now,
    status_reason: reason ?? rule.frontmatter.status_reason,
  };

  let nextContent = rule.content;
  nextContent = replaceLine(nextContent, "是否已被人工确认：", "是");
  nextContent = replaceLine(nextContent, "最近一次命中效果：", "已确认，待后续任务验证");
  nextContent = applyStatusReason(nextContent, reason);

  await writeMarkdownDocument(rule.path, nextFrontmatter, nextContent);

  return {
    ...rule,
    frontmatter: nextFrontmatter,
    content: nextContent,
    status: "confirmed",
  };
}

async function updateRuleStatus(
  rule: Rule,
  status: Rule["status"],
  effect: string,
  reason?: string,
): Promise<Rule> {
  const now = new Date().toISOString();
  const nextFrontmatter = {
    ...rule.frontmatter,
    status,
    updated_at: now,
    status_reason: reason ?? rule.frontmatter.status_reason,
  };

  let nextContent = rule.content;
  nextContent = replaceLine(nextContent, "是否已被人工确认：", status === "confirmed" ? "是" : "否");
  nextContent = replaceLine(nextContent, "最近一次命中效果：", effect);
  nextContent = applyStatusReason(nextContent, reason);

  await writeMarkdownDocument(rule.path, nextFrontmatter, nextContent);

  return {
    ...rule,
    frontmatter: nextFrontmatter,
    content: nextContent,
    status,
  };
}

export async function rejectRule(rule: Rule, reason?: string): Promise<Rule> {
  return updateRuleStatus(rule, "disabled", "已拒绝，不纳入稳定规则", reason);
}

export async function disableRule(rule: Rule, reason?: string): Promise<Rule> {
  return updateRuleStatus(rule, "disabled", "已停用，待后续重新评估", reason);
}

export async function updateDefaultProfileWithRule(input: {
  vaultRoot: string;
  rule: Rule;
  profiles: Profile[];
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
      content: `# 写作画像

## 总体风格

- 语气特点：
- 句式特点：
- 常见篇幅：
- 偏好详略：

## 结构习惯

- 开头通常怎么写：
- 主体通常怎么展开：
- 结尾通常怎么收：

## 高优先级偏好

- 

## 常见禁忌

- 

## 分场景差异

### 领导汇报

- 

### 方案材料

- 

### 总结复盘

- 

## 当前稳定规则摘要

- 

## 待确认观察

- `,
      id: "profile-default",
      name: "default",
      version: 1,
    } satisfies Profile);

  const bullet = `${input.rule.title} (${input.rule.id})`;
  const nextFrontmatter = {
    ...profile.frontmatter,
    updated_at: now,
  };
  const nextContent = ensureBulletInSection(profile.content, "当前稳定规则摘要", bullet);
  await writeMarkdownDocument(profile.path, nextFrontmatter, nextContent);
  return profile.path;
}

export async function removeRuleFromDefaultProfile(input: {
  vaultRoot: string;
  rule: Rule;
  profiles: Profile[];
}): Promise<string | null> {
  const profile = input.profiles[0];
  if (!profile) {
    return null;
  }

  const bullet = `${input.rule.title} (${input.rule.id})`;
  const nextFrontmatter = {
    ...profile.frontmatter,
    updated_at: new Date().toISOString(),
  };
  const nextContent = removeBulletFromSection(profile.content, "当前稳定规则摘要", bullet);
  await writeMarkdownDocument(profile.path, nextFrontmatter, nextContent);
  return profile.path;
}
