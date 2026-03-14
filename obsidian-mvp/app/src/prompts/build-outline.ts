import type { MaterialSummary, MatchedRule, Profile } from "../types/domain.js";
import type { DiagnosisResult, TaskAnalysis } from "../types/schemas.js";

export function buildOutlinePrompt(input: {
  taskAnalysis: TaskAnalysis;
  diagnosis: DiagnosisResult;
  matchedRules: MatchedRule[];
  materialSummaries: MaterialSummary[];
  profiles: Profile[];
}): string {
  const profileSummary = input.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    content: profile.content.slice(0, 1200),
  }));

  return `请生成一份可直接用于写作的提纲。

要求：
1. 提纲必须符合写前诊断建议
2. 每一节说明承担什么功能
3. 每一节列出要写的关键点
4. source_basis 字段中写明该节主要参考了哪些规则或材料
5. 不要写成正文

输出要求：
- 只输出 JSON
- 提纲要稳定、克制、适合正式材料

任务分析:
${JSON.stringify(input.taskAnalysis, null, 2)}

写前诊断:
${JSON.stringify(input.diagnosis, null, 2)}

命中规则:
${JSON.stringify(input.matchedRules, null, 2)}

相似材料摘要:
${JSON.stringify(input.materialSummaries, null, 2)}

写作画像:
${JSON.stringify(profileSummary, null, 2)}`;
}
