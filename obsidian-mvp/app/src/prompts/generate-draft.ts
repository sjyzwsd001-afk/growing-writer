import type { EvidenceCard, MaterialSummary, MatchedRule, Profile, TemplateRewriteStep } from "../types/domain.js";
import type { DiagnosisResult, OutlineResult, TaskAnalysis } from "../types/schemas.js";
import {
  compactDiagnosis,
  compactEvidenceCards,
  compactMatchedRules,
  compactMaterialSummaries,
  compactOutline,
  compactProfiles,
  compactTaskAnalysis,
  compactTemplateRewritePlan,
} from "./context.js";
import { normalizeStructureLabel } from "../retrieve/summaries.js";

const LOW_ASSIGNMENT_CONFIDENCE_THRESHOLD = 0.28;

function buildSectionWriteBriefs(input: {
  outline: OutlineResult;
  templateRewritePlan: TemplateRewriteStep[];
}): Array<Record<string, unknown>> {
  const rewriteMap = new Map(
    input.templateRewritePlan.map((step) => [normalizeStructureLabel(step.section), step] as const),
  );

  return input.outline.sections.slice(0, 6).map((section, index) => {
    const matchedStep =
      rewriteMap.get(normalizeStructureLabel(section.heading)) ||
      input.templateRewritePlan[index] ||
      null;

    return {
      heading: section.heading,
      purpose: section.purpose,
      must_cover: section.key_points.slice(0, 5),
      assigned_facts: matchedStep?.assigned_facts.slice(0, 5) ?? [],
      assigned_requirements: matchedStep?.assigned_requirements.slice(0, 5) ?? [],
      assignment_confidence:
        typeof matchedStep?.assignment_confidence === "number"
          ? Number(matchedStep.assignment_confidence.toFixed(2))
          : undefined,
      template_section_excerpt: matchedStep?.template_section_excerpt ?? "",
      template_writing_pattern: matchedStep?.template_writing_pattern ?? "",
      content_hint_warning: matchedStep?.content_hint_warning ?? "",
      conservative_approach:
        typeof matchedStep?.assignment_confidence === "number"
          ? matchedStep.assignment_confidence < LOW_ASSIGNMENT_CONFIDENCE_THRESHOLD
          : false,
      history_section_hints: (matchedStep?.history_section_hints ?? []).slice(0, 3).map((item) => ({
        material_title: item.material_title,
        section: item.section,
        excerpt: item.excerpt ?? "",
        writing_pattern: item.writing_pattern ?? "",
      })),
      fill_strategy: matchedStep?.fill_strategy ?? "",
      logic_after: matchedStep?.logic_after
        ? {
            from: matchedStep.logic_after.from,
            to: matchedStep.logic_after.to,
            reason: matchedStep.logic_after.reason,
          }
        : null,
      source_basis: section.source_basis.slice(0, 4),
    };
  });
}

export function buildGenerateDraftPrompt(input: {
  taskAnalysis: TaskAnalysis;
  diagnosis: DiagnosisResult;
  outline: OutlineResult;
  matchedRules: MatchedRule[];
  materialSummaries: MaterialSummary[];
  evidenceCards: EvidenceCard[];
  profiles: Profile[];
  templateRewritePlan?: TemplateRewriteStep[];
  templateQualityAssessment?: {
    mode: "structured" | "derived-sections" | "generic-outline";
    warnings: string[];
  };
}): string {
  return `请基于提纲、任务事实、规则和风格摘要，生成正式材料初稿。

要求：
1. 不得编造事实
2. 对缺失但重要的信息，不要瞎补，可以用保守表述处理，并在 self_review 中指出
3. 尽量符合已确认规则
4. 风格保持正式、稳定、可交付
5. draft_markdown 只写正文，不要包含额外解释
6. 关键事实句尽量引用证据卡片编号，如 [证据卡:E01]
7. 如果任务没有明确要求长文，draft_markdown 默认控制在 300 到 600 字
8. self_review 四个数组都尽量精简，每个数组最多 2 条
9. revision_suggestions 最多 3 条，短句即可
10. 如果命中模板槽位，必须结合本次背景材料替换对应部分，不要照抄模板中的旧事实
11. 如果历史材料中给出了明确逻辑链，正文段落顺序应优先沿用该逻辑链
12. 如果模板改写计划中已经给出 rewrite_steps，正文各大段顺序应尽量与这些 section 一致，不要跳过前面的关键模板段
13. self_review.missing_points 必须优先检查每个 rewrite_step 的 assigned_requirements 是否已在对应段落真正覆盖；如果没覆盖，要明确写出“哪一段漏了什么”
14. self_review.rule_violations 必须检查正文是否偏离 rewrite_steps 的逻辑顺序、段落意图和模板槽位要求，而不是泛泛而谈
15. self_review.strengths 也要尽量对应到具体段落，例如“某段已覆盖采购结果”
16. 写正文时请按 section_write_briefs 逐段完成，不要让所有段落重复同一组事实
17. 每一段优先使用自己被分配到的 assigned_facts 和 assigned_requirements，再补充全局事实
18. 如果某段存在 logic_after，对应段落顺序和承接关系必须体现出来
19. 相似材料里的 logic_chain / template_slots / section_intents 是结构化约束；请直接利用 from -> to、section、intent、fill_rule 这些字段，不要把它们降成泛泛参考
20. 如果模板逻辑链与历史材料逻辑链冲突，优先服从模板逻辑链；历史材料逻辑链只作为局部承接或补充理由
21. 如果没有可执行的模板逻辑链或历史逻辑链，默认按“背景/现状 -> 主体事项 -> 结论/安排”的顺序组织正文
22. 如果某段 assignment_confidence 明显偏低，不要硬编事实；请用保守表述，并在 self_review.missing_points 中指出该段事实支撑不足
23. 如果 section_write_briefs 里的 conservative_approach=true，请显式使用保守表达，如“从现有材料看”“当前材料主要显示”，不要把推测写成确定事实。
24. 如果 template_quality_assessment.mode = "derived-sections"，说明模板只有派生章节；请沿用章节骨架，但不要假定模板中存在更细的隐藏槽位。
25. 如果 template_quality_assessment.mode = "generic-outline"，说明模板结构很弱；请优先保住 requirements 和 facts 的覆盖，不要伪造复杂结构映射。
26. 如果 template_quality_assessment.warnings 非空，请把这些警告视为本次写作的高风险点，在 self_review 里优先检查相关段落。
27. 如果某段提供了 template_section_excerpt，这代表模板原段落的写法骨架；请学习它的展开方式和语气，但必须把旧事实替换成这次任务事实。
28. 如果某段提供了 history_section_hints.excerpt，这代表历史材料里对应段落的真实写法；请把它当内容参考，而不只是标题参考。
29. 如果某段提供了 template_writing_pattern 或 history_section_hints.writing_pattern，请优先沿用这些写法模式，例如“先交代依据再展开事实”“句式偏短直接落结论”等，而不是只模仿词面。
30. 如果某段出现 content_hint_warning，说明该段缺少稳定的正文参考；请更保守地依赖 assigned_facts、assigned_requirements 和 outline purpose，不要擅自补充模板里未出现的展开方式。
31. 如果写作画像里存在高优先级偏好，请把它们视为正文风格硬约束；例如偏好的开头方式、句式密度、收束习惯应优先执行。
32. 如果写作画像里存在常见禁忌，请显式规避这些表达和写法；不要因为模板或历史材料里出现过类似写法就照搬。

然后做一轮自检：
- 哪些地方写得比较稳
- 哪些地方可能还空
- 哪些规则可能没有完全满足

输出要求：
- 只输出 JSON
- 以下上下文已经裁剪，请严格依托现有事实，不要因为细节不足而虚构
- 优先保证成稿稳定性，不要追求过长内容

任务分析:
${JSON.stringify(compactTaskAnalysis(input.taskAnalysis), null, 2)}

写前诊断:
${JSON.stringify(compactDiagnosis(input.diagnosis), null, 2)}

提纲:
${JSON.stringify(compactOutline(input.outline), null, 2)}

命中规则:
${JSON.stringify(compactMatchedRules(input.matchedRules), null, 2)}

相似材料摘要:
${JSON.stringify(compactMaterialSummaries(input.materialSummaries), null, 2)}

证据卡片:
${JSON.stringify(compactEvidenceCards(input.evidenceCards), null, 2)}

写作画像:
${JSON.stringify(compactProfiles(input.profiles), null, 2)}

模板改写计划:
${JSON.stringify(compactTemplateRewritePlan(input.templateRewritePlan ?? []), null, 2)}

section_write_briefs:
${JSON.stringify(
    buildSectionWriteBriefs({
      outline: input.outline,
      templateRewritePlan: input.templateRewritePlan ?? [],
    }),
    null,
    2,
  )}

template_quality_assessment:
${JSON.stringify(
    {
      mode: input.templateQualityAssessment?.mode ?? "structured",
      warnings: (input.templateQualityAssessment?.warnings ?? []).slice(0, 6),
    },
    null,
    2,
  )}`;
}
