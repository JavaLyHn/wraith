---
name: mcp-builder
description: |
  构建高质量 MCP(Model Context Protocol)服务的指南:通过设计良好的工具,让 LLM 与外部服务交互。构建 MCP 服务、集成外部 API 时使用(Python FastMCP 或 Node/TypeScript SDK)。
  触发场景:用户想「建一个 MCP 服务 / 把某 API 接成 MCP / 给 agent 加外部能力」时。先 load_skill。
version: "1.0.0"
author: Wraith CLI
tags: [mcp, integration, tools]
---

# MCP 服务开发指南

## 概述

构建 MCP 服务,让 LLM 通过设计良好的工具与外部服务交互。一个 MCP 服务的质量,以「它让 LLM 完成真实任务的能力」来衡量。

---

# 流程

## 🚀 高层工作流

构建高质量 MCP 服务分四个阶段:

### 阶段 1:深入研究与规划

#### 1.1 理解现代 MCP 设计

**API 覆盖 vs. 工作流工具:**
在「全面覆盖 API 端点」和「专门的工作流工具」之间平衡。工作流工具对特定任务更方便,全面覆盖给 agent 组合操作的灵活性。表现因客户端而异——有的受益于「用代码组合基础工具」,有的更适合高层工作流。拿不准时,优先全面 API 覆盖。

**工具命名与可发现性:**
清晰、描述性的工具名帮 agent 快速找到对的工具。用一致的前缀(如 `github_create_issue`、`github_list_repos`)+ 动作导向命名。

**上下文管理:**
agent 受益于简洁的工具描述 + 过滤/分页能力。设计返回聚焦、相关数据的工具。有的客户端支持代码执行,能帮 agent 高效过滤处理数据。

**可执行的错误信息:**
错误信息应带具体建议和下一步,引导 agent 走向解法。

#### 1.2 研读 MCP 协议文档

**浏览 MCP 规范:**
先看 sitemap 找相关页:`https://modelcontextprotocol.io/sitemap.xml`
再用 `.md` 后缀取具体页的 markdown(如 `https://modelcontextprotocol.io/specification/draft.md`)。

要点页:规范总览与架构、传输机制(streamable HTTP、stdio)、工具/资源/提示词定义。

#### 1.3 研读框架文档

**推荐技术栈:**
- **语言**:TypeScript(SDK 质量高、在很多执行环境兼容性好;AI 模型也擅长生成 TypeScript,得益于其广泛使用、静态类型和好的 lint 工具)
- **传输**:远程服务用 Streamable HTTP + 无状态 JSON(更易扩展维护,优于有状态会话+流式响应);本地服务用 stdio。

**加载框架文档:**
- **MCP 最佳实践**:[📋 见 references/mcp_best_practices.md](references/mcp_best_practices.md) —— 核心准则

**TypeScript(推荐):**
- **TypeScript SDK**:用 WebFetch 加载 `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- [⚡ TypeScript 指南](references/node_mcp_server.md) —— TS 模式与示例

**Python:**
- **Python SDK**:用 WebFetch 加载 `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
- [🐍 Python 指南](references/python_mcp_server.md) —— Python 模式与示例

#### 1.4 规划实现

**理解 API:** 看服务的 API 文档,识别关键端点、鉴权要求、数据模型。按需用 web search 和 WebFetch。
**工具选择:** 优先全面 API 覆盖。列出要实现的端点,从最常用的操作开始。

---

### 阶段 2:实现

#### 2.1 搭项目结构
见语言专属指南:[⚡ TypeScript](references/node_mcp_server.md)(结构/package.json/tsconfig)、[🐍 Python](references/python_mcp_server.md)(模块组织/依赖)。

#### 2.2 实现核心基础设施
建共享工具:带鉴权的 API 客户端、错误处理助手、响应格式化(JSON/Markdown)、分页支持。

#### 2.3 实现工具
每个工具:
- **入参 Schema:** 用 Zod(TS)或 Pydantic(Python);含约束和清晰描述;字段描述里加示例。
- **出参 Schema:** 尽量定义 `outputSchema`;工具响应用 `structuredContent`(TS SDK 特性);帮客户端理解处理输出。
- **工具描述:** 简洁功能摘要 + 参数描述 + 返回类型 schema。
- **实现:** I/O 用 async/await;错误处理带可执行信息;适用处支持分页;用现代 SDK 时同时返回文本内容和结构化数据。
- **注解:** `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`。

---

### 阶段 3:评审与测试

#### 3.1 代码质量
审:无重复代码(DRY)、一致的错误处理、完整类型覆盖、清晰的工具描述。

#### 3.2 构建与测试
- **TypeScript:** `npm run build` 验编译;MCP Inspector 测:`npx @modelcontextprotocol/inspector`
- **Python:** `python -m py_compile your_server.py` 验语法;MCP Inspector 测

详细测试方法与质量清单见语言专属指南。

---

### 阶段 4:创建评测

实现后,创建全面评测以检验有效性。**加载 [✅ 评测指南](references/evaluation.md) 获取完整指引。**

#### 4.1 评测目的
用评测检验 LLM 能否有效用你的 MCP 服务回答真实、复杂的问题。

#### 4.2 创建 10 个评测问题
按评测指南流程:1) 工具巡检 2) 用只读操作探索数据 3) 生成 10 个复杂真实问题 4) 自己解一遍验证答案。

#### 4.3 评测要求
每题应:**独立**(不依赖其它题)、**只读**(仅非破坏性操作)、**复杂**(需多次工具调用+深入探索)、**真实**(基于人真正在意的用例)、**可验证**(单一明确、可字符串比对的答案)、**稳定**(答案不随时间变)。

#### 4.4 输出格式
```xml
<evaluation>
  <qa_pair>
    <question>Find discussions about AI model launches with animal codenames. One model needed a specific safety designation that uses the format ASL-X. What number X was being determined for the model named after a spotted wild cat?</question>
    <answer>3</answer>
  </qa_pair>
<!-- More qa_pairs... -->
</evaluation>
```

---

# 参考文件

## 📚 文档库(按需加载)

### 核心 MCP 文档(先加载)
- **MCP 协议**:先看 sitemap `https://modelcontextprotocol.io/sitemap.xml`,再用 `.md` 后缀取具体页
- [📋 MCP 最佳实践](references/mcp_best_practices.md) —— 通用准则:命名约定、响应格式(JSON vs Markdown)、分页、传输选择、安全与错误处理

### SDK 文档(阶段 1/2 加载)
- **Python SDK**:`https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
- **TypeScript SDK**:`https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`

### 语言专属实现指南(阶段 2 加载)
- [🐍 Python 实现指南](references/python_mcp_server.md) —— 完整 Python/FastMCP:初始化、Pydantic 模型、`@mcp.tool` 注册、完整示例、质量清单
- [⚡ TypeScript 实现指南](references/node_mcp_server.md) —— 完整 TS:项目结构、Zod schema、`server.registerTool`、完整示例、质量清单

### 评测指南(阶段 4 加载)
- [✅ 评测指南](references/evaluation.md) —— 问题创建、答案验证、XML 格式、示例、用脚本跑评测

## wraith 说明

- 建好的 MCP 服务在 wraith 里通过 `McpServerManager` 接入(mcp.json / 桌面「插件」面板),`/mcp` 查看状态,`@server:scheme://uri` 引用资源。
- ⚠️ references/ 下 node_mcp_server / python_mcp_server / evaluation 及 scripts 为上游原文(未翻译);其中 evaluation + scripts 是 Anthropic 评测流水线,wraith 不运行。

---
> 本技能 SKILL.md 与 mcp_best_practices 完整翻译自 anthropics/skills `mcp-builder`(见 LICENSE.txt);巨型实现指南与评测基建原文保留。
