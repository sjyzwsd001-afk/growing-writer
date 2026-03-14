import type { MaterialSummary, MatchedRule, Profile } from "../types/domain.js";
import type { DiagnosisResult, OutlineResult, TaskAnalysis } from "../types/schemas.js";

export function buildGenerateDraftPrompt(input: {
  taskAnalysis: TaskAnalysis;
  diagnosis: DiagnosisResult;
  outline: OutlineResult;
  matchedRules: MatchedRule[];
  materialSummaries: MaterialSummary[];
  profiles: Profile[];
}): string {
  const profileSummary = input.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    content: profile.content.slice(0, 1200),
  }));

  return `请基于提纲、任务事实、规则和风格摘要，生成正式材料初稿。

要求：
1. 不得编造事实
2. 对缺失但重要的信息，不要瞎补，可以用保守表述处理，并在 self_review 中指出
3. 尽量符合已确认规则
4. 风格保持正式、稳定、可交付
5. draft_markdown 只写正文，不要包含额外解释

然后做一轮自检：
- 哪些地方写得比较稳
- 哪些地方可能还空
- 哪些规则可能没有完全满足

输出要求：
- 只输出 JSON

任务分析:
${JSON.stringify(input.taskAnalysis, null, 2)}

写前诊断:
${JSON.stringify(input.diagnosis, null, 2)}

提纲:
${JSON.stringify(input.outline, null, 2)}

命中规则:
${JSON.stringify(input.matchedRules, null, 2)}

相似材料摘要:
${JSON.stringify(input.materialSummaries, null, 2)}

写作画像:
${JSON.stringify(profileSummary, null, 2)}`;
}
