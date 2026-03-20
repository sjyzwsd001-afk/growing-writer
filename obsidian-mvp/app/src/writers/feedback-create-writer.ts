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
  selectedText?: string;
  selectionStart?: number;
  selectionEnd?: number;
  annotations?: Array<{
    location?: string;
    reason?: string;
    comment?: string;
    isReusable?: boolean;
    priority?: string;
    selectedText?: string;
    selectionStart?: number;
    selectionEnd?: number;
  }>;
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
    affected_paragraph: input.affectedParagraph ?? "",
    affected_section: input.affectedSection ?? "",
    affects_structure: input.affectsStructure ?? "",
    selected_text: input.selectedText ?? "",
    selection_start: typeof input.selectionStart === "number" ? input.selectionStart : null,
    selection_end: typeof input.selectionEnd === "number" ? input.selectionEnd : null,
    annotation_count: Array.isArray(input.annotations) ? input.annotations.length : 0,
    created_at: now,
  };

  const annotationLines = Array.isArray(input.annotations) && input.annotations.length
    ? input.annotations.flatMap((item, index) => [
        `- 批注 ${index + 1}`,
        `  - 位置：${item.location ?? ""}`,
        `  - 原因：${item.reason ?? ""}`,
        `  - 说明：${item.comment ?? ""}`,
        `  - 偏好类型：${item.isReusable ? "长期偏好" : "本次修改"}`,
        `  - 优先级：${item.priority ?? "medium"}`,
        `  - 选区偏移：${typeof item.selectionStart === "number" && typeof item.selectionEnd === "number" ? `${item.selectionStart}-${item.selectionEnd}` : ""}`,
        `  - 选区原文：${item.selectedText ?? ""}`,
      ]).join("\n")
    : "- ";

  const content = `# 原始反馈

${input.rawFeedback.trim()}

# 反馈分类

- 属于：${input.feedbackType ?? ""}
- 这是一次性修改还是长期偏好：

# 影响位置

- 影响段落：${input.affectedParagraph ?? ""}
- 影响章节：${input.affectedSection ?? ""}
- 影响整体结构：${input.affectsStructure ?? ""}
- 选区偏移：${typeof input.selectionStart === "number" && typeof input.selectionEnd === "number" ? `${input.selectionStart}-${input.selectionEnd}` : ""}
- 选区原文：${input.selectedText ?? ""}

# 本轮批注清单

${annotationLines}

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
