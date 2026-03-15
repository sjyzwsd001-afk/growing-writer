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
- `batch-rules`
- `list-rules`
- `list-tasks`
- `list-feedback`
- `list-materials`
- `import-material`
- `import-materials-dir`
- `analyze-material`
- `refresh-tasks`
- `refresh-profile`

当前 `learn-feedback` 已完成 CLI 接线、规则文件写入和回退逻辑；
配置模型后会走真实分析，不配置时仍返回占位结果。
如果分析结果可复用为规则，系统会新增 `rules/` 下的候选规则文件，
并回写 `feedback` 的分析结果与关联 rule id。

## 安装

```bash
npm install
```

## 本地前端

如果你不想直接敲 CLI，现在可以启动一个本地 Web 控制台：

```bash
npm run web
```

默认地址：

```bash
http://127.0.0.1:4318
```

这个页面当前支持：

- 导入材料
- 查看材料 / 任务 / 规则 / 反馈
- 对任务运行 `diagnose / outline / draft`
- 对反馈运行 `learn-feedback`
- 对规则执行确认 / 停用 / 拒绝
- 刷新任务参考依据
- 刷新写作画像

注意：

- 这版前端是本地控制台，不是云端部署页面
- “导入文件”当前走的是本地文件路径输入，不是浏览器上传
- 所有结果仍然直接写回你的 Obsidian vault

## 模型配置

当前这些命令都已支持通过 OpenAI 兼容接口调用模型：

- `parse-task`
- `diagnose`
- `outline`
- `draft`
- `learn-feedback`

`confirm-rule` / `reject-rule` / `disable-rule` 不依赖模型，它们负责管理规则状态，并同步更新默认画像。
`batch-rules` 用于按状态或规则 id 批量执行确认/停用/拒绝。
`list-rules` 用于快速查看当前规则库，也支持 `--json` 输出。
`list-tasks` 用于快速查看当前任务列表，也支持 `--json` 输出。
`list-feedback` 用于快速查看反馈记录，也支持 `--json` 输出。
`list-materials` 用于快速查看材料库，也支持 `--json` 输出。
`import-material` 用于快速导入历史材料到标准模板，支持 `txt/md/docx/pdf`。
`import-materials-dir` 用于把目录下的 `txt/md/docx/pdf` 批量导入为标准材料文件。
`analyze-material` 用于对已导入材料重新生成一版初步结构分析。
`refresh-tasks` 用于按当前规则和材料状态批量刷新任务的参考依据与 matched_rules。
`refresh-profile` 用于根据已确认规则重建默认写作画像摘要。
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
npx tsx src/cli/index.ts batch-rules --action disable --status candidate --reason "批量清理待确认规则"
npx tsx src/cli/index.ts list-rules --status confirmed
npx tsx src/cli/index.ts list-tasks --status draft
npx tsx src/cli/index.ts list-feedback --type logic
npx tsx src/cli/index.ts list-materials --doc-type 风险汇报
npx tsx src/cli/index.ts import-material --title "某项目月报" --doc-type 工作汇报 --body "这里是正文"
npx tsx src/cli/index.ts import-material --title "旧方案" --doc-type 方案材料 --source-file ./old.docx
npx tsx src/cli/index.ts import-materials-dir --source-dir ./raw-materials --doc-type 工作汇报
npx tsx src/cli/index.ts analyze-material ../materials/your-material.md
npx tsx src/cli/index.ts confirm-rule ../rules/rule-demo-candidate.md --reason "已在两次任务中验证有效"
npx tsx src/cli/index.ts refresh-tasks
npx tsx src/cli/index.ts refresh-profile
```

## 下一步建议

1. 增加 task/profile 的批量诊断命令
2. 进一步优化材料分析的模型提示词
3. 增加规则确认后的自动 profile 刷新
