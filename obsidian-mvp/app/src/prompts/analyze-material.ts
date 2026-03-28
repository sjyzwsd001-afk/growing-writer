export function buildAnalyzeMaterialPrompt(input: {
  title: string;
  docType: string;
  audience?: string;
  scenario?: string;
  rawBody: string;
}): string {
  return `请分析这篇历史材料的结构和风格，并输出严格 JSON。

要求：
1. 判断开头这段主要承担什么功能
2. 提炼最多 3 个主体结构要点
3. 判断结尾主要承担什么功能
4. 总结语气、句式、逻辑顺序和明显禁忌
5. 明确这篇材料内部“为什么先写A再写B”，输出逻辑关系链
6. 如果它像模板，请拆出可替换槽位：哪一段是固定框架，哪一段需要结合背景/数据替换
7. 总结每一段的写作意图：这段是在交代背景、说明意义、承接风险、提出措施还是收束结论
8. 给出最多 3 条候选规则，表述要清楚可复用
9. 不要编造原文没有的信息

输出要求：
- 只输出 JSON

材料标题：${input.title}
材料类型：${input.docType}
面向对象：${input.audience ?? ""}
使用场景：${input.scenario ?? ""}

材料正文：
${input.rawBody}`;
}
