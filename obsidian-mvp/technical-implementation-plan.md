# 技术实现方案

这是一版面向 Obsidian 写作助手 MVP 的技术实现方案。

目标不是一次做成完整平台，而是先把下面这条链跑通：

1. 从 Obsidian vault 读取材料、规则、任务
2. 为当前任务召回相关材料和规则
3. 拼装 AI 上下文
4. 生成写前诊断、提纲、初稿
5. 把结果回写到任务文件
6. 读取反馈并生成候选规则

## 1. 第一版推荐形态

我建议第一版采用：

`Obsidian vault + 本地脚本服务 + 大模型 API + 检索层`

而不是一开始就开发完整 Obsidian 插件。

原因：

- 本地脚本开发更快
- 调试更容易
- 后续既能封装成插件，也能迁移成独立产品
- 可以先验证核心逻辑，不被 UI 开发拖住

所以第一版建议是：

- Obsidian 负责存储和编辑
- 本地脚本负责流程编排
- 检索层负责召回
- 模型负责生成

## 2. 推荐的技术拆分

建议拆成 6 个模块。

### 2.1 Vault Reader

职责：

- 读取 `materials/`
- 读取 `rules/`
- 读取 `tasks/`
- 读取 `feedback/`
- 解析 frontmatter
- 返回结构化对象

建议输入：

- vault 根目录
- 某个 task 文件路径

建议输出：

```ts
type Material
type Rule
type Task
type Feedback
type Profile
```

### 2.2 Retriever

职责：

- 根据任务元数据筛选候选材料
- 调用语义检索找相似材料
- 根据文体、对象、场景筛规则

建议分两层：

- `metadata filter`
- `semantic retrieve`

第一层先用 frontmatter 做快速筛选，第二层再做语义相似度排序。

### 2.3 Context Builder

职责：

- 把任务、规则、材料摘要、画像拼成模型输入
- 控制上下文长度
- 统一输出 prompt 输入对象

输出建议包含：

- 当前任务摘要
- 命中规则摘要
- 相似材料摘要
- 写作画像摘要
- 本次缺失信息

### 2.4 Writer Engine

职责：

- 调用模型生成写前诊断
- 调用模型生成提纲
- 调用模型生成初稿
- 调用模型生成审校结果

第一版建议不要做 agent loop，先做固定 4 步 pipeline。

### 2.5 Feedback Learner

职责：

- 读取反馈记录
- 分类反馈类型
- 生成候选规则
- 关联原任务和原规则

### 2.6 Result Writer

职责：

- 把生成内容回写到 task 文件
- 把候选规则写入 rules 文件
- 更新 profile 摘要

## 3. 推荐目录与代码结构

如果我们后面要开发，我建议代码目录先按这个结构组织：

```text
app/
  src/
    cli/
    config/
    vault/
    retrieve/
    prompts/
    llm/
    workflows/
    feedback/
    writers/
    types/
```

各目录职责：

- `cli/`
  命令入口，比如生成任务、刷新规则、处理反馈

- `config/`
  模型、vault 路径、检索参数、输出策略

- `vault/`
  读取 markdown、解析 frontmatter、更新文件

- `retrieve/`
  元数据过滤、相似材料召回、规则命中

- `prompts/`
  各阶段 prompt 模板

- `llm/`
  模型适配层

- `workflows/`
  任务解析、诊断、提纲、初稿、审校流程

- `feedback/`
  反馈分类、候选规则提炼

- `writers/`
  把结果写回 task / rule / profile

- `types/`
  统一数据结构

## 4. 推荐技术选型

为了开发速度和可维护性，我建议第一版优先用：

- `TypeScript + Node.js`
- `gray-matter` 解析 frontmatter
- `zod` 做输入输出校验
- `fast-glob` 或原生文件扫描
- `OpenAI / Claude / Gemini` 任一稳定 API
- `简易本地向量检索` 或直接先接 Smart Connections/Khoj

为什么推荐 TypeScript：

- 处理 markdown 文件和本地脚本很顺手
- 后续转 Obsidian 插件也方便
- 数据结构清晰，适合这类多阶段工作流

## 5. 第一版检索实现建议

第一版检索不要做太复杂，建议分三步：

### 5.1 元数据初筛

根据 task 的：

- `doc_type`
- `audience`
- `scenario`
- `tags`

先筛出一批候选材料和候选规则。

### 5.2 相似度排序

对候选材料按任务描述做相似度排序。

优先排序项：

- 标题和摘要相似
- 文体相同
- 受众相同
- 高质量样本加权

### 5.3 截断与摘要

召回后不要把全文直接塞给模型。

每个材料建议只保留：

- 标题
- 任务摘要
- 结构摘要
- 风格摘要
- 关键段落

每次最终只拼 3-5 篇。

## 6. 规则命中逻辑

第一版规则匹配可以先不用模型判断，先做显式匹配。

优先级建议：

1. `confirmed` 且文体匹配
2. `confirmed` 且受众匹配
3. `confirmed` 的通用规则
4. 高置信度 `candidate`

命中输出建议：

```ts
type MatchedRule = {
  ruleId: string;
  title: string;
  reason: string;
  priority: number;
}
```

reason 很重要，因为后面要解释“为什么用了这条规则”。

## 7. 大模型调用链

建议第一版只做这 4 个 workflow。

### workflow 1: parse-task

输入：

- 当前任务 markdown

输出：

- 结构化任务对象
- 缺失信息清单

### workflow 2: prewrite-diagnosis

输入：

- 任务对象
- 召回材料摘要
- 命中规则
- 写作画像摘要

输出：

- 写前诊断
- 建议结构
- 建议补充信息

### workflow 3: outline-draft

输入：

- 已确认任务对象
- 写前诊断
- 命中规则
- 相似材料摘要

输出：

- 提纲

### workflow 4: generate-draft

输入：

- 提纲
- 原始素材
- 命中规则
- 风格摘要

输出：

- 初稿
- 风险提醒

## 8. 回写策略

第一版不建议让 AI 直接覆盖整个文件。

建议用“分区回写”：

- 更新 `写前诊断`
- 更新 `参考依据`
- 更新 `提纲`
- 更新 `初稿`
- 更新 `修改记录`

也就是说，我们只替换 task 文件里的固定 section。

这样更安全，也方便你人工改。

## 9. 反馈学习实现建议

反馈学习先做半自动，不要一开始追求全自动记忆。

流程建议：

1. 你在 `feedback/` 新建一条反馈
2. 脚本读取反馈和关联 task
3. 模型输出：
   - 反馈分类
   - 是否建议沉淀为规则
   - 候选规则表述
   - 适用场景
4. 脚本生成一条新的 `candidate rule`
5. 由你确认后再改成 `confirmed`

这样风险最小。

## 10. 推荐的 CLI 入口

第一版做成 CLI 最省力。

建议有这些命令：

```bash
writer parse-task <task-file>
writer diagnose <task-file>
writer outline <task-file>
writer draft <task-file>
writer learn-feedback <feedback-file>
writer refresh-profile
```

后面如果接 Obsidian，可以通过：

- Obsidian 外部命令
- QuickAdd
- Templater
- 自定义插件按钮

来触发这些命令。

## 11. 和 Obsidian 的集成方式

第一版推荐 3 种集成方式，按难度从低到高：

### 方式一：手动触发 CLI

最简单。

你在终端执行命令，然后结果回写 markdown。

适合先验证逻辑。

### 方式二：通过 QuickAdd / Templater 调用脚本

这一步就已经比较好用了。

你在 Obsidian 里点击命令：

- 生成写前诊断
- 生成提纲
- 生成初稿
- 学习反馈

脚本在后台执行，结果回写文件。

### 方式三：做成真正的 Obsidian 插件

等 MVP 证明有效后再做。

插件可以做：

- 侧边栏显示命中规则
- 一键生成
- 批注转反馈
- 可视化候选规则确认

但这一步不适合作为第一步。

## 12. 第一版最小数据结构

建议统一这些核心类型：

```ts
type TaskInput
type TaskAnalysis
type MaterialSummary
type RuleCard
type MatchedRule
type DiagnosisResult
type OutlineResult
type DraftResult
type FeedbackAnalysis
```

有了这些类型，后面不管换模型还是换交互层，核心逻辑都不会乱。

## 13. 现在最值得先做的实现顺序

如果我们正式开始开发，我建议按这个顺序来：

1. 先做 markdown 读取和 section 回写
2. 再做 task 解析
3. 再做规则匹配和材料召回
4. 再接模型生成写前诊断
5. 再接提纲和初稿生成
6. 最后做反馈学习

因为前两步一旦打通，后面所有功能都能接上。

## 14. 一句话架构结论

第一版最合适的技术路线不是“先开发一个完整插件”，而是：

`用 Obsidian 管内容，用本地 TypeScript 工作流管逻辑，用现成检索和模型能力管召回与生成。`
