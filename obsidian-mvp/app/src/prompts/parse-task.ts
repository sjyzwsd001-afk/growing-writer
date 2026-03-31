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

export function buildParseTaskRelaxedPrompt(task: Task): string {
  return `请解析当前写作任务，但这次不要输出 JSON。

请严格按下面格式输出纯文本，每个字段单独一行或一个小节：

任务类型：...
受众：...
场景：...
目标：...
必须写入：
- ...
- ...
限制条件：
- ...
- ...
事实：
- ...
- ...
缺失信息：
- ...
- ...
风险：
- ...
- ...
置信度：0.00-1.00

要求：
1. 不要输出 markdown 代码块
2. 不要解释
3. 列表项不足时可以留空
4. 置信度请给 0 到 1 之间的小数

任务 frontmatter:
${JSON.stringify(task.frontmatter, null, 2)}

任务正文:
${task.content}`;
}
