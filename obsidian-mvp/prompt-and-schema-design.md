# Prompt 与 Schema 设计

这是一版面向 Obsidian 写作助手 MVP 的 prompt 链和 JSON 输入输出格式。

目标：

1. 让每个 AI 步骤职责单一
2. 输出稳定的结构化结果
3. 降低“写着写着跑偏”的概率
4. 方便后续用 TypeScript 直接做校验和回写

## 1. 总体原则

第一版建议固定为 5 个步骤：

1. `parse_task`
2. `diagnose_task`
3. `build_outline`
4. `generate_draft`
5. `learn_feedback`

每一步都要求：

- 只做当前步骤
- 输出 JSON
- 不输出多余解释
- 缺信息时明确标注
- 不编造事实

## 2. 通用 System Prompt

所有步骤共享一条基础 system prompt：

```text
你是一个结构化写作助手，任务是基于用户提供的历史材料、已确认规则、写作画像和当前任务信息，输出严格符合要求的 JSON。

必须遵守：
1. 不得编造事实。
2. 如果信息不足，必须在对应字段中明确说明缺失项。
3. 优先遵守已确认规则，其次参考高置信度候选规则。
4. 不要输出 JSON 以外的任何内容。
5. 你的任务不是追求华丽表达，而是保证结构、逻辑、适配场景和可追溯性。
```

## 3. Step 1: parse_task

### 目标

把原始任务 markdown 和用户补充素材，转换成结构化任务对象。

### 输入对象

```json
{
  "task_id": "task-001",
  "title": "季度项目风险汇报",
  "raw_task_markdown": "...",
  "raw_user_materials": [
    "项目已进入联调阶段，客户希望下周看到风险说明。",
    "当前主要风险有进度延迟、接口稳定性、测试资源不足。"
  ]
}
```

### 输出 Schema

```json
{
  "task_type": "string",
  "audience": "string",
  "scenario": "string",
  "goal": "string",
  "must_include": ["string"],
  "constraints": ["string"],
  "raw_facts": ["string"],
  "missing_info": ["string"],
  "risk_flags": ["string"],
  "confidence": 0.0
}
```

### Prompt 模板

```text
请解析当前写作任务，并输出结构化任务对象。

输入信息包括：
- 任务原文
- 用户补充素材

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
```

## 4. Step 2: diagnose_task

### 目标

基于任务对象、规则、材料摘要和写作画像，给出写前诊断。

### 输入对象

```json
{
  "task_analysis": {
    "task_type": "风险汇报",
    "audience": "领导",
    "scenario": "项目阶段汇报",
    "goal": "说明当前主要风险并提出应对措施",
    "must_include": ["风险点", "影响", "措施"],
    "constraints": ["语气正式", "篇幅控制在 1200 字内"],
    "raw_facts": ["联调阶段", "存在接口稳定性问题"],
    "missing_info": ["是否需要写下一步计划"],
    "risk_flags": [],
    "confidence": 0.82
  },
  "matched_rules": [
    {
      "rule_id": "rule-003",
      "title": "风险材料必须写原因、影响、措施",
      "priority": 1,
      "reason": "文体与场景完全匹配"
    }
  ],
  "material_summaries": [
    {
      "material_id": "material-002",
      "title": "某项目月度风险汇报",
      "doc_type": "风险汇报",
      "structure_summary": ["背景", "风险分项", "措施", "结尾态度"],
      "style_summary": ["语气稳健", "先结论后展开"],
      "useful_phrases": ["总体可控", "需重点关注"]
    }
  ],
  "profile_summary": {
    "style_preferences": ["正式", "简洁", "先结论后分析"],
    "taboos": ["口语化", "空泛表述"],
    "stable_patterns": ["结尾写态度和下一步"]
  }
}
```

### 输出 Schema

```json
{
  "readiness": "ready | partial | blocked",
  "diagnosis_summary": "string",
  "recommended_structure": [
    {
      "section": "string",
      "purpose": "string",
      "must_cover": ["string"]
    }
  ],
  "missing_info": ["string"],
  "applied_rules": ["string"],
  "reference_materials": ["string"],
  "writing_risks": ["string"],
  "next_action": "string"
}
```

### Prompt 模板

```text
请根据任务分析、已命中规则、相似材料摘要和写作画像，输出写前诊断。

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
```

## 5. Step 3: build_outline

### 目标

基于写前诊断和上下文，产出稳定提纲。

### 输入对象

```json
{
  "task_analysis": {},
  "diagnosis_result": {},
  "matched_rules": [],
  "material_summaries": [],
  "profile_summary": {}
}
```

### 输出 Schema

```json
{
  "outline_title": "string",
  "sections": [
    {
      "heading": "string",
      "purpose": "string",
      "key_points": ["string"],
      "source_basis": ["string"]
    }
  ],
  "tone_notes": ["string"],
  "coverage_check": ["string"]
}
```

### Prompt 模板

```text
请生成一份可直接用于写作的提纲。

要求：
1. 提纲必须符合写前诊断建议
2. 每一节说明承担什么功能
3. 每一节列出要写的关键点
4. source_basis 字段中写明该节主要参考了哪些规则或材料
5. 不要写成正文

输出要求：
- 只输出 JSON
- 提纲要稳定、克制、适合正式材料
```

## 6. Step 4: generate_draft

### 目标

基于提纲生成初稿，并做一轮自检。

### 输入对象

```json
{
  "task_analysis": {},
  "diagnosis_result": {},
  "outline_result": {},
  "matched_rules": [],
  "material_summaries": [],
  "profile_summary": {}
}
```

### 输出 Schema

```json
{
  "draft_markdown": "string",
  "self_review": {
    "strengths": ["string"],
    "risks": ["string"],
    "missing_points": ["string"],
    "rule_violations": ["string"]
  },
  "revision_suggestions": ["string"]
}
```

### Prompt 模板

```text
请基于提纲、任务事实、规则和风格摘要，生成正式材料初稿。

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
```

## 7. Step 5: learn_feedback

### 目标

把用户批注和修改，转成结构化反馈分析与候选规则。

### 输入对象

```json
{
  "task_id": "task-001",
  "feedback_text": "这一版问题分析太虚了，必须把影响范围说具体，措施也不能只写原则。",
  "task_analysis": {},
  "draft_excerpt": "..."
}
```

### 输出 Schema

```json
{
  "feedback_type": "wording | structure | order | logic | missing_info | scenario_mismatch | factual_fix",
  "feedback_summary": "string",
  "is_reusable_rule": true,
  "candidate_rule": {
    "title": "string",
    "content": "string",
    "scope": "string",
    "doc_types": ["string"],
    "audiences": ["string"],
    "confidence": 0.0
  },
  "reasoning": "string",
  "suggested_update": "string"
}
```

### Prompt 模板

```text
请分析用户反馈，判断这次修改属于哪类问题，并评估是否应沉淀为长期规则。

要求：
1. feedback_type 只能从指定枚举中选择
2. 如果只是本次场景特殊要求，不要强行抽成长期规则
3. 如果适合沉淀，candidate_rule 要写得足够明确，可复用，可判断是否命中
4. reasoning 要说明为什么建议或不建议入库
5. suggested_update 要说明本次稿件应该怎么改

输出要求：
- 只输出 JSON
```

## 8. TypeScript Schema 建议

后续代码里建议直接对应这些类型：

```ts
export type TaskAnalysis = {
  task_type: string;
  audience: string;
  scenario: string;
  goal: string;
  must_include: string[];
  constraints: string[];
  raw_facts: string[];
  missing_info: string[];
  risk_flags: string[];
  confidence: number;
};

export type DiagnosisResult = {
  readiness: "ready" | "partial" | "blocked";
  diagnosis_summary: string;
  recommended_structure: Array<{
    section: string;
    purpose: string;
    must_cover: string[];
  }>;
  missing_info: string[];
  applied_rules: string[];
  reference_materials: string[];
  writing_risks: string[];
  next_action: string;
};

export type OutlineResult = {
  outline_title: string;
  sections: Array<{
    heading: string;
    purpose: string;
    key_points: string[];
    source_basis: string[];
  }>;
  tone_notes: string[];
  coverage_check: string[];
};

export type DraftResult = {
  draft_markdown: string;
  self_review: {
    strengths: string[];
    risks: string[];
    missing_points: string[];
    rule_violations: string[];
  };
  revision_suggestions: string[];
};

export type FeedbackAnalysis = {
  feedback_type:
    | "wording"
    | "structure"
    | "order"
    | "logic"
    | "missing_info"
    | "scenario_mismatch"
    | "factual_fix";
  feedback_summary: string;
  is_reusable_rule: boolean;
  candidate_rule: {
    title: string;
    content: string;
    scope: string;
    doc_types: string[];
    audiences: string[];
    confidence: number;
  } | null;
  reasoning: string;
  suggested_update: string;
};
```

## 9. 一版很实用的落地建议

真正开始写代码时，建议这样用：

1. 每一步都要求模型输出 JSON
2. 用 `zod` 严格校验
3. 校验失败就重试一次
4. 不把整条链交给一个超长 prompt
5. 每步输出先落盘，便于调试

这样做虽然朴素，但很稳。

## 10. 一句话结论

第一版最重要的不是 prompt 写得多花，而是：

`把每一步的职责、输入、输出和失败边界固定住。`
