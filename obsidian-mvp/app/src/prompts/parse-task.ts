import type { Task } from "../types/domain.js";

export function buildParseTaskPrompt(task: Task): string {
  return `请解析当前写作任务，并输出结构化任务对象。

请完成：
1. 判断任务类型
2. 判断受众和场景
3. 总结写作目标
4. 提取必须写入的事实
5. 列出限制条件
6. 标记当前缺失信息
7. 如果存在明显风险，如目标不清、事实不足、要求冲突，请放入 risk_flags

输出要求：
- 只输出 JSON
- 如果某项无法确定，填入最合理判断，并在 missing_info 或 risk_flags 中说明

任务 frontmatter:
${JSON.stringify(task.frontmatter, null, 2)}

任务正文:
${task.content}`;
}
