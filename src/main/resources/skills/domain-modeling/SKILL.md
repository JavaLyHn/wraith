---
name: domain-modeling
description: |
  构建和打磨项目的领域模型：把领域术语钉死成统一语言、把架构决策落成 ADR、在会话中主动挑战术语和边界。当用户要「统一术语 / 建领域模型 / 记架构决策 / 写 ADR / 我们的词汇表 / ubiquitous language / 这个概念到底叫什么」时使用。
  触发场景：用户说「这个词到底指什么 / 我们把术语统一一下 / 写个 ADR / 记一下这个架构决策 / 领域建模 / CONTEXT.md / 统一语言 / bounded context」。先 load_skill。
version: "1.0.0"
author: Wraith
tags: [design, domain, documentation]
---

# 领域建模（Domain Modeling）

## 概述

设计时主动构建和打磨项目的领域模型。这是*主动*纪律——挑战术语、发明边界场景、在术语/决策刚凝固的那一刻就写下来。

（只是*读* `CONTEXT.md` 拿词汇不是这个技能——那是一行习惯，任何技能都能做。这个技能用于你要*改*模型的时候，不是只*消费*它。）

## 文件结构

大多数仓库只有一个上下文：

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

如果根目录有 `CONTEXT-MAP.md`，仓库有多个上下文。map 指向每个上下文在哪：

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← 系统级决策
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                 ← 上下文级决策
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

文件懒创建——只在有东西可写时才建。没有 `CONTEXT.md` 就在第一个术语敲定时建；没有 `docs/adr/` 就在第一个 ADR 需要时建。

## 会话中

### 对照词汇表挑战

当用户用一个与 `CONTEXT.md` 现有语言冲突的词，立刻指出。「你的词汇表把『取消』定义为 X，但你说的像是 Y——到底是哪个？」

### 打磨模糊语言

当用户用模糊或过载的词，提出精确的规范词。「你说『账号』——指 Customer 还是 User？这是两个东西。」

### 讨论具体场景

当领域关系在讨论时，用具体场景压测。发明探边界、逼用户对概念边界精确的边缘案例。

### 与代码交叉验证

当用户说某事怎么运作时，查代码是否同意。发现矛盾就浮现：「你的代码取消整个 Order，但你刚说可以部分取消——哪个对？」

### 内联更新 CONTEXT.md

术语敲定就当场更新 `CONTEXT.md`。不要攒着——发生了就记。用 `references/context-format.md` 的格式。

`CONTEXT.md` 应彻底不含实现细节。别把它当 spec、草稿本或实现决策的仓库。它是一份词汇表，仅此而已。

### 慎用 ADR

只在三者全中时才提议建 ADR：

1. **难逆转**——改主意的代价实质
2. **没有上下文会令人困惑**——未来的读者会想「他们为什么这么做」
3. **真正权衡的结果**——有过真实替代方案，你因特定理由选了这个

缺任何一个就跳过。用 `references/adr-format.md` 的格式。

## wraith 说明

- Wraith 项目级记忆文件 `WRAITH.md` 是团队共享的项目规则，与 `CONTEXT.md`（领域词汇表）职责不同：前者放规则，后者放领域语言。不要把一次性经验写进 `WRAITH.md`，也别把实现细节写进 `CONTEXT.md`。
- 长期记忆走 `/save`，可审计可删除（`/memory list` / `/memory search` / `/memory delete` / `/memory clear`）。
- ADR 的 `docs/adr/` 与 Wraith 的 `docs/` 目录约定一致；编号顺延。
