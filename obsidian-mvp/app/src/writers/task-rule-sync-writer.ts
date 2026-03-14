import { writeMarkdownDocument } from "../vault/markdown.js";
import type { Task } from "../types/domain.js";

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export async function syncRuleInTasks(input: {
  tasks: Task[];
  ruleId: string;
  enabled: boolean;
}): Promise<string[]> {
  const updated: string[] = [];

  for (const task of input.tasks) {
    const existing = Array.isArray(task.frontmatter.matched_rules)
      ? task.frontmatter.matched_rules.filter((item): item is string => typeof item === "string")
      : [];

    const hasRule = existing.includes(input.ruleId);
    const nextMatchedRules = input.enabled
      ? uniqueStrings([...existing, input.ruleId])
      : existing.filter((item) => item !== input.ruleId);

    if ((input.enabled && hasRule && nextMatchedRules.length === existing.length) || (!input.enabled && !hasRule)) {
      continue;
    }

    const nextFrontmatter = {
      ...task.frontmatter,
      matched_rules: nextMatchedRules,
    };

    await writeMarkdownDocument(task.path, nextFrontmatter, task.content);
    updated.push(task.path);
  }

  return updated;
}
