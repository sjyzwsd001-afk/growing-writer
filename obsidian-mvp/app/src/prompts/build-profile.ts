import type { Feedback, Material, Rule } from "../types/domain.js";
import { normalizeFeedback, normalizeRule } from "../types/normalize.js";

function trimRule(rule: Rule) {
  const normalized = normalizeRule(rule);
  return {
    id: normalized.id,
    title: normalized.title,
    scope: normalized.scope,
    doc_types: normalized.docTypes,
    audiences: normalized.audiences,
    confidence: normalized.confidence,
    content: rule.content.slice(0, 1000),
  };
}

function trimMaterial(material: Material) {
  return {
    id: material.id,
    title: material.title,
    doc_type: material.docType,
    audience: material.audience,
    scenario: material.scenario,
    quality: material.quality,
    tags: material.tags,
    snippet: material.content.slice(0, 800),
  };
}

function trimFeedback(feedback: Feedback) {
  const normalized = normalizeFeedback(feedback);
  return {
    id: normalized.id,
    task_id: normalized.taskId,
    feedback_type: normalized.feedbackType,
    related_rule_ids: normalized.relatedRuleIds,
    snippet: feedback.content.slice(0, 600),
  };
}

export function buildProfilePrompt(input: {
  confirmedRules: Rule[];
  materials: Material[];
  feedbackEntries: Feedback[];
}): string {
  return `请根据“已确认规则 + 历史材料 + 用户反馈”生成可执行的写作画像摘要。

要求：
1. 只提炼稳定、可复用偏好，不要输出一次性偶然意见。
2. 如果某个结论证据不足，要放进 pending_observations。
3. 输出内容要能直接指导后续写作（结构、语气、禁忌、分场景差异）。
4. 不要编造不存在的规则或事实。
5. 只输出 JSON。

输入数据：
已确认规则：
${JSON.stringify(input.confirmedRules.slice(0, 30).map(trimRule), null, 2)}

历史材料（抽样）：
${JSON.stringify(input.materials.slice(0, 24).map(trimMaterial), null, 2)}

反馈记录（抽样）：
${JSON.stringify(input.feedbackEntries.slice(0, 40).map(trimFeedback), null, 2)}`;
}
