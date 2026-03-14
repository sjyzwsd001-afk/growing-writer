import type { Feedback, Task } from "../types/domain.js";
import type { TaskAnalysis } from "../types/schemas.js";

export function buildLearnFeedbackPrompt(input: {
  feedback: Feedback;
  task: Task | null;
  taskAnalysis: TaskAnalysis | null;
}): string {
  return `请分析用户反馈，判断这次修改属于哪类问题，并评估是否应沉淀为长期规则。

要求：
1. feedback_type 只能从指定枚举中选择
2. 如果只是本次场景特殊要求，不要强行抽成长期规则
3. 如果适合沉淀，candidate_rule 要写得足够明确，可复用，可判断是否命中
4. reasoning 要说明为什么建议或不建议入库
5. suggested_update 要说明本次稿件应该怎么改

输出要求：
- 只输出 JSON

反馈 frontmatter:
${JSON.stringify(input.feedback.frontmatter, null, 2)}

反馈正文:
${input.feedback.content}

关联任务:
${JSON.stringify(
  input.task
    ? {
        id: input.task.id,
        title: input.task.title,
        doc_type: input.task.docType,
        audience: input.task.audience,
        scenario: input.task.scenario,
        content: input.task.content.slice(0, 2000),
      }
    : null,
  null,
  2,
)}

任务分析:
${JSON.stringify(input.taskAnalysis, null, 2)}`;
}
