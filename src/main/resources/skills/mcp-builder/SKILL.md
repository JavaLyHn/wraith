---
name: mcp-builder
description: |
  为 wraith 构建/接入 MCP(Model Context Protocol)server 的决策手册:何时该做 MCP、怎么设计工具与资源、怎么在 wraith 里注册连接。
  触发场景:用户想「给 Agent 加一个外部能力/接一个 MCP / 让 wraith 能调某系统」时。先 load_skill。
version: "1.0.0"
author: Wraith CLI
tags: [mcp, integration, tools]
---

# mcp-builder Skill

## 先判断:该用 MCP,还是别的?

- **该做 MCP**:能力可复用、需暴露一组结构化**工具/资源/提示词**给 Agent、或第三方已有 MCP server 可直接接。
- **不必 MCP**:一次性 shell 能搞定 → 直接 `execute_command`;只是读网页 → 用 web-access 技能;只是一段决策指引 → 写个 skill 就够。

## MCP server 三类能力

1. **tools**:Agent 可调用的动作(带 JSON Schema 入参)。设计要点:**单一职责**、参数最小、名字动词化、返回结构化且可读。
2. **resources**:可被 `@server:scheme://uri` 引用的只读内容(文件/数据)。
3. **prompts**:可复用的提示词模板。

## 设计准则

- **工具粒度**:一个工具做一件事。宁可多个小工具,不要一个「万能」工具塞一堆 mode。
- **入参 Schema 严格**:必填/可选/枚举写清楚,Agent 才能正确调用。
- **返回可读 + 可判成败**:成功给结构化结果,失败给明确错误文案(别只抛栈)。
- **幂等/安全**:有副作用的工具要能被审批拦截(危险操作交给 HITL)。
- **密钥**:server 自己的密钥走它自己的 env/配置,**绝不**回传进工具结果。

## 在 wraith 里接入

- wraith 通过 `McpServerManager` 连 MCP server;配置在 MCP 配置(`mcp.json` / 桌面「插件」面板)。
- 传输一般是 **stdio**(`command` + `args`)或 SSE/WS;首选 stdio(免公网、最简单)。
- 接好后:`/mcp` 查状态、`/mcp resources <name>`、`/mcp restart <name>`;桌面在「插件(Plugins)」面板管理。
- 资源可在对话里用 `@<server>:<scheme>://<uri>` 内联引用。

## 落地步骤

1. 明确要暴露哪几个 tool / resource(先列清单,别过度设计)。
2. 选 SDK(官方 MCP SDK:TS/Python 等),实现 stdio server。
3. 本地手测:能 list tools、能调用、错误路径正常。
4. 在 wraith MCP 配置里注册 → `/mcp` 确认连上 → 让 Agent 试调一次。

## 反模式

- ❌ 一个巨型工具塞十个功能靠 mode 参数分流。
- ❌ 工具返回一坨非结构化文本,Agent 没法判断成败。
- ❌ server 把 API key 拼进返回值/日志。
- ❌ 能力只用一次却包成 MCP(过度工程)。

> 面向 wraith 的 MCP 子系统整理;协议参考 anthropics MCP 规范与 anthropics/skills(mcp-builder)。
