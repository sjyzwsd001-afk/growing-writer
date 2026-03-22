# Obsidian 写作助手 MVP

这是一版面向“可学习个人写法的材料助手”的 Obsidian 目录结构。

目标不是做通用知识库，而是让系统能围绕以下链路工作：

1. 积累历史材料
2. 提炼写作规则
3. 发起新写作任务
4. 生成提纲和初稿
5. 记录反馈并沉淀规则

## 目录结构

- `materials/` 历史材料库与正式模板
- `rules/` 规则库
- `tasks/` 写作任务与成稿
- `feedback/` 反馈与修改记录
- `profiles/` 写作画像
- `workflow-runs/` 编排运行记录
- `observability/` 模型调用与可观测性记录

## 推荐使用方式

1. 把这个目录作为 Obsidian vault 打开，或复制到现有 vault 中。
2. 把旧稿、范文和固定模板都导入 `materials/`；其中正式模板会通过 frontmatter 标记为模板。
3. 每导入 10-30 篇材料后，整理出第一版规则库。
4. 新任务从 `tasks/` 建立，定稿后也继续留在这里，方便回看完整链路。
5. 每次修改后，在 `feedback/` 中记录反馈，并把可复用经验转成规则。

## Obsidian 对接方式

这套仓库本身就是一个适合直接被 Obsidian 打开的知识库。

- 历史材料：放在 `materials/`
- 正式模板：也放在 `materials/`，但带模板标记
- 成稿任务：放在 `tasks/`
- 写作画像：放在 `profiles/`
- 规则库：放在 `rules/`
- 反馈记录：放在 `feedback/`

推荐的协作方式是：

1. 在 Obsidian 里长期管理和整理这些资产。
2. 在 Growing Writer 里负责导入、分析、生成、学习。
3. 定稿、规则、画像仍然回写到 Vault，继续沉淀成可复用知识。

## MVP 的核心原则

- 材料和规则都要可读、可改、可追溯
- 规则不要自动永久生效，先以候选规则形式出现
- 每次任务都要能追溯“参考了哪些材料、用了哪些规则”
- 反馈要区分一次性修改和长期规则

## 文档入口

- 用户手册：[USER_MANUAL_ZH.md](/Users/zw/Documents/growing writer/obsidian-mvp/USER_MANUAL_ZH.md)
- 下一阶段路线图：见用户手册第 21 节“下一阶段产品路线图”
