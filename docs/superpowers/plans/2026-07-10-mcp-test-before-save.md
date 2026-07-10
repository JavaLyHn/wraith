# MCP 表单保存前测试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP 添加/编辑表单加「测试」按钮:拉临时进程握手+tools/list,报「连接成功 · N 个工具 · XXms」或含 stderr 的错误,不落盘、与保存独立。

**Architecture:** 后端 `McpOps.test(scope,name,command,args,env)` 默认方法 + `AppServerMcp` 实现(`StdioTransport`+`McpClient` 现成部件拉临时进程,不注册 live manager,finally 必杀);env 空值沿用 `McpConfigWriter` 的"空串=保留现值"密钥语义(`mergeEnvForTest` 静态可测);`mcp.test` RPC 照 `mcp.config.upsert` 样板;前端 `mcpTest` IPC + 表单测试按钮 + `formatMcpTestResult` 纯函数。设计详见 `docs/superpowers/specs/2026-07-10-mcp-test-before-save-design.md`。

**Tech Stack:** Java 17 / Maven;Electron + React + TS + Vitest。分支 `feat/mcp-builtin-detail`。

## Global Constraints

- **临时进程铁律**:探测进程绝不注册进 `McpServerManager`;`finally` 里 `client.close()`(client 未建成则 `transport.close()`),不残留。
- **env 红线**:回包只含 `ok/toolCount/latencyMs/error`,**绝不回显 env 值**;env 值走 `mcp.config.upsert` 同一条既有通道,不落日志。
- **env 空值语义与保存一致**:空串 = 沿用 `scopePath(scope)` 配置里 `name` 条目的已存值(`McpConfigWriter.upsert:41-43` 的密钥编辑语义);无存值则保持空串。
- **错误报文**:异常消息 + `StdioTransport.stderrLines()` 尾部**最多 5 行**,总长**截断 500 字符**(加 `…`)。
- `McpOps.test` 为 **default 方法**(抛 UnsupportedOperationException)——`AppServerMcpDispatchTest` 的匿名 fake McpOps 未覆写也要能编译。
- 测试中表单**测试+保存+取消一起禁用**;任意字段变更清空旧结果;busy 时随表单一起禁(不单独放行)。
- 不做:详情页探活、MCP ping、真实拉外部包的集成测试、http transport 测试(见 spec Out of Scope)。
- **中文**注释;commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- Java 测试须 `-DskipTests=false`;基线约 4F 为 JDK/Mockito 噪声。桌面无 RTL:逻辑沉纯函数 vitest,接线 typecheck+vitest+build+眼验。
- **密钥扫描**:提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。

---

## File Structure

- `src/main/java/com/lyhn/wraith/runtime/appserver/McpOps.java` — `test` 默认方法(T1)。
- `src/main/java/com/lyhn/wraith/runtime/appserver/AppServerMcp.java` — `test` 实现 + `mergeEnvForTest`/`savedEntryOrNull`/`buildTestError`(T1)。
- `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` — `case "mcp.test"`(T1)。
- Test: `AppServerMcpTest.java`(op+merge)、`AppServerMcpDispatchTest.java`(dispatch)(T1)。
- `desktop/src/shared/types.ts` — `McpTestResult`(T2);`desktop/src/preload/index.ts` + `desktop/src/main/index.ts` — `mcpTest` 通道(T2)。
- `desktop/src/renderer/lib/mcpTestResultText.ts`(新)+ `desktop/test/mcpTestResultText.test.ts`(新)(T3)。
- `desktop/src/renderer/components/McpServerForm.tsx` — 测试按钮/结果行/禁用态(T3)。

---

### Task 1: 后端 mcp.test 全链(op + 实现 + dispatch + 测试)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/McpOps.java`(接口末尾 `configRemove` 之后)
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServerMcp.java`(`configRemove` 实现之后;helpers 区)
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(`case "mcp.config.upsert"` 块之后)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerMcpTest.java` + `AppServerMcpDispatchTest.java`

**Interfaces:**
- Consumes: `StdioTransport(String, List<String>, Map<String,String>, Path)`(构造即拉进程,失败抛 IOException);`McpClient(name, transport)`/`initialize()`/`listTools()`/`close()`;`StdioTransport.stderrLines()`;`AppServerMcp` 既有 `scopePath(scope)`/`MAPPER`/`currentWorkspace`;`AppServer` 既有 `handleMcp`/`textParam`;DispatchTest 既有 `run(List<String> calls, McpOps customOps, String... requests)`。
- Produces: RPC `mcp.test {scope,name,command,args,env}` → `{ok:true,toolCount,latencyMs}` | `{ok:false,error}`;`McpOps.test(...)` default;`static Map<String,String> AppServerMcp.mergeEnvForTest(Map<String,String>, JsonNode)`。T2 依赖 RPC 契约。

- [ ] **Step 1: Write the failing tests**

(1a) `AppServerMcpTest.java` 末尾(最后 `}` 前)加两用例(缺的断言静态导入如 `assertNotNull` 需补):

```java
    @Test
    void testOpReportsFailureForNonexistentCommand(@TempDir Path ws) throws Exception {
        AppServerMcp mcp = new AppServerMcp((reg, dir) -> new FakeManager(reg, dir));
        mcp.ensureFor(ws.toString(), registry(ws), null);
        Map<String, Object> r = mcp.test("user", "ghost", "/nonexistent-cmd-xyz-12345",
                List.of(), Map.of());
        assertEquals(Boolean.FALSE, r.get("ok"), "不存在的命令应报 ok:false");
        assertNotNull(r.get("error"));
        assertFalse(String.valueOf(r.get("error")).isBlank(), "error 应含具体信息");
    }

    @Test
    void mergeEnvForTestBlankValueUsesSavedElseKeepsBlank() {
        com.fasterxml.jackson.databind.node.ObjectNode entry = JsonRpc.MAPPER.createObjectNode();
        entry.putObject("env").put("TOKEN", "saved-v");
        Map<String, String> form = new java.util.LinkedHashMap<>();
        form.put("TOKEN", "");   // 空串+有存值 → 合并
        form.put("OTHER", "");   // 空串+无存值 → 保持空
        form.put("SET", "x");    // 非空 → 原样
        Map<String, String> merged = AppServerMcp.mergeEnvForTest(form, entry);
        assertEquals("saved-v", merged.get("TOKEN"));
        assertEquals("", merged.get("OTHER"));
        assertEquals("x", merged.get("SET"));
        // savedEntry 为 null(新增场景)→ 全部保持原样
        assertEquals("", AppServerMcp.mergeEnvForTest(Map.of("TOKEN", ""), null).get("TOKEN"));
    }
```

(1b) `AppServerMcpDispatchTest.java` 末尾(最后 `}` 前)加 dispatch 用例(该文件已有 `run(calls, customOps, requests)` 辅助;匿名 McpOps 需实现全部抽象方法并覆写 `test`):

```java
    @Test
    void testDispatchesToOpsAndReturnsResult() throws Exception {
        List<String> got = new ArrayList<>();
        McpOps ops = new McpOps() {
            public Map<String, Object> list() { return Map.of("servers", List.of()); }
            public void enable(String n) { }
            public void disable(String n) { }
            public void restart(String n) { }
            public String logs(String n) { return ""; }
            public List<Map<String, Object>> resources(String n) { return List.of(); }
            public String prompts(String n) { return ""; }
            public void configUpsert(String sc, String n, String c, List<String> a, Map<String, String> e) { }
            public boolean configRemove(String sc, String n) { return true; }
            @Override public Map<String, Object> test(String sc, String n, String c,
                                                      List<String> a, Map<String, String> e) {
                got.add("test:" + sc + ":" + n + ":" + c + ":" + a + ":" + e.keySet());
                return Map.of("ok", true, "toolCount", 7, "latencyMs", 123);
            }
        };
        List<JsonNode> replies = run(new ArrayList<>(), ops,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"mcp.test\",\"params\":{\"scope\":\"user\",\"name\":\"fs\",\"command\":\"npx\",\"args\":[\"-y\",\"pkg\"],\"env\":{\"K\":\"v\"}}}");
        JsonNode res = replies.stream().filter(x -> x.path("id").asInt(-1) == 2 && x.has("result"))
            .findFirst().orElseThrow().get("result");
        assertTrue(res.get("ok").asBoolean());
        assertEquals(7, res.get("toolCount").asInt());
        assertEquals(123, res.get("latencyMs").asInt());
        assertEquals(1, got.size());
        assertTrue(got.get(0).startsWith("test:user:fs:npx:[-y, pkg]"), got.get(0));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mvn -Dtest='AppServerMcpTest,AppServerMcpDispatchTest' -DskipTests=false test`
Expected: 编译失败 `method test(...)/mergeEnvForTest is undefined`。

- [ ] **Step 3a: McpOps 加 default 方法**

`McpOps.java` 的 `configRemove` 行之后、接口 `}` 前插入:

```java
    /** 用给定配置拉临时 MCP 进程探连通(握手+tools/list)。回包 {ok,toolCount?,latencyMs?,error?},绝不含 env 值。 */
    default Map<String, Object> test(String scope, String name, String command,
                                     List<String> args, Map<String, String> env) throws IOException {
        throw new UnsupportedOperationException("mcp test not implemented");
    }
```

- [ ] **Step 3b: AppServerMcp 实现**

`AppServerMcp.java` 的 `configRemove` 实现之后插入(FQN 写法,避免动 import 区;若该文件已 import 相应类型可用短名):

```java
    @Override public Map<String, Object> test(String scope, String name, String command,
                                              List<String> args, Map<String, String> env) {
        Map<String, String> merged = mergeEnvForTest(env, savedEntryOrNull(scope, name));
        long t0 = System.currentTimeMillis();
        com.lyhn.wraith.mcp.transport.StdioTransport transport = null;
        com.lyhn.wraith.mcp.McpClient client = null;
        try {
            java.nio.file.Path workDir = currentWorkspace != null
                    ? java.nio.file.Path.of(currentWorkspace) : java.nio.file.Path.of(".");
            transport = new com.lyhn.wraith.mcp.transport.StdioTransport(command, args, merged, workDir);
            client = new com.lyhn.wraith.mcp.McpClient("__test__", transport);
            client.initialize();
            int toolCount = client.listTools().size();
            Map<String, Object> ok = new LinkedHashMap<>();
            ok.put("ok", true);
            ok.put("toolCount", toolCount);
            ok.put("latencyMs", System.currentTimeMillis() - t0);
            return ok;
        } catch (Exception ex) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("ok", false);
            err.put("error", buildTestError(ex, transport)); // 绝不含 env 值
            return err;
        } finally {
            // 临时进程绝不残留:client 建成走级联关闭,否则直接关 transport
            if (client != null) client.close();
            else if (transport != null) try { transport.close(); } catch (Exception ignore) { }
        }
    }

    /** 读 scope 配置里 name 的已存条目(供测试 env 合并);任何失败按"无存值"返 null。 */
    private JsonNode savedEntryOrNull(String scope, String name) {
        try {
            java.nio.file.Path fp = scopePath(scope);
            if (!Files.exists(fp)) return null;
            JsonNode servers = MAPPER.readTree(fp.toFile()).get("mcpServers");
            return servers == null ? null : servers.get(name);
        } catch (Exception e) {
            return null;
        }
    }

    /** 测试用 env 合并:空串=沿用已存值(与 McpConfigWriter.upsert 密钥编辑语义一致);无存值保持空串。 */
    static Map<String, String> mergeEnvForTest(Map<String, String> formEnv, JsonNode savedEntry) {
        JsonNode savedEnv = savedEntry != null && savedEntry.has("env") && savedEntry.get("env").isObject()
                ? savedEntry.get("env") : null;
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : formEnv.entrySet()) {
            String v = e.getValue();
            if (v != null && v.isEmpty() && savedEnv != null && savedEnv.hasNonNull(e.getKey())) {
                out.put(e.getKey(), savedEnv.get(e.getKey()).asText());
            } else {
                out.put(e.getKey(), v == null ? "" : v);
            }
        }
        return out;
    }

    /** 组测试失败报文:异常消息 + stderr 尾部(≤5 行),总长截断 500 字符。 */
    private static String buildTestError(Exception ex, com.lyhn.wraith.mcp.transport.StdioTransport transport) {
        StringBuilder sb = new StringBuilder(
                ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage());
        if (transport != null) {
            List<String> lines = transport.stderrLines();
            if (lines != null && !lines.isEmpty()) {
                List<String> tail = lines.subList(Math.max(0, lines.size() - 5), lines.size());
                sb.append('\n').append(String.join("\n", tail));
            }
        }
        String s = sb.toString();
        return s.length() > 500 ? s.substring(0, 500) + "…" : s;
    }
```

（`LinkedHashMap`/`Files`/`JsonNode`/`List`/`Map` 该文件已用;缺则补 import。）

- [ ] **Step 3c: AppServer dispatch case**

`AppServer.java` 的 `case "mcp.config.upsert" -> ...` 块(结束于 `});`)之后插入:

```java
            case "mcp.test" -> handleMcp(msg, ops -> {
                JsonNode p = msg.params();
                String scope = textParam(p, "scope"); String name = textParam(p, "name"); String command = textParam(p, "command");
                if (scope == null || name == null || command == null) { writer.error(msg.id(), -32602, "缺 scope/name/command"); return; }
                List<String> args = new ArrayList<>();
                if (p.has("args") && p.get("args").isArray()) p.get("args").forEach(a -> args.add(a.asText()));
                Map<String, String> env = new LinkedHashMap<>();
                if (p.has("env") && p.get("env").isObject())
                    p.get("env").fields().forEachRemaining(e -> env.put(e.getKey(), e.getValue().asText()));
                try { writer.result(msg.id(), ops.test(scope, name, command, args, env)); }
                catch (IOException e) { writer.error(msg.id(), -32000, "测试失败: " + e.getMessage()); }
            });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mvn -Dtest='AppServerMcpTest,AppServerMcpDispatchTest' -DskipTests=false test`
Expected: BUILD SUCCESS;3 个新用例过,既有全部零回归(尤其 env 红线用例与既有 dispatch 用例——它们的匿名 McpOps 未覆写 `test`,default 方法保证编译)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/McpOps.java \
        src/main/java/com/lyhn/wraith/runtime/appserver/AppServerMcp.java \
        src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerMcpTest.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerMcpDispatchTest.java
git commit -m "feat(appserver): mcp.test 临时进程探测 RPC(握手+tools/list,env 空值沿用存值)"
```

---

### Task 2: 桌面通道 mcpTest + McpTestResult 类型

**Files:**
- Modify: `desktop/src/shared/types.ts`(`McpUpsertPayload` 之后)
- Modify: `desktop/src/preload/index.ts`(接口 `mcpConfigUpsert` 行后;实现 `mcpConfigUpsert` 后)
- Modify: `desktop/src/main/index.ts`(`wraith:mcpConfigUpsert` handler 后)

**Interfaces:**
- Consumes: Task 1 的 `mcp.test` RPC;既有 `McpUpsertPayload`。
- Produces: `McpTestResult { ok: boolean; toolCount?: number; latencyMs?: number; error?: string }`;`window.wraith.mcpTest(payload: McpUpsertPayload): Promise<McpTestResult>`。

- [ ] **Step 1: types.ts 加类型**

在 `McpUpsertPayload` 接口之后插入:

```ts
/** mcp.test 回包:临时进程探测结果(绝不含 env 值)。 */
export interface McpTestResult {
  ok: boolean
  toolCount?: number
  latencyMs?: number
  error?: string
}
```

- [ ] **Step 2: preload 接口+实现**

接口区 `mcpConfigUpsert(...)` 行(46)后加:

```ts
  mcpTest(payload: McpUpsertPayload): Promise<McpTestResult>
```

实现区 `mcpConfigUpsert(payload) {...},`(229-231)后加:

```ts
  mcpTest(payload) {
    return ipcRenderer.invoke('wraith:mcpTest', payload) as Promise<McpTestResult>
  },
```

并把 `McpTestResult` 加进顶部 `import type { ... } from '../shared/types'`。

- [ ] **Step 3: main handler**

`wraith:mcpConfigUpsert` handler(456-459)后加:

```ts
ipcMain.handle('wraith:mcpTest', async (_e, payload: unknown) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.test', payload as Record<string, unknown>)
})
```

- [ ] **Step 4: Typecheck + build**

Run: `cd desktop && npm run typecheck && npm run build`
Expected: 0 error;build 成功。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat(desktop/ipc): window.wraith.mcpTest → mcp.test + McpTestResult 类型"
```

---

### Task 3: 表单「测试」按钮 + formatMcpTestResult

**Files:**
- Create: `desktop/src/renderer/lib/mcpTestResultText.ts`
- Test: `desktop/test/mcpTestResultText.test.ts`
- Modify: `desktop/src/renderer/components/McpServerForm.tsx`

**Interfaces:**
- Consumes: Task 2 `window.wraith.mcpTest` + `McpTestResult`;表单既有 `buildFormValue/envRows/busy/submitting`。
- Produces: `formatMcpTestResult(r: McpTestResult): { kind: 'ok' | 'err'; text: string }`;表单测试按钮(`mcp-form-test`)+ 结果行(`mcp-form-test-result`)。

- [ ] **Step 1: Write the failing test**

Create `desktop/test/mcpTestResultText.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatMcpTestResult } from '../src/renderer/lib/mcpTestResultText'

describe('formatMcpTestResult', () => {
  it('成功 → 绿文案含工具数与耗时', () => {
    expect(formatMcpTestResult({ ok: true, toolCount: 12, latencyMs: 843 }))
      .toEqual({ kind: 'ok', text: '✅ 连接成功 · 12 个工具 · 843ms' })
  })
  it('成功但字段缺省 → 兜底 0', () => {
    expect(formatMcpTestResult({ ok: true }))
      .toEqual({ kind: 'ok', text: '✅ 连接成功 · 0 个工具 · 0ms' })
  })
  it('失败 → 红文案含错误', () => {
    expect(formatMcpTestResult({ ok: false, error: 'ENOENT: npx not found' }))
      .toEqual({ kind: 'err', text: '❌ 连接失败:ENOENT: npx not found' })
  })
  it('失败但 error 缺省 → 未知错误', () => {
    expect(formatMcpTestResult({ ok: false }))
      .toEqual({ kind: 'err', text: '❌ 连接失败:未知错误' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run test/mcpTestResultText.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: Write the module**

Create `desktop/src/renderer/lib/mcpTestResultText.ts`:

```ts
import type { McpTestResult } from '../../shared/types'

/** mcp 测试回包 → 表单结果行文案。ok 缺字段兜底 0;err 缺 error 显「未知错误」。 */
export function formatMcpTestResult(r: McpTestResult): { kind: 'ok' | 'err'; text: string } {
  if (r.ok) return { kind: 'ok', text: `✅ 连接成功 · ${r.toolCount ?? 0} 个工具 · ${r.latencyMs ?? 0}ms` }
  return { kind: 'err', text: `❌ 连接失败:${r.error || '未知错误'}` }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run test/mcpTestResultText.test.ts`
Expected: 4/4 PASS。

- [ ] **Step 5: McpServerForm 接线**

(a) import 区:第 1 行改 `import { useEffect, useState } from 'react'`;加 `import { formatMcpTestResult } from '../lib/mcpTestResultText'`。

(b) state 区(`const [error, setError] = ...` 后)加:

```tsx
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // 任意字段变更 → 旧测试结果对新配置无效,清空
  useEffect(() => { setTestResult(null) }, [name, command, argsText, scope, envRows])
```

(c) `handleSubmit` 之后加:

```tsx
  const handleTest = async (): Promise<void> => {
    const v = buildFormValue(scope, name, command, argsText, envRows)
    if (!v.name || !v.command) { setError('name 与 command 必填'); return }
    setTesting(true); setError(null); setTestResult(null)
    try {
      const r = await window.wraith.mcpTest(v)   // 临时进程探测,不落盘
      setTestResult(formatMcpTestResult(r))
    } catch (err) {
      console.error('[wraith] mcpTest error:', err)
      setTestResult({ kind: 'err', text: '❌ 连接失败:后端未连接或测试请求失败' })
    }
    setTesting(false)
  }
```

(d) `{error && ...}` 行(98)之后加结果行:

```tsx
      {testResult && (
        <div data-testid="mcp-form-test-result"
          className={'whitespace-pre-wrap break-words font-mono text-xs ' +
            (testResult.kind === 'ok' ? 'text-success' : 'text-danger')}>
          {testResult.text}
        </div>
      )}
```

(e) 按钮行(100-107)整体替换为(保存/取消在测试中一并禁用;取消原无 disabled,补上):

```tsx
      <div className="flex gap-2">
        <button data-testid="mcp-form-submit" disabled={busy || submitting || testing} onClick={() => void handleSubmit()}
          className="rounded-lg bg-accent px-4 py-2 text-xs text-white disabled:opacity-60">
          {submitting ? '保存中…' : '保存'}
        </button>
        <button data-testid="mcp-form-test" disabled={busy || submitting || testing} onClick={() => void handleTest()}
          className="rounded-lg border border-border px-4 py-2 text-xs text-fg hover:border-accent disabled:opacity-60">
          {testing ? '测试中…' : '测试'}
        </button>
        <button data-testid="mcp-form-cancel" disabled={testing} onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-xs text-fg-muted disabled:opacity-60">取消</button>
      </div>
```

- [ ] **Step 6: Typecheck + 全量 vitest + build**

Run: `cd desktop && npm run typecheck && npx vitest run && npm run build`
Expected: 0 error;全绿(含新 4 条);build 成功。

- [ ] **Step 7: Commit**

```bash
git add desktop/src/renderer/lib/mcpTestResultText.ts desktop/test/mcpTestResultText.test.ts \
        desktop/src/renderer/components/McpServerForm.tsx
git commit -m "feat(desktop): MCP 表单「测试」按钮 — 保存前探测连通(结果行/禁用态/变更清结果)"
```

---

## 交付后(执行阶段处理)

- 重建部署 jar(`mvn -DskipTests package` → `~/.wraith/wraith.jar`)+ **dev App 完全重启**(新 RPC + preload 新方法 `mcpTest`)。
- **眼验**:添加表单填 `npx` + `-y`/`@modelcontextprotocol/server-filesystem`/`/tmp`(三行 args)→ 测试 → 绿色「连接成功 · N 个工具 · XXms」;包名改错 → 红色失败含 stderr;测试中三按钮禁用;改任意字段旧结果消失;`ps aux | grep server-filesystem` 无残留。
- 提交前密钥扫描。

## Self-Review 记录

- **Spec 覆盖**:临时进程+finally 杀(T1 impl)、env 空值合并语义+静态可测(T1 mergeEnvForTest)、stderr 尾行/截断(T1 buildTestError)、dispatch 样板(T1 3c)、IPC+类型(T2)、按钮/结果行/禁用/变更清空(T3)、必填校验复用(T3 handleTest)、回包无 env 值(T1 注释+结构保证)——全覆盖。
- **占位符扫描**:无 TBD;全部真实代码。
- **类型一致**:`McpTestResult`(T2 定义,T3 lib 消费);`mergeEnvForTest(Map,JsonNode)` 签名测试/实现一致;`formatMcpTestResult` 返回形状与表单 state 类型一致;`mcpTest(payload: McpUpsertPayload)` 与 `buildFormValue` 返回的 `McpFormValue` ——检查:`McpFormValue` 与 `McpUpsertPayload` 是否同形?`McpFormValue` 在 `shared/mcpFormValue.ts`,字段 scope/name/command/args/env——与 `McpUpsertPayload` 同形,现有 `onSubmitForm` 已把 `McpFormValue` 传给 `mcpConfigUpsert(payload: McpUpsertPayload)`(App.tsx `handleMcpSubmitForm` 直传),同一兼容路径,T3 直传无碍。
