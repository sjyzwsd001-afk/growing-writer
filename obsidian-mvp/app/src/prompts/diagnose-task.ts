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

输出要求：
- 只输出 JSON
- 不要直接写正文
- 结构建议必须可执行
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
${JSON.stringify(compactTemplateRewritePlan(input.templateRewritePlan ?? []), null, 2)}`;
}
