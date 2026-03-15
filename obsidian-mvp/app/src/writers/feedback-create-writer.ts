import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { writeMarkdownDocument } from "../vault/markdown.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function createFeedback(input: {
  vaultRoot: string;
  taskId?: string;
  feedbackType?: string;
  severity?: string;
  action?: string;
  rawFeedback: string;
  affectedParagraph?: string;
  affectedSection?: string;
  affectsStructure?: string;
}): Promise<{ path: string; feedbackId: string }> {
  const now = new Date().toISOString();
  const timestamp = now.replace(/[:.]/g, "-");
  const feedbackId = `feedback-${timestamp}`;
  const fileName = `${feedbackId}-${slugify(input.rawFeedback.slice(0, 20) || "new-feedback")}.md`;
  const path = join(input.vaultRoot, "feedback", fileName);

  const frontmatter = {
    id: feedbackId,
    task_id: input.taskId ?? "",
    related_rule_ids: [],
    feedback_type: input.feedbackType ?? "",
    severity: input.severity ?? "medium",
    action: input.action ?? "review",
    created_at: now,
  };

  const content = `# 原始反馈

${input.rawFeedback.trim()}

# 反馈分类

- 属于：${input.feedbackType ?? ""}
- 这是一次性修改还是长期偏好：

# 影响位置

- 影响段落：${input.affectedParagraph ?? ""}
- 影响章节：${input.affectedSection ?? ""}
- 影响整体结构：${input.affectsStructure ?? ""}

# 系统建议提炼

- 可提炼规则：
- 是否建议入库：
- 推荐适用场景：

# 最终处理结果

- 本次如何修改：
- 是否转为规则：
- 如转规则，对应 rule id：

# 备注

- `;

  await mkdir(dirname(path), { recursive: true });
  await writeMarkdownDocument(path, frontmatter, content);
  return { path, feedbackId };
}
