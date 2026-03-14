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

当前 `learn-feedback` 已完成 CLI 接线、规则文件写入和回退逻辑；
配置模型后会走真实分析，不配置时仍返回占位结果。

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
```

## 下一步建议

1. 优化反馈抽取，缩小给模型的反馈上下文
2. 把候选规则自动关联回反馈记录和任务记录
3. 继续优化规则确认流程
