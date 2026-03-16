import { replaceSection, writeMarkdownDocument } from "../vault/markdown.js";
import type { DiagnosisResult, DraftResult, OutlineResult } from "../types/schemas.js";
import type { Material, MatchedRule, Task } from "../types/domain.js";

function renderDiagnosis(result: DiagnosisResult): string {
  const structure = result.recommended_structure
    .map(
      (item) =>
        `- ${item.section}：${item.purpose}\n  - 必须覆盖：${item.must_cover.join("、") || "无"}`,
    )
    .join("\n");
  return [
    `- 就绪度：${result.readiness}`,
    `- 诊断摘要：${result.diagnosis_summary}`,
    `- 缺失信息：${result.missing_info.join("；") || "无"}`,
    `- 写作风险：${result.writing_risks.join("；") || "无"}`,
    "",
    "### 建议结构",
    "",
    structure,
    "",
    `- 下一步：${result.next_action}`,
  ].join("\n");
}

function renderOutline(result: OutlineResult): string {
  return result.sections
    .map(
      (section, index) =>
        `${index + 1}. ${section.heading}\n` +
        `- 目的：${section.purpose}\n` +
        `- 关键点：${section.key_points.join("、") || "无"}\n` +
        `- 依据：${section.source_basis.join("、") || "无"}`,
    )
    .join("\n\n");
}

function renderReferences(input: {
  matchedRules: MatchedRule[];
  matchedMaterials: Material[];
  decisionLog: string[];
}): string {
  const materialLines =
    input.matchedMaterials.map((material) => `- ${material.title || material.id}`).join("\n") || "- 无";
  const ruleLines =
    input.matchedRules
      .map((rule) => {
        const source = rule.source ? `来源:${rule.source}` : "";
        const score =
          typeof rule.effective_score === "number" ? `score:${rule.effective_score}` : "";
        const overriddenBy = rule.overridden_by ? `被「${rule.overridden_by}」降权` : "";
        const detail = [rule.reason, source, score, overriddenBy].filter(Boolean).join("；");
        return `- ${rule.title}${detail ? `（${detail}）` : ""}`;
      })
      .join("\n") || "- 无";
  const decisionLines = input.decisionLog.map((line) => `- ${line}`).join("\n") || "- 无";

  return `## 相似历史材料

${materialLines}

## 已匹配规则

${ruleLines}

## 策略裁决

${decisionLines}`;
}

function renderDraft(result: DraftResult): string {
  return `${result.draft_markdown}\n\n### 自检\n\n- 优点：${result.self_review.strengths.join("；") || "无"}\n- 风险：${result.self_review.risks.join("；") || "无"}\n- 缺失点：${result.self_review.missing_points.join("；") || "无"}\n- 规则违例：${result.self_review.rule_violations.join("；") || "无"}\n\n### 修改建议\n\n- ${result.revision_suggestions.join("\n- ")}`;
}

export async function writeTaskSections(input: {
  task: Task;
  diagnosis?: DiagnosisResult;
  outline?: OutlineResult;
  draft?: DraftResult;
  matchedRules?: MatchedRule[];
  matchedMaterials?: Material[];
  decisionLog?: string[];
}): Promise<void> {
  let nextContent = input.task.content;

  if (input.diagnosis) {
    nextContent = replaceSection(nextContent, "写前诊断", renderDiagnosis(input.diagnosis));
  }
  if (input.outline) {
    nextContent = replaceSection(nextContent, "提纲", renderOutline(input.outline));
  }
  if (input.draft) {
    nextContent = replaceSection(nextContent, "初稿", renderDraft(input.draft));
  }
  if (input.matchedRules || input.matchedMaterials) {
    nextContent = replaceSection(
      nextContent,
      "参考依据",
      renderReferences({
        matchedRules: input.matchedRules ?? [],
        matchedMaterials: input.matchedMaterials ?? [],
        decisionLog: input.decisionLog ?? [],
      }),
    );
  }

  await writeMarkdownDocument(input.task.path, input.task.frontmatter, nextContent);
}
