import { writeMarkdownDocument } from "../vault/markdown.js";
import type { Task } from "../types/domain.js";

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export async function attachRuleToTask(input: {
  task: Task;
  ruleId: string | null;
  feedbackId: string;
}): Promise<void> {
  if (!input.ruleId) {
    return;
  }

  const currentMatchedRules = Array.isArray(input.task.frontmatter.matched_rules)
    ? input.task.frontmatter.matched_rules.filter((item): item is string => typeof item === "string")
    : [];

  const nextFrontmatter = {
    ...input.task.frontmatter,
    matched_rules: uniqueStrings([...currentMatchedRules, input.ruleId]),
  };

  const addition = `- feedback ${input.feedbackId} -> candidate rule ${input.ruleId}`;
  const marker = "# 修改记录";
  let nextContent = input.task.content;

  if (nextContent.includes(addition)) {
    await writeMarkdownDocument(input.task.path, nextFrontmatter, nextContent);
    return;
  }

  if (nextContent.includes(marker)) {
    nextContent = nextContent.replace(marker, `${marker}\n\n${addition}`);
  } else {
    nextContent = `${nextContent.trim()}\n\n# 修改记录\n\n${addition}\n`;
  }

  await writeMarkdownDocument(input.task.path, nextFrontmatter, nextContent);
}
