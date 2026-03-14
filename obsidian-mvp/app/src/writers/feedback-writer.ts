import { writeMarkdownDocument } from "../vault/markdown.js";
import type { Feedback } from "../types/domain.js";
import type { FeedbackAnalysis } from "../types/schemas.js";

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function replaceSimpleListItem(content: string, prefix: string, value: string): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^- ${escaped}.*$`, "m");
  const nextLine = `- ${prefix}${value}`;

  if (pattern.test(content)) {
    return content.replace(pattern, nextLine);
  }

  return `${content.trim()}\n${nextLine}\n`;
}

export async function writeFeedbackResult(input: {
  feedback: Feedback;
  analysis: FeedbackAnalysis;
  ruleId: string | null;
}): Promise<void> {
  const nextFrontmatter = {
    ...input.feedback.frontmatter,
    feedback_type: input.analysis.feedback_type,
    related_rule_ids: uniqueStrings([
      ...(Array.isArray(input.feedback.frontmatter.related_rule_ids)
        ? input.feedback.frontmatter.related_rule_ids.filter((item): item is string => typeof item === "string")
        : []),
      ...(input.ruleId ? [input.ruleId] : []),
    ]),
  };

  let nextContent = input.feedback.content;
  nextContent = replaceSimpleListItem(nextContent, "属于：", input.analysis.feedback_type);
  nextContent = replaceSimpleListItem(
    nextContent,
    "这是一次性修改还是长期偏好：",
    input.analysis.is_reusable_rule ? "建议作为长期规则候选" : "更像一次性修改",
  );
  nextContent = replaceSimpleListItem(
    nextContent,
    "可提炼规则：",
    input.analysis.candidate_rule?.content ?? "无",
  );
  nextContent = replaceSimpleListItem(
    nextContent,
    "是否建议入库：",
    input.analysis.is_reusable_rule ? "是" : "否",
  );
  nextContent = replaceSimpleListItem(
    nextContent,
    "推荐适用场景：",
    input.analysis.candidate_rule?.scope ?? "无",
  );
  nextContent = replaceSimpleListItem(nextContent, "本次如何修改：", input.analysis.suggested_update);
  nextContent = replaceSimpleListItem(
    nextContent,
    "是否转为规则：",
    input.ruleId ? "已生成候选规则" : "未生成规则",
  );
  nextContent = replaceSimpleListItem(
    nextContent,
    "如转规则，对应 rule id：",
    input.ruleId ?? "无",
  );

  await writeMarkdownDocument(input.feedback.path, nextFrontmatter, nextContent);
}
