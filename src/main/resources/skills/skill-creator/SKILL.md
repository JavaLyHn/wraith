---
name: skill-creator
description: |
  为 wraith 写一个「好用的」skill 的决策手册:frontmatter 怎么填、description 怎么写才会被正确触发、正文写成决策手册而非教程、references 怎么放。
  触发场景:用户想「新建一个技能 / 把某套做法固化成 skill / 帮我写 SKILL.md」时。先 load_skill。
version: "1.0.0"
author: Wraith CLI
tags: [meta, skill, authoring]
---

# skill-creator Skill

## 一个 skill 是什么

一份 **`SKILL.md` 决策手册**:告诉 Agent「**遇到某类任务时,该怎么判断、走哪条路、避哪些坑**」。不是 API 文档,不是教程,是「老手的临场决策清单」。

## 文件与生效机制

- 放在 `~/.wraith/skills/<名>/SKILL.md`(用户级)或 `<项目>/.wraith/skills/<名>/`(项目级);内置在 jar 内。
- 三层覆盖:**user > project > builtin**(同名后者盖前者)。
- 索引段(frontmatter)进系统提示;Agent 判定相关时调 `load_skill` 把正文拉进上下文。
- 桌面「技能」面板可新建/编辑,并支持加 references 附加文件。

## frontmatter(决定「会不会被触发」)

```yaml
---
name: my-skill                 # 目录名同步,仅 [A-Za-z0-9_-]
description: |                  # ★最关键:决定何时被加载
  一句话说清这个技能是干什么的决策手册。
  触发场景:列出用户会说的话/任务特征(越具体越准)。先 load_skill。
version: "1.0.0"
author: 你
tags: [分类, 关键词]
---
```

- **description 是触发开关**:写「做什么 + 什么场景触发」。太泛 → 到处乱触发;太窄 → 该用时不触发。用用户真实措辞举例。

## 正文怎么写(决策手册,不是教程)

1. **核心原则**:一两句点破这件事最重要的判断。
2. **何时用 / 何时不用**:边界写清楚,防滥用。
3. **流程 / 工具选择表**:有序步骤,或「什么场景→用什么」的表(参考内置 web-access)。
4. **关键约束 & 反模式**:老手才知道的坑、明确「不要做的事」。
5. 简短。**决策密度 > 篇幅**;能一张表说清就别写三段话。

## references(可选)

- 大段速查/站点经验/长模板放 `references/<file>.md`,正文里指路,按需 `read_file`。
- 别把所有内容堆进 SKILL.md 正文——正文要精,细节沉到 references。

## 验证

- 写完想:用户说哪句话时它该触发?会不会误触发别的场景?
- 桌面「技能 → 查看」确认正文 + references 都在;或 `/skill show <名>`。

## 反模式

- ❌ 把 SKILL.md 写成 API 教程/知识科普(Agent 要的是「怎么决策」)。
- ❌ description 含糊,导致该触发不触发、或到处乱触发。
- ❌ 正文又长又平,没有「何时不用」「反模式」这些真正省事的部分。
- ❌ 细节全塞正文,不用 references 分层。

> 面向 wraith skill 机制整理;思路参考 anthropics/skills(skill-creator)与 obra/superpowers。
