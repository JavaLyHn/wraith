---
name: requesting-code-review
description: |
  完成任务、实现重大功能、或合并前使用:派一个代码评审子 agent,在问题扩散前抓住它,核实工作是否满足要求。
  触发场景:做完一个任务/功能、准备合并前想让人(子 agent)过一遍代码时。先 load_skill。
version: "1.0.0"
author: Wraith CLI
tags: [process, review, quality]
---

# 请求代码评审(Requesting Code Review)

派一个代码评审子 agent,在问题扩散前抓住它。评审者拿到的是**精心裁剪的评估上下文**——绝不是你会话的历史。这让评审者聚焦于**工作产物**而非你的思考过程,也保住你自己的上下文继续干活。

**核心原则:早评审、常评审。**

## 何时请求评审

**强制:**
- 子 agent 驱动开发里每个任务之后
- 完成重大功能之后
- 合并到主干之前

**可选但有价值:**
- 卡住时(新视角)
- 重构前(基线检查)
- 修完复杂 bug 之后

## 怎么请求

**1. 拿 git SHA:**
```bash
BASE_SHA=$(git rev-parse HEAD~1)  # 或 origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

**2. 派代码评审子 agent:**

派一个 `general-purpose` 子 agent,填好 [code-reviewer.md](references/code-reviewer.md) 的模板。

**占位符:**
- `{DESCRIPTION}` - 你构建了什么的简述
- `{PLAN_OR_REQUIREMENTS}` - 它应该做什么
- `{BASE_SHA}` - 起始 commit
- `{HEAD_SHA}` - 结束 commit

**3. 依反馈行动:**
- Critical 立即修
- Important 继续前修
- Minor 记下稍后
- 评审者错了就(带理由)反驳

## 例

```
[刚完成 Task 2:加校验函数]

你:合并前先请求评审。

BASE_SHA=$(git log --oneline | grep "Task 1" | head -1 | awk '{print $1}')
HEAD_SHA=$(git rev-parse HEAD)

[派代码评审子 agent]
  DESCRIPTION: 加了 verifyIndex() 和 repairIndex(),4 种问题类型
  PLAN_OR_REQUIREMENTS: docs/superpowers/plans/deployment-plan.md 的 Task 2
  BASE_SHA: a7981ec
  HEAD_SHA: 3df7661

[子 agent 返回]:
  优点:架构干净、有真实测试
  问题:
    Important: 缺进度提示
    Minor: 上报间隔用了魔法数(100)
  评估:可以继续

你:[修进度提示]
[继续 Task 3]
```

## 与工作流集成

**子 agent 驱动开发:** 每个任务后评审,问题复合前抓住,修完再下一个。
**执行计划:** 每任务后或自然检查点评审,拿反馈、落实、继续。
**临时开发:** 合并前评审;卡住时评审。

## 危险信号

**永不:**
- 因「简单」跳过评审
- 无视 Critical
- 带着未修的 Important 继续
- 与「正确的技术反馈」争辩

**评审者错了:** 用技术理由反驳、拿能跑的代码/测试证明、请求澄清。

模板见:[code-reviewer.md](references/code-reviewer.md)

---
> 本技能完整翻译自 obra/superpowers(MIT)`requesting-code-review`;评审 prompt 模板在 references/。
