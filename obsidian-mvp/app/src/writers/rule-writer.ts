import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { writeMarkdownDocument } from "../vault/markdown.js";
import type { Feedback } from "../types/domain.js";
import type { FeedbackAnalysis } from "../types/schemas.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function writeCandidateRule(input: {
  vaultRoot: string;
  feedback: Feedback;
  analysis: FeedbackAnalysis;
}): Promise<{ path: string; ruleId: string } | null> {
  if (!input.analysis.is_reusable_rule || !input.analysis.candidate_rule) {
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ruleId = `rule-${timestamp}`;
  const fileName = `${ruleId}-${slugify(input.analysis.candidate_rule.title)}.md`;
  const path = join(input.vaultRoot, "rules", fileName);

  const frontmatter = {
    id: ruleId,
    title: input.analysis.candidate_rule.title,
    status: "candidate",
    priority: "medium",
    scope: input.analysis.candidate_rule.scope,
    doc_types: input.analysis.candidate_rule.doc_types,
    audiences: input.analysis.candidate_rule.audiences,
    source_materials: [],
    confidence: input.analysis.candidate_rule.confidence,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const content = `# 规则内容

${input.analysis.candidate_rule.content}

# 规则分类

- 类型：待人工确认
- 适用范围：${input.analysis.candidate_rule.scope || "待补充"}
- 优先级：medium

# 来源依据

- 来自哪些历史材料：待补充
- 来自哪些反馈记录：${input.feedback.id}
- 典型例子：${input.analysis.feedback_summary}

# 触发条件

- 什么时候应该使用这条规则：待人工确认
- 哪些场景不适用：待人工确认

# 正反例

## 正例

- 待补充

## 反例

- 待补充

# 确认记录

- 是否已被人工确认：否
- 最近一次验证任务：${input.feedback.taskId || "未关联"}
- 最近一次命中效果：待验证

# 备注

- reasoning：${input.analysis.reasoning}
- suggested_update：${input.analysis.suggested_update}
`;

  await mkdir(dirname(path), { recursive: true });
  await writeMarkdownDocument(path, frontmatter, content);
  return { path, ruleId };
}
