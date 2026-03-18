import type { EvidenceCard, MaterialSummary, MatchedRule, Profile } from "../types/domain.js";
import type { DiagnosisResult, OutlineResult, TaskAnalysis } from "../types/schemas.js";
import {
  compactDiagnosis,
  compactEvidenceCards,
  compactMatchedRules,
  compactMaterialSummaries,
  compactOutline,
  compactProfiles,
  compactTaskAnalysis,
} from "./context.js";

export function buildGenerateDraftPrompt(input: {
  taskAnalysis: TaskAnalysis;
  diagnosis: DiagnosisResult;
  outline: OutlineResult;
  matchedRules: MatchedRule[];
  materialSummaries: MaterialSummary[];
  evidenceCards: EvidenceCard[];
  profiles: Profile[];
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
${JSON.stringify(compactProfiles(input.profiles), null, 2)}`;
}
