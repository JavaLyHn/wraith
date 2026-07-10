# MCP server 详情增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** server 详情页只读回显 stdio 启动命令/参数(①),外部 server 的工具在 tools tab 显示入参 schema 折叠(②),并把内置详情的工具行抽成共享组件(DRY)。

**Architecture:** ② 后端只差最后一步——`McpToolDescriptor.inputSchema`(McpClient 已解析+sanitize+留存)在 `AppServerMcp.list()` 序列化工具视图时补进 `parameters` 字段;前端把 `BuiltinToolRowView` 抽成共享 `ToolDetailRow`(props 化,`missing?` 可选),内置详情与 server tools tab 共用;① 纯前端,`McpServerView.command/args` 已回传,详情头部加只读命令块。设计详见 `docs/superpowers/specs/2026-07-10-mcp-server-detail-enrich-design.md`。

**Tech Stack:** Java 17 / Maven(后端);Electron + React + TypeScript + Vitest(桌面)。分支 `feat/mcp-builtin-detail`(依赖其内置能力详情特性)。

## Global Constraints

- **数据事实**:`McpToolDescriptor` 是 `record(String serverName, String name, String namespacedName, String description, JsonNode inputSchema)`(包 `com.lyhn.wraith.mcp.protocol`);`McpSchemaSanitizer.sanitize` **永不返回 null**(缺失时回 fallback ObjectNode),故真实链路 `inputSchema` 恒非空——null 守卫仅防御(手工构造的 descriptor/测试)。fallback 最小 schema(如 `{"type":"object"}`)也会显示折叠,这是**预期行为**(诚实展示"接受对象,无声明属性"),不特判。
- **序列化**:`JsonRpcWriter` 用 `JsonRpc.MAPPER.writeValueAsBytes` 整体序列化——`Map<String,Object>` 里放 `JsonNode` 值 Jackson 原生支持,直接 `tv.put("parameters", t.inputSchema())`。
- **env 值红线**:mcp.list 现状只回 envKeys(键名),**env 值从不回传**——本次改动不得触碰 env 相关序列化;既有测试 `listReturnsCommandAndArgsForStdioServerButNotEnvValue` 必须保持全绿。
- **行为保真**:内置能力详情换用共享组件后行为必须与现状一致(missing 标记、参数折叠、`type="button"`);现有概览/表单/resources/prompts/logs、tools tab 空态「无工具(未就绪或空)」一律不动。
- ① 命令块仅 `transport==='stdio' && command` 时显示;http 型/无命令不显示、无占位;不可编辑。
- **中文**注释;commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- Java 测试默认跳过,单测须带 `-DskipTests=false`;基线约 4F 为 JDK/Mockito 噪声,非本改动。
- 桌面无 RTL:可测逻辑沉纯模块 vitest 覆盖;组件/接线靠 `npm run typecheck` + `npx vitest run` + `npm run build` + 眼验。
- **密钥红线**:提交前跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。

---

## File Structure

- `src/main/java/com/lyhn/wraith/runtime/appserver/AppServerMcp.java` — list() 工具视图补 `parameters`(Task 1)。
- `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerMcpTest.java` — 新增 schema 序列化用例(Task 1)。
- `desktop/src/renderer/lib/toolParams.ts`(新)— `hasToolParams` 纯谓词(Task 2)。
- `desktop/test/toolParams.test.ts`(新)— 谓词 vitest(Task 2)。
- `desktop/src/renderer/components/ToolDetailRow.tsx`(新)— 共享工具行组件(Task 2)。
- `desktop/src/renderer/components/PluginsPanel.tsx` — 删内联 `BuiltinToolRowView` 换 `ToolDetailRow`(Task 2);命令回显块 + tools tab 换用(Task 3)。
- `desktop/src/shared/types.ts` — `McpToolView` += `parameters?: unknown`(Task 3)。

---

### Task 1: 后端 mcp.list 工具视图补 parameters

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServerMcp.java`(list() 内工具构建段,约 125-128 行)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerMcpTest.java`(新增 1 用例,插在 `listReturnsCommandAndArgsForStdioServerButNotEnvValue` 之后)

**Interfaces:**
- Consumes: `McpToolDescriptor.inputSchema() : JsonNode`(可 null);`McpServer.tools(List<McpToolDescriptor>)` setter;测试文件既有 `FakeManager` + `registry(ws)` 辅助。
- Produces: mcp.list 每个工具项在 `inputSchema != null` 时含 `parameters` 字段(sanitized JSON schema);null 时**省略**。前端 `McpToolView.parameters?`(Task 3)依赖此契约。

- [ ] **Step 1: Write the failing test**

在 `AppServerMcpTest.java` 的 `listReturnsCommandAndArgsForStdioServerButNotEnvValue` 用例(约 112 行 `}` 结束)之后插入:

```java
    @Test
    void listIncludesToolParametersWhenSchemaPresent(@TempDir Path ws) throws Exception {
        McpServerConfig cfg = new McpServerConfig();
        cfg.setCommand("npx");
        McpServer srv = new McpServer("schema-srv", cfg);
        com.fasterxml.jackson.databind.node.ObjectNode schema =
                com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        schema.put("type", "object");
        srv.tools(List.of(
                new com.lyhn.wraith.mcp.protocol.McpToolDescriptor(
                        "schema-srv", "read", "mcp__schema-srv__read", "读取", schema),
                new com.lyhn.wraith.mcp.protocol.McpToolDescriptor(
                        "schema-srv", "ping", "mcp__schema-srv__ping", "探活", null)));

        AppServerMcp mcp = new AppServerMcp((reg, dir) -> new FakeManager(reg, dir) {
            @Override public java.util.Collection<McpServer> servers() { return List.of(srv); }
        });
        mcp.ensureFor(ws.toString(), registry(ws), null);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> servers = (List<Map<String, Object>>) mcp.list().get("servers");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tools = (List<Map<String, Object>>) servers.get(0).get("tools");
        assertEquals(2, tools.size());
        assertEquals("read", tools.get(0).get("name"));
        assertEquals(schema, tools.get(0).get("parameters"), "带 schema 的工具应回传 parameters");
        assertEquals("ping", tools.get(1).get("name"));
        assertFalse(tools.get(1).containsKey("parameters"), "inputSchema 为 null 时应省略 parameters 字段");
    }
```

（`McpToolDescriptor`/`JsonNodeFactory` 用全限定名,不改文件 import 区;`FakeManager`/`registry(ws)` 是该文件既有辅助,直接用。若缺 `assertFalse` 静态导入则在文件顶部补 `import static org.junit.jupiter.api.Assertions.assertFalse;`——先看现有 import,多数断言已通配导入。）

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn -Dtest=AppServerMcpTest -DskipTests=false test`
Expected: 新用例 FAIL —— `tools.get(0).get("parameters")` 为 null(现实现只序列化 name/description)。

- [ ] **Step 3: Write minimal implementation**

在 `AppServerMcp.java` 的 `list()` 里,把这段(约 125-128 行):

```java
            List<Map<String, Object>> tools = new ArrayList<>();
            s.tools().forEach(t -> tools.add(Map.of(
                    "name", t.name(), "description", t.description() == null ? "" : t.description())));
            e.put("tools", tools);
```

整体替换为:

```java
            List<Map<String, Object>> tools = new ArrayList<>();
            s.tools().forEach(t -> {
                Map<String, Object> tv = new LinkedHashMap<>();
                tv.put("name", t.name());
                tv.put("description", t.description() == null ? "" : t.description());
                if (t.inputSchema() != null) {
                    tv.put("parameters", t.inputSchema()); // sanitized JSON schema;null(仅防御)时省略
                }
                tools.add(tv);
            });
            e.put("tools", tools);
```

（`LinkedHashMap` 该文件已 import——`e` 就是。）

- [ ] **Step 4: Run test to verify it passes**

Run: `mvn -Dtest=AppServerMcpTest -DskipTests=false test`
Expected: BUILD SUCCESS;新用例过,既有用例(尤其 `listReturnsCommandAndArgsForStdioServerButNotEnvValue`)零回归。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServerMcp.java \
        src/test/java/com/lyhn/wraith/runtime/appserver/AppServerMcpTest.java
git commit -m "feat(appserver): mcp.list 工具视图补 inputSchema→parameters(null 省略)"
```

---

### Task 2: 共享 ToolDetailRow + hasToolParams 谓词,内置详情换用

**Files:**
- Create: `desktop/src/renderer/lib/toolParams.ts`
- Create: `desktop/src/renderer/components/ToolDetailRow.tsx`
- Modify: `desktop/src/renderer/components/PluginsPanel.tsx`(删内联 `BuiltinToolRowView`,内置详情换 `ToolDetailRow`)
- Test: `desktop/test/toolParams.test.ts`

**Interfaces:**
- Consumes: 现 `BuiltinToolRowView` 的渲染逻辑(PluginsPanel.tsx 36-61 行,原样搬移);`BuiltinToolRow`(`{name, description, parameters?, missing}`,来自 `../lib/builtinCapabilityDetail`)。
- Produces:
  - `hasToolParams(parameters: unknown): boolean`(`lib/toolParams.ts`)
  - `ToolDetailRow` 组件,props `{ name: string; description: string; parameters?: unknown; missing?: boolean }`(`missing` 缺省 false)。Task 3 依赖。

- [ ] **Step 1: Write the failing test**

Create `desktop/test/toolParams.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hasToolParams } from '../src/renderer/lib/toolParams'

describe('hasToolParams', () => {
  it('null/undefined → false', () => {
    expect(hasToolParams(null)).toBe(false)
    expect(hasToolParams(undefined)).toBe(false)
  })
  it('非对象(字符串/数字)→ false', () => {
    expect(hasToolParams('x')).toBe(false)
    expect(hasToolParams(42)).toBe(false)
  })
  it('空对象 → false', () => {
    expect(hasToolParams({})).toBe(false)
  })
  it('非空对象 → true', () => {
    expect(hasToolParams({ type: 'object' })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run test/toolParams.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: Write the predicate module**

Create `desktop/src/renderer/lib/toolParams.ts`:

```ts
/** 工具入参 schema 是否值得渲染折叠:非空对象 → true;null/undefined/非对象/空对象 → false。 */
export function hasToolParams(parameters: unknown): boolean {
  return parameters != null && typeof parameters === 'object'
    && Object.keys(parameters as object).length > 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run test/toolParams.test.ts`
Expected: 4/4 PASS。

- [ ] **Step 5: Create ToolDetailRow(搬移 BuiltinToolRowView 逻辑)**

Create `desktop/src/renderer/components/ToolDetailRow.tsx`:

```tsx
import { useState } from 'react'
import { hasToolParams } from '../lib/toolParams'

/**
 * 工具详情行(内置能力详情与 MCP server tools tab 共用):
 * mono 真名 + 描述 + 可折叠入参 schema;missing 时淡色标记「定义缺失 / 当前不可用」。
 */
export default function ToolDetailRow(
  { name, description, parameters, missing = false }: {
    name: string
    description: string
    parameters?: unknown
    missing?: boolean
  },
): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const showParams = hasToolParams(parameters)
  return (
    <div className="rounded-lg bg-surface/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-fg">{name}</span>
        {missing && <span className="text-3xs text-fg-subtle">定义缺失 / 当前不可用</span>}
        {showParams && (
          <button type="button" onClick={() => setExpanded(v => !v)}
            className="ml-auto shrink-0 text-3xs text-fg-subtle hover:text-fg-muted">
            {expanded ? '▼ 参数' : '▶ 参数'}
          </button>
        )}
      </div>
      {description && <div className="mt-0.5 text-xs text-fg-muted">{description}</div>}
      {showParams && expanded && (
        <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg px-2 py-1 text-2xs text-fg-subtle">
{JSON.stringify(parameters, null, 2)}
        </pre>
      )}
    </div>
  )
}
```

- [ ] **Step 6: PluginsPanel 换用**

在 `PluginsPanel.tsx`:

(a) 顶部加 import:

```tsx
import ToolDetailRow from './ToolDetailRow'
```

(b) **整体删除**内联组件 `BuiltinToolRowView`(36-61 行,含其 JSDoc 注释)。

(c) 内置能力详情里的消费处,把:

```tsx
                  {joinBuiltinTools(selectedBuiltin.tools, builtinCatalog ?? []).map(row => (
                    <BuiltinToolRowView key={row.name} row={row} />
                  ))}
```

改为:

```tsx
                  {joinBuiltinTools(selectedBuiltin.tools, builtinCatalog ?? []).map(row => (
                    <ToolDetailRow key={row.name} name={row.name} description={row.description}
                      parameters={row.parameters} missing={row.missing} />
                  ))}
```

(d) 若 `BuiltinToolRow` 类型 import(`import { joinBuiltinTools, type BuiltinToolRow } from '../lib/builtinCapabilityDetail'`)删除内联组件后不再被引用,把 `, type BuiltinToolRow` 从该 import 中移除(typecheck 会揪出未用 import)。

- [ ] **Step 7: Typecheck + 全量 vitest + build**

Run: `cd desktop && npm run typecheck && npx vitest run && npm run build`
Expected: typecheck 0;vitest 全绿(含新 4 条 + 既有 builtinCapabilityDetail 4 条);build 成功。

- [ ] **Step 8: Commit**

```bash
git add desktop/src/renderer/lib/toolParams.ts desktop/test/toolParams.test.ts \
        desktop/src/renderer/components/ToolDetailRow.tsx \
        desktop/src/renderer/components/PluginsPanel.tsx
git commit -m "refactor(desktop): 抽共享 ToolDetailRow + hasToolParams 谓词,内置详情换用"
```

---

### Task 3: server 详情接线 — 命令回显 + tools tab 参数折叠

**Files:**
- Modify: `desktop/src/shared/types.ts`(`McpToolView` 约 184-187 行)
- Modify: `desktop/src/renderer/components/PluginsPanel.tsx`(server 详情头部 + tools tab)

**Interfaces:**
- Consumes: Task 1 契约(mcp.list 工具项含 `parameters?`);Task 2 `ToolDetailRow`;现有 `McpServerView.command?`/`args?`。
- Produces: server 详情头部只读命令块;tools tab 工具行含参数折叠。

- [ ] **Step 1: McpToolView 加字段**

在 `desktop/src/shared/types.ts` 把:

```ts
export interface McpToolView {
  name: string
  description: string
}
```

改为:

```ts
export interface McpToolView {
  name: string
  description: string
  /** 工具入参 JSON schema(mcp.list 回传;后端 sanitize 过;可缺省) */
  parameters?: unknown
}
```

- [ ] **Step 2: server 详情头部加命令回显块**

在 `PluginsPanel.tsx` server 详情分支,找到头部(锚点:`<span className="text-xs text-fg-subtle">{STATE_LABEL[current.state]} · {current.transport} · {SCOPE_LABEL[current.scope]}</span>` 所在 `<div>` 的闭合 `</div>`)与其后的 `{current.error && (` 之间,插入:

```tsx
              {current.transport === 'stdio' && current.command && (
                <div data-testid="mcp-command-echo" className="mb-3 rounded-lg bg-surface/60 px-3 py-2">
                  <div className="mb-0.5 text-3xs uppercase tracking-wider text-fg-subtle">启动命令</div>
                  <div className="select-text break-all font-mono text-xs text-fg-muted">
                    {[current.command, ...(current.args ?? [])].join(' ')}
                  </div>
                </div>
              )}
```

- [ ] **Step 3: tools tab 换 ToolDetailRow**

同文件 tools tab,把:

```tsx
              {tab === 'tools' && (
                <div className="flex flex-col gap-1">
                  {current.tools.length === 0 && <div className="text-xs text-fg-subtle">无工具(未就绪或空)</div>}
                  {current.tools.map(t => (
                    <div key={t.name} className="rounded-lg bg-surface/60 px-3 py-2">
                      <div className="font-mono text-xs text-fg">{t.name}</div>
                      {t.description && <div className="mt-0.5 text-xs text-fg-muted">{t.description}</div>}
                    </div>
                  ))}
                </div>
              )}
```

整体替换为:

```tsx
              {tab === 'tools' && (
                <div className="flex flex-col gap-1">
                  {current.tools.length === 0 && <div className="text-xs text-fg-subtle">无工具(未就绪或空)</div>}
                  {current.tools.map(t => (
                    <ToolDetailRow key={t.name} name={t.name} description={t.description}
                      parameters={t.parameters} />
                  ))}
                </div>
              )}
```

- [ ] **Step 4: Typecheck + 全量 vitest + build**

Run: `cd desktop && npm run typecheck && npx vitest run && npm run build`
Expected: typecheck 0;vitest 全绿;build 成功。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/renderer/components/PluginsPanel.tsx
git commit -m "feat(desktop): server 详情回显启动命令 + tools tab 工具入参折叠"
```

---

## 交付后(执行阶段处理)

- **重建部署 jar**(`mvn -DskipTests package` → `~/.wraith/wraith.jar`)+ **dev App 完全重启**(后端 mcp.list 序列化变了;本次无 preload 新方法,但 jar 必须换)。
- **眼验**:
  1. MCP 面板 → 点已添加的 stdio server(如 filesystem)→ 头部「启动命令 npx -y @modelcontextprotocol/server-filesystem <目录>」,可选中复制;
  2. tools tab(server ready 后)→ 工具行「▶ 参数」展开为 JSON schema;
  3. 内置能力卡详情行为与之前一致(共享组件无回归,「定义缺失」仍在);
  4. http 型 server(若有)→ 无命令块无占位。
- 提交前密钥扫描。

## Self-Review 记录

- **Spec 覆盖**:① 命令块(T3 Step 2,stdio+command 条件、mono、可复制、无占位)✓;② 后端 parameters(T1)+ 类型(T3 Step 1)+ 前端折叠(T3 Step 3)✓;共享 ToolDetailRow + hasToolParams 谓词 + vitest(T2)✓;env 值红线(T1 既有测试守护)✓;Out of Scope 未越界 ✓。
- **占位符扫描**:无 TBD;每步含完整代码。
- **类型一致**:`ToolDetailRow` props(T2 定义,T2c/T3 消费一致);`hasToolParams` 签名一致;`McpToolView.parameters?: unknown` 与 `ToolDetailRow.parameters?: unknown` 匹配;T2(d) 处理了 `BuiltinToolRow` 类型 import 可能悬空。
