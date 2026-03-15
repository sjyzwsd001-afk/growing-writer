# Brainstorming 记录：借鉴 content-writer 的 SKILL 编排层，升级 growing writer

日期：2026-03-15  
目标：把 `content-writer` 的“流程编排能力”抽象出来，系统化落地到 `growing writer`，并兼容当前“引导式写作 + 反馈迭代 + 模板高权重 + 双模型配置（API Key/OAuth）”路线。

---

## 0. 已确认输入

### 0.1 现有 skill 的关键特征（content-writer）

- 7 步流程清晰：问背景 -> 问材料 -> 问模板 -> 写作 -> 检查 -> 确认 -> 定稿
- 原则是“主动询问，不抢跑”，天然适配引导式流程
- 角色分工明确：采集/生成 与 审校/把关分层
- 已恢复并备份在仓库：[openclaw-skills/content-writer/SKILL.md](/Users/zw/Documents/growing writer/openclaw-skills/content-writer/SKILL.md)
- 其 PPT 发布脚本已改为 NotebookLM 原生导出：[openclaw-skills/content-writer/publish_presentation.py](/Users/zw/Documents/growing writer/openclaw-skills/content-writer/publish_presentation.py)

### 0.2 growing writer 当前能力（从代码与文档确认）

- 前端已有“新建写作向导 + 设置页 + 反馈再生成”
- 后端已有 `diagnose/outline/draft/feedback-learn/rule-action/profile-refresh` 端点
- 具备 LLM 与 fallback 双路径
- 具备规则库、画像、反馈、模板的基础对象，但“编排层”还主要是线性调用，缺少显式状态机、策略机和审计轨迹

---

## 1. 多角度拆解：我们到底要借鉴 content-writer 的什么

### 1.1 借鉴的不是“prompt 文案”，而是“流程约束”

最可迁移资产不是“写得像谁”，而是这几条编排约束：

- 步骤边界清晰：每一步输入输出都清楚
- 步骤前置条件明确：信息不够就不进入下一步
- 每步产物可落盘：可追溯、可回放、可复盘
- 人机协同点固定：确认点、修订点、定稿点是强节点

### 1.2 content-writer 的真正价值：把“经验流程”变成“可执行流程”

如果只做提示词，系统很快漂移。  
如果做编排层，系统会稳定演进。  
因此建议把 skill 思维升级为：

- `Workflow Contract`（工作流契约）
- `Stage Runtime`（阶段运行时）
- `Policy Layer`（策略层）
- `Evidence Log`（证据日志）

### 1.3 编排层与模型层解耦

- 编排层决定“什么时候问、问什么、什么时候写、什么时候停”
- 模型层只负责“在被授权阶段内生成结构化结果”
- 模型可替换（API key / OAuth / 不同模型），编排不变

---

## 2. 给 growing writer 的目标架构（建议）

### 2.1 三层模型

1. `Orchestration Layer`：状态机、阶段门控、人工确认策略  
2. `Reasoning Layer`：诊断/提纲/成稿/学习的 LLM 调用  
3. `Knowledge Layer`：材料库、模板库、规则库、画像、反馈历史

### 2.2 七阶段状态机（直接映射 content-writer）

- `INTAKE_BACKGROUND`
- `INTAKE_MATERIALS`
- `SELECT_TEMPLATE`
- `GENERATE_DRAFT`
- `REVIEW_DIAGNOSE`
- `USER_CONFIRM_OR_EDIT`
- `FINALIZE_AND_LEARN`

每个状态定义：

- `entry_check`: 进入条件
- `required_fields`: 必填字段
- `llm_tasks`: 允许的模型任务
- `human_actions`: 允许的人工动作
- `exit_criteria`: 退出条件
- `artifacts`: 要写回的产物

### 2.3 与当前前端向导的映射

现状是 4 步向导，可升级为“前台 4 步 + 后台 3 步”：

- 前台：背景 / 材料 / 模板 / 生成
- 后台：检查 / 确认 / 学习

这样 UI 仍简洁，但后端有完整 7 步编排语义。

---

## 3. 深入讨论：编排层的 5 种实现路线

### 方案 A：硬编码顺序 Pipeline（最简单）

- 优点：开发快，改动小
- 缺点：难插入分支；难做重试策略；难做审计
- 结论：只适合 demo，不适合你现在要的“会学习的产品”

### 方案 B：显式有限状态机 FSM（推荐基线）

- 优点：状态可视化；可控；适合引导流程
- 缺点：复杂分支多时图会变大
- 结论：适合当前阶段，能快速上强约束

### 方案 C：事件溯源 Event-Sourcing（推荐作为增强）

- 优点：全量可回放；非常适合“反馈学习”和“规则演化”
- 缺点：实现复杂度上升
- 结论：FSM + Event Log 是最稳组合

### 方案 D：DAG 编排（后期可扩）

- 优点：并行评估强（可多模型并跑）
- 缺点：用户心智复杂，不利于小白
- 结论：先不做主编排，可用于“后台评测流水线”

### 方案 E：Agent 自由循环（不推荐做主流程）

- 优点：灵活
- 缺点：不稳定、不可预期、难审计
- 结论：作为辅助工具可用，不应担任主链路

---

## 4. 模板、规则、画像、反馈如何进入“编排层优先级”

### 4.1 统一权重框架（建议）

在生成阶段引入统一打分：

`EffectivePriority = SourceWeight * Confidence * Recency * ScopeMatch * UserOverride`

默认 SourceWeight 建议：

- 模板规则：1.50（高）
- 用户显式规则：1.40（高）
- 已确认规则：1.20
- 画像偏好：1.00
- 相似历史材料抽取：0.90
- 自动候选规则：0.70

### 4.2 冲突处理（必须有）

当“模板要求”和“画像偏好”冲突时：

1. 文档类型强约束优先（模板）  
2. 用户本次明确输入优先  
3. 历史偏好让位  
4. 冲突写入 `decision_log`

### 4.3 多轮反馈的权重规则

你提的“同一处多次修改，以最后一次为主”非常关键。建议：

- location 粒度跟踪：段落/句子/章节
- 对同 location 的规则学习采用时间衰减，最新权重最大
- 但保留“历史变更链”防止误学习

---

## 5. 新建写作流程：大模型应该介入到什么程度

### 5.1 介入节点建议（强约束版）

1. `任务诊断`：必须 LLM，输出结构化诊断对象  
2. `提纲生成`：必须 LLM，输出结构化提纲对象  
3. `正文生成`：必须 LLM，输出草稿 + 自检  
4. `反馈学习`：必须 LLM，输出候选规则与适用范围  
5. `画像刷新`：必须 LLM，聚合近期变化并生成画像更新

### 5.2 不建议交给 LLM 的节点

- 权限判断、状态跳转、必填校验
- 冲突解决最终裁决（策略层）
- 持久化和版本管理

### 5.3 截断与摘要

建议由“检索/摘要服务”完成，不由最终生成模型临时处理：

- 材料入库即做摘要缓存
- 召回后按预算拼装上下文
- 超预算时先裁剪低权重片段

---

## 6. 在 growing writer 里可落地的后端改造

### 6.1 新增核心对象

- `WorkflowRun`：一次写作会话
- `WorkflowStageEvent`：阶段进入/退出/失败/重试
- `DecisionLog`：规则命中、冲突与裁决说明
- `ArtifactVersion`：诊断 vN、提纲 vN、正文 vN、反馈学习 vN

### 6.2 新增关键接口（建议）

- `POST /api/workflow/start`
- `POST /api/workflow/:runId/advance`
- `POST /api/workflow/:runId/regenerate`
- `POST /api/workflow/:runId/finalize`
- `GET /api/workflow/:runId/events`

### 6.3 与现有接口关系

- 现有 `tasks/generate` 保留，作为内部子能力
- 新流程入口转到 `workflow/*`
- 逐步把页面操作收束到“状态驱动”

---

## 7. 在前端可落地的交互编排升级

### 7.1 主界面保持极简

- 只保留“新建写作”
- 明确显示当前阶段、阶段目标、是否可继续

### 7.2 设置界面收纳系统资产

- 历史材料
- 模板库
- 规则库
- 写作画像
- 反馈记录
- 模型配置（API key / OAuth）

### 7.3 修改反馈界面升级

- 正文直接可编辑
- 任意位置可批注“为何这样改”
- 自动生成 location key
- 展示“该位置最近一次有效偏好”

---

## 8. 如何把 skill 规范流程直接映射为代码契约

### 8.1 SKILL DSL（建议新增）

可定义一个轻量 `workflow.yaml`：

- `stages`
- `transitions`
- `required_inputs`
- `llm_calls`
- `confirm_points`
- `learning_hooks`

这样以后不仅 content-writer，其他领域也能复用同一编排引擎。

### 8.2 运行时执行模型

- `StageExecutor`: 执行阶段
- `PolicyEvaluator`: 评估是否放行
- `ArtifactWriter`: 写产物
- `RunJournal`: 写事件与决策日志

### 8.3 可观测性（必须）

- 每个阶段耗时、token、失败率
- 每次再生成与最终定稿差异
- 每条规则被命中/被否决次数

---

## 9. 风险与反模式清单

- 只靠大 prompt，不建状态机：会漂移
- 规则自动入库不过人工确认：会污染
- 反馈只存最终稿不存修改理由：失去学习价值
- 模板权重过高且无冲突策略：会压制真实需求
- 不做版本化：无法解释“为什么这次这么写”

---

## 10. 分阶段实施建议（按收益优先）

### Phase 1（1-2 周）

- 上 FSM 基线编排
- 写 `WorkflowRun + EventLog`
- 把现有 generate/feedback 链接入状态机

### Phase 2（2-3 周）

- 上优先级与冲突裁决器
- 上 location 级反馈权重学习
- 上流程回放与对比

### Phase 3（2-4 周）

- 上 SKILL DSL（可配置编排）
- 上 A/B 编排实验（不同流程策略）
- 上质量看板

---

## 11. 讨论过程记录（完整）

> 以下是“从问题定义到最终方案”的完整讨论轨迹，保留每轮关键争论、取舍与结论。

### Round 1：问题定性

- 观察：当前 growing writer 已有能力点，但缺“统一编排中枢”
- 争论：是继续堆功能，还是先补编排骨架
- 决策：先补编排骨架，否则功能越多越乱

### Round 2：借鉴对象筛选

- 候选：借鉴 prompt、借鉴 UI、借鉴 SKILL 流程
- 争论：哪个可复用性最高
- 决策：借鉴 SKILL 流程（可执行、可约束、可追溯）

### Round 3：流程粒度

- 方案：4 步（前台一致） vs 7 步（全量语义）
- 争论：小白易用与系统严谨如何兼得
- 决策：前台 4 步 + 后台 3 步，语义仍为 7 步

### Round 4：核心实现范式

- 方案：Pipeline / FSM / Agent Loop
- 争论：速度 vs 可控
- 决策：FSM 基线，禁用自由 Agent Loop 做主流程

### Round 5：模板权重策略

- 观察：模板是历史材料的一种，但权重更高
- 争论：模板是否应绝对优先
- 决策：高优先但非绝对；必须保留冲突裁决和人工覆盖

### Round 6：反馈学习策略

- 观察：多次修改同一处，最终偏好才可信
- 争论：是否只记最终稿
- 决策：保留全链路 + 最新权重最大

### Round 7：规则入库策略

- 方案：自动入库 vs 候选待确认
- 争论：效率 vs 污染风险
- 决策：默认候选，需确认后生效；高风险场景严禁自动入库

### Round 8：模型介入边界

- 争论：是不是“全交给模型”
- 决策：模型做内容与分析；编排和策略由系统负责

### Round 9：上下文预算管理

- 争论：截断摘要由模型临时做，还是检索层预处理
- 决策：检索层预处理并缓存摘要，生成模型专注写作

### Round 10：可观测性

- 争论：先做功能还是先做日志
- 决策：日志必须同步做；否则后续不可优化

### Round 11：与现有代码兼容

- 观察：现有 API 能力足够作为子模块
- 决策：新增 workflow 接口，不推翻旧接口，渐进迁移

### Round 12：产品差异化落点

- 结论：真正差异化不是“会写”，而是“会按你的流程稳定地写，并且可解释地越写越像你”

---

## 12. 最终建议（可直接执行）

1. 先把编排状态机落地（不是继续堆 endpoint）。  
2. 把模板/规则/画像/反馈统一到同一权重与冲突框架。  
3. 把每轮生成与修改写成事件日志，支持回放。  
4. 把 SKILL 流程规范抽成 DSL，让编排可配置。  
5. 以“可追溯学习”作为核心卖点，而不是“多模型切换”。

---

## 13. 附：本次可引用文件

- [openclaw-skills/content-writer/SKILL.md](/Users/zw/Documents/growing writer/openclaw-skills/content-writer/SKILL.md)
- [openclaw-skills/content-writer/publish_presentation.py](/Users/zw/Documents/growing writer/openclaw-skills/content-writer/publish_presentation.py)
- [obsidian-mvp/ai-workflow-design.md](/Users/zw/Documents/growing writer/obsidian-mvp/ai-workflow-design.md)
- [obsidian-mvp/technical-implementation-plan.md](/Users/zw/Documents/growing writer/obsidian-mvp/technical-implementation-plan.md)
- [obsidian-mvp/app/src/web/public/app.js](/Users/zw/Documents/growing writer/obsidian-mvp/app/src/web/public/app.js)
- [obsidian-mvp/app/src/web/server.ts](/Users/zw/Documents/growing writer/obsidian-mvp/app/src/web/server.ts)

