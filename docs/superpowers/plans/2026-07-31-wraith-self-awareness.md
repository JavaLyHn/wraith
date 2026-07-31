# Wraith 自我认知 + 聊天内帮用户接入能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent 认识 Wraith 自身能力、正确回答元问题,并在聊天里一键帮用户打开功能面板 / 接入 IM(微信聊天内直出二维码)。

**Architecture:** 给 agent 两个「UI 意图」工具 `open_panel` / `im_connect`(注册在 `ToolRegistry`,与既有 14 工具并列,纯校验、无副作用)。它们的 `tool.call` 事件照常经既有回合事件流到渲染层;渲染层 `transcriptReducer` 对 `name ∈ {open_panel, im_connect}` 的调用**特判**成 `action` / `im-bind` transcript item,渲染成可交互动作卡。**不新造 AppServer 事件类型**。IM 绑定复用 `ImGatewayPanel` 既有的 bind IPC(`gatewayBindStart` / `gatewayBindWeixinStart` / `gatewayBindCancel` / `onGatewayEvent`),把 bind 事件归并逻辑抽成共享纯函数,面板与聊天卡同源。

**Tech Stack:** Java 17 / Maven(后端 `com.lyhn.wraith`);Electron + React + TypeScript(桌面 `desktop/`,vitest + RTL 测试,tsc typecheck)。

## Global Constraints

- 中文回复用户;代码 / 命令 / 文件名 / 路径保留原文。
- 所有 git 提交信息**必须**以这两行结尾(逐字):
  - `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  - `Claude-Session: https://claude.ai/code/session_0186i8XTzXVmK2TuYfAXXJAQ`
- `git add` **只**加本任务列出的文件;**绝不** `git add .` / `git add -A`;**绝不**触碰以下 WIP 文件:`README.md`、`demo/pom.xml`、`.claude/settings.json`、`demo/src/Hello.java`、`progress.md`。
- push 需用户显式同意;只 push 当前分支 `feat/windows-parity-block1`(绝不 `--all`)。本计划所有提交落在该分支。
- **不新造 AppServer 事件类型** —— 复用既有 `tool.call`,渲染层按 `name` 特判。
- **守密钥红线**:agent 绝不接触密钥;feishu/wecom 的密钥仍只在面板表单填、落 `~/.wraith/config.json`,聊天卡不碰密钥。
- 两个 UI 工具**无任何文件/命令副作用**,只做参数校验 + 返回确认串;不进 `AUDIT_TOOLS`、不走 HITL 审批。
- 面板 id 以 `App.tsx` 的 `setView` / `Sidebar` 的 `activeNav` 为准:`plugins`(即 MCP 面板)、`automations`、`im-gateway`、`providers`、`skills`、`memory`、`snapshots`、`tasks`、`policy`、`browser`、`rag`。LLM 可能用别名 `mcp` → 渲染层归一到 `plugins`。
- IM 平台:`qq` / `weixin` / `feishu` / `wecom`。**只有 weixin 后端会发 `qr` data-URI(聊天内内联二维码);qq 后端 `openExternal` 打开系统浏览器授权页、不发 qr;feishu/wecom 无扫码、退化到开面板填密钥。**
- IM 聊天卡**点击才启动绑定**(不在挂载时启动)—— transcript 历史回放会重建 `im-bind` item,挂载即 spawn 会在每次 resume 重启绑定进程。
- 回归门(每阶段末):`mvn test -DskipTests=false`(Java)+ `cd desktop && npm test`(vitest)+ `cd desktop && npm run typecheck`(tsc)全绿,零回归。测试基线以当前分支为准。
- 三阶段(A 自我认知 / B open_panel / C im_connect)各自可独立交付、独立测试;C 依赖 B 的 `onOpenPanel` 桥。

---

## 文件结构

**Stage A(prompt 层,纯后端资产)**
- Create: `src/main/resources/prompts/capabilities.md` —— Wraith 产品能力目录(11 面板)。
- Modify: `src/main/java/com/lyhn/wraith/prompt/PromptAssembler.java` —— 拼入 capabilities.md。
- Modify: `src/main/resources/prompts/base.md` —— Tool Policy 加「元问题」判别策略。
- Test: `src/test/java/com/lyhn/wraith/prompt/PromptAssemblerTest.java`(既有,追加断言)。

**Stage B(open_panel 动作卡)**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java` —— 加 `open_panel` 工具。
- Modify: `src/main/resources/prompts/base.md` —— Tools 列表加 `open_panel`。
- Test(Java): `src/test/java/com/lyhn/wraith/tool/ToolRegistryUiIntentTest.java`(新)。
- Create: `desktop/src/renderer/lib/panelActions.ts` —— PanelId / 中文名映射 / 归一化(纯)。
- Create: `desktop/src/renderer/components/ActionCard.tsx` —— 「打开 X 面板」按钮卡。
- Modify: `desktop/src/shared/transcriptReducer.ts` —— `action` Item 变体 + tool.call 特判。
- Modify: `desktop/src/renderer/components/Transcript.tsx` —— 渲染 `action` item + `onOpenPanel` prop。
- Modify: `desktop/src/renderer/App.tsx` —— 下传 `onOpenPanel`(→ `setView`)。
- Test(桌面):`desktop/test/panelActions.test.ts`、`desktop/test/actionCard.test.tsx`、`desktop/test/transcriptReducer.uiIntent.test.ts`(新)。

**Stage C(im_connect 内联绑定)**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java` —— 加 `im_connect` 工具。
- Modify: `src/main/resources/prompts/base.md` —— Tools 列表加 `im_connect`。
- Test(Java): 复用 `ToolRegistryUiIntentTest.java`(追加)。
- Create: `desktop/src/renderer/lib/imBind.ts` —— `applyBindEvent` 共享纯函数 + `BindState` 类型。
- Create: `desktop/src/renderer/components/ImConnectCard.tsx` —— 点击启动绑定的内联卡。
- Modify: `desktop/src/renderer/components/ImGatewayPanel.tsx` —— 改用 `applyBindEvent`(去重,不复制)。
- Modify: `desktop/src/shared/transcriptReducer.ts` —— `im-bind` Item 变体 + tool.call 特判。
- Modify: `desktop/src/renderer/components/Transcript.tsx` —— 渲染 `im-bind` item。
- Test(桌面):`desktop/test/imBind.test.ts`、`desktop/test/imConnectCard.test.tsx`、扩充 `transcriptReducer.uiIntent.test.ts`。

---

## Stage A —— Wraith 自我认知(prompt 层)

### Task A1: capabilities.md 资产 + PromptAssembler 拼入

**Files:**
- Create: `src/main/resources/prompts/capabilities.md`
- Modify: `src/main/java/com/lyhn/wraith/prompt/PromptAssembler.java:24-43`
- Test: `src/test/java/com/lyhn/wraith/prompt/PromptAssemblerTest.java`

**Interfaces:**
- Consumes: `PromptRepository.loadRequired("capabilities.md")`(与 `loadRequired("base.md")` / `loadRequired("handoff.md")` 同解析规则,资源在 `prompts/` 下)。
- Produces: 组装后的系统提示词包含 `## Wraith 产品能力（本产品自身）` 段;后续 Stage B/C 的元问题策略、Stage A2 的 base.md 规则都引用此段标题。

- [ ] **Step 1: 追加断言到既有 assembler 测试(先失败)**

在 `PromptAssemblerTest.java` 追加:

```java
    @Test
    void injectsWraithCapabilitiesCatalog() {
        // Wraith 自我认知:系统提示词须含「产品能力目录」,让 agent 能回答元问题、不去 grep 用户项目。
        String prompt = PromptAssembler.createDefault().assemble(PromptMode.AGENT, PromptContext.empty());
        assertTrue(prompt.contains("Wraith 产品能力"), "系统提示词应含 Wraith 产品能力目录标题");
        assertTrue(prompt.contains("IM 网关"), "能力目录应列出 IM 网关");
        assertTrue(prompt.contains("代码检索"), "能力目录应列出代码检索(RAG)面板");
    }
```

- [ ] **Step 2: 运行,确认失败**

Run: `mvn -q -DskipTests=false -Dtest=PromptAssemblerTest test`
Expected: FAIL —— `injectsWraithCapabilitiesCatalog` 断言 `Wraith 产品能力` 不存在。

- [ ] **Step 3: 创建 `capabilities.md`**

写入 `src/main/resources/prompts/capabilities.md`(完整内容,勿留占位):

```markdown
## Wraith 产品能力（本产品自身）

以下是 **Wraith 自身**（你所运行的这个产品）的能力目录，不是用户当前项目的代码。当用户问「Wraith 有没有 / 支不支持 / 怎么用 / 怎么接入 X 功能」这类**关于本产品自身**的问题时，依据本目录直接回答并指路（打开哪个面板、几步），**不要用 `grep_code` / `glob_files` / `search_code` 去搜用户项目代码**——那会答错（这些能力在 Wraith 里，不在用户项目里）。只有用户明确问「当前项目」的代码 / 文件时才搜项目。

Wraith 提供以下功能面板（桌面端左侧工具栏）：

| 能力 | 是什么 | 怎么用 / 指路 |
|---|---|---|
| **IM 网关** | 让 Wraith 经 QQ / 飞书 / 企业微信 / 微信 收发消息、跑回合、HITL 审批 | 微信：扫码绑定（聊天内可直出二维码）；QQ：一键打开浏览器授权页；飞书 / 企业微信：填密钥→启动守护。想接入时可调 `im_connect`；只想打开面板可调 `open_panel(im-gateway)` |
| **MCP** | 接外部 MCP server（stdio / HTTP），给自己加动态工具 | MCP 面板加 server（命令或 URL）→启用 / 重启；或编辑 `~/.wraith/mcp.json`。`open_panel(plugins)` |
| **自动化** | 定时 / cron agent 任务 + 投递目标（可投 IM）+ HITL 审批 | 自动化面板新建任务：cron 表达式 + 投递目标 + 审批策略。`open_panel(automations)` |
| **Provider 配置** | 选 / 配 LLM 供应商（DeepSeek / GLM / Kimi / Anthropic / StepFun / 兼容 OpenAI） | Provider 面板填 API key→设默认供应商 / 模型。`open_panel(providers)` |
| **技能（Skills）** | 用户级 / 项目级 Skill 文件，按需 load | 技能面板新建 / 编辑 / 启用；或放 `~/.wraith/skills`、`<项目>/.wraith/skills`。`open_panel(skills)` |
| **记忆** | 长期记忆 + 候选待批自动提取 | 记忆面板搜索 / 保存 / 在「待确认区」批准候选；CLI `/memory pending·approve·reject`。`open_panel(memory)` |
| **快照** | 每轮工作区快照 + 恢复 / 回滚 | 快照面板列表 / 恢复某快照；聊天里可用 `revert_turn` 回滚最近若干轮。`open_panel(snapshots)` |
| **后台任务** | 持久异步 agent 任务（发后即走） | 后台任务面板新建 / 查看 / 取消；或 `/task add …`。`open_panel(tasks)` |
| **安全** | 沙箱 + 命令 / 路径围栏 + 审计日志 | 安全面板看策略状态 / 审计；可切沙箱（macOS Seatbelt）。这是 HITL + 围栏 + 审计，非容器沙箱。`open_panel(policy)` |
| **浏览器** | 连本机 Chrome（CDP）驱动浏览 / 登录态任务 | 浏览器面板连接本机 Chrome；聊天里可 `browser_connect`。SPA / 需登录态用它。`open_panel(browser)` |
| **代码检索** | 语义索引 / 搜索（RAG）+ 代码关系图 | 代码检索面板建索引 / 搜索 / graph；聊天里 `search_code` 语义检索。`open_panel(rag)` |
```

- [ ] **Step 4: PromptAssembler 拼入 capabilities.md**

在 `PromptAssembler.assemble()` 里，`if (!ctx.toolsEnabled()) { append(prompt, noToolsSection()); }` 之后、`append(prompt, repository.loadRequired("personalities/calm.md"));` 之前，插入一行:

```java
        if (!ctx.toolsEnabled()) {
            append(prompt, noToolsSection());
        }
        append(prompt, repository.loadRequired("capabilities.md"));
        append(prompt, repository.loadRequired("personalities/calm.md"));
```

（无条件拼入:自我认知不依赖当前 provider 是否支持工具调用；即便工具关闭，元问题仍可据此用文字作答。）

- [ ] **Step 5: 运行测试,确认通过**

Run: `mvn -q -DskipTests=false -Dtest=PromptAssemblerTest test`
Expected: PASS（含既有全部用例,零回归）。

- [ ] **Step 6: 提交**

```bash
git add src/main/resources/prompts/capabilities.md src/main/java/com/lyhn/wraith/prompt/PromptAssembler.java src/test/java/com/lyhn/wraith/prompt/PromptAssemblerTest.java
git commit -m "feat(prompt): Wraith 产品能力目录 capabilities.md + PromptAssembler 拼入(自我认知 Stage A1)"
```

---

### Task A2: base.md 元问题判别策略

**Files:**
- Modify: `src/main/resources/prompts/base.md`(Tool Policy 段,约 `:28-41`)
- Test: `src/test/java/com/lyhn/wraith/prompt/PromptAssemblerTest.java`

**Interfaces:**
- Consumes: capabilities.md 已由 A1 拼入(本策略指引 agent 依据「Wraith 产品能力」目录回答)。
- Produces: 无新符号;仅提示词行为约束。

- [ ] **Step 1: 追加断言(先失败)**

在 `PromptAssemblerTest.java` 追加:

```java
    @Test
    void toolPolicyRoutesMetaQuestionsToCapabilities() {
        // 防回归:问 Wraith 自身能力时必须据能力目录作答,不得 grep 用户项目(修「问 IM 集成答没有」的缺口)。
        String prompt = PromptAssembler.createDefault().assemble(PromptMode.AGENT, PromptContext.empty());
        assertTrue(prompt.contains("Wraith 自身能力"), "Tool Policy 应含元问题判别策略");
    }
```

- [ ] **Step 2: 运行,确认失败**

Run: `mvn -q -DskipTests=false -Dtest=PromptAssemblerTest#toolPolicyRoutesMetaQuestionsToCapabilities test`
Expected: FAIL。

- [ ] **Step 3: base.md Tool Policy 加一条**

在 `## Tool Policy` 段末(当前 `:41` 那条图片兜底之后)追加:

```markdown
- 当用户问的是 **Wraith 自身能力**（如「有哪些 IM 集成 / 支不支持定时任务 / 怎么接微信 / 怎么配 MCP / 有没有代码检索」）时，依据系统提示词里的「Wraith 产品能力」目录直接回答并指路（打开哪个面板、几步）；能一键帮用户操作的用 `open_panel` / `im_connect` 呈现入口。**不要** 用 `grep_code` / `glob_files` / `search_code` 去搜用户项目代码——这些能力在 Wraith 产品里、不在用户项目里，搜项目会答错。只有用户明确问**当前项目**的代码 / 文件时才搜项目。
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `mvn -q -DskipTests=false -Dtest=PromptAssemblerTest test`
Expected: PASS（全部用例）。

- [ ] **Step 5: Stage A 回归门**

Run: `mvn -q -DskipTests=false test`
Expected: 全绿(以当前分支基线为准)。

- [ ] **Step 6: 提交**

```bash
git add src/main/resources/prompts/base.md src/test/java/com/lyhn/wraith/prompt/PromptAssemblerTest.java
git commit -m "feat(prompt): Tool Policy 加元问题判别——问 Wraith 自身能力据目录答不 grep 项目(Stage A2)"
```

---

## Stage B —— `open_panel` 动作卡

### Task B1: 后端 `open_panel` 工具 + base.md 登记

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java:127-149`(构造器) + 新增私有方法
- Modify: `src/main/resources/prompts/base.md:26`(Tools 列表,`mcp__{server}__{tool}` 之后)
- Test: `src/test/java/com/lyhn/wraith/tool/ToolRegistryUiIntentTest.java`(新)

**Interfaces:**
- Consumes: 既有 `Tool` record(`name, description, JsonNode parameters, ToolExecutor executor`)、`createParameters(Param...)`、`new Param(name,type,desc,required)`、`executeTool(String,String)`。
- Produces: 工具名 `open_panel`,参数 `{"panel": "<id>"}`,合法 id 见 Global Constraints(别名 `mcp`→`plugins`);返回确认串或 `open_panel 失败: …`。经 `getToolDefinitions()` 自动暴露给 LLM。

- [ ] **Step 1: 写失败测试**

创建 `src/test/java/com/lyhn/wraith/tool/ToolRegistryUiIntentTest.java`:

```java
package com.lyhn.wraith.tool;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class ToolRegistryUiIntentTest {

    @Test
    void openPanelAcceptsKnownPanel() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("open_panel", "{\"panel\":\"im-gateway\"}");
        assertTrue(out.contains("im-gateway"), "合法面板应回确认串,含面板 id;实际: " + out);
    }

    @Test
    void openPanelNormalizesMcpAlias() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("open_panel", "{\"panel\":\"mcp\"}");
        assertTrue(out.contains("plugins"), "别名 mcp 应归一到 plugins;实际: " + out);
    }

    @Test
    void openPanelRejectsUnknownPanel() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("open_panel", "{\"panel\":\"nope\"}");
        assertTrue(out.startsWith("open_panel 失败"), "非法面板应回失败串;实际: " + out);
    }

    @Test
    void openPanelIsExposedToLlm() {
        ToolRegistry reg = new ToolRegistry();
        boolean present = reg.getToolDefinitions().stream().anyMatch(t -> t.name().equals("open_panel"));
        assertTrue(present, "open_panel 应出现在 getToolDefinitions()");
    }
}
```

- [ ] **Step 2: 运行,确认失败**

Run: `mvn -q -DskipTests=false -Dtest=ToolRegistryUiIntentTest test`
Expected: FAIL —— `未知工具: open_panel`。

- [ ] **Step 3: 注册 `open_panel` 工具**

在 `ToolRegistry` 构造器的注册序列末尾加一行调用:

```java
        registerTodoTools();
        registerOpenPanelTool();
```

新增私有方法(放在 `registerTodoTools()` 附近):

```java
    /** UI 意图工具:呈现「打开某功能面板」入口。纯校验、无副作用;桌面渲染层特判成动作卡。 */
    private void registerOpenPanelTool() {
        Set<String> panels = Set.of(
                "plugins", "automations", "im-gateway", "providers", "skills",
                "memory", "snapshots", "tasks", "policy", "browser", "rag");
        tools.put("open_panel", new Tool(
                "open_panel",
                "在桌面对话中为用户呈现「打开某功能面板」的一键入口。当你引导用户去用 Wraith 的某个功能面板"
                        + "(plugins=MCP / automations / im-gateway / providers / skills / memory / snapshots / tasks / policy / browser / rag)时调用。"
                        + "仅呈现入口,不产生任何文件或命令副作用。",
                createParameters(new Param("panel", "string",
                        "面板 id:plugins(MCP)|automations|im-gateway|providers|skills|memory|snapshots|tasks|policy|browser|rag", true)),
                args -> {
                    String raw = args.get("panel");
                    String norm = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
                    if ("mcp".equals(norm)) {
                        norm = "plugins";
                    }
                    if (!panels.contains(norm)) {
                        return "open_panel 失败: 未知面板 '" + raw + "',可选:" + String.join("/", panels);
                    }
                    return "已在桌面对话中为用户呈现「打开 " + norm + " 面板」的一键入口(桌面端显示为可点动作卡)。";
                }
        ));
    }
```

（`Locale` 与 `Set` 已在 `ToolRegistry` import 中。）

- [ ] **Step 4: 运行测试,确认通过**

Run: `mvn -q -DskipTests=false -Dtest=ToolRegistryUiIntentTest test`
Expected: PASS。

- [ ] **Step 5: base.md Tools 列表登记**

在 `## Tools` 列表 `mcp__{server}__{tool}` 那条(`:26`)之后追加:

```markdown
15. `open_panel` - 呈现「打开某功能面板」的一键入口,参数：`{"panel": "im-gateway"}`（合法：plugins/automations/im-gateway/providers/skills/memory/snapshots/tasks/policy/browser/rag）
```

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/tool/ToolRegistry.java src/test/java/com/lyhn/wraith/tool/ToolRegistryUiIntentTest.java src/main/resources/prompts/base.md
git commit -m "feat(tool): open_panel UI 意图工具(纯校验+mcp 别名归一)+ base.md 登记(Stage B1)"
```

---

### Task B2: `panelActions.ts` 纯模块

**Files:**
- Create: `desktop/src/renderer/lib/panelActions.ts`
- Test: `desktop/test/panelActions.test.ts`

**Interfaces:**
- Produces: `type PanelId`(11 个 id 联合);`PANEL_LABELS: Record<PanelId,string>`(id→中文名);`normalizePanel(raw: string): PanelId | null`(`mcp`→`plugins`,非法→null)。B3/B4/B5、C4 都消费之。

- [ ] **Step 1: 写失败测试**

创建 `desktop/test/panelActions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizePanel, PANEL_LABELS } from '../src/renderer/lib/panelActions'

describe('panelActions', () => {
  it('合法 id 原样返回', () => {
    expect(normalizePanel('im-gateway')).toBe('im-gateway')
    expect(normalizePanel('rag')).toBe('rag')
  })
  it('mcp 别名归一到 plugins', () => {
    expect(normalizePanel('mcp')).toBe('plugins')
    expect(normalizePanel('MCP')).toBe('plugins')
  })
  it('非法 id 返回 null', () => {
    expect(normalizePanel('nope')).toBeNull()
    expect(normalizePanel('')).toBeNull()
  })
  it('每个 PanelId 都有中文名', () => {
    expect(PANEL_LABELS['im-gateway']).toBe('IM 网关')
    expect(PANEL_LABELS['plugins']).toBe('MCP')
  })
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd desktop && npx vitest run test/panelActions.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

创建 `desktop/src/renderer/lib/panelActions.ts`:

```ts
/**
 * panelActions —— 纯 TS,无 React/Electron 依赖。
 * 面板 id ↔ 中文名映射 + LLM 传入 panel 参数的归一化(mcp→plugins)。
 * 与 App.tsx 的 setView / Sidebar 的 activeNav 对齐。
 */

export type PanelId =
  | 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills'
  | 'memory' | 'snapshots' | 'tasks' | 'policy' | 'browser' | 'rag'

export const PANEL_LABELS: Record<PanelId, string> = {
  plugins: 'MCP',
  automations: '自动化',
  'im-gateway': 'IM 网关',
  providers: 'Provider 配置',
  skills: '技能',
  memory: '记忆',
  snapshots: '快照',
  tasks: '后台任务',
  policy: '安全',
  browser: '浏览器',
  rag: '代码检索',
}

/** LLM 传入 panel 参数归一:trim + 小写,别名 mcp→plugins;非法返回 null。 */
export function normalizePanel(raw: string): PanelId | null {
  const s = (raw || '').trim().toLowerCase()
  const alias = s === 'mcp' ? 'plugins' : s
  return Object.prototype.hasOwnProperty.call(PANEL_LABELS, alias) ? (alias as PanelId) : null
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd desktop && npx vitest run test/panelActions.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/lib/panelActions.ts desktop/test/panelActions.test.ts
git commit -m "feat(desktop): panelActions 纯模块——PanelId/中文名/归一化(mcp→plugins)(Stage B2)"
```

---

### Task B3: transcriptReducer `action` 变体 + tool.call 特判

**Files:**
- Modify: `desktop/src/shared/transcriptReducer.ts`(`Item` 联合 `:129-138`;`tool.call` case `:350-356`)
- Test: `desktop/test/transcriptReducer.uiIntent.test.ts`(新)

**Interfaces:**
- Consumes: 既有 `tool.call` 事件(`callId, name, argsJson`)。
- Produces: `Item` 新增 `{ type: 'action'; panel: string }`;当 `tool.call` 的 `name === 'open_panel'` 时归约为 `action` item(而非 `tool` card)。B5 的 Transcript 渲染消费之。

- [ ] **Step 1: 写失败测试**

创建 `desktop/test/transcriptReducer.uiIntent.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { transcriptReducer, initialTranscriptState, type Item } from '../src/shared/transcriptReducer'

function lastItem(items: Item[]): Item { return items[items.length - 1] }

describe('transcriptReducer —— open_panel 特判', () => {
  it('open_panel 的 tool.call 归约成 action item(非 tool card)', () => {
    const s = transcriptReducer(initialTranscriptState(), {
      type: 'tool.call', callId: 'c1', name: 'open_panel', argsJson: '{"panel":"im-gateway"}',
    })
    const it = lastItem(s.items)
    expect(it.type).toBe('action')
    expect((it as { type: 'action'; panel: string }).panel).toBe('im-gateway')
  })
  it('普通工具仍归约成 tool card', () => {
    const s = transcriptReducer(initialTranscriptState(), {
      type: 'tool.call', callId: 'c2', name: 'read_file', argsJson: '{"path":"a.txt"}',
    })
    expect(lastItem(s.items).type).toBe('tool')
  })
  it('argsJson 非法时 panel 回退空串,不抛', () => {
    const s = transcriptReducer(initialTranscriptState(), {
      type: 'tool.call', callId: 'c3', name: 'open_panel', argsJson: 'not-json',
    })
    const it = lastItem(s.items)
    expect(it.type).toBe('action')
    expect((it as { type: 'action'; panel: string }).panel).toBe('')
  })
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd desktop && npx vitest run test/transcriptReducer.uiIntent.test.ts`
Expected: FAIL —— open_panel 目前归约成 `tool`。

- [ ] **Step 3: 加 Item 变体 + 特判 + 安全 parse 助手**

在 `Item` 联合类型(`export type Item =` 处)加一支:

```ts
  | { type: 'diff'; filePath: string; before: string; after: string }
  | { type: 'action'; panel: string }
  | PlanItem
```

在文件的 helper 区(如 `updateToolCard` 上方)加:

```ts
/** 从工具 argsJson 安全取一个字符串字段;非法 JSON / 缺字段 → 空串,绝不抛。 */
function toolArgString(argsJson: string, key: string): string {
  try {
    const o = JSON.parse(argsJson) as Record<string, unknown>
    return typeof o?.[key] === 'string' ? (o[key] as string) : ''
  } catch {
    return ''
  }
}
```

改 `case 'tool.call':`,在构造 `card` 之前特判:

```ts
    case 'tool.call': {
      const callId = typeof p['callId'] === 'string' ? p['callId'] : ''
      const name = typeof p['name'] === 'string' ? p['name'] : ''
      const argsJson = typeof p['argsJson'] === 'string' ? p['argsJson'] : ''
      // UI 意图工具:特判成动作卡 item,不走 ToolCard(其 tool.result/tool.output.delta 因无匹配 callId 安全忽略)。
      if (name === 'open_panel') {
        return { ...state, items: [...state.items, { type: 'action', panel: toolArgString(argsJson, 'panel') }] }
      }
      const card: ToolCard = { callId, name, argsJson, output: '', done: false }
      return { ...state, items: [...state.items, { type: 'tool', card }] }
    }
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd desktop && npx vitest run test/transcriptReducer.uiIntent.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + 提交**

Run: `cd desktop && npm run typecheck`
Expected: 0 error（`action` 变体的所有 switch/分支已在别处兜底为 `default: null`,无穷尽性报错）。

```bash
git add desktop/src/shared/transcriptReducer.ts desktop/test/transcriptReducer.uiIntent.test.ts
git commit -m "feat(desktop): transcriptReducer 加 action 变体 + open_panel tool.call 特判(Stage B3)"
```

---

### Task B4: `ActionCard.tsx` 组件

**Files:**
- Create: `desktop/src/renderer/components/ActionCard.tsx`
- Test: `desktop/test/actionCard.test.tsx`

**Interfaces:**
- Consumes: `normalizePanel` / `PANEL_LABELS` / `PanelId`(B2)。
- Produces: 默认导出 `ActionCard`,props `{ panel: string; onOpenPanel: (id: PanelId) => void }`;合法 panel 渲染按钮(`data-testid="action-card"`),点击调 `onOpenPanel(归一化 id)`;非法 panel 渲染 `null`。

- [ ] **Step 1: 写失败测试**

创建 `desktop/test/actionCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ActionCard from '../src/renderer/components/ActionCard'

afterEach(() => cleanup())

describe('ActionCard', () => {
  it('合法 panel 渲染中文名按钮,点击调 onOpenPanel(归一化 id)', () => {
    const onOpenPanel = vi.fn()
    render(<ActionCard panel="im-gateway" onOpenPanel={onOpenPanel} />)
    const btn = screen.getByTestId('action-card')
    expect(btn.textContent).toContain('IM 网关')
    fireEvent.click(btn)
    expect(onOpenPanel).toHaveBeenCalledWith('im-gateway')
  })
  it('别名 mcp 归一到 plugins', () => {
    const onOpenPanel = vi.fn()
    render(<ActionCard panel="mcp" onOpenPanel={onOpenPanel} />)
    fireEvent.click(screen.getByTestId('action-card'))
    expect(onOpenPanel).toHaveBeenCalledWith('plugins')
  })
  it('非法 panel 渲染 null(无按钮)', () => {
    render(<ActionCard panel="nope" onOpenPanel={vi.fn()} />)
    expect(screen.queryByTestId('action-card')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd desktop && npx vitest run test/actionCard.test.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现**

创建 `desktop/src/renderer/components/ActionCard.tsx`:

```tsx
import { normalizePanel, PANEL_LABELS, type PanelId } from '../lib/panelActions'

interface ActionCardProps {
  /** 后端 open_panel 工具传来的原始 panel id(可能是别名 mcp)。 */
  panel: string
  /** 打开面板(App.tsx 注入,内部 setView)。 */
  onOpenPanel: (id: PanelId) => void
}

/** 聊天内「打开某功能面板」动作卡。非法 panel 渲染 null(容错,不炸)。 */
export default function ActionCard({ panel, onOpenPanel }: ActionCardProps): JSX.Element | null {
  const id = normalizePanel(panel)
  if (!id) return null
  return (
    <button
      data-testid="action-card"
      onClick={() => onOpenPanel(id)}
      className="self-start flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg hover:border-accent hover:text-accent transition-colors"
    >
      <span aria-hidden>🧭</span>
      <span>打开 {PANEL_LABELS[id]} 面板</span>
    </button>
  )
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd desktop && npx vitest run test/actionCard.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/renderer/components/ActionCard.tsx desktop/test/actionCard.test.tsx
git commit -m "feat(desktop): ActionCard 组件——聊天内「打开 X 面板」动作卡(Stage B4)"
```

---

### Task B5: Transcript 渲染 action item + App 下传 onOpenPanel

**Files:**
- Modify: `desktop/src/renderer/components/Transcript.tsx:18-39`(props) + `:158-171`(渲染分支)
- Modify: `desktop/src/renderer/App.tsx`(`<Transcript … />` 调用处,约 `:1079`)
- Test: `desktop/test/transcript.actionCard.test.tsx`(新)

**Interfaces:**
- Consumes: `ActionCard`(B4);`action` item(B3);`PanelId`(B2)。
- Produces: `Transcript` 新增必填 prop `onOpenPanel: (id: PanelId) => void`;`App` 以 `(id) => setView(id)` 注入。C4 复用同一 prop 传给 `ImConnectCard`。

- [ ] **Step 1: 写失败测试**

创建 `desktop/test/transcript.actionCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Transcript from '../src/renderer/components/Transcript'
import type { Item } from '../src/shared/transcriptReducer'

afterEach(() => cleanup())

const noop = () => {}
const base = {
  busy: false, onEditMessage: noop, onDeleteMessage: noop, onResendMessage: noop,
  onPlanReview: noop, mode: 'react' as const,
}

describe('Transcript —— action item', () => {
  it('渲染 action item 为 ActionCard,点击调 onOpenPanel', () => {
    const onOpenPanel = vi.fn()
    const items: Item[] = [{ type: 'action', panel: 'im-gateway' }]
    render(<Transcript {...base} items={items} onOpenPanel={onOpenPanel} />)
    fireEvent.click(screen.getByTestId('action-card'))
    expect(onOpenPanel).toHaveBeenCalledWith('im-gateway')
  })
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd desktop && npx vitest run test/transcript.actionCard.test.tsx`
Expected: FAIL —— `onOpenPanel` 未知 prop / action 未渲染。

- [ ] **Step 3: Transcript 加 prop + 渲染分支**

在 `TranscriptProps` 接口加:

```ts
  editors?: EditorApp[]
  workspace?: string | null
  /** 打开功能面板(action / im-bind 动作卡用)。 */
  onOpenPanel: (id: PanelId) => void
```

在解构签名加 `onOpenPanel`,并 `import ActionCard from './ActionCard'` + `import type { PanelId } from '../lib/panelActions'`。在渲染 map 里、`if (item.type === 'diff') return null` 之后加:

```tsx
        if (item.type === 'diff') return null
        if (item.type === 'action') {
          return <ActionCard key={`action-${originalIdx}`} panel={item.panel} onOpenPanel={onOpenPanel} />
        }
```

- [ ] **Step 4: App.tsx 下传 onOpenPanel**

在 `<Transcript … />` 调用处加一行 prop（`PanelId` 的值都是合法 `view`,`setView(id)` 直接可用）:

```tsx
                    <Transcript
                      …既有 props…
                      onOpenPanel={(id) => setView(id)}
                    />
```

- [ ] **Step 5: 运行测试 + typecheck,确认通过**

Run: `cd desktop && npx vitest run test/transcript.actionCard.test.tsx && npm run typecheck`
Expected: PASS + 0 error。若别处调用 `<Transcript>`(如故事/测试)因新必填 prop 报错,给它们补 `onOpenPanel={() => {}}`。

- [ ] **Step 6: Stage B 回归门 + 提交**

Run: `cd desktop && npm test && npm run typecheck`
Expected: 全绿。

```bash
git add desktop/src/renderer/components/Transcript.tsx desktop/src/renderer/App.tsx desktop/test/transcript.actionCard.test.tsx
git commit -m "feat(desktop): Transcript 渲染 action 动作卡 + App 下传 onOpenPanel→setView(Stage B5)"
```

---

## Stage C —— `im_connect` 内联绑定(含微信二维码)

### Task C1: 后端 `im_connect` 工具 + base.md 登记

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`(构造器 + 新增私有方法)
- Modify: `src/main/resources/prompts/base.md`(Tools 列表,`open_panel` 之后)
- Test: `src/test/java/com/lyhn/wraith/tool/ToolRegistryUiIntentTest.java`(追加)

**Interfaces:**
- Consumes: 同 B1 的 `Tool` / `createParameters` / `Param`。
- Produces: 工具名 `im_connect`,参数 `{"platform": "<p>"}`,`p ∈ {qq,weixin,feishu,wecom}`;返回确认串或 `im_connect 失败: …`。

- [ ] **Step 1: 追加失败测试**

在 `ToolRegistryUiIntentTest.java` 追加:

```java
    @Test
    void imConnectAcceptsKnownPlatform() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("im_connect", "{\"platform\":\"weixin\"}");
        assertTrue(out.contains("weixin"), "合法平台应回确认串;实际: " + out);
    }

    @Test
    void imConnectRejectsUnknownPlatform() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("im_connect", "{\"platform\":\"telegram\"}");
        assertTrue(out.startsWith("im_connect 失败"), "非法平台应回失败串;实际: " + out);
    }

    @Test
    void imConnectIsExposedToLlm() {
        ToolRegistry reg = new ToolRegistry();
        boolean present = reg.getToolDefinitions().stream().anyMatch(t -> t.name().equals("im_connect"));
        assertTrue(present, "im_connect 应出现在 getToolDefinitions()");
    }
```

- [ ] **Step 2: 运行,确认失败**

Run: `mvn -q -DskipTests=false -Dtest=ToolRegistryUiIntentTest test`
Expected: FAIL —— `未知工具: im_connect`。

- [ ] **Step 3: 注册 `im_connect` 工具**

构造器再加一行:

```java
        registerOpenPanelTool();
        registerImConnectTool();
```

新增方法:

```java
    /** UI 意图工具:呈现「接入某 IM 平台」内联入口。纯校验、无副作用;真正的 bind 由桌面渲染层触发既有 IPC。 */
    private void registerImConnectTool() {
        Set<String> platforms = Set.of("qq", "weixin", "feishu", "wecom");
        tools.put("im_connect", new Tool(
                "im_connect",
                "在桌面对话中为用户开启「接入某 IM 平台」的内联入口。用户想把 Wraith 接入 QQ / 微信 / 飞书 / 企业微信时调用。"
                        + "weixin 会在聊天内直出二维码;qq 会一键打开浏览器授权页;feishu / wecom 引导到面板填密钥。"
                        + "不接触任何密钥,不产生副作用。",
                createParameters(new Param("platform", "string", "平台:qq|weixin|feishu|wecom", true)),
                args -> {
                    String raw = args.get("platform");
                    String norm = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
                    if (!platforms.contains(norm)) {
                        return "im_connect 失败: 未知平台 '" + raw + "',可选:qq/weixin/feishu/wecom";
                    }
                    return "已在桌面对话中为用户开启「接入 " + norm + "」的内联入口(桌面端显示为可点绑定卡)。";
                }
        ));
    }
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `mvn -q -DskipTests=false -Dtest=ToolRegistryUiIntentTest test`
Expected: PASS。

- [ ] **Step 5: base.md Tools 列表登记**

在 `open_panel`(第 15 条)之后追加:

```markdown
16. `im_connect` - 呈现「接入某 IM 平台」的内联入口,参数：`{"platform": "weixin"}`（合法：qq/weixin/feishu/wecom；weixin 聊天内直出二维码，qq 打开浏览器授权页，feishu/wecom 引导到面板填密钥）
```

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/tool/ToolRegistry.java src/test/java/com/lyhn/wraith/tool/ToolRegistryUiIntentTest.java src/main/resources/prompts/base.md
git commit -m "feat(tool): im_connect UI 意图工具(纯校验)+ base.md 登记(Stage C1)"
```

---

### Task C2: `imBind.ts` 共享 `applyBindEvent` + ImGatewayPanel 去重

**Files:**
- Create: `desktop/src/renderer/lib/imBind.ts`
- Modify: `desktop/src/renderer/components/ImGatewayPanel.tsx:34,115-125`
- Test: `desktop/test/imBind.test.ts`

**Interfaces:**
- Consumes: `GatewayEvent`(`shared/gateway.ts`,`{ kind:'bind'; phase; message?; qr?; url? }`)、`GatewayBindPhase`。
- Produces: `interface BindState { phase: GatewayBindPhase; message?: string; qr?: string; url?: string }`;`applyBindEvent(prev: BindState | null, evt: GatewayBindEvent): BindState`(scanning 阶段保留已到达 qr/url,非 scanning 清空)。`ImGatewayPanel` 与 `ImConnectCard`(C4)共用。

- [ ] **Step 1: 写失败测试**

创建 `desktop/test/imBind.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyBindEvent, type BindState } from '../src/renderer/lib/imBind'

describe('applyBindEvent', () => {
  it('scanning 阶段保留先到的 qr(后一条无 qr 不冲掉)', () => {
    let s: BindState | null = null
    s = applyBindEvent(s, { kind: 'bind', phase: 'scanning', qr: 'data:image/png;base64,AAA' })
    expect(s.qr).toBe('data:image/png;base64,AAA')
    s = applyBindEvent(s, { kind: 'bind', phase: 'scanning', url: 'https://x' })
    expect(s.qr).toBe('data:image/png;base64,AAA') // 仍在
    expect(s.url).toBe('https://x')
  })
  it('非 scanning 阶段清空 qr/url', () => {
    const prev: BindState = { phase: 'scanning', qr: 'data:...', url: 'https://x' }
    const s = applyBindEvent(prev, { kind: 'bind', phase: 'bound' })
    expect(s.phase).toBe('bound')
    expect(s.qr).toBeUndefined()
    expect(s.url).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd desktop && npx vitest run test/imBind.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 imBind.ts**

创建 `desktop/src/renderer/lib/imBind.ts`:

```ts
/**
 * imBind —— IM 扫码绑定的共享纯逻辑(面板 + 聊天内联卡同源)。
 * 无 React/Electron 依赖;只做 bind 事件→state 归并。
 */
import type { GatewayBindPhase, GatewayEvent } from '../../shared/gateway'

export interface BindState {
  phase: GatewayBindPhase
  message?: string
  qr?: string
  url?: string
}

type GatewayBindEvent = Extract<GatewayEvent, { kind: 'bind' }>

/**
 * 逐条 bind 事件归并:微信扫码 scanning 阶段会分几条来(「请扫码」行、带 qr 的图片行、带 url 的兜底链接行),
 * 保留已拿到的 qr / url(后一条不冲掉前一条);非 scanning 阶段(bound/failed/…)清空 qr/url。
 */
export function applyBindEvent(prev: BindState | null, evt: GatewayBindEvent): BindState {
  return {
    phase: evt.phase,
    message: evt.message,
    qr: evt.qr ?? (evt.phase === 'scanning' ? prev?.qr : undefined),
    url: evt.url ?? (evt.phase === 'scanning' ? prev?.url : undefined),
  }
}
```

- [ ] **Step 4: ImGatewayPanel 改用 applyBindEvent(去重)**

在 `ImGatewayPanel.tsx` 顶部 import 加 `import { applyBindEvent } from '../lib/imBind'`。把 `:115-125` 的 bind 分支从手写归并改为:

```ts
      else if (evt.kind === 'bind') {
        setBind(prev => applyBindEvent(prev, evt))
        if (evt.phase === 'bound' || evt.phase === 'secret-invalid') void refreshConfig()
      }
```

（`bind` 的 useState 类型 `{ phase; message?; qr?; url? } | null` 与 `BindState` 结构一致,可保留原样,或改成 `useState<BindState | null>` 并 import 类型 —— 二选一,保持编译通过即可。）

- [ ] **Step 5: 运行测试(含既有 ImGatewayPanel 测试),确认全通过**

Run: `cd desktop && npx vitest run test/imBind.test.ts && npx vitest run test/imGatewayPanel.test.tsx 2>/dev/null; cd desktop && npm run typecheck`
（若无 `imGatewayPanel.test.tsx` 则跳过该项;关键是 typecheck 0 error 且不破坏既有 IM 面板测试。）
Expected: PASS + 0 error。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/lib/imBind.ts desktop/src/renderer/components/ImGatewayPanel.tsx desktop/test/imBind.test.ts
git commit -m "refactor(desktop): 抽 imBind.applyBindEvent 共享纯函数 + ImGatewayPanel 改用(Stage C2)"
```

---

### Task C3: transcriptReducer `im-bind` 变体 + tool.call 特判

**Files:**
- Modify: `desktop/src/shared/transcriptReducer.ts`(`Item` 联合;`tool.call` case)
- Test: `desktop/test/transcriptReducer.uiIntent.test.ts`(追加)

**Interfaces:**
- Produces: `Item` 新增 `{ type: 'im-bind'; platform: string }`;`tool.call` 的 `name === 'im_connect'` 归约成 `im-bind` item。C4 的 Transcript 渲染消费之。

- [ ] **Step 1: 追加失败测试**

在 `transcriptReducer.uiIntent.test.ts` 追加:

```ts
describe('transcriptReducer —— im_connect 特判', () => {
  it('im_connect 的 tool.call 归约成 im-bind item', () => {
    const s = transcriptReducer(initialTranscriptState(), {
      type: 'tool.call', callId: 'c4', name: 'im_connect', argsJson: '{"platform":"weixin"}',
    })
    const it = lastItem(s.items)
    expect(it.type).toBe('im-bind')
    expect((it as { type: 'im-bind'; platform: string }).platform).toBe('weixin')
  })
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd desktop && npx vitest run test/transcriptReducer.uiIntent.test.ts`
Expected: FAIL —— im_connect 目前归约成 `tool`。

- [ ] **Step 3: 加变体 + 特判**

`Item` 联合再加一支:

```ts
  | { type: 'action'; panel: string }
  | { type: 'im-bind'; platform: string }
```

`case 'tool.call':` 里 open_panel 特判之后加:

```ts
      if (name === 'im_connect') {
        return { ...state, items: [...state.items, { type: 'im-bind', platform: toolArgString(argsJson, 'platform') }] }
      }
```

- [ ] **Step 4: 运行测试 + typecheck,确认通过**

Run: `cd desktop && npx vitest run test/transcriptReducer.uiIntent.test.ts && npm run typecheck`
Expected: PASS + 0 error。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/shared/transcriptReducer.ts desktop/test/transcriptReducer.uiIntent.test.ts
git commit -m "feat(desktop): transcriptReducer 加 im-bind 变体 + im_connect tool.call 特判(Stage C3)"
```

---

### Task C4: `ImConnectCard.tsx` + Transcript 渲染 im-bind

**Files:**
- Create: `desktop/src/renderer/components/ImConnectCard.tsx`
- Modify: `desktop/src/renderer/components/Transcript.tsx`(im-bind 渲染分支)
- Test: `desktop/test/imConnectCard.test.tsx`

**Interfaces:**
- Consumes: `applyBindEvent` / `BindState`(C2)、`bindPhaseLabel`(`lib/gatewayLabels.ts`)、`PanelId`(B2)、既有 IPC `window.wraith.{gatewayBindStart, gatewayBindWeixinStart, gatewayBindCancel, onGatewayEvent, openExternal}`、`im-bind` item(C3)、`onOpenPanel` prop(B5)。
- Produces: 默认导出 `ImConnectCard`,props `{ platform: string; workspace?: string | null; onOpenPanel: (id: PanelId) => void }`。**点击才启动绑定**(挂载只订阅事件、不 spawn)。

- [ ] **Step 1: 写失败测试**

创建 `desktop/test/imConnectCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import ImConnectCard from '../src/renderer/components/ImConnectCard'
import type { GatewayEvent } from '../src/shared/gateway'

afterEach(() => cleanup())

let emit: (e: GatewayEvent) => void = () => {}
const bindWeixin = vi.fn()
const bindQQ = vi.fn()

beforeEach(() => {
  bindWeixin.mockReset(); bindQQ.mockReset()
  ;(window as unknown as { wraith: unknown }).wraith = {
    onGatewayEvent: (cb: (e: GatewayEvent) => void) => { emit = cb; return () => {} },
    gatewayBindWeixinStart: bindWeixin,
    gatewayBindStart: bindQQ,
    gatewayBindCancel: vi.fn(),
    openExternal: vi.fn(),
  }
})

describe('ImConnectCard', () => {
  it('weixin:点击启动才调 bind IPC;收到 qr 事件后内联渲染二维码', () => {
    render(<ImConnectCard platform="weixin" workspace="/w" onOpenPanel={vi.fn()} />)
    expect(bindWeixin).not.toHaveBeenCalled()            // 挂载不启动
    fireEvent.click(screen.getByTestId('im-connect-start'))
    expect(bindWeixin).toHaveBeenCalledWith('/w')
    act(() => emit({ kind: 'bind', phase: 'scanning', qr: 'data:image/png;base64,AAA' }))
    expect(screen.getByTestId('im-connect-qr').getAttribute('src')).toContain('data:image/png')
  })
  it('qq:点击调 gatewayBindStart,不渲染内联二维码,显示浏览器提示', () => {
    render(<ImConnectCard platform="qq" onOpenPanel={vi.fn()} />)
    fireEvent.click(screen.getByTestId('im-connect-start'))
    expect(bindQQ).toHaveBeenCalled()
    act(() => emit({ kind: 'bind', phase: 'scanning' }))
    expect(screen.queryByTestId('im-connect-qr')).toBeNull()
    expect(screen.getByTestId('im-connect-card').textContent).toContain('浏览器')
  })
  it('feishu:不绑定,渲染「打开 IM 网关面板」按钮', () => {
    const onOpenPanel = vi.fn()
    render(<ImConnectCard platform="feishu" onOpenPanel={onOpenPanel} />)
    expect(screen.queryByTestId('im-connect-start')).toBeNull()
    fireEvent.click(screen.getByTestId('im-connect-open-panel'))
    expect(onOpenPanel).toHaveBeenCalledWith('im-gateway')
  })
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd desktop && npx vitest run test/imConnectCard.test.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现 ImConnectCard.tsx**

创建 `desktop/src/renderer/components/ImConnectCard.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { bindPhaseLabel } from '../lib/gatewayLabels'
import { applyBindEvent, type BindState } from '../lib/imBind'
import type { PanelId } from '../lib/panelActions'
import type { GatewayEvent } from '../../shared/gateway'

interface ImConnectCardProps {
  /** 后端 im_connect 工具传来的平台 id。 */
  platform: string
  /** 微信绑定用的工作目录(可空)。 */
  workspace?: string | null
  /** feishu/wecom 退化到开面板。 */
  onOpenPanel: (id: PanelId) => void
}

const LABELS: Record<string, string> = { qq: 'QQ', weixin: '微信', feishu: '飞书', wecom: '企业微信' }

/**
 * 聊天内 IM 接入卡。⚠ 点击「开始」才启动绑定(不在挂载时启动):
 * transcript 历史回放会重建本 item,挂载即 spawn 会在每次 resume 重启绑定进程。
 */
export default function ImConnectCard({ platform, workspace, onOpenPanel }: ImConnectCardProps): JSX.Element | null {
  const p = (platform || '').trim().toLowerCase()
  const [bind, setBind] = useState<BindState | null>(null)
  const [started, setStarted] = useState(false)

  // 挂载只订阅事件(不启动绑定)。
  useEffect(() => {
    const unsub = window.wraith.onGatewayEvent((evt: GatewayEvent) => {
      if (evt.kind === 'bind') setBind(prev => applyBindEvent(prev, evt))
    })
    return () => unsub()
  }, [])

  // feishu / wecom:无扫码,退化到开面板填密钥。
  if (p === 'feishu' || p === 'wecom') {
    return (
      <div data-testid="im-connect-card" className="self-start flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg">
        <span>接入 {LABELS[p]} 需要在面板填写密钥(App ID / Secret)。</span>
        <button
          data-testid="im-connect-open-panel"
          onClick={() => onOpenPanel('im-gateway')}
          className="self-start rounded-lg border border-border px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
        >🧭 打开 IM 网关面板</button>
      </div>
    )
  }
  if (p !== 'qq' && p !== 'weixin') return null

  const start = (): void => {
    setStarted(true)
    setBind({ phase: 'scanning' })
    if (p === 'weixin') void window.wraith.gatewayBindWeixinStart(workspace?.trim() || undefined)
    else void window.wraith.gatewayBindStart()
  }

  return (
    <div data-testid="im-connect-card" className="self-start flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-3 text-sm text-fg">
      <span className="font-medium">接入 {LABELS[p]}</span>

      {!started && (
        <button
          data-testid="im-connect-start"
          onClick={start}
          className="self-start rounded-lg border border-accent px-2.5 py-1 text-xs text-accent hover:bg-accent/10"
        >{p === 'weixin' ? '扫码绑定微信' : '打开 QQ 授权页'}</button>
      )}

      {started && p === 'qq' && (
        <div className="text-xs text-fg-muted">已在系统浏览器打开 QQ 扫码授权页,请在浏览器完成授权;完成后此处会显示结果。</div>
      )}

      {started && p === 'weixin' && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface/40 p-3">
          <div className="text-xs text-fg-muted">请用目标微信扫描二维码</div>
          {bind?.qr ? (
            <img data-testid="im-connect-qr" src={bind.qr} alt="微信绑定二维码" className="h-44 w-44 rounded-md bg-white p-2" />
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded-md border border-dashed border-border text-2xs text-fg-subtle">二维码生成中…</div>
          )}
          {bind?.url && (
            <button className="text-2xs text-accent hover:underline" onClick={() => void window.wraith.openExternal(bind.url!)}>扫不出?在浏览器打开链接</button>
          )}
        </div>
      )}

      {bind && (
        <div data-testid="im-connect-status" className={'text-xs ' + (bind.phase === 'bound' ? 'text-ok' : bind.phase === 'failed' || bind.phase === 'secret-invalid' ? 'text-danger' : 'text-fg-muted')}>
          {bindPhaseLabel(bind.phase, bind.message)}
        </div>
      )}

      {bind?.phase === 'scanning' && (
        <button data-testid="im-connect-cancel" onClick={() => void window.wraith.gatewayBindCancel()} className="self-start text-2xs text-fg-subtle hover:text-fg">取消</button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Transcript 渲染 im-bind 分支**

在 `Transcript.tsx` import 加 `import ImConnectCard from './ImConnectCard'`。在 action 分支之后加:

```tsx
        if (item.type === 'im-bind') {
          return <ImConnectCard key={`imbind-${originalIdx}`} platform={item.platform} workspace={workspace} onOpenPanel={onOpenPanel} />
        }
```

- [ ] **Step 5: 运行测试 + typecheck,确认通过**

Run: `cd desktop && npx vitest run test/imConnectCard.test.tsx && npm run typecheck`
Expected: PASS + 0 error。

- [ ] **Step 6: Stage C 回归门 + 提交**

Run: `cd desktop && npm test && npm run typecheck` 且 `mvn -q -DskipTests=false test`
Expected: 全绿(Java + 桌面 + tsc)。

```bash
git add desktop/src/renderer/components/ImConnectCard.tsx desktop/src/renderer/components/Transcript.tsx desktop/test/imConnectCard.test.tsx
git commit -m "feat(desktop): ImConnectCard 聊天内 IM 接入卡(微信内联二维码/QQ 浏览器/飞书企微开面板)+ Transcript 渲染(Stage C4)"
```

---

## Self-Review(写完计划的自查)

**1. Spec coverage** —— spec 各节 → 任务映射:
- §4.1 capabilities.md + PromptAssembler → A1 ✓;§4.2 base.md 元问题策略 → A2 ✓。
- §5.1 open_panel 后端 → B1 ✓;§5.2 action 变体/ActionCard/panelActions → B3/B4/B2 ✓;§5.3 onOpenPanel 桥 → B5 ✓。
- §6.1 im_connect 后端 → C1 ✓;§6.2 im-bind 变体/ImConnectCard(点击启动、微信内联二维码/QQ 浏览器/飞书企微开面板)/imBind 共享 → C3/C4/C2 ✓;§6.3 复用不重写、守密钥 → C2(不重写 bind)/C1+C4(不碰密钥)✓。
- §7 能力目录全表 → A1 capabilities.md 11 行 ✓。§9 各阶段测试 → 每任务的单测 + 阶段回归门 ✓。

**2. Placeholder scan** —— 无 TBD/TODO;每个代码步骤都给了完整可粘贴代码;测试步骤都含真实断言。

**3. Type consistency** —— `PanelId`(B2)贯穿 ActionCard/Transcript/ImConnectCard/App;`BindState`+`applyBindEvent`(C2)贯穿 imBind/ImGatewayPanel/ImConnectCard;`toolArgString`(B3)被 B3/C3 共用;`Item` 的 `action`/`im-bind` 变体命名前后一致;Java `registerOpenPanelTool`/`registerImConnectTool` 与构造器调用一致。

**4. 关键取舍已在计划中固化**:不新造事件(复用 tool.call)、点击触发绑定(防历史回放重启)、mcp→plugins 归一、微信才有内联二维码/QQ 走浏览器 —— 均与已修正的 spec 一致。

**诚实边界**:Stage A 是纯 prompt 行为,效果取决于 DeepSeek 遵循度;真实扫码需真账号,归用户真机验,mac 只验管线(工具→tool.call→卡→触发 IPC→QR/状态,用假 IPC 驱动)。
