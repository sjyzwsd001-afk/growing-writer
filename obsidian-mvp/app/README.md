# TypeScript CLI MVP

这个目录是 Obsidian 写作助手的本地 CLI 骨架。

## 当前已包含

- `schema` 类型定义
- vault markdown 读取
- task section 回写
- 材料和规则的基础匹配
- 5 个 CLI 命令入口

## 当前实现状态

下面这些步骤里，前四步已接模型，`learn-feedback` 目前仍是占位实现：

- `parse-task`
- `diagnose`
- `outline`
- `draft`
- `learn-feedback`
- `confirm-rule`
- `reject-rule`
- `disable-rule`
- `list-rules`
- `list-tasks`
- `list-feedback`
- `refresh-tasks`

当前 `learn-feedback` 已完成 CLI 接线、规则文件写入和回退逻辑；
配置模型后会走真实分析，不配置时仍返回占位结果。
如果分析结果可复用为规则，系统会新增 `rules/` 下的候选规则文件，
并回写 `feedback` 的分析结果与关联 rule id。

## 安装

```bash
npm install
```

## 模型配置

当前这些命令都已支持通过 OpenAI 兼容接口调用模型：

- `parse-task`
- `diagnose`
- `outline`
- `draft`
- `learn-feedback`

`confirm-rule` / `reject-rule` / `disable-rule` 不依赖模型，它们负责管理规则状态，并同步更新默认画像。
`list-rules` 用于快速查看当前规则库，也支持 `--json` 输出。
`list-tasks` 用于快速查看当前任务列表，也支持 `--json` 输出。
`list-feedback` 用于快速查看反馈记录，也支持 `--json` 输出。
`refresh-tasks` 用于按当前规则和材料状态批量刷新任务的参考依据与 matched_rules。
规则状态命令支持 `--reason`，用于记录确认、拒绝或停用原因。

可用环境变量：

```bash
export OPENAI_BEARER_TOKEN=your_token
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_MODEL=gpt-4.1-mini
```

兼容策略：

- 优先使用 `OPENAI_BEARER_TOKEN`
- 如果未配置，再回退使用 `OPENAI_API_KEY`

这意味着：

- 直接 API key 可以用
- OAuth access token 也可以用
- 其他 OpenAI-compatible 网关签发的 bearer token 也可以用

如果两个都不配置，CLI 会自动回退到本地占位实现。

## 使用

在 `app/` 目录执行：

```bash
npm run check
npm run dev -- diagnose ../tasks/your-task.md
```

或者：

```bash
npx tsx src/cli/index.ts draft ../tasks/your-task.md
npx tsx src/cli/index.ts learn-feedback ../feedback/feedback-demo.md
npx tsx src/cli/index.ts confirm-rule ../rules/rule-demo-candidate.md
npx tsx src/cli/index.ts reject-rule ../rules/rule-demo-candidate.md
npx tsx src/cli/index.ts disable-rule ../rules/rule-demo-candidate.md
npx tsx src/cli/index.ts list-rules --status confirmed
npx tsx src/cli/index.ts list-tasks --status draft
npx tsx src/cli/index.ts list-feedback --type logic
npx tsx src/cli/index.ts confirm-rule ../rules/rule-demo-candidate.md --reason "已在两次任务中验证有效"
npx tsx src/cli/index.ts refresh-tasks
```

## 下一步建议

1. 增加规则批量操作命令
2. 增加 profile 摘要自动整理
3. 增加材料列表命令
