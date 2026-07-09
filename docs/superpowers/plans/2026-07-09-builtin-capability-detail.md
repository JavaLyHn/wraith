# 内置能力可点击查看详情 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MCP 面板「能力概览」的 9 张内置能力卡片可点击,点进去用后端权威数据(`ToolRegistry.getToolDefinitions()`)展示该能力下每个工具的真名 + 描述 + 可折叠参数。

**Architecture:** 后端新增只读 RPC `tools.list` 暴露内置工具目录;前端纯函数 `joinBuiltinTools` 按工具名把"能力的工具名数组"与后端目录 join(漂移标 missing);`PluginsPanel` 把内置卡片改为可点,右侧详情从两态扩为三态(概览/能力详情/server 详情)。reducer/流式/CLI 完全无关。

**Tech Stack:** Java 17 / Maven(后端);Electron + React + TypeScript + Vitest(桌面)。设计详见 `docs/superpowers/specs/2026-07-09-builtin-capability-detail-design.md`。

## Global Constraints

- **权威数据源**:详情数据一律取自后端 `ToolRegistry.getToolDefinitions()`(= 模型看到的定义),不在前端硬编码工具描述/参数。
- **`tools.list` 纯只读**:handler 绝不改 `AppServer.sessionId`、不碰 agent/model;只读目录。
- **CLI/reducer/流式零改动**:本特性只加一个只读 RPC + MCP 面板 UI;不碰 reducer、流式事件、现有 `session.*` 路径、现有 server 详情/概览/表单三条渲染路径。
- **作用域**:内置工具不可启停/编辑/删除;无 resources/prompts/logs;后端目录里未被任何能力卡覆盖的工具**不做**未分类兜底(见 spec Out of Scope)。
- **漂移不静默**:能力声明的工具名在后端目录找不到 → 该行标 `missing`(淡色「定义缺失 / 当前不可用」),不隐藏。
- **密钥红线**:`tools.list` 只回 name/description/parameters(公开的工具定义),不含密钥。提交前跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。
- **中文**注释;commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- Java 测试默认跳过,单测须带 `-DskipTests=false`;基线约 4F 为 JDK/Mockito 噪声,非本改动。
- 桌面无 RTL:面板接线靠 `npm run typecheck` + `npm run build` + 眼验;可测逻辑沉进纯模块用 vitest 覆盖。

---

## File Structure

- `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` — `SessionRunner.builtinTools()` 默认方法 + `tools.list` dispatch/handler(Task 1)。
- `src/main/java/com/lyhn/wraith/cli/Main.java` — app-server SessionRunner 覆写 `builtinTools()`(Task 1)。
- `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerToolsTest.java`(新)— `tools.list` 测试(Task 1)。
- `desktop/src/preload/index.ts` + `desktop/src/main/index.ts` + `desktop/src/shared/types.ts` — `listBuiltinTools` 通道 + `BuiltinToolView` 类型(Task 2)。
- `desktop/src/renderer/lib/builtinCapabilityDetail.ts`(新)— `joinBuiltinTools` 纯函数(Task 3)。
- `desktop/src/renderer/components/PluginsPanel.tsx` — 卡片可点 + 能力详情态 + 懒加载 + `BuiltinToolRowView` 组件(Task 4)。

---

### Task 1: 后端 tools.list 只读 RPC + SessionRunner.builtinTools

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(`SessionRunner` 接口 `readCards` 默认方法后;dispatch `session.peek` case 后;`handleSessionPeek` handler 后)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(app-server SessionRunner 的 `peekSession` 覆写后,约 1250 行)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerToolsTest.java`(新建)

**Interfaces:**
- Consumes: `ToolRegistry.getToolDefinitions() : List<LlmClient.Tool>`;`LlmClient.Tool = record(String name, String description, JsonNode parameters)`;`Agent.getToolRegistry()`;`JsonRpcWriter.result/error`;`JsonRpc.MAPPER`。
- Produces: RPC `tools.list {}` → `{ tools: [{ name, description, parameters? }] }`(`parameters` 为 JSON schema,null 时省略);`SessionRunner.builtinTools() : List<LlmClient.Tool>`(默认空)。

- [ ] **Step 1: Write the failing test**

新建 `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerToolsTest.java`:

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AppServerToolsTest {

    private List<JsonNode> parseAll(String s) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        for (String ln : s.split("\n")) if (!ln.isBlank()) out.add(JsonRpc.MAPPER.readTree(ln));
        return out;
    }

    @Test
    void toolsListSerializesBuiltinToolDefinitions() throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
                public List<LlmClient.Tool> builtinTools() {
                    ObjectNode params = JsonRpc.MAPPER.createObjectNode();
                    params.put("type", "object");
                    return List.of(
                        new LlmClient.Tool("read_file", "读取文件", params),
                        new LlmClient.Tool("save_memory", "保存记忆", null));  // parameters=null → 省略
                }
            };
        };
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        JsonNode res = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> n.path("id").asInt(-1) == 2 && n.has("result")).findFirst().orElseThrow().get("result");
        JsonNode tools = res.get("tools");
        assertEquals(2, tools.size());
        assertEquals("read_file", tools.get(0).get("name").asText());
        assertEquals("读取文件", tools.get(0).get("description").asText());
        assertEquals("object", tools.get(0).get("parameters").get("type").asText());
        assertEquals("save_memory", tools.get(1).get("name").asText());
        assertFalse(tools.get(1).has("parameters"), "parameters 为 null 时应省略该字段");
    }

    @Test
    void toolsListWithoutSessionReturnsNoSession() throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
            };
        };
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools.list\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        JsonNode err = parseAll(out.toString(StandardCharsets.UTF_8)).stream()
            .filter(n -> n.path("id").asInt(-1) == 1 && n.has("error")).findFirst().orElseThrow();
        assertEquals(-32000, err.get("error").get("code").asInt());
        assertEquals("no session", err.get("error").get("message").asText());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn -Dtest=AppServerToolsTest -DskipTests=false test`
Expected: 编译失败 `method builtinTools() is undefined` / 或 `tools.list` 无 case → 无 result 断言失败。

- [ ] **Step 3a: SessionRunner 接口加默认方法**

在 `AppServer.java` 的 `readCards` 默认方法(约 147-149 行)之后、接口结束 `}` 之前插入:

```java
        /** 内置工具目录(= 模型看到的定义:name/description/parameters)。默认空。供 UI 只读展示。 */
        default java.util.List<com.lyhn.wraith.llm.LlmClient.Tool> builtinTools() {
            return java.util.List.of();
        }
```

- [ ] **Step 3b: dispatch 加 case**

在 `dispatch(...)` 的 `case "session.peek" -> handleSessionPeek(msg);` 之后插入:

```java
            case "tools.list" -> handleToolsList(msg);
```

- [ ] **Step 3c: 加 handler**

在 `handleSessionPeek(...)` 方法之后、类结束 `}` 之前插入:

```java
    private void handleToolsList(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        // 纯只读:仅回工具定义,不改 sessionId/agent。
        java.util.List<com.fasterxml.jackson.databind.node.ObjectNode> wire = new java.util.ArrayList<>();
        for (com.lyhn.wraith.llm.LlmClient.Tool t : session.builtinTools()) {
            com.fasterxml.jackson.databind.node.ObjectNode n = JsonRpc.MAPPER.createObjectNode();
            n.put("name", t.name());
            n.put("description", t.description() == null ? "" : t.description());
            if (t.parameters() != null) {
                n.set("parameters", t.parameters());   // JSON schema;null 时省略该字段
            }
            wire.add(n);
        }
        java.util.Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("tools", wire);
        writer.result(msg.id(), result);
    }
```

- [ ] **Step 3d: Main.java 实现覆写**

在 `Main.java` app-server SessionRunner 匿名类里,`peekSession` 覆写(约 1248-1250 行)之后插入:

```java
                    @Override
                    public java.util.List<com.lyhn.wraith.llm.LlmClient.Tool> builtinTools() {
                        return agent.getToolRegistry().getToolDefinitions();   // 权威目录,只读
                    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mvn -Dtest=AppServerToolsTest -DskipTests=false test`
Expected: BUILD SUCCESS;两用例通过。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerToolsTest.java
git commit -m "feat(appserver): tools.list 只读 RPC 暴露内置工具目录(name/description/parameters)"
```

---

### Task 2: 桌面通道 listBuiltinTools + BuiltinToolView 类型

**Files:**
- Modify: `desktop/src/shared/types.ts`(新增 `BuiltinToolView`)
- Modify: `desktop/src/preload/index.ts`(WraithApi 接口 + 实现)
- Modify: `desktop/src/main/index.ts`(ipcMain handler)

**Interfaces:**
- Consumes: Task 1 的 RPC `tools.list`;现有 `client.request`。
- Produces: `interface BuiltinToolView { name: string; description: string; parameters?: unknown }`;`window.wraith.listBuiltinTools(): Promise<{ tools: BuiltinToolView[] }>`。

- [ ] **Step 1: 加类型**

在 `desktop/src/shared/types.ts` 末尾(`AppInfo`/`UpdateResult` 附近,文件末)加入:

```ts
/** 内置工具定义(tools.list 回传;= 模型看到的定义)。 */
export interface BuiltinToolView { name: string; description: string; parameters?: unknown }
```

- [ ] **Step 2: preload 接口 + 实现**

在 `desktop/src/preload/index.ts`:先确保顶部类型 import 含 `BuiltinToolView`(与 `McpServerView` 等同处 import;若 `import type { ... } from '../shared/types'` 已存在,加进去)。
WraithApi 接口里 `mcpList()` 附近加签名:

```ts
  listBuiltinTools(): Promise<{ tools: BuiltinToolView[] }>
```

实现体里(`mcpList` 实现附近)加:

```ts
  listBuiltinTools() {
    return ipcRenderer.invoke('wraith:listBuiltinTools') as Promise<{ tools: BuiltinToolView[] }>
  },
```

- [ ] **Step 3: main ipcMain handler**

在 `desktop/src/main/index.ts` 的 `wraith:listSessions` handler 附近加:

```ts
ipcMain.handle('wraith:listBuiltinTools', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('tools.list', {})
})
```

- [ ] **Step 4: Typecheck + build**

Run: `cd desktop && npm run typecheck && npm run build`
Expected: typecheck 0 error;build 成功。（IPC 直传层,无单测。）

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat(desktop/ipc): window.wraith.listBuiltinTools → tools.list"
```

---

### Task 3: builtinCapabilityDetail.ts 纯 join 模块 + vitest

**Files:**
- Create: `desktop/src/renderer/lib/builtinCapabilityDetail.ts`
- Test: `desktop/test/builtinCapabilityDetail.test.ts`

**Interfaces:**
- Consumes: `BuiltinToolView`(`import type { BuiltinToolView } from '../../shared/types'`)。
- Produces:
  - `interface BuiltinToolRow { name: string; description: string; parameters?: unknown; missing: boolean }`
  - `joinBuiltinTools(capabilityToolNames: string[], catalog: BuiltinToolView[]): BuiltinToolRow[]`

- [ ] **Step 1: Write the failing test**

Create `desktop/test/builtinCapabilityDetail.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { joinBuiltinTools } from '../src/renderer/lib/builtinCapabilityDetail'
import type { BuiltinToolView } from '../src/shared/types'

const catalog: BuiltinToolView[] = [
  { name: 'read_file', description: '读取文件', parameters: { type: 'object' } },
  { name: 'write_file', description: '写入文件' },
]

describe('joinBuiltinTools', () => {
  it('全命中 → 带后端描述/参数,missing=false', () => {
    const rows = joinBuiltinTools(['read_file', 'write_file'], catalog)
    expect(rows).toEqual([
      { name: 'read_file', description: '读取文件', parameters: { type: 'object' }, missing: false },
      { name: 'write_file', description: '写入文件', parameters: undefined, missing: false },
    ])
  })
  it('目录里找不到的工具名 → missing=true,描述空', () => {
    const rows = joinBuiltinTools(['read_file', 'ghost_tool'], catalog)
    expect(rows[1]).toEqual({ name: 'ghost_tool', description: '', parameters: undefined, missing: true })
  })
  it('空目录(加载失败回落)→ 全部 missing,仍保留工具名', () => {
    const rows = joinBuiltinTools(['read_file', 'write_file'], [])
    expect(rows.map(r => r.missing)).toEqual([true, true])
    expect(rows.map(r => r.name)).toEqual(['read_file', 'write_file'])
  })
  it('空工具名单 → 空数组', () => {
    expect(joinBuiltinTools([], catalog)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run test/builtinCapabilityDetail.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: Write the module**

Create `desktop/src/renderer/lib/builtinCapabilityDetail.ts`:

```ts
import type { BuiltinToolView } from '../../shared/types'

/** 一行可渲染的内置工具:后端目录命中则带真实描述/参数,否则 missing。 */
export interface BuiltinToolRow {
  name: string
  description: string
  parameters?: unknown
  missing: boolean
}

/**
 * 把某内置能力声明的工具名数组与后端目录 join。
 * 命中 → 用后端 description/parameters;未命中 → missing=true(描述空),仍保留工具名。
 */
export function joinBuiltinTools(
  capabilityToolNames: string[],
  catalog: BuiltinToolView[],
): BuiltinToolRow[] {
  return capabilityToolNames.map(name => {
    const hit = catalog.find(t => t.name === name)
    return hit
      ? { name, description: hit.description, parameters: hit.parameters, missing: false }
      : { name, description: '', parameters: undefined, missing: true }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run test/builtinCapabilityDetail.test.ts && npm run typecheck`
Expected: 4/4 PASS;typecheck 0 error。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/lib/builtinCapabilityDetail.ts desktop/test/builtinCapabilityDetail.test.ts
git commit -m "feat(desktop): builtinCapabilityDetail.joinBuiltinTools 纯模块 + vitest"
```

---

### Task 4: PluginsPanel 内置能力可点 + 能力详情态

**Files:**
- Modify: `desktop/src/renderer/components/PluginsPanel.tsx`

**Interfaces:**
- Consumes: Task 2 `window.wraith.listBuiltinTools` + `BuiltinToolView`;Task 3 `joinBuiltinTools` + `BuiltinToolRow`;现有 `BUILTIN_CAPABILITIES`(`{id, icon, name, desc, tools: string[]}`)。
- Produces: 内置能力卡片可点 → 右侧能力详情(工具真名 + 描述 + 可折叠参数 + 漂移标记)。

- [ ] **Step 1: import + 顶部工具行组件**

在 `PluginsPanel.tsx` 顶部:
- 第 1 行 `import { useEffect, useState } from 'react'` 改为 `import { useCallback, useEffect, useState } from 'react'`。
- 第 2 行 import 加类型:`import type { McpServerView, McpResourceView, BuiltinToolView } from '../../shared/types'`。
- 加一行:`import { joinBuiltinTools, type BuiltinToolRow } from '../lib/builtinCapabilityDetail'`。

在 `export default function PluginsPanel` 之前加工具行组件(名字与类型 `BuiltinToolRow` 区分,叫 `BuiltinToolRowView`):

```tsx
/** 内置工具的一行:真名 + 描述 + 可折叠参数(JSON schema);missing 则淡色标记。 */
function BuiltinToolRowView({ row }: { row: BuiltinToolRow }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const hasParams = row.parameters != null && typeof row.parameters === 'object'
    && Object.keys(row.parameters as object).length > 0
  return (
    <div className="rounded-lg bg-surface/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-fg">{row.name}</span>
        {row.missing && <span className="text-3xs text-fg-subtle">定义缺失 / 当前不可用</span>}
        {hasParams && (
          <button onClick={() => setExpanded(v => !v)}
            className="ml-auto shrink-0 text-3xs text-fg-subtle hover:text-fg-muted">
            {expanded ? '▼ 参数' : '▶ 参数'}
          </button>
        )}
      </div>
      {row.description && <div className="mt-0.5 text-xs text-fg-muted">{row.description}</div>}
      {hasParams && expanded && (
        <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg px-2 py-1 text-2xs text-fg-subtle">
{JSON.stringify(row.parameters, null, 2)}
        </pre>
      )}
    </div>
  )
}
```

- [ ] **Step 2: state + 派生 + 懒加载**

在 `PluginsPanel` 组件体内(现有 `tabContent` state 之后,约 44 行后)加:

```tsx
  const [builtinCatalog, setBuiltinCatalog] = useState<BuiltinToolView[] | null>(null)
  const [builtinError, setBuiltinError] = useState(false)
```

在 `const current = ...`(约 49 行)之后加派生:

```tsx
  // 选中值为 'builtin:<id>' 哨兵时,解析出对应内置能力(否则 null)。
  const selectedBuiltin = selected.startsWith('builtin:')
    ? (BUILTIN_CAPABILITIES.find(c => c.id === selected.slice('builtin:'.length)) ?? null)
    : null
```

在其它 `useEffect` 附近加取目录的 callback + 懒加载 effect:

```tsx
  const fetchBuiltinCatalog = useCallback(async () => {
    try {
      const { tools } = await window.wraith.listBuiltinTools()
      setBuiltinCatalog(tools); setBuiltinError(false)
    } catch (err) {
      console.error('[wraith] listBuiltinTools error:', err); setBuiltinError(true)
    }
  }, [])

  // 首次进入任一能力详情时拉一次目录并缓存(builtinError 阻止失败后自旋)。
  useEffect(() => {
    if (selectedBuiltin && builtinCatalog === null && !builtinError) void fetchBuiltinCatalog()
  }, [selectedBuiltin, builtinCatalog, builtinError, fetchBuiltinCatalog])
```

- [ ] **Step 3: 内置能力卡片改为可点**

在概览区 `BUILTIN_CAPABILITIES.map(c => (...))`(约 145-155 行)把外层 `<div>` 改为 `<button>` 并加点击:

```tsx
                  {BUILTIN_CAPABILITIES.map(c => (
                    <button key={c.id} type="button" data-testid="mcp-builtin-card"
                      onClick={() => setSelected('builtin:' + c.id)}
                      title={c.tools.join(' · ')}
                      className="rounded-lg border border-border bg-surface/40 p-3 text-left hover:border-accent">
                      <div className="flex items-center gap-2">
                        <span className="text-base leading-none">{c.icon}</span>
                        <span className="truncate text-xs font-medium text-fg">{c.name}</span>
                        <span className="ml-auto shrink-0 rounded bg-surface px-1.5 py-0.5 text-4xs text-fg-subtle">已内置</span>
                      </div>
                      <div className="mt-1 text-2xs text-fg-muted">{c.desc}</div>
                    </button>
                  ))}
```

- [ ] **Step 4: 右侧详情加"能力详情"分支**

右详情当前结构是 `formMode !== 'hidden' ? <Form/> : !current ? <Overview/> : <ServerDetail/>`。把中间改成先判 `selectedBuiltin`。找到 `) : !current ? (`(约 139 行,概览分支开头),在其前面插入能力详情分支——即把 `!current ? ( 概览 ) : ( server 详情 )` 包成 `selectedBuiltin ? ( 能力详情 ) : !current ? ( 概览 ) : ( server 详情 )`。

在 `formMode !== 'hidden' ? (<McpServerForm .../>) :` 之后、`!current ? (` 之前插入:

```tsx
          ) : selectedBuiltin ? (
            <div data-testid="mcp-builtin-detail" className="flex min-w-0 flex-1 flex-col gap-3">
              <button data-testid="mcp-builtin-back" onClick={() => setSelected(OVERVIEW)}
                className="self-start rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 概览</button>
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">{selectedBuiltin.icon}</span>
                <span className="text-sm font-bold text-fg">{selectedBuiltin.name}</span>
                <span className="text-2xs text-fg-subtle">{selectedBuiltin.desc}</span>
                <span className="ml-1 shrink-0 rounded bg-surface px-1.5 py-0.5 text-4xs text-fg-subtle">已内置</span>
              </div>
              {builtinError && (
                <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
                  无法加载内置工具定义
                  <button data-testid="mcp-builtin-retry"
                    onClick={() => { setBuiltinError(false); void fetchBuiltinCatalog() }}
                    className="ml-2 underline hover:no-underline">重试</button>
                </div>
              )}
              <div className="flex flex-col gap-1">
                {joinBuiltinTools(selectedBuiltin.tools, builtinCatalog ?? []).map(row => (
                  <BuiltinToolRowView key={row.name} row={row} />
                ))}
              </div>
            </div>
```

（注:这样右详情四分支为 `表单 : 能力详情 : 概览 : server 详情`。现有 `!current` 概览与 server 详情两分支内部**一行不改**。因为 `selected='builtin:x'` 时 `current` 已是 null(没有名为 `builtin:x` 的 server),故不会误入 server 详情;新分支在 `!current` 前拦截。）

- [ ] **Step 5: Typecheck + build + 全量 vitest**

Run: `cd desktop && npm run typecheck && npx vitest run && npm run build`
Expected: typecheck 0;vitest 全绿(含 Task 3 的 4 条 + 既有全部);build 成功。

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/components/PluginsPanel.tsx
git commit -m "feat(desktop): 内置能力卡片可点 → 右侧能力详情(真名+描述+可折叠参数)"
```

---

## 交付后(执行阶段处理)

- **重建并部署 jar**:后端加了 `tools.list`,`mvn -DskipTests package` 后覆盖到 `~/.wraith/wraith.jar`;dev App 完全重启(新 jar + preload 新方法 `listBuiltinTools`)。
- **眼验**:MCP 面板 → 能力概览 → 点任一「内置能力」卡 → 右侧显示该能力工具(真名 + 真实描述 + ▶参数可折叠展开 JSON schema)→「← 概览」返回 → 点真实 server 仍显 server 详情(回归)。可临时把某能力的 `tools` 写一个不存在的名字验证「定义缺失」标记。
- 提交前跑密钥扫描。

## Self-Review 记录

- **Spec 覆盖**:tools.list 权威 RPC(T1)、IPC+类型(T2)、joinBuiltinTools 纯函数含 drift(T3)、卡片可点+三态详情+懒加载+参数折叠+错误重试(T4)、只读不改活跃态(T1 handler 无 sessionId 写)、Out-of-scope(未做启停/未分类兜底)—— 全部有任务对应。
- **占位符扫描**:无 TBD;每个改码步骤含完整代码。
- **类型一致**:`BuiltinToolView`(T2 定义,T3/T4 消费)、`BuiltinToolRow`(T3 定义,T4 import 为类型)、组件名 `BuiltinToolRowView`(避开与类型 `BuiltinToolRow` 撞名)、`joinBuiltinTools` 签名一致、`selectedBuiltin`/`builtinCatalog`/`builtinError`/`fetchBuiltinCatalog` 在 T4 内一致。
