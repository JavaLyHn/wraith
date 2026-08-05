---
name: research
description: |
  把调研工作委派给后台代理：对照高可信一手来源调研一个问题，把发现写成带引用的 Markdown 文件存进仓库。当用户要「帮我调研一下 / 查一下某库的 API / 把阅读腿活外包出去 / research / 读文档整理出来 / 收集 API 事实」时使用。
  触发场景：用户说「帮我调研 X / 委派个 agent 去查 / 把这些文档读了整理 / research this / 收集 API 事实 / 对照一手来源 / 帮我读 legwork」。先 load_skill。
version: "1.0.0"
author: Wraith
tags: [process, research, delegation]
---

# 调研委派（Research）

## 概述

派一个**后台代理**去做调研，这样你（主线）可以继续干活，它在后面读。

## 它的职责

1. 对照**一手来源**调研问题——官方文档、源代码、规范、第一方 API——不是对它们的二手转述。每个论点追回到拥有它的来源。
2. 把发现写成单个 Markdown 文件，每个论点标注来源。
3. 存到仓库已有这类笔记的地方；匹配既有约定，没有就放个合理位置并说明在哪。

## 何时用

- 用户要某个主题被调研
- 要收集 API/库的事实
- 阅读腿活可以外包给后台，不阻塞主线
- 需要对照权威来源而非博客转述

## 何时不用

- 用户问的是**当前项目/当前代码**——那是本地上下文任务，该用 `glob_files` / `grep_code` / `read_file`，不是调研。
- 用户问的是时效性强的当前事实（价格、版本号、最新发布）——该用 `web_search` / `web_fetch`，调研委派适合需要读多个来源、整理带引用的长文。

## wraith 说明

- Wraith 的 Multi-Agent（`/team`）可派生后台子代理执行调研；子代理共享 ToolRegistry，能 `web_search` / `web_fetch` / `web-access` skill。
- 一手来源优先级：官方文档 / 源代码 / 规范 > 第一方 API > 二手博客。`web-access` skill 有站点模式库（GitHub、掘金、微信公众号等）帮助取可信页面。
- 调研产物若属长期稳定事实，可建议 `/save`；项目级领域语言相关结论可建议进 `CONTEXT.md`（见 domain-modeling skill）。
- 文件存位：仓库已有 `docs/` 就放 `docs/research/`；有 `research/` 或 `notes/` 就匹配；都没有就放项目根并说明。
