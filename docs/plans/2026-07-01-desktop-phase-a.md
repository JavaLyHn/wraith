# Wraith 桌面端 Phase A（前门 + 视觉身份）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 P3b 的 Electron 壳升级成 Codex 级"前门"：Wraith 自己的柔和浅色视觉身份、居中欢迎空态、富 composer（含功能性"替我审批"开关与重选目录）、静态侧栏骨架，并把已有组件重皮。

**Architecture:** 前端引入 Tailwind + shadcn 风格（Radix primitives + CSS 变量主题）作为设计系统；布局重构为 `AppShell = Sidebar + MainPane`；欢迎/对话切换由 reducer 的 `hasStarted` 驱动。唯一后端改动是新增 `session.setApprovalMode` RPC，把开关接到既有 `hitl.setEnabled(!auto)`（`HitlToolRegistry` 已按 `isEnabled()` 门控审批）。重选目录复用 `pickWorkspace`+`startSession`（`AppServer.handleSessionStart` 可重复调用、无冷启）。

**Tech Stack:** Electron 32 · React 18 · TypeScript · electron-vite · Tailwind CSS · Radix UI（Switch/Tooltip/Dialog）· class-variance-authority/clsx/tailwind-merge · vitest · @playwright/test（_electron）· react-markdown · Java 17（app-server 后端）。

关联 spec：`docs/specs/2026-07-01-desktop-phase-a-front-door.md`。

## Global Constraints

每个任务的要求都隐含以下项（数值/规则逐字取自 spec）：

- **包管理器 npm**；桌面代码在 `desktop/` 子目录（独立 npm，不进 Maven）；`node_modules`/`out` 已 gitignore。
- **preload 必须 CJS**：`electron.vite.config.ts` 的 `preload.build.rollupOptions.output = { format:'cjs', entryFileNames:'[name].cjs' }` 不能破坏；`main/index.ts` 载入 `../preload/index.cjs`。
- **Tailwind 只作用于 renderer**：通过 `renderer.css.postcss.plugins` 配置；**不得**改动 main/preload 的构建（不给它们加 PostCSS/Tailwind）。
- **`src/shared/` 保持纯 TS 零 UI 依赖**（reducer / jsonRpcClient / types 不 import React/Electron/Radix）。
- **重皮不改契约**：所有既有 `data-testid` 不变（`transcript`/`thinking`/`thinking-toggle`/`tool-card`/`tool-output`/`approve`/`reject`/`restart`/`input`/`interrupt`），事件处理与 props 语义不变。
- **危险色规则**（审批弹窗）：`dangerLevel.includes('高危')→--danger` / `includes('中危')→--warn` / else `--accent`。
- **欢迎大标题文案固定**：`今天做点什么？`。
- **唯一后端 Java 改动**：新增 `session.setApprovalMode` RPC + `SessionRunner.setApprovalMode` 默认方法 + Main.java lambda 一行实现；**不做其它 Java 改动**。
- **单会话不变**；重选目录 = 重建会话（新 sessionId、清空 transcript、`approvalMode` 归 `ask`）。
- **安全不降级**：`contextIsolation:true` / `nodeIntegration:false` 不变；无 `webSecurity` 降级；react-markdown 不加 `rehype-raw`。
- **测试**：纯模块 vitest；Playwright 打 mock 后端、全程 auto-waiting、无 `sleep`、无像素断言；新增 Java 测试**避开 Mockito**（走 headless JSON-RPC harness 风格，见项目记忆 `testing_quirks`）。
- **提交尾注**：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。禁止提交任何密钥；不提交临时脚本。
- **分支**：`feat/desktop-phase-a`（已建，spec 已提交其上）。

---

## File Structure

**后端（Java）**
- Modify `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`：`SessionRunner` 加默认方法 + dispatch case + handler。
- Modify `src/main/java/com/lyhn/wraith/cli/Main.java`：lambda 返回的 `SessionRunner` 加 `setApprovalMode` 实现。
- Create `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSetApprovalModeTest.java`。

**共享（纯 TS）**
- Modify `desktop/src/shared/transcriptReducer.ts`：加 `hasStarted`/`approvalMode`/`workspace` 字段 + 4 个 helper。
- Modify `desktop/test/transcriptReducer.test.ts`：加对应测试。

**壳接线**
- Modify `desktop/src/preload/index.ts`：`WraithApi` 加 `setApprovalMode`。
- Modify `desktop/src/main/index.ts`：加 `wraith:setApprovalMode` IPC；`pickWorkspace` 的 E2E 分支返回 `WRAITH_E2E_WORKSPACE ?? null`。
- Modify `desktop/test/fixtures/mock-appserver.mjs`：加 `session.setApprovalMode`、记录请求到 `WRAITH_E2E_RECORD` 文件、`session.start` 递增 sessionId。

**设计系统 / UI**
- Modify `desktop/package.json`、`desktop/electron.vite.config.ts`、`desktop/src/renderer/main.tsx`。
- Create `desktop/tailwind.config.js`、`desktop/src/renderer/styles/tokens.css`、`desktop/src/renderer/lib/utils.ts`。
- Create `desktop/src/renderer/components/ui/switch.tsx`、`.../ui/tooltip.tsx`、`.../ui/dialog.tsx`。
- Create `desktop/src/renderer/components/Composer.tsx`、`WelcomeEmptyState.tsx`、`Sidebar.tsx`。
- Modify `desktop/src/renderer/App.tsx`（分阶段：Composer → Welcome → AppShell）。
- Modify（重皮）`Transcript.tsx`/`ToolCard.tsx`/`ThinkingBlock.tsx`/`DisconnectedBanner.tsx`/`ApprovalModal.tsx`。
- Modify `desktop/test/e2e/shell.e2e.ts`：加审批开关、重选目录、欢迎过渡、侧栏断言。

**依赖顺序**：Task 1（后端）→ 2（reducer）→ 3（接线+mock）→ 4（Tailwind/shadcn 地基）→ 5（Composer）→ 6（Welcome）→ 7（Sidebar/AppShell）→ 8（重皮）。

---

### Task 1: 后端 `session.setApprovalMode` RPC（Java）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java:1151-1154`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSetApprovalModeTest.java`

**Interfaces:**
- Consumes: 既有 `AppServer.SessionRunner`、`JsonRpc.Incoming`、`JsonRpcWriter`、`JsonRpc.MAPPER`；`SwitchableHitlHandler.setEnabled(boolean)`（委托给 volatile 的 `RendererHitlHandler.enabled`）；`HitlToolRegistry.java:38` 按 `hitlHandler.isEnabled()` 门控审批（`false` → 自动放行）。
- Produces: 协议方法 `session.setApprovalMode {sessionId, auto:boolean} → {ok:true}`；`SessionRunner.setApprovalMode(boolean auto)` 默认方法。

- [ ] **Step 1: 写失败测试**

Create `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSetApprovalModeTest.java`：

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class AppServerSetApprovalModeTest {

    private List<JsonNode> parseAll(String s) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        for (String ln : s.split("\n")) if (!ln.isBlank()) out.add(JsonRpc.MAPPER.readTree(ln));
        return out;
    }

    @Test
    void setApprovalModeReachesRunnerAndRepliesOk() throws Exception {
        AtomicReference<Boolean> recorded = new AtomicReference<>(null);
        AppServer.SessionRunnerFactory factory = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return ""; }
                public void setApprovalMode(boolean auto) { recorded.set(auto); }
            };
        };

        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"session.setApprovalMode\",\"params\":{\"auto\":true}}",
                "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayInputStream in = new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        new AppServer(in, out, factory).serve();

        assertEquals(Boolean.TRUE, recorded.get(), "runner.setApprovalMode 应收到 auto=true");
        List<JsonNode> msgs = parseAll(out.toString(StandardCharsets.UTF_8));
        boolean okReply = msgs.stream().anyMatch(n ->
                n.path("id").asInt(-1) == 2 && n.path("result").path("ok").asBoolean(false));
        assertTrue(okReply, "session.setApprovalMode 应回 {ok:true}");
    }

    @Test
    void setApprovalModeWithoutSessionErrors() throws Exception {
        AppServer.SessionRunnerFactory factory = (writer, sessionId, workspaceDir) -> null;
        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.setApprovalMode\",\"params\":{\"auto\":true}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayInputStream in = new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(in, out, factory).serve();
        List<JsonNode> msgs = parseAll(out.toString(StandardCharsets.UTF_8));
        boolean err = msgs.stream().anyMatch(n -> n.path("id").asInt(-1) == 1 && n.has("error"));
        assertTrue(err, "无 session → error");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=AppServerSetApprovalModeTest`
Expected: 编译失败 —— 匿名 `SessionRunner` 覆写了不存在的 `setApprovalMode`，且 dispatch 无该 method（`no session` 分支尚不存在则 id:1 无 error）。

- [ ] **Step 3: 给 `SessionRunner` 加默认方法 + dispatch case + handler**

在 `AppServer.java` 的 `SessionRunner` 接口（当前第 21-24 行）加默认方法：

```java
    public interface SessionRunner {
        EventStreamRenderer renderer();
        String runTurn(String input) throws Exception;
        /** 切换审批模式。auto=true → 关闭 HITL（自动放行）。默认 no-op，旧实现无需改动。 */
        default void setApprovalMode(boolean auto) { }
    }
```

在 `dispatch` 的 switch 里，`approval.respond` 之后、`shutdown` 之前加一行：

```java
            case "session.setApprovalMode" -> handleSetApprovalMode(msg);
```

在 `handleApprovalRespond` 方法之后新增 handler：

```java
    private void handleSetApprovalMode(JsonRpc.Incoming msg) {
        if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
        JsonNode p = msg.params();
        boolean auto = p != null && p.path("auto").asBoolean(false);
        session.setApprovalMode(auto);
        writer.result(msg.id(), Map.of("ok", true));
    }
```

- [ ] **Step 4: 在 Main.java lambda 里实现**

`Main.java` 当前第 1151-1154 行返回匿名 `SessionRunner`，加一行 `setApprovalMode`（`hitl` 是 lambda 内的 effectively-final 局部变量，可捕获）：

```java
                return new com.lyhn.wraith.runtime.appserver.AppServer.SessionRunner() {
                    public com.lyhn.wraith.runtime.appserver.EventStreamRenderer renderer() { return renderer; }
                    public String runTurn(String input) { return agent.run(input); }
                    public void setApprovalMode(boolean auto) { hitl.setEnabled(!auto); }
                };
```

- [ ] **Step 5: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest=AppServerSetApprovalModeTest`
Expected: `Tests run: 2, Failures: 0, Errors: 0, Skipped: 0`。

- [ ] **Step 6: 回归既有 app-server 测试**

Run: `mvn test -DskipTests=false -Dtest=AppServerTest,AppServerInitializeAndGuardTest,AppServerWorkspaceDirTest`
Expected: 全绿（默认方法不破坏既有匿名 runner）。

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/main/java/com/lyhn/wraith/cli/Main.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSetApprovalModeTest.java
git commit -m "feat(app-server): session.setApprovalMode RPC → hitl.setEnabled(!auto)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: reducer 新增字段与 helper（纯 TS）

**Files:**
- Modify: `desktop/src/shared/transcriptReducer.ts`
- Test: `desktop/test/transcriptReducer.test.ts`

**Interfaces:**
- Consumes: 既有 `TranscriptState`/`initialState`/`reduce`。
- Produces: `TranscriptState` 增 `hasStarted:boolean`、`approvalMode:'ask'|'auto'`、`workspace:string`；导出 helper `markStarted(state)`、`setApprovalMode(state, mode)`、`setWorkspace(state, ws)`、`resetSession(state, ws)`。

- [ ] **Step 1: 写失败测试**

在 `desktop/test/transcriptReducer.test.ts` 顶部 import 追加新 helper：

```ts
import {
  reduce,
  clearApproval,
  setModel,
  markStarted,
  setApprovalMode,
  setWorkspace,
  resetSession,
  initialState,
  type TranscriptState,
} from '../src/shared/transcriptReducer'
```

在文件末尾追加：

```ts
describe('phase-A state additions', () => {
  it('initialState has hasStarted=false, approvalMode=ask, workspace=""', () => {
    expect(initialState.hasStarted).toBe(false)
    expect(initialState.approvalMode).toBe('ask')
    expect(initialState.workspace).toBe('')
  })

  it('markStarted flips hasStarted immutably and is idempotent', () => {
    const s1 = markStarted(initialState)
    expect(s1.hasStarted).toBe(true)
    expect(initialState.hasStarted).toBe(false) // original untouched
    const s2 = markStarted(s1)
    expect(s2.hasStarted).toBe(true)
  })

  it('setApprovalMode toggles ask/auto immutably', () => {
    const auto = setApprovalMode(initialState, 'auto')
    expect(auto.approvalMode).toBe('auto')
    expect(initialState.approvalMode).toBe('ask')
    const back = setApprovalMode(auto, 'ask')
    expect(back.approvalMode).toBe('ask')
  })

  it('setWorkspace sets workspace immutably', () => {
    const s = setWorkspace(initialState, '/tmp/proj')
    expect(s.workspace).toBe('/tmp/proj')
    expect(initialState.workspace).toBe('')
  })

  it('resetSession clears items+hasStarted+approvalMode, keeps model+connection', () => {
    let s: TranscriptState = { ...initialState, connection: 'connected', model: 'deepseek', approvalMode: 'auto', hasStarted: true }
    s = reduce(s, { kind: 'notification', method: 'message.delta', params: { text: 'x' } })
    expect(s.items.length).toBe(1)
    const r = resetSession(s, '/new/dir')
    expect(r.items).toEqual([])
    expect(r.hasStarted).toBe(false)
    expect(r.approvalMode).toBe('ask')
    expect(r.pendingApproval).toBeNull()
    expect(r.workspace).toBe('/new/dir')
    expect(r._messageOpen).toBe(false)
    expect(r.model).toBe('deepseek')      // preserved
    expect(r.connection).toBe('connected') // preserved
    // original untouched
    expect(s.items.length).toBe(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/transcriptReducer.test.ts`
Expected: FAIL —— `markStarted`/`setApprovalMode`/`setWorkspace`/`resetSession` 未导出；`initialState.hasStarted` 等 undefined。

- [ ] **Step 3: 加字段到 `TranscriptState` 与 `initialState`**

`desktop/src/shared/transcriptReducer.ts` 的 `TranscriptState` 接口（`model: string` 之后、`_messageOpen` 之前）加：

```ts
  model: string
  /** 前门：首条消息发出后翻 true，控制欢迎态/对话态。 */
  hasStarted: boolean
  /** 审批模式：ask=逐个弹窗，auto=替我审批（自动放行）。 */
  approvalMode: 'ask' | 'auto'
  /** 当前工作目录（驱动 composer 的项目按钮显示）。 */
  workspace: string
  /** Internal flag: true when the last message item is still open for appending. */
  _messageOpen: boolean
```

`initialState`（在 `model: ''` 之后、`_messageOpen: false` 之前）加：

```ts
  model: '',
  hasStarted: false,
  approvalMode: 'ask',
  workspace: '',
  _messageOpen: false,
```

- [ ] **Step 4: 加 4 个 helper（在 `setModel` 之后）**

```ts
/** 前门：标记会话已开始（首条消息发出时同步调用）。 */
export function markStarted(state: TranscriptState): TranscriptState {
  return { ...state, hasStarted: true }
}

/** 设置审批模式（UI 开关驱动）。 */
export function setApprovalMode(state: TranscriptState, mode: 'ask' | 'auto'): TranscriptState {
  return { ...state, approvalMode: mode }
}

/** 设置当前工作目录。 */
export function setWorkspace(state: TranscriptState, ws: string): TranscriptState {
  return { ...state, workspace: ws }
}

/** 重选目录后重置为新会话（清空 transcript，回欢迎态，审批归 ask；保留 model/connection）。 */
export function resetSession(state: TranscriptState, ws: string): TranscriptState {
  return {
    ...state,
    items: [],
    _messageOpen: false,
    hasStarted: false,
    approvalMode: 'ask',
    pendingApproval: null,
    workspace: ws,
  }
}
```

- [ ] **Step 5: 跑测试确认通过（含既有回归）**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/transcriptReducer.test.ts && npm run typecheck`
Expected: 全部通过（原有 reducer 测试 + 5 个新测试），typecheck 0 error。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/shared/transcriptReducer.ts desktop/test/transcriptReducer.test.ts
git commit -m "feat(desktop): reducer 增 hasStarted/approvalMode/workspace + helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 壳接线（preload/main IPC）+ mock 后端可观测

**Files:**
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/main/index.ts:176-185`（pickWorkspace）+ 新增 IPC handler
- Modify: `desktop/test/fixtures/mock-appserver.mjs`

**Interfaces:**
- Consumes: 既有 `client.request`、`currentSessionId`、`ipcMain.handle`。
- Produces: `window.wraith.setApprovalMode(auto:boolean): Promise<{ok:boolean}>`；IPC channel `wraith:setApprovalMode`；`pickWorkspace` 在 E2E 下返回 `process.env.WRAITH_E2E_WORKSPACE ?? null`；mock 记录所有请求到 `WRAITH_E2E_RECORD` 文件、`session.start` 递增 sessionId、支持 `session.setApprovalMode`。

- [ ] **Step 1: preload 暴露 `setApprovalMode`**

`desktop/src/preload/index.ts` 的 `WraithApi` 接口，在 `restartBackend(): Promise<void>` 之后加：

```ts
  restartBackend(): Promise<void>
  setApprovalMode(auto: boolean): Promise<{ ok: boolean }>
  onEvent(cb: (evt: BackendEvent) => void): () => void
```

`const wraith` 实现里，`restartBackend()` 之后加：

```ts
  restartBackend() {
    return ipcRenderer.invoke('wraith:restartBackend')
  },

  setApprovalMode(auto) {
    return ipcRenderer.invoke('wraith:setApprovalMode', auto) as Promise<{ ok: boolean }>
  },
```

- [ ] **Step 2: main 加 IPC handler + 改 pickWorkspace E2E 分支**

`desktop/src/main/index.ts`，在 `wraith:restartBackend` handler 之后新增：

```ts
ipcMain.handle('wraith:setApprovalMode', async (_e, auto: boolean) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.setApprovalMode', {
    sessionId: currentSessionId,
    auto
  })
})
```

把 `wraith:pickWorkspace` 的 E2E 守卫（当前第 178 行 `if (process.env['WRAITH_E2E'] === '1') return null`）改成：

```ts
ipcMain.handle('wraith:pickWorkspace', async () => {
  // E2E test guard: skip native dialog. Return an injected dir if provided
  // (drives the re-pick flow deterministically), else null (backend default).
  if (process.env['WRAITH_E2E'] === '1') {
    return process.env['WRAITH_E2E_WORKSPACE'] ?? null
  }
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  return result.canceled || result.filePaths.length === 0
    ? null
    : result.filePaths[0]!
})
```

> 说明：`wraith:startSession`（第 140-146 行）已在每次调用时 `currentSessionId = r.sessionId`，满足"重选后 sessionId 更新"要求，无需改动。

- [ ] **Step 3: mock 后端加记录 + setApprovalMode + 递增 sessionId**

`desktop/test/fixtures/mock-appserver.mjs`：顶部 import 后加：

```js
import readline from 'readline'
import fs from 'node:fs'

// Optional: append every received request to this file so E2E can assert
// what the backend saw (JSONL of {method, params}).
const recordPath = process.env['WRAITH_E2E_RECORD']
function record(method, params) {
  if (!recordPath) return
  try {
    fs.appendFileSync(recordPath, JSON.stringify({ method, params: params ?? null }) + '\n')
  } catch {
    /* ignore */
  }
}
```

把 `let sessionId = 'sess_mock'` 改为可递增：

```js
let sessionCounter = 0
let sessionId = 'sess_mock_0'
```

在 `handleRequest` 顶部（`const { id, method, params } = req` 之后）加：

```js
  record(method, params)
```

`session.start` case 改为递增并记录 workspaceDir（记录已由 record() 完成，这里只更新 sessionId）：

```js
    case 'session.start': {
      sessionId = `sess_mock_${++sessionCounter}`
      reply(id, { sessionId })
      break
    }
```

在 `turn.interrupt` case 之后加：

```js
    case 'session.setApprovalMode': {
      reply(id, { ok: true })
      break
    }
```

- [ ] **Step 4: typecheck + build + 既有 E2E 回归**

Run:
```bash
cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run build && npx playwright test
```
Expected: typecheck 0；build 成功；既有 2 个 E2E 仍绿（pickWorkspace 未设 `WRAITH_E2E_WORKSPACE` 时返回 null，行为同前；mock sessionId 由 `sess_mock` 变 `sess_mock_1`，测试未断言其值）。

- [ ] **Step 5: 提交**

```bash
git add desktop/src/preload/index.ts desktop/src/main/index.ts desktop/test/fixtures/mock-appserver.mjs
git commit -m "feat(desktop): setApprovalMode IPC + pickWorkspace E2E 注入 + mock 请求记录

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tailwind + shadcn 地基 + 设计 token

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/electron.vite.config.ts`
- Modify: `desktop/src/renderer/main.tsx`
- Create: `desktop/tailwind.config.js`
- Create: `desktop/src/renderer/styles/tokens.css`
- Create: `desktop/src/renderer/lib/utils.ts`
- Create: `desktop/src/renderer/components/ui/switch.tsx`
- Create: `desktop/src/renderer/components/ui/tooltip.tsx`
- Create: `desktop/src/renderer/components/ui/dialog.tsx`

**Interfaces:**
- Consumes: electron-vite renderer 配置。
- Produces: 全局 CSS 变量调色板；Tailwind 语义色类（`bg-surface`/`text-fg`/`text-fg-muted`/`border-border`/`text-accent`/`bg-accent`/`text-danger`/`text-warn`/`text-ok`）；字体类 `font-sans`/`font-mono`；`cn(...)` 合并类工具；shadcn 风格 `Switch`、`Tooltip*`、`Dialog*` 组件（**相对 import** `../../lib/utils`，不用路径别名）。

- [ ] **Step 1: 加依赖**

编辑 `desktop/package.json`：`dependencies` 加（保持字母序不强制）：

```json
  "dependencies": {
    "@radix-ui/react-dialog": "^1.1.1",
    "@radix-ui/react-switch": "^1.1.0",
    "@radix-ui/react-tooltip": "^1.1.2",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-markdown": "^9.0.1",
    "tailwind-merge": "^2.5.2"
  },
```

`devDependencies` 加：

```json
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.40",
    "tailwindcss": "^3.4.10",
```

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm install`
Expected: 安装成功（`node_modules` gitignore，不入库）。

- [ ] **Step 2: 建 tokens.css（调色板 + Tailwind 指令）**

Create `desktop/src/renderer/styles/tokens.css`：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg: #f7f8fa;
  --bg-elevated: #ffffff;
  --bg-sidebar-from: #eef1f6;
  --bg-sidebar-to: #e7ebf3;
  --fg: #1c2430;
  --fg-muted: #5b6675;
  --fg-subtle: #98a2b3;
  --border: #e2e6ec;
  --accent: #0ea5b7;
  --accent-fg: #ffffff;
  --danger: #c0392b;
  --warn: #e67e22;
  --ok: #1f9d63;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
}

html, body, #root { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
}

.sidebar-gradient {
  background: linear-gradient(180deg, var(--bg-sidebar-from), var(--bg-sidebar-to));
}
```

- [ ] **Step 3: 建 tailwind.config.js**

Create `desktop/tailwind.config.js`（desktop `package.json` 是 `type:module`，用 `export default`）：

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--bg-elevated)',
        fg: 'var(--fg)',
        'fg-muted': 'var(--fg-muted)',
        'fg-subtle': 'var(--fg-subtle)',
        border: 'var(--border)',
        accent: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        danger: 'var(--danger)',
        warn: 'var(--warn)',
        ok: 'var(--ok)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 4: electron.vite.config.ts 给 renderer 配 PostCSS（仅 renderer）**

编辑 `desktop/electron.vite.config.ts`：顶部加 import，renderer 段加 `css.postcss`：

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: 'src/main/index.ts'
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: 'src/preload/index.ts',
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    css: {
      postcss: {
        plugins: [tailwindcss(), autoprefixer()]
      }
    },
    build: {
      rollupOptions: {
        input: 'src/renderer/index.html'
      }
    },
    plugins: [react()]
  }
})
```

> 关键：PostCSS 只挂在 `renderer` 段；main/preload 不动，preload 仍输出 CJS。

- [ ] **Step 5: main.tsx 引入 tokens.css**

编辑 `desktop/src/renderer/main.tsx`，在 import App 之前加：

```ts
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import App from './App'
```

- [ ] **Step 6: 建 cn() 工具**

Create `desktop/src/renderer/lib/utils.ts`：

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 7: 建 shadcn 风格 Switch**

Create `desktop/src/renderer/components/ui/switch.tsx`：

```tsx
import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { cn } from '../../lib/utils'

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent data-[state=unchecked]:bg-fg-subtle/40',
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5',
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = 'Switch'

export { Switch }
```

- [ ] **Step 8: 建 shadcn 风格 Tooltip**

Create `desktop/src/renderer/components/ui/tooltip.tsx`：

```tsx
import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../../lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-[220px] rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-fg-muted shadow-md',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = 'TooltipContent'

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
```

- [ ] **Step 9: 建 shadcn 风格 Dialog（供 Task 8 审批弹窗）**

Create `desktop/src/renderer/components/ui/dialog.tsx`：

```tsx
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '../../lib/utils'

const Dialog = DialogPrimitive.Root
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-black/40', className)}
    {...props}
  />
))
DialogOverlay.displayName = 'DialogOverlay'

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-6 shadow-xl focus:outline-none',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = 'DialogContent'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-sm font-bold', className)} {...props} />
))
DialogTitle.displayName = 'DialogTitle'

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-xs text-fg-muted', className)} {...props} />
))
DialogDescription.displayName = 'DialogDescription'

export {
  Dialog,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
}
```

- [ ] **Step 10: typecheck + build + 既有 E2E 回归**

Run:
```bash
cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run build && npx playwright test
```
Expected: typecheck 0；build 成功（Tailwind 编译进 renderer）；既有 2 个 E2E 仍绿。Tailwind preflight（base reset）会改变默认样式，但既有组件用内联样式覆盖、E2E 断的是 DOM/文本而非像素，故行为不变。

- [ ] **Step 11: 提交**

```bash
git add desktop/package.json desktop/package-lock.json desktop/electron.vite.config.ts \
        desktop/tailwind.config.js desktop/src/renderer/main.tsx \
        desktop/src/renderer/styles/tokens.css desktop/src/renderer/lib/utils.ts \
        desktop/src/renderer/components/ui/
git commit -m "feat(desktop): Tailwind + shadcn 地基(token/cn/Switch/Tooltip/Dialog)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 富 Composer（功能性审批开关 + 重选目录 + 占位控件）

**Files:**
- Create: `desktop/src/renderer/components/Composer.tsx`
- Modify: `desktop/src/renderer/App.tsx`
- Test: `desktop/test/e2e/shell.e2e.ts`

**Interfaces:**
- Consumes: Task 2 的 `setApprovalMode`/`resetSession`/`setWorkspace`/`markStarted`；Task 3 的 `window.wraith.setApprovalMode`；Task 4 的 `Switch`/`Tooltip*`。
- Produces: `Composer` 组件（props 见下）；新增 `data-testid`：`approval-toggle`、`workspace-switch`、`attach`（禁用占位）。保留既有 `input`/`interrupt`。

- [ ] **Step 1: 写失败的 E2E（审批开关 + 重选目录）**

在 `desktop/test/e2e/shell.e2e.ts` 末尾追加两个测试（顶部已 import `fs`? 若无则加 `import fs from 'node:fs'` 与 `import os from 'node:os'`）：

```ts
import fs from 'node:fs'
import os from 'node:os'

test('approval toggle sends session.setApprovalMode with correct auto flag', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}.jsonl`)
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile
    }
  })
  const win = await app.firstWindow()
  const toggle = win.locator('[data-testid="approval-toggle"]')
  await expect(toggle).toBeVisible({ timeout: 15000 })

  await toggle.click() // ask → auto
  await expect
    .poll(() => {
      if (!fs.existsSync(recordFile)) return null
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const last = [...lines].reverse().find(l => l.method === 'session.setApprovalMode')
      return last ? last.params.auto : null
    }, { timeout: 10000 })
    .toBe(true)

  await toggle.click() // auto → ask
  await expect
    .poll(() => {
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const last = [...lines].reverse().find(l => l.method === 'session.setApprovalMode')
      return last ? last.params.auto : null
    }, { timeout: 10000 })
    .toBe(false)

  await app.close()
  fs.rmSync(recordFile, { force: true })
})

test('workspace switch re-picks dir → second session.start + transcript reset', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-ws.jsonl`)
  const injectedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ws-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_WORKSPACE: injectedDir
    }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  // go to conversation state
  await input.fill('hi')
  await input.press('Enter')
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 15000 })

  // re-pick
  await win.locator('[data-testid="workspace-switch"]').click()

  // second session.start carrying the injected workspaceDir
  await expect
    .poll(() => {
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const starts = lines.filter(l => l.method === 'session.start')
      return starts.length >= 2 && starts[starts.length - 1].params?.workspaceDir === injectedDir
    }, { timeout: 10000 })
    .toBe(true)

  // welcome heading returns (transcript reset)
  await expect(win.locator('text=今天做点什么？')).toBeVisible({ timeout: 10000 })

  await app.close()
  fs.rmSync(recordFile, { force: true })
  fs.rmSync(injectedDir, { recursive: true, force: true })
})
```

> 注：`text=今天做点什么？` 断言依赖 Task 6 的 WelcomeEmptyState。执行顺序上 Task 5 先跑时该行会失败——因此本步的重选测试中"welcome heading 返回"这一断言**先注释掉**，在 Task 6 完成后取消注释并复跑（在 Task 6 Step 的验证里点名复跑）。审批开关测试与 `session.start` 断言不依赖 welcome，可在 Task 5 立即通过。

- [ ] **Step 2: 跑 E2E 确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run build && npx playwright test -g "approval toggle"`
Expected: FAIL —— `[data-testid="approval-toggle"]` 不存在（Composer 未建）。

- [ ] **Step 3: 建 Composer 组件**

Create `desktop/src/renderer/components/Composer.tsx`：

```tsx
import { useCallback } from 'react'
import { Switch } from './ui/switch'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './ui/tooltip'

interface ComposerProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onInterrupt: () => void
  running: boolean
  approvalAuto: boolean
  onToggleApproval: (auto: boolean) => void
  model: string
  workspace: string
  onSwitchWorkspace: () => void
  /** 欢迎态用居中窄版，对话态用贴底宽版。 */
  centered?: boolean
}

function baseName(p: string): string {
  if (!p) return '默认工作目录'
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

export default function Composer({
  value,
  onChange,
  onSubmit,
  onInterrupt,
  running,
  approvalAuto,
  onToggleApproval,
  model,
  workspace,
  onSwitchWorkspace,
  centered = false,
}: ComposerProps): JSX.Element {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onSubmit()
      }
    },
    [onSubmit],
  )

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={
          'w-full rounded-2xl border border-border bg-surface shadow-sm ' +
          (centered ? 'max-w-2xl mx-auto' : '')
        }
      >
        {/* text row */}
        <textarea
          data-testid="input"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          placeholder="给 Wraith 一个目标… (Enter 发送, Shift+Enter 换行)"
          rows={centered ? 3 : 2}
          className="w-full resize-none bg-transparent px-4 pt-3 text-sm text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
        />

        {/* control row */}
        <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
          {/* attach — disabled placeholder */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid="attach"
                disabled
                aria-label="附件"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-subtle opacity-50"
              >
                +
              </button>
            </TooltipTrigger>
            <TooltipContent>附件在后续阶段</TooltipContent>
          </Tooltip>

          {/* model chip — read only */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default rounded-lg border border-border px-2 py-1 text-xs text-fg-muted">
                {model || '—'}
              </span>
            </TooltipTrigger>
            <TooltipContent>模型/强度切换在后续阶段</TooltipContent>
          </Tooltip>

          {/* workspace switch — functional */}
          <button
            data-testid="workspace-switch"
            onClick={onSwitchWorkspace}
            disabled={running}
            title="重选工作目录"
            className="max-w-[180px] truncate rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-50"
          >
            📁 {baseName(workspace)}
          </button>

          <div className="flex-1" />

          {/* approve-mode toggle — functional */}
          <label className="flex select-none items-center gap-1.5 text-xs text-fg-muted">
            替我审批
            <Switch
              data-testid="approval-toggle"
              checked={approvalAuto}
              onCheckedChange={onToggleApproval}
            />
          </label>

          {running && (
            <button
              data-testid="interrupt"
              onClick={onInterrupt}
              className="rounded-lg border border-danger px-3 py-1 text-xs text-danger hover:bg-danger/10"
            >
              中断
            </button>
          )}

          <button
            onClick={onSubmit}
            disabled={running || !value.trim()}
            className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </TooltipProvider>
  )
}
```

- [ ] **Step 4: App.tsx 接入 Composer + 审批开关 + 重选目录**

编辑 `desktop/src/renderer/App.tsx`：

(a) import 段加 helper 与组件：

```tsx
import {
  initialState,
  reduce,
  clearApproval,
  setModel,
  markStarted,
  setApprovalMode,
  setWorkspace,
  resetSession,
  type TranscriptState,
} from '../shared/transcriptReducer'
import Transcript from './components/Transcript'
import Composer from './components/Composer'
import ApprovalModal from './components/ApprovalModal'
import DisconnectedBanner from './components/DisconnectedBanner'
```

(b) `LocalAction` 联合类型扩展：

```tsx
type LocalAction =
  | { type: 'clearApproval' }
  | { type: 'setModel'; model: string }
  | { type: 'markStarted' }
  | { type: 'setApprovalMode'; mode: 'ask' | 'auto' }
  | { type: 'setWorkspace'; ws: string }
  | { type: 'resetSession'; ws: string }
```

(c) `reduceAdapter` 增分支（在 `setModel` 分支之后、`reduce(...)` 之前）：

```tsx
  if ('type' in action && action.type === 'markStarted') {
    return markStarted(state)
  }
  if ('type' in action && action.type === 'setApprovalMode') {
    return setApprovalMode(state, action.mode)
  }
  if ('type' in action && action.type === 'setWorkspace') {
    return setWorkspace(state, action.ws)
  }
  if ('type' in action && action.type === 'resetSession') {
    return resetSession(state, action.ws)
  }
```

(d) 启动流程记录 workspace：`startup flow` 的 `const ws = await window.wraith.pickWorkspace()` 之后加：

```tsx
        const ws = await window.wraith.pickWorkspace()
        dispatch({ type: 'setWorkspace', ws: ws ?? '' })
```

(e) `handleSubmit`：在 `setInputValue('')` 之后加 `dispatch({ type: 'markStarted' })`：

```tsx
  const handleSubmit = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || state.turn === 'running') return
    setInputValue('')
    dispatch({ type: 'markStarted' })
    try {
      await window.wraith.submitTurn(text)
    } catch (err) {
      console.error('[wraith] submitTurn error:', err)
    }
  }, [inputValue, state.turn])
```

(f) 新增两个 handler（放在 `handleInterrupt` 附近）：

```tsx
  const handleToggleApproval = useCallback(
    async (auto: boolean) => {
      const mode = auto ? 'auto' : 'ask'
      dispatch({ type: 'setApprovalMode', mode })
      try {
        await window.wraith.setApprovalMode(auto)
      } catch (err) {
        console.error('[wraith] setApprovalMode error:', err)
        dispatch({ type: 'setApprovalMode', mode: auto ? 'ask' : 'auto' }) // rollback
      }
    },
    [],
  )

  const handleSwitchWorkspace = useCallback(async () => {
    if (state.turn === 'running') return
    try {
      const ws = await window.wraith.pickWorkspace()
      if (!ws || ws === state.workspace) return
      await window.wraith.startSession(ws)
      dispatch({ type: 'resetSession', ws })
    } catch (err) {
      console.error('[wraith] switchWorkspace error:', err)
    }
  }, [state.turn, state.workspace])
```

(g) 替换旧的输入区（当前 `{/* Input area */}` 整块，App.tsx 第 215-293 行）为 `<Composer>`：

```tsx
      {/* Composer */}
      <div style={{ padding: '12px 16px', flexShrink: 0 }}>
        <Composer
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          onInterrupt={handleInterrupt}
          running={state.turn === 'running'}
          approvalAuto={state.approvalMode === 'auto'}
          onToggleApproval={handleToggleApproval}
          model={state.model}
          workspace={state.workspace}
          onSwitchWorkspace={handleSwitchWorkspace}
        />
      </div>
```

> 说明：`handleKeyDown` 旧逻辑已移入 Composer，App 里原 `handleKeyDown` 可删。旧 header 暂保留（Task 7 再换成 Sidebar/AppShell）。

- [ ] **Step 5: 取消审批测试里对 welcome 的依赖后跑 E2E（审批开关）**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run build && npx playwright test -g "approval toggle"`
Expected: PASS（`session.setApprovalMode` 先 auto=true 后 auto=false 被记录）。

- [ ] **Step 6: 跑重选目录 E2E（welcome 断言暂注释）+ 既有回归**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx playwright test`
Expected: 审批开关 PASS；重选目录测试中"第二次 session.start 带 injectedDir"PASS（welcome 断言此步仍注释）；既有 2 个 happy-path/disconnect 仍绿。

- [ ] **Step 7: 提交**

```bash
git add desktop/src/renderer/components/Composer.tsx desktop/src/renderer/App.tsx desktop/test/e2e/shell.e2e.ts
git commit -m "feat(desktop): 富 Composer(审批开关+重选目录+占位控件)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 欢迎空态 + hasStarted 过渡

**Files:**
- Create: `desktop/src/renderer/components/WelcomeEmptyState.tsx`
- Modify: `desktop/src/renderer/App.tsx`
- Test: `desktop/test/e2e/shell.e2e.ts`（取消 Task 5 注释 + 加欢迎过渡测试）

**Interfaces:**
- Consumes: Task 2 的 `hasStarted`；Task 5 的 `Composer`。
- Produces: `WelcomeEmptyState`（居中大标题 `今天做点什么？` + 副标题 + children 插槽承载 Composer）；App 按 `state.hasStarted` 切换欢迎/对话。

- [ ] **Step 1: 写失败的欢迎过渡 E2E**

在 `desktop/test/e2e/shell.e2e.ts` 追加：

```ts
test('welcome empty state shows, then transitions to transcript on submit', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()

  // welcome heading visible, transcript absent
  await expect(win.locator('text=今天做点什么？')).toBeVisible({ timeout: 15000 })
  await expect(win.locator('[data-testid="transcript"]')).toHaveCount(0)

  // submit → welcome gone, transcript present
  const input = win.locator('[data-testid="input"]')
  await input.fill('hi')
  await input.press('Enter')
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 15000 })
  await expect(win.locator('text=今天做点什么？')).toHaveCount(0)

  await app.close()
})
```

并把 Task 5 "workspace switch" 测试里被注释的 welcome 断言取消注释（`await expect(win.locator('text=今天做点什么？')).toBeVisible(...)`）。

- [ ] **Step 2: 跑确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run build && npx playwright test -g "welcome empty state"`
Expected: FAIL —— 无 `今天做点什么？`（Welcome 未建，App 总是渲染 transcript）。

- [ ] **Step 3: 建 WelcomeEmptyState**

Create `desktop/src/renderer/components/WelcomeEmptyState.tsx`：

```tsx
import type { ReactNode } from 'react'

interface WelcomeEmptyStateProps {
  children: ReactNode
}

export default function WelcomeEmptyState({ children }: WelcomeEmptyStateProps): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <h1 className="mb-2 text-2xl font-semibold text-fg">今天做点什么？</h1>
      <p className="mb-8 text-sm text-fg-muted">
        Wraith 会读代码、跑命令、改文件——先说个目标
      </p>
      <div className="w-full">{children}</div>
    </div>
  )
}
```

- [ ] **Step 4: App.tsx 按 hasStarted 切换**

编辑 `desktop/src/renderer/App.tsx`：import 加 `import WelcomeEmptyState from './components/WelcomeEmptyState'`。

把 `{/* Transcript */}` 与 `{/* Composer */}` 两块重构为条件渲染。找到当前：

```tsx
      {/* Transcript */}
      <Transcript items={state.items} />
      <div ref={transcriptEndRef} />

      {/* Composer */}
      <div style={{ padding: '12px 16px', flexShrink: 0 }}>
        <Composer ... />
      </div>
```

替换为（把 `<Composer .../>` 抽成一个常量避免重复；保持所有 props 不变）：

```tsx
      {(() => {
        const composer = (
          <Composer
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            onInterrupt={handleInterrupt}
            running={state.turn === 'running'}
            approvalAuto={state.approvalMode === 'auto'}
            onToggleApproval={handleToggleApproval}
            model={state.model}
            workspace={state.workspace}
            onSwitchWorkspace={handleSwitchWorkspace}
          />
        )
        return state.hasStarted ? (
          <>
            <Transcript items={state.items} />
            <div ref={transcriptEndRef} />
            <div style={{ padding: '12px 16px', flexShrink: 0 }}>{composer}</div>
          </>
        ) : (
          <div style={{ flexGrow: 1, minHeight: 0 }}>
            <WelcomeEmptyState>{composer}</WelcomeEmptyState>
          </div>
        )
      })()}
```

> `hasStarted` 由 `handleSubmit` 的 `markStarted`（Task 5）同步翻转，故点发送即切走欢迎态。

- [ ] **Step 5: 跑 E2E 确认通过（含 Task 5 复跑）**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run build && npx playwright test`
Expected: 欢迎过渡 PASS；重选目录（welcome 断言已取消注释）PASS；审批开关 PASS；既有 happy-path/disconnect PASS。

> 注意：既有 happy-path 测试先 `input.fill('hi').press('Enter')` 再断言 transcript——发送后 `hasStarted` 翻真、transcript 出现，测试仍成立。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/components/WelcomeEmptyState.tsx desktop/src/renderer/App.tsx desktop/test/e2e/shell.e2e.ts
git commit -m "feat(desktop): 欢迎空态 + hasStarted 欢迎↔对话过渡

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 静态侧栏 + AppShell 布局

**Files:**
- Create: `desktop/src/renderer/components/Sidebar.tsx`
- Modify: `desktop/src/renderer/App.tsx`
- Test: `desktop/test/e2e/shell.e2e.ts`

**Interfaces:**
- Consumes: Task 4 的 `Tooltip*`、`.sidebar-gradient` 类。
- Produces: `Sidebar`（静态骨架：品牌区 + 禁用导航 + 静态会话条目 + 设置 + 工作目录页脚）；App 外层变 `flex row`（Sidebar + MainPane）。新增 `data-testid="sidebar"`、`data-testid="nav-plugins"`（禁用占位样例）。

- [ ] **Step 1: 写失败的侧栏 E2E**

追加：

```ts
test('static sidebar shell present with disabled placeholder nav', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="sidebar"]')).toBeVisible({ timeout: 15000 })
  await expect(win.locator('[data-testid="nav-plugins"]')).toBeDisabled()
  await app.close()
})
```

- [ ] **Step 2: 跑确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run build && npx playwright test -g "static sidebar"`
Expected: FAIL —— 无 `[data-testid="sidebar"]`。

- [ ] **Step 3: 建 Sidebar**

Create `desktop/src/renderer/components/Sidebar.tsx`：

```tsx
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './ui/tooltip'

interface SidebarProps {
  workspace: string
}

const NAV: { key: string; label: string; hint: string }[] = [
  { key: 'search', label: '搜索', hint: '搜索在后续阶段' },
  { key: 'plugins', label: '插件', hint: '插件在 Phase D' },
  { key: 'automation', label: '自动化', hint: '自动化在 Phase D' },
  { key: 'projects', label: '项目', hint: '多项目在 Phase C' },
]

function baseName(p: string): string {
  if (!p) return '默认工作目录'
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

export default function Sidebar({ workspace }: SidebarProps): JSX.Element {
  return (
    <TooltipProvider delayDuration={200}>
      <aside
        data-testid="sidebar"
        className="sidebar-gradient flex h-full w-60 flex-col border-r border-border"
      >
        {/* brand */}
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="text-accent">✦</span>
          <span className="text-sm font-bold tracking-wide text-fg">WRAITH</span>
        </div>

        {/* new conversation — disabled placeholder */}
        <div className="px-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid="nav-new"
                disabled
                className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-left text-xs text-fg-muted opacity-60"
              >
                ＋ 新对话
              </button>
            </TooltipTrigger>
            <TooltipContent>多会话在 Phase B</TooltipContent>
          </Tooltip>
        </div>

        {/* nav — disabled placeholders */}
        <nav className="mt-3 flex flex-col gap-0.5 px-3">
          {NAV.map(n => (
            <Tooltip key={n.key}>
              <TooltipTrigger asChild>
                <button
                  data-testid={`nav-${n.key}`}
                  disabled
                  className="rounded-lg px-3 py-1.5 text-left text-xs text-fg-muted opacity-60"
                >
                  {n.label}
                </button>
              </TooltipTrigger>
              <TooltipContent>{n.hint}</TooltipContent>
            </Tooltip>
          ))}
        </nav>

        {/* conversations — static single entry */}
        <div className="mt-4 px-3 text-[10px] uppercase tracking-wider text-fg-subtle">对话</div>
        <div className="px-3">
          <div className="truncate rounded-lg bg-surface px-3 py-2 text-xs text-fg">当前会话</div>
        </div>

        <div className="flex-1" />

        {/* footer: workspace + settings */}
        <div className="border-t border-border px-3 py-3">
          <div className="mb-2 truncate text-[11px] text-fg-subtle" title={workspace || '默认工作目录'}>
            📁 {baseName(workspace)}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid="nav-settings"
                disabled
                className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-fg-muted opacity-60"
              >
                设置
              </button>
            </TooltipTrigger>
            <TooltipContent>设置在后续阶段</TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  )
}
```

- [ ] **Step 4: App.tsx 外层改 AppShell（Sidebar + MainPane）**

编辑 `desktop/src/renderer/App.tsx`：import 加 `import Sidebar from './components/Sidebar'`。

把最外层容器（当前 `return ( <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'#0d0f12', ... }}>` ）改为浅色 AppShell 行布局，并删除旧的深色 header（第 165-209 行整块），把断连横幅 + 内容区放进 MainPane。最外层结构改为：

```tsx
  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
      <Sidebar workspace={state.workspace} />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {state.connection === 'disconnected' && (
          <DisconnectedBanner onRestart={handleRestart} />
        )}

        {/* content: welcome ↔ transcript + composer （沿用 Task 6 的条件渲染块） */}
        {(() => {
          const composer = (
            <Composer
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              onInterrupt={handleInterrupt}
              running={state.turn === 'running'}
              approvalAuto={state.approvalMode === 'auto'}
              onToggleApproval={handleToggleApproval}
              model={state.model}
              workspace={state.workspace}
              onSwitchWorkspace={handleSwitchWorkspace}
            />
          )
          return state.hasStarted ? (
            <>
              <Transcript items={state.items} />
              <div ref={transcriptEndRef} />
              <div style={{ padding: '12px 16px', flexShrink: 0 }}>{composer}</div>
            </>
          ) : (
            <div className="min-h-0 flex-1">
              <WelcomeEmptyState>{composer}</WelcomeEmptyState>
            </div>
          )
        })()}
      </div>

      {/* Approval modal（Task 8 换 shadcn Dialog；此处结构不变） */}
      {state.pendingApproval && (
        <ApprovalModal
          approvalId={state.pendingApproval.approvalId}
          toolName={state.pendingApproval.toolName}
          argsJson={state.pendingApproval.argsJson}
          dangerLevel={state.pendingApproval.dangerLevel}
          riskDescription={state.pendingApproval.riskDescription}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </div>
  )
```

> 旧 header 里的 model 展示已并入 Composer 的 model chip；连接状态/忙闲不再单独占 header（Codex 范式，model 在 composer）。`background:'#0d0f12'` 等深色内联样式随本次删除。

- [ ] **Step 5: 跑 E2E + typecheck + build**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run build && npx playwright test`
Expected: 侧栏测试 PASS（`sidebar` 可见、`nav-plugins` disabled）；欢迎/审批/重选/既有全绿。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/renderer/components/Sidebar.tsx desktop/src/renderer/App.tsx desktop/test/e2e/shell.e2e.ts
git commit -m "feat(desktop): 静态侧栏骨架 + AppShell 浅色布局

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 组件重皮到浅色调色板（保留契约）

**Files:**
- Modify: `desktop/src/renderer/components/Transcript.tsx`
- Modify: `desktop/src/renderer/components/ToolCard.tsx`
- Modify: `desktop/src/renderer/components/ThinkingBlock.tsx`
- Modify: `desktop/src/renderer/components/DisconnectedBanner.tsx`
- Modify: `desktop/src/renderer/components/ApprovalModal.tsx`（→ shadcn Dialog）

**Interfaces:**
- Consumes: Task 4 的 Tailwind 语义类 + `Dialog*`。
- Produces: 5 个组件浅色化；**所有 `data-testid` 与 props 不变**；危险色按 Global Constraints 规则。

- [ ] **Step 1: 重皮 Transcript.tsx**

整文件替换为（消息正文浅色，其余委托子组件）：

```tsx
import ReactMarkdown from 'react-markdown'
import type { Item } from '../../shared/transcriptReducer'
import ThinkingBlock from './ThinkingBlock'
import ToolCard from './ToolCard'

interface TranscriptProps {
  items: Item[]
}

export default function Transcript({ items }: TranscriptProps): JSX.Element {
  return (
    <div
      data-testid="transcript"
      className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-4"
    >
      {items.map((item, idx) => {
        if (item.type === 'message') {
          return (
            <div key={idx} className="text-sm leading-7 text-fg [&_code]:font-mono [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/[0.04] [&_pre]:p-3">
              <ReactMarkdown>{item.text}</ReactMarkdown>
            </div>
          )
        }
        if (item.type === 'thinking') {
          return <ThinkingBlock key={idx} label={item.label} text={item.text} done={item.done} />
        }
        if (item.type === 'tool') {
          return <ToolCard key={item.card.callId || idx} card={item.card} />
        }
        return null
      })}
    </div>
  )
}
```

- [ ] **Step 2: 重皮 ToolCard.tsx**

整文件替换为（浅色卡片，等宽输出；徽标色用语义类）：

```tsx
import type { ToolCard as ToolCardType } from '../../shared/transcriptReducer'

interface ToolCardProps {
  card: ToolCardType
}

export default function ToolCard({ card }: ToolCardProps): JSX.Element {
  const badgeClass = card.done
    ? card.ok === false
      ? 'bg-danger text-white'
      : 'bg-ok text-white'
    : 'bg-accent/15 text-accent'

  return (
    <div
      data-testid="tool-card"
      className="my-1.5 overflow-hidden rounded-xl border border-border bg-surface font-mono text-xs"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-1.5">
        <span className="font-semibold text-accent">{card.name}</span>
        <span className="flex-1 truncate text-fg-muted">{card.argsJson}</span>
        {card.done ? (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${badgeClass}`}>
            {card.ok === false ? `exit ${card.exitCode ?? 1}` : `exit ${card.exitCode ?? 0}`}
          </span>
        ) : (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${badgeClass}`}>running…</span>
        )}
      </div>
      <pre
        data-testid="tool-output"
        className="m-0 max-h-60 overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed text-fg-muted"
      >
        {card.output || ' '}
      </pre>
    </div>
  )
}
```

- [ ] **Step 3: 重皮 ThinkingBlock.tsx**

整文件替换为（浅色可折叠块；保留 `thinking`/`thinking-toggle` testid 与 stopPropagation）：

```tsx
import { useState } from 'react'

interface ThinkingBlockProps {
  label: string
  text: string
  done: boolean
}

export default function ThinkingBlock({ label, text, done }: ThinkingBlockProps): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div
      data-testid="thinking"
      className="my-1.5 overflow-hidden rounded-xl border border-border bg-surface font-mono text-xs"
    >
      <div
        className="flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-fg-muted"
        onClick={() => setOpen(o => !o)}
      >
        <button
          data-testid="thinking-toggle"
          onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          aria-expanded={open}
          aria-label="Toggle thinking block"
          className="p-0 text-[10px] leading-none text-fg-subtle"
        >
          {open ? '▼' : '▶'}
        </button>
        <span className="text-[11px] tracking-wide text-accent">
          {done ? '✓' : '⟳'} {label || '思考中'}
        </span>
        {!done && <span className="text-[11px] italic text-fg-subtle">思考中…</span>}
      </div>
      {open && (
        <pre className="m-0 whitespace-pre-wrap break-words border-t border-border px-3 py-2 text-xs leading-relaxed text-fg-muted">
          {text}
        </pre>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 重皮 DisconnectedBanner.tsx**

整文件替换为（浅色警示条；保留 `restart` testid）：

```tsx
interface DisconnectedBannerProps {
  onRestart: () => void
}

export default function DisconnectedBanner({ onRestart }: DisconnectedBannerProps): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-danger/40 bg-danger/10 px-4 py-2 text-xs">
      <span className="text-danger">⚡ 后端连接断开</span>
      <button
        data-testid="restart"
        onClick={onRestart}
        className="rounded-lg border border-danger px-3 py-1 text-danger hover:bg-danger/10"
      >
        重新连接
      </button>
    </div>
  )
}
```

> 注：原来是 `position:fixed`；现放在 MainPane 顶部的常规流里（Task 7 已把它放在内容区之上）。去掉 fixed 定位。

- [ ] **Step 5: 重皮 ApprovalModal.tsx（→ shadcn Dialog）**

整文件替换为（用 Task 4 的 Dialog；危险色按规则；保留 `approve`/`reject` testid 与 props）：

```tsx
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'

interface ApprovalModalProps {
  approvalId: string
  toolName: string
  argsJson: string
  dangerLevel: string
  riskDescription: string
  onApprove: () => void
  onReject: () => void
}

export default function ApprovalModal({
  toolName,
  argsJson,
  dangerLevel,
  riskDescription,
  onApprove,
  onReject,
}: ApprovalModalProps): JSX.Element {
  const dangerText =
    dangerLevel.includes('高危') ? 'text-danger'
    : dangerLevel.includes('中危') ? 'text-warn'
    : 'text-accent'
  const dangerBg =
    dangerLevel.includes('高危') ? 'bg-danger'
    : dangerLevel.includes('中危') ? 'bg-warn'
    : 'bg-accent'

  return (
    <Dialog open>
      <DialogContent>
        <div className="mb-4">
          <DialogTitle className={dangerText}>⚠ 审批请求</DialogTitle>
          <div className="mt-1 text-sm font-semibold text-fg">{toolName}</div>
        </div>

        <pre className="mb-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-black/[0.03] px-3 py-2 font-mono text-xs text-fg-muted">
          {argsJson}
        </pre>

        <div className="mb-5">
          <span className={`mb-2 inline-block rounded px-2 py-0.5 text-[11px] font-bold text-white ${dangerBg}`}>
            {dangerLevel}
          </span>
          <DialogDescription className="leading-relaxed">{riskDescription}</DialogDescription>
        </div>

        <div className="flex justify-end gap-2.5">
          <button
            data-testid="reject"
            onClick={onReject}
            className="rounded-lg border border-border px-4 py-1.5 text-xs text-fg-muted hover:bg-black/[0.03]"
          >
            拒绝
          </button>
          <button
            data-testid="approve"
            onClick={onApprove}
            className="rounded-lg bg-ok px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            允许
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 6: 全套测试**

Run:
```bash
cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run test && npm run build && npx playwright test
```
Expected: vitest 全绿；typecheck 0；build 成功；Playwright 全部 E2E 绿（happy-path 里 markdown `strong=world`、thinking、tool-card `echo hi`、approve、tool-output `hi`、`exit 0` 均仍命中——testid 与文本未变）。

- [ ] **Step 7: 提交**

```bash
git add desktop/src/renderer/components/Transcript.tsx desktop/src/renderer/components/ToolCard.tsx \
        desktop/src/renderer/components/ThinkingBlock.tsx desktop/src/renderer/components/DisconnectedBanner.tsx \
        desktop/src/renderer/components/ApprovalModal.tsx
git commit -m "feat(desktop): 组件重皮到浅色调色板(审批弹窗→shadcn Dialog)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 收尾（在 subagent-driven-development 的最终整支复审前后）

- **控制器真后端眼验**（非 CI，spec §10/§12）：真 `java -jar ~/.wraith/wraith.jar app-server`，`WRAITH_E2E=1`（+ 必要时 `WRAITH_E2E_WORKSPACE`）跳对话框，眼看：① 浅色前门 + 欢迎大标题渲染；② 发消息后欢迎→对话过渡；③ 切"替我审批"为 auto 后，一个本会触发审批的命令**不再弹窗**（证明 `hitl.setEnabled(false)` 真生效）；④ 点"项目/工作目录"选到另一目录后，会话在新目录工作（如读新目录文件）、transcript 清空回欢迎。临时脚本用后删除、**不提交**。
- 全套 Java 回归：`mvn test -DskipTests=false`（对照 `testing_quirks` 的 ~3F/38E 环境性基线，勿混淆）。

## Self-Review（写完自查，已过）

- **Spec 覆盖**：§2 调色板→Task4；§3 shadcn/electron-vite→Task4；§4 AppShell/Sidebar→Task7；§5 欢迎态→Task6；§6 富 composer + §6.1 重选→Task5；§7 重皮→Task8；§8 后端 RPC→Task1；§9 reducer/IPC→Task2+Task3；§10 测试→各任务 TDD + 收尾眼验。无遗漏。
- **Placeholder 扫描**：无 TBD/TODO；每个改代码步骤都给了完整代码或精确 old→new 块。
- **类型一致**：`markStarted`/`setApprovalMode`/`setWorkspace`/`resetSession` 在 Task2 定义、Task5/6 消费签名一致；`window.wraith.setApprovalMode(auto)` 在 Task3 定义、Task5 消费一致；testid（`approval-toggle`/`workspace-switch`/`attach`/`sidebar`/`nav-plugins`/`nav-settings`）在创建任务定义、E2E 断言一致；`SessionRunner.setApprovalMode` 默认方法在 Task1 定义、Main.java 覆写一致。
- **已知跨任务约束**：Task5 的重选 E2E 中"welcome 断言"依赖 Task6，已在 Task5 Step1/Step6 标注先注释、Task6 Step1/Step5 取消注释并复跑。
