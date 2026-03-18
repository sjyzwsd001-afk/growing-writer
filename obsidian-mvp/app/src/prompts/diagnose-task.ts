import type { EvidenceCard, MaterialSummary, MatchedRule, Profile } from "../types/domain.js";
import type { TaskAnalysis } from "../types/schemas.js";
import {
  compactEvidenceCards,
  compactMatchedRules,
  compactMaterialSummaries,
  compactProfiles,
  compactTaskAnalysis,
} from "./context.js";

export function buildDiagnoseTaskPrompt(input: {
  taskAnalysis: TaskAnalysis;
  matchedRules: MatchedRule[];
  materialSummaries: MaterialSummary[];
  evidenceCards: EvidenceCard[];
  profiles: Profile[];
}): string {
  return `请根据任务分析、已命中规则、相似材料摘要和写作画像，输出写前诊断。

要求：
1. 判断当前是否已经足够成稿
2. 如果不足，指出缺失信息
3. 给出建议结构，每一部分都写清目的和必须覆盖的内容
4. 标出本次真正应启用的规则
5. 标出如果直接生成，最可能出现的问题

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
${JSON.stringify(compactProfiles(input.profiles), null, 2)}`;
}
