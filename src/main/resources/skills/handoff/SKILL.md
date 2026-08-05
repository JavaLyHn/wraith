---
name: handoff
description: |
  把当前会话压缩成交接文档，让另一个 agent 接手。当用户要「交接 / handoff / 给下个会话留个交接 / 把进度打包给新线程 / 我要换会话继续」时使用。可接受参数描述下个会话要干什么，据此裁剪文档。
  触发场景：用户说「写个交接文档 / handoff / 我换会话了帮我交接 / 给下个 agent 留交接 / 打包进度 / 我要继续这个任务但换线程」。先 load_skill。
version: "1.0.0"
author: Wraith
tags: [process, handoff, session]
---

# 会话交接（Handoff）

## 概述

写一份交接文档，总结当前会话，让一个全新 agent 能接着干。存到用户操作系统的临时目录——不要存当前工作区。

## 必含

- **目标与上下文**——这个任务要解决什么、为什么。
- **已完成**——已做完的事，带文件路径/commit 引用。
- **进行中**——正做到哪一步、卡在哪。
- **待办**——还剩什么、建议的下一步。
- **关键决策与约束**——已敲定的决策、踩过的坑、不能违反的约束。
- **建议技能**——下个 agent 该 `load_skill` 哪些（基于待办性质）。

## 不要重复已有工件

不要复述已捕获在其他工件里的内容（specs、plans、ADR、issue、commit、diff）。用路径或 URL 引用它们。

## 脱敏

涂掉敏感信息：API key、密码、token、个人身份信息。代码里的密钥用 `<redacted>` 占位，不要原样抄进交接文档。

## 参数

若用户传了参数，把它当作对下个会话聚焦什么的描述，据此裁剪文档（详写相关部分、略写无关的）。

## 存哪

存到 OS 临时目录（macOS/Linux：`/tmp/` 或 `$TMPDIR`；Windows：`%TEMP%`），不存当前工作区——避免交接文档被误提交进仓库。给出完整路径让用户/下个 agent 能找到。

## 何时用

- 会话上下文要超限、需要压缩前交接
- 用户明确要换会话/换线程继续
- 长任务跨多个 agent session

## wraith 说明

- Wraith 的 `/export` 导出的是含完整 system prompt 的会话记录，偏调试用；handoff 是精炼的、面向接手者的、脱敏的交接文档，二者互补。
- 交接文档里引用的 commit / 分支 / 文件路径要写绝对或仓库相对路径，让下个 agent 能直接 `read_file` / `git show`。
- 建议技能段：根据待办列出技能名（如「实现前先 `load_skill brainstorming`；写代码前 `load_skill test-driven-development`」），下个 agent 会据此 `load_skill`。
- 临时目录文件名建议 `wraith-handoff-<timestamp>.md`，避免覆盖。
