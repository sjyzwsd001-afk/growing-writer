# Growing Writer 用户手册

这是一份给小白看的使用手册。

如果你不想看代码、不想猜命令，只想知道：

- 现在能做什么
- 文件放哪
- 一步一步怎么用
- 哪些功能已经可用
- 哪些功能还只是第一版

看这份就够了。

---

## 1. 这套东西现在是什么

这是一个基于 `Obsidian + 本地 CLI` 的写作助手原型。

它现在已经能做这些事：

1. 导入你的历史材料
2. 自动给材料生成一版初步结构分析
3. 新建写作任务后，生成诊断、提纲、初稿
4. 记录你的反馈
5. 把反馈转成候选规则
6. 确认、拒绝、停用规则
7. 自动同步任务、规则、画像之间的关系
8. 用编排状态机记录每次写作流程（workflow run）
9. 规则命中支持权重与冲突裁决，并在“参考依据”里写出决策日志
10. 同一位置多次修改时，后端会持久化“位置反馈信号”，并按 latest-first 参与后续规则匹配
11. 工作流改为 DSL 驱动，定义文件在 `workflow/workflow-definition.json`
12. 设置页提供 DSL 图形化编辑入口，保存后实时生效（热更新）
13. DSL 编辑区下方提供实时流程图预览和结构校验提示（next/action 目标有效性、重复 stage id 等）
14. DSL 可视化编辑支持阶段新增、删除、上移下移、设初始阶段，且自动同步 JSON
15. 新建写作主界面新增 7 步流程状态条，并随编排 run 的当前阶段实时联动

一句话理解：

`它已经不是单纯“帮你写”的工具，而是一套能积累你写作规则的工作流。`

补充：从这版开始，前端“新建写作/再生成/定稿”会走编排状态机，阶段流转会记录到 `workflow-runs/`，便于回放与排错。

---

## 2. 你的文件都在哪

当前主要目录在这里：

- [obsidian-mvp](/Users/zw/Documents/growing writer/obsidian-mvp)

里面几个最重要的目录：

- [materials](/Users/zw/Documents/growing writer/obsidian-mvp/materials)
  历史材料库
- [rules](/Users/zw/Documents/growing writer/obsidian-mvp/rules)
  规则库
- [tasks](/Users/zw/Documents/growing writer/obsidian-mvp/tasks)
  写作任务
- [feedback](/Users/zw/Documents/growing writer/obsidian-mvp/feedback)
  反馈记录
- [profiles](/Users/zw/Documents/growing writer/obsidian-mvp/profiles)
  写作画像
- [app](/Users/zw/Documents/growing writer/obsidian-mvp/app)
  CLI 程序代码

如果你用 Obsidian，直接把 [obsidian-mvp](/Users/zw/Documents/growing writer/obsidian-mvp) 当成一个 vault 打开就行。

---

## 3. 开始之前要做什么

### 3.1 第一步：进入程序目录

在终端进入这里：

```bash
cd "/Users/zw/Documents/growing writer/obsidian-mvp/app"
```

### 3.2 第二步：安装依赖

第一次用时执行：

```bash
npm install
```

### 3.3 第三步：检查程序能不能跑

```bash
npm run check
```

如果没有报错，说明程序基础环境正常。

---

## 4. 如果你要用模型，需要怎么配

这套工具支持 `OpenAI 兼容接口`。

你可以用：

- `OPENAI_BEARER_TOKEN`
- 或 `OPENAI_API_KEY`

推荐这样设置：

```bash
export OPENAI_BEARER_TOKEN=你的token
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_MODEL=gpt-4.1-mini
```

### 4.1 如果你不配置 token，会怎样

也能用。

只是：

- `parse-task`
- `diagnose`
- `outline`
- `draft`
- `learn-feedback`
- `analyze-material`

这些地方会退回到本地的占位逻辑或启发式逻辑，效果会弱一些，但不会直接坏掉。

---

## 5. 现在已经能用的功能

下面这些命令都已经存在：

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

你不需要一下子全记住。  
最常用的其实只有几类：

1. 导入材料
2. 查看材料/任务/规则
3. 跑写作任务
4. 处理反馈
5. 管理规则
6. 刷新画像

---

## 6. 最推荐你的使用顺序

如果你是第一次真正开始用，我建议按这个顺序：

1. 导入历史材料
2. 看材料分析结果
3. 新建任务
4. 跑诊断
5. 跑提纲
6. 跑初稿
7. 记录反馈
8. 把反馈变成规则
9. 确认规则
10. 刷新画像

下面我按这个顺序详细讲。

---

## 7. 怎么导入历史材料

### 7.1 导入一篇纯文本材料

如果你手上只有一段文字，直接这样：

```bash
npx tsx src/cli/index.ts import-material \
  --title "某项目月报" \
  --doc-type "工作汇报" \
  --audience "领导" \
  --scenario "月度汇报" \
  --body "本月项目总体推进平稳，重点完成接口联调和测试准备。"
```

执行后，它会在 [materials](/Users/zw/Documents/growing writer/obsidian-mvp/materials) 下生成一个标准材料文件。

### 7.2 从文件导入一篇材料

支持这些格式：

- `txt`
- `md`
- `docx`
- `pdf`

比如导入 Word：

```bash
npx tsx src/cli/index.ts import-material \
  --title "旧方案" \
  --doc-type "方案材料" \
  --source-file ./old.docx
```

比如导入 PDF：

```bash
npx tsx src/cli/index.ts import-material \
  --title "历史汇报PDF" \
  --doc-type "工作汇报" \
  --source-file ./report.pdf
```

### 7.3 一次导入一个目录

如果你有很多历史材料放在一个目录里：

```bash
npx tsx src/cli/index.ts import-materials-dir \
  --source-dir ./raw-materials \
  --doc-type 工作汇报 \
  --audience 领导 \
  --scenario 月度汇报
```

当前批量导入支持：

- `txt`
- `md`
- `docx`
- `pdf`

会自动扫描目录，把每个文件导成一篇材料。

### 7.4 导入后会发生什么

导入后不仅会保存原文，还会自动生成一版：

- 开头功能
- 主体结构
- 结尾功能
- 风格观察
- 候选规则占位

也就是说，导入不是“只存档”，而是已经开始帮你做材料整理了。

---

## 8. 怎么看当前材料库

### 8.1 普通查看

```bash
npx tsx src/cli/index.ts list-materials
```

### 8.2 按文体筛选

```bash
npx tsx src/cli/index.ts list-materials --doc-type 工作汇报
```

### 8.3 JSON 输出

如果你后面想给脚本或其他工具用：

```bash
npx tsx src/cli/index.ts list-materials --json
```

---

## 9. 怎么重新分析一篇已经导入的材料

如果你改过材料内容，或者想重新生成一版结构分析：

```bash
npx tsx src/cli/index.ts analyze-material ../materials/你的材料文件.md
```

这个命令会重新更新那篇材料里的：

- 结构拆解
- 风格观察
- 候选规则占位

---

## 10. 怎么查看当前任务

### 10.1 查看任务列表

```bash
npx tsx src/cli/index.ts list-tasks
```

### 10.2 按状态筛选

```bash
npx tsx src/cli/index.ts list-tasks --status draft
```

### 10.3 JSON 输出

```bash
npx tsx src/cli/index.ts list-tasks --json
```

---

## 11. 怎么跑一篇写作任务

当前已有一个演示任务：

- [task-demo.md](/Users/zw/Documents/growing writer/obsidian-mvp/tasks/task-demo.md)

你也可以复制任务模板自己建新的任务文件。

### 11.1 第一步：任务解析

```bash
npx tsx src/cli/index.ts parse-task ../tasks/task-demo.md
```

它会把任务解析成结构化对象。

### 11.2 第二步：写前诊断

```bash
npx tsx src/cli/index.ts diagnose ../tasks/task-demo.md
```

这一步会：

- 分析任务
- 匹配规则
- 匹配材料
- 回写“写前诊断”
- 回写“参考依据”

### 11.3 第三步：生成提纲

```bash
npx tsx src/cli/index.ts outline ../tasks/task-demo.md
```

这一步会回写：

- 提纲
- 参考依据

### 11.4 第四步：生成初稿

```bash
npx tsx src/cli/index.ts draft ../tasks/task-demo.md
```

这一步会回写：

- 写前诊断
- 参考依据
- 提纲
- 初稿

### 11.5 一个很重要的点

这些命令现在已经做了“幂等处理”，也就是：

`你重复执行，不会再把同一段内容一层层叠上去。`

---

## 12. 怎么记录反馈

当前有一个演示反馈文件：

- [feedback-demo.md](/Users/zw/Documents/growing writer/obsidian-mvp/feedback/feedback-demo.md)

你也可以复制反馈模板，新建自己的反馈文件。

### 12.1 处理反馈

```bash
npx tsx src/cli/index.ts learn-feedback ../feedback/feedback-demo.md
```

这个命令会做这些事：

1. 读取反馈内容
2. 判断反馈类型
3. 判断是否值得沉淀为规则
4. 如果适合，会生成候选规则文件
5. 回写反馈文件
6. 在 task / rule / feedback 之间建立关联

### 12.2 现在这个功能的实际状态

这一步已经能跑通流程，但要实话实说：

- 有 token 时，会走真实模型分析
- 没 token 时，会回退到占位结果

也就是说，机制已经通了，但“判断质量”还在继续打磨。

---

## 13. 怎么查看反馈列表

### 13.1 普通查看

```bash
npx tsx src/cli/index.ts list-feedback
```

### 13.2 按反馈类型筛选

```bash
npx tsx src/cli/index.ts list-feedback --type logic
```

### 13.3 JSON 输出

```bash
npx tsx src/cli/index.ts list-feedback --json
```

---

## 14. 怎么管理规则

规则文件都在这里：

- [rules](/Users/zw/Documents/growing writer/obsidian-mvp/rules)

当前有一条演示规则：

- [rule-demo-candidate.md](/Users/zw/Documents/growing writer/obsidian-mvp/rules/rule-demo-candidate.md)

### 14.1 查看规则列表

```bash
npx tsx src/cli/index.ts list-rules
```

### 14.2 按状态看规则

```bash
npx tsx src/cli/index.ts list-rules --status confirmed
```

状态一般有：

- `candidate`
- `confirmed`
- `disabled`

### 14.3 确认规则

```bash
npx tsx src/cli/index.ts confirm-rule ../rules/rule-demo-candidate.md --reason "已在两次任务中验证有效"
```

这会：

- 把规则改成 `confirmed`
- 记录确认原因
- 同步到 profile
- 同步到 task 的 `matched_rules`

### 14.4 拒绝规则

```bash
npx tsx src/cli/index.ts reject-rule ../rules/rule-demo-candidate.md --reason "不适合作为长期规则"
```

### 14.5 停用规则

```bash
npx tsx src/cli/index.ts disable-rule ../rules/rule-demo-candidate.md --reason "规则过时，暂时停用"
```

### 14.6 批量处理规则

如果规则多了，可以批量操作：

```bash
npx tsx src/cli/index.ts batch-rules --action disable --status candidate --reason "批量清理待确认规则"
```

或者按 id 批量处理：

```bash
npx tsx src/cli/index.ts batch-rules --action confirm --ids rule-a,rule-b --reason "统一确认"
```

---

## 15. 规则变动后会自动影响什么

当你确认、停用、拒绝规则时，系统会自动联动：

1. 更新规则文件本身
2. 更新 profile
3. 更新 task 的 `matched_rules`

也就是说，规则不是孤立文件，而是整个系统的“活连接”。

---

## 16. 怎么刷新任务和画像

### 16.1 批量刷新任务

```bash
npx tsx src/cli/index.ts refresh-tasks
```

这会：

- 批量重算 task 的 matched rules
- 批量重写任务里的“参考依据”

适合你在修改规则后统一刷新。

### 16.2 刷新画像

```bash
npx tsx src/cli/index.ts refresh-profile
```

这会根据当前 `confirmed` 规则，重建默认画像摘要。

默认画像文件在这里：

- [default-profile.md](/Users/zw/Documents/growing writer/obsidian-mvp/profiles/default-profile.md)

### 16.3 在设置页图形化维护 Workflow DSL（推荐）

打开 Web 控制台后进入 `设置 -> Workflow DSL 编辑`，你会看到 3 块：

1. `DSL JSON`：完整定义，适合高级修改
2. `可视化编排编辑`：适合日常增删改
3. `流程图预览`：实时结构校验

日常最推荐这样用：

1. 点 `新增阶段`
2. 填阶段 `ID/标题/描述`
3. 填 `next`（逗号分隔）和 `actions`（每行 `action=target`）
4. 用 `设为初始` 或上方下拉指定 `initialStage`
5. 点 `保存 DSL`

你只要改可视化区域，JSON 会自动同步；如果你直接改 JSON，也会实时刷新可视化区和预览区。

如果你删掉某个阶段，系统会自动清理其他阶段里指向它的 `next/actions` 目标，避免脏引用。

---

## 17. 我最建议你的实际使用方法

如果你现在真的要开始用，而不是只看 demo，我建议你这样走：

### 路线 A：先喂材料

1. 准备一个目录，把历史材料放进去
2. 优先放 `docx / pdf / md / txt`
3. 批量导入

示例：

```bash
npx tsx src/cli/index.ts import-materials-dir \
  --source-dir ./raw-materials \
  --doc-type 工作汇报 \
  --audience 领导
```

### 路线 B：先验证任务流程

1. 打开 [task-demo.md](/Users/zw/Documents/growing writer/obsidian-mvp/tasks/task-demo.md)
2. 跑 `diagnose`
3. 跑 `outline`
4. 跑 `draft`
5. 看结果是否符合你的预期

### 路线 C：开始积累规则

1. 新建反馈文件
2. 跑 `learn-feedback`
3. 看是否生成候选规则
4. 决定确认、拒绝还是停用
5. 最后跑 `refresh-profile`

---

## 18. 你现在要注意的现实边界

这套东西已经能用，但它还是 `MVP`，所以你要知道边界：

### 已经比较稳的部分

- 材料导入
- 规则管理
- task / rule / profile / feedback 联动
- 各种列表命令
- 任务 section 的稳定回写

### 还在继续打磨的部分

- `learn-feedback` 的判断质量
- 材料结构分析的“像不像人”
- 模型分析提示词
- 更复杂的文体适配

### 你现在最适合拿它做什么

- 搭建你的材料库
- 开始沉淀规则库
- 跑一个完整 demo 工作流
- 验证“历史材料 + 规则”是否真的能提升写作质量

---

## 19. 最常用命令速查

如果你只想看最常用的一组，记这个就够了：

### 导入材料

```bash
npx tsx src/cli/index.ts import-material --title "标题" --doc-type 工作汇报 --source-file ./file.docx
```

### 批量导入材料

```bash
npx tsx src/cli/index.ts import-materials-dir --source-dir ./raw-materials --doc-type 工作汇报
```

### 跑任务

```bash
npx tsx src/cli/index.ts diagnose ../tasks/task-demo.md
npx tsx src/cli/index.ts outline ../tasks/task-demo.md
npx tsx src/cli/index.ts draft ../tasks/task-demo.md
```

### 处理反馈

```bash
npx tsx src/cli/index.ts learn-feedback ../feedback/feedback-demo.md
```

### 管规则

```bash
npx tsx src/cli/index.ts list-rules
npx tsx src/cli/index.ts confirm-rule ../rules/xxx.md --reason "原因"
```

### 刷新系统

```bash
npx tsx src/cli/index.ts refresh-tasks
npx tsx src/cli/index.ts refresh-profile
```

---

## 20. 如果你现在就要开始，我建议你先做这三件事

1. 准备一个 `raw-materials` 目录，把你过去的 Word / PDF / Markdown 材料放进去
2. 用 `import-materials-dir` 导入第一批材料
3. 跑一次 `list-materials`、`diagnose`、`draft`，看看第一轮体验

如果你愿意，我下一步可以继续直接帮你做两件很实用的事之一：

1. 我帮你写一份 `你的第一轮实际使用清单`，就按你现在这个项目定制
2. 我继续把这份手册同步精简进 [README.md](/Users/zw/Documents/growing writer/obsidian-mvp/app/README.md)，让入口文档也更好用
