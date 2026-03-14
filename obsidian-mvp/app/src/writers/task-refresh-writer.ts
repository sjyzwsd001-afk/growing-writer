import { writeMarkdownDocument } from "../vault/markdown.js";
import type { Material, MatchedRule, Task } from "../types/domain.js";
import { writeTaskSections } from "./task-writer.js";

export async function refreshTaskReferences(input: {
  task: Task;
  matchedRules: MatchedRule[];
  matchedMaterials: Material[];
}): Promise<void> {
  const nextFrontmatter = {
    ...input.task.frontmatter,
    matched_rules: input.matchedRules.map((rule) => rule.rule_id),
  };

  await writeMarkdownDocument(input.task.path, nextFrontmatter, input.task.content);

  await writeTaskSections({
    task: {
      ...input.task,
      frontmatter: nextFrontmatter,
    },
    matchedRules: input.matchedRules,
    matchedMaterials: input.matchedMaterials,
  });
}
