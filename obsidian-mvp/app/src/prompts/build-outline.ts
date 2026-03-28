import type { EvidenceCard, MaterialSummary, MatchedRule, Profile, TemplateRewriteStep } from "../types/domain.js";
import type { DiagnosisResult, TaskAnalysis } from "../types/schemas.js";
import {
  compactDiagnosis,
  compactEvidenceCards,
  compactMatchedRules,
  compactMaterialSummaries,
  compactProfiles,
  compactTaskAnalysis,
  compactTemplateRewritePlan,
} from "./context.js";

export function buildOutlinePrompt(input: {
  taskAnalysis: TaskAnalysis;
  diagnosis: DiagnosisResult;
  matchedRules: MatchedRule[];
  materialSummaries: MaterialSummary[];
  evidenceCards: EvidenceCard[];
  profiles: Profile[];
  templateRewritePlan?: TemplateRewriteStep[];
}): string {
  return `请生成一份可直接用于写作的提纲。

要求：
1. 提纲必须符合写前诊断建议
2. 每一节说明承担什么功能
3. 每一节列出要写的关键点
4. source_basis 字段中写明该节主要参考了哪些规则或材料
5. 不要写成正文
6. 如果材料中有模板槽位，优先把提纲写成“固定结构 + 本次需要替换的内容”
7. 如果历史材料里存在明确逻辑链，提纲顺序优先遵循该逻辑链，而不是自由重排
8. 如果模板改写计划中已经给出 rewrite_steps，sections 应尽量按 rewrite_steps 的 section 顺序生成，至少前几节不要偏离该顺序
9. 每一节 key_points 都要能对应 rewrite_steps 里的 fill_strategy 或 must_include，不要只写空泛标题
10. 相似材料里的 logic_chain / template_slots / section_intents 是结构化约束；请直接利用 from -> to、section、intent 这些字段，不要把它们当普通示例
11. 如果模板逻辑链与历史材料逻辑链冲突，优先遵循模板逻辑链；历史材料逻辑链只用于补充承接理由或局部排序
12. 如果没有可执行的模板逻辑链或历史逻辑链，默认按“背景/现状 -> 主体事项 -> 结论/安排”的顺序组织 sections

输出要求：
- 只输出 JSON
- 提纲要稳定、克制、适合正式材料
- 以下输入已经做过裁剪，请只抓关键结构和依据

任务分析:
${JSON.stringify(compactTaskAnalysis(input.taskAnalysis), null, 2)}

写前诊断:
${JSON.stringify(compactDiagnosis(input.diagnosis), null, 2)}

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
