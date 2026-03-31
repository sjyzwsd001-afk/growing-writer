import type { EvidenceCard, MaterialSummary, MatchedRule, Profile, TemplateRewriteStep } from "../types/domain.js";
import type { TaskAnalysis } from "../types/schemas.js";
import {
  compactEvidenceCards,
  compactMatchedRules,
  compactMaterialSummaries,
  compactProfiles,
  compactTaskAnalysis,
  compactTemplateRewritePlan,
} from "./context.js";

export function buildDiagnoseTaskPrompt(input: {
  taskAnalysis: TaskAnalysis;
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
  return `请根据任务分析、已命中规则、相似材料摘要和写作画像，输出写前诊断。

要求：
1. 判断当前是否已经足够成稿
2. 如果不足，指出缺失信息
3. 给出建议结构，每一部分都写清目的和必须覆盖的内容
4. 标出本次真正应启用的规则
5. 标出如果直接生成，最可能出现的问题
6. 如果相似材料中存在模板槽位或逻辑关系，明确指出本次应沿用哪些槽位、哪些逻辑顺序
7. 相似材料里的 logic_chain / template_slots / section_intents 都是结构化线索，不是普通描述文本；请把它们当成可执行约束来诊断
8. 如果模板逻辑链与历史材料逻辑链冲突，优先服从模板逻辑链；历史材料逻辑链只作为补充理由或局部参考
9. 如果既没有明确模板逻辑链，也没有足够清晰的历史逻辑链，默认按“背景/现状 -> 主体事项 -> 结论/安排”的顺序诊断结构
10. 如果模板改写计划中提供了 template_section_excerpt 或 template_writing_pattern，请据此判断每一节应如何展开，不要只停留在标题级诊断。
11. 如果 history_section_hints 带有 excerpt 或 writing_pattern，请把它们当成历史段落的真实内容参考，用来提示哪些段更适合作为写法借鉴。
12. 如果 template_quality_assessment.mode = "derived-sections"，说明当前模板主要依赖派生章节；诊断时应优先保住章节顺序和任务事实覆盖，不要假设模板里还有隐藏槽位。
13. 如果 template_quality_assessment.mode = "generic-outline"，说明当前模板结构较弱；诊断时应更多依赖任务事实、规则和历史材料，不要把模板章节当成强约束。
14. 如果 template_quality_assessment.warnings 非空，请把这些警告视为本次结构诊断的高风险点，在诊断摘要和 recommended_structure 中主动规避相关风险。
15. 请额外输出 input_quality_assessment，评估模板质量、历史材料参考质量、背景事实充分度，并给出 warnings。
16. 请额外输出 fact_section_mapping，把重要事实匹配到最适合承载它的章节，并说明原因与置信度；如果没有明显完美匹配，也要给出最接近的章节。
17. fact_section_mapping 里的 recommended_requirements 请写出“这条事实最适合帮助覆盖哪些 must_include 或段落要求”；如果没有明显要求，可返回空数组。

输出要求：
- 只输出 JSON
- 不要直接写正文
- 结构建议必须可执行
- input_quality_assessment 和 fact_section_mapping 也必须尽量填写完整
- 以下输入已经做过裁剪，请优先抓住最相关信息，不要因为缺少细枝末节而编造内容

任务分析:
${JSON.stringify(compactTaskAnalysis(input.taskAnalysis), null, 2)}

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

export function buildDiagnoseTaskRelaxedPrompt(input: {
  taskAnalysis: TaskAnalysis;
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
  return `请根据任务分析、已命中规则、相似材料摘要和写作画像，输出“写前诊断”，但这次不要输出 JSON。

请严格按下面格式输出纯文本：

成稿准备度：ready / partial / blocked
诊断摘要：...
建议结构：
- 标题｜目的｜必须覆盖1；必须覆盖2
- 标题｜目的｜必须覆盖1；必须覆盖2
缺失信息：
- ...
启用规则：
- ...
参考材料：
- ...
写作风险：
- ...
模板质量：strong / partial / weak
历史材料质量：strong / partial / weak
事实充分度：strong / partial / weak
输入质量警告：
- ...
事实-章节匹配：
- 事实｜章节｜要求1；要求2｜原因｜0.75
- 事实｜章节｜｜原因｜0.40
下一步：...

要求：
1. 不要输出 markdown 代码块
2. 不要解释
3. “建议结构”每行都必须用“标题｜目的｜必须覆盖项”格式
4. “事实-章节匹配”每行都必须用“事实｜章节｜要求列表｜原因｜置信度”格式
5. 如果某一项为空，也保留字段位置

任务分析:
${JSON.stringify(compactTaskAnalysis(input.taskAnalysis), null, 2)}

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
