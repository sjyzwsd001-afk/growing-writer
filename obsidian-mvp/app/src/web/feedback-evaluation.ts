import { readMarkdownDocument, replaceSection, writeMarkdownDocument } from "../vault/markdown.js";

export type FeedbackAbsorptionEvaluation = {
  score: number;
  level: string;
  absorbed: boolean;
  notes: string[];
  changedRatio: number;
  keywordHitRatio: number;
};

function extractKeywords(text: string): string[] {
  const raw = text
    .toLowerCase()
    .split(/[\s,.;:!?，。；：！？、（）()\[\]{}"'`~\-_/\\]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return [...new Set(raw)].slice(0, 20);
}

function normalizeTextForCompare(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function tokenSet(text: string): Set<string> {
  return new Set(extractKeywords(text));
}

export function evaluateFeedbackAbsorption(input: {
  beforeDraft: string;
  afterDraft: string;
  reason: string;
  comment: string;
  selectedText: string;
}): FeedbackAbsorptionEvaluation {
  const before = normalizeTextForCompare(input.beforeDraft || "");
  const after = normalizeTextForCompare(input.afterDraft || "");
  const reasonText = `${input.reason || ""} ${input.comment || ""}`.trim();
  const notes: string[] = [];
  if (!after) {
    return {
      score: 0,
      level: "weak",
      absorbed: false,
      notes: ["再生成结果为空，无法判定反馈吸收情况。"],
      changedRatio: 0,
      keywordHitRatio: 0,
    };
  }

  const beforeTokens = tokenSet(before);
  const afterTokens = tokenSet(after);
  const union = new Set([...beforeTokens, ...afterTokens]);
  let overlap = 0;
  for (const token of beforeTokens) {
    if (afterTokens.has(token)) {
      overlap += 1;
    }
  }
  const changedRatio = union.size ? 1 - overlap / union.size : before === after ? 0 : 1;
  let score = 40 + changedRatio * 30;

  if (before === after) {
    score = 5;
    notes.push("改前改后正文无变化。");
  } else {
    notes.push(`正文变化比例约 ${(changedRatio * 100).toFixed(1)}%。`);
  }

  const keywords = extractKeywords(reasonText);
  let keywordHits = 0;
  for (const keyword of keywords) {
    if (after.includes(keyword) && !before.includes(keyword)) {
      keywordHits += 1;
    }
  }
  const keywordHitRatio = keywords.length ? keywordHits / keywords.length : 0;
  score += keywordHitRatio * 20;
  if (keywords.length) {
    notes.push(`反馈关键词新增命中 ${keywordHits}/${keywords.length}。`);
  }

  if (input.selectedText) {
    const selected = normalizeTextForCompare(input.selectedText);
    if (selected && !after.includes(selected)) {
      score += 12;
      notes.push("选区原文已被改写。");
    } else if (selected && after.includes(selected) && before.includes(selected)) {
      score -= 6;
      notes.push("选区原文仍基本保持不变。");
    }
  }

  if (/补充|具体|数据|量化|完善|展开/.test(reasonText)) {
    if (after.length > before.length * 1.02) {
      score += 8;
      notes.push("正文长度增长，符合“补充/展开”倾向。");
    }
  }
  if (/精简|简洁|压缩|删减/.test(reasonText)) {
    if (after.length < before.length * 0.98) {
      score += 8;
      notes.push("正文长度收敛，符合“精简”倾向。");
    }
  }

  score = Math.max(0, Math.min(100, Number(score.toFixed(1))));
  const level = score >= 80 ? "strong" : score >= 60 ? "partial" : "weak";
  const absorbed = level !== "weak";
  return {
    score,
    level,
    absorbed,
    notes,
    changedRatio: Number(changedRatio.toFixed(3)),
    keywordHitRatio: Number(keywordHitRatio.toFixed(3)),
  };
}

export async function persistFeedbackEvaluation(input: {
  feedbackPath: string;
  evaluation: FeedbackAbsorptionEvaluation;
}) {
  const doc = await readMarkdownDocument(input.feedbackPath);
  const now = new Date().toISOString();
  const nextFrontmatter = {
    ...doc.frontmatter,
    absorption_score: input.evaluation.score,
    absorption_level: input.evaluation.level,
    absorption_updated_at: now,
  };
  const evaluationBody = [
    `- 评分：${input.evaluation.score}`,
    `- 等级：${input.evaluation.level}`,
    `- 是否吸收：${input.evaluation.absorbed ? "是" : "否"}`,
    `- 正文变化比例：${input.evaluation.changedRatio}`,
    `- 关键词命中比例：${input.evaluation.keywordHitRatio}`,
    `- 评估时间：${now}`,
    `- 说明：${input.evaluation.notes.join("；") || "无"}`,
  ].join("\n");
  const nextContent = replaceSection(doc.content, "学习评估", evaluationBody);
  await writeMarkdownDocument(doc.path, nextFrontmatter, nextContent);
}
