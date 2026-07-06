# 技能系统接通 app-server + 桌面「技能」面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Skill 系统接进桌面 app-server(修掉 `load_skill`「Skill 系统未初始化」),并新增桌面「技能」面板(按来源分组展示 + 启停 + 重扫)。

**Architecture:** app-server 的 SessionRunner 工厂每会话复刻交互路径的技能初始化(内置抽取 + SkillStateStore + SkillRegistry + setters);新增 `skills.list`/`skills.setEnabled` RPC 暴露注册表;桌面经 preload/IPC 桥接,新 `📚 技能` nav 面板按 内置/用户/项目 分组渲染并启停。

**Tech Stack:** Java 17 / Maven / JUnit5 / Jackson;Electron + React18 + TypeScript + Vitest;既有 JSON-RPC(AppServer)+ preload/IPC 桥。

## Global Constraints

- 不涉密钥;提交前仍跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。
- Java 从仓库根跑 `cd /Users/aa00945/Desktop/wraith && mvn ...`;**绝不在 `desktop/` 下跑 mvn**。桌面命令在 `desktop/` 下跑。
- commit trailer(每次提交,空行后):
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
```
- 门禁:Java `mvn -DskipTests=false test` 0F/0E;桌面 `npm run typecheck` + `npx vitest run` + `npm run build` 全绿。
- 分支:`feat/skills-panel`。
- 不做:桌面内新建/编辑 SKILL.md;gateway daemon 技能接线;RPC 回传 SKILL.md body。

---

## File Structure

| 层 | 文件 | 职责 |
|---|---|---|
| RPC 接口/分发 | `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` | SessionRunner +skillsList/+skillsSetEnabled default;分发 skills.list/skills.setEnabled |
| RPC 实现 + 接线 | `src/main/java/com/lyhn/wraith/cli/Main.java` | app-server SessionRunner 工厂:技能初始化 + 两方法实现 |
| Java 测试 | `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSkillsTest.java` | RPC 形状 + setEnabled + 缺 name |
| 类型 | `desktop/src/shared/types.ts` | SkillView / SkillListResult |
| 桥 | `desktop/src/preload/index.ts`、`desktop/src/main/index.ts` | skillsList / setSkillEnabled + 2 handler |
| 纯函数 | `desktop/src/renderer/lib/skillsView.ts` | groupSkillsBySource(+测试) |
| 面板 | `desktop/src/renderer/components/SkillsPanel.tsx`(新) | 分组列表 / 启停 / 重扫 |
| nav | `desktop/src/renderer/App.tsx`、`desktop/src/renderer/components/Sidebar.tsx` | view 'skills' + `📚 技能` 项 |

---

## Task 1: skills.list / skills.setEnabled RPC 层(接口 + 分发 + 测试)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(SessionRunner 接口加 default;dispatch 加 case)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSkillsTest.java`(新建)

**Interfaces:**
- Produces:SessionRunner `default Map<String,Object> skillsList()` 与 `default Map<String,Object> skillsSetEnabled(String name, boolean enabled)`(默认抛 `UnsupportedOperationException`);RPC `skills.list {}` → `{skills:[{name,description,version,author,tags,source,enabled}]}`;`skills.setEnabled {name, enabled}` → `{ok:true}`,缺 name → -32602。

- [ ] **Step 1: Write the failing test**

Create `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSkillsTest.java`:

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AppServerSkillsTest {
    private List<JsonNode> run(String... requests) throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public Map<String,Object> skillsList() {
                return Map.of("skills", List.of(Map.of(
                    "name", "web-access", "description", "联网手册", "version", "1.0.0",
                    "author", "Wraith CLI", "tags", List.of("web", "browser"),
                    "source", "builtin", "enabled", true)));
            }
            public Map<String,Object> skillsSetEnabled(String name, boolean enabled) {
                return Map.of("ok", true);
            }
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String r : requests) lines.add(r.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)), out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }
    private JsonNode byId(List<JsonNode> r, int id) {
        return r.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst().orElseThrow();
    }

    @Test void listReturnsSkillsWithSourceAndEnabled() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.list\",\"params\":{}}");
        JsonNode skills = byId(r, 2).path("result").path("skills");
        assertTrue(skills.isArray());
        JsonNode s0 = skills.get(0);
        assertEquals("web-access", s0.path("name").asText());
        assertEquals("builtin", s0.path("source").asText());
        assertTrue(s0.path("enabled").asBoolean());
        assertTrue(s0.path("tags").isArray());
    }
    @Test void setEnabledOk() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.setEnabled\",\"params\":{\"name\":\"web-access\",\"enabled\":false}}");
        assertTrue(byId(r, 2).path("result").path("ok").asBoolean());
    }
    @Test void setEnabledMissingNameIsParamError() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.setEnabled\",\"params\":{\"enabled\":true}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=AppServerSkillsTest test`
Expected: FAIL —— 分发无 `skills.list`/`skills.setEnabled`(method-not-found / 缺 result);`setEnabledMissingNameIsParamError` 可能拿到 -32601 而非 -32602。

- [ ] **Step 3a: Add SessionRunner default methods**

In `AppServer.java`, inside `interface SessionRunner`, after the `configTestProvider` default (near line 92, before the interface closing `}`), add:

```java
        /** 列出全部技能(含 source 与 enabled)。默认抛出。 */
        default java.util.Map<String, Object> skillsList() {
            throw new UnsupportedOperationException("skillsList not implemented");
        }
        /** 启用/禁用一个技能(写 SkillStateStore + reload)。默认抛出。 */
        default java.util.Map<String, Object> skillsSetEnabled(String name, boolean enabled) {
            throw new UnsupportedOperationException("skillsSetEnabled not implemented");
        }
```

- [ ] **Step 3b: Add dispatch cases**

In `AppServer.java`, after the `case "config.testProvider"` block, add:

```java
            case "skills.list" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.skillsList()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
            case "skills.setEnabled" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String name = textParam(p, "name");
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                boolean enabled = p != null && p.hasNonNull("enabled") ? p.get("enabled").asBoolean() : true;
                try { writer.result(msg.id(), session.skillsSetEnabled(name, enabled)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=AppServerSkillsTest test`
Expected: PASS(3 tests)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSkillsTest.java
git commit -m "feat(skills): skills.list / skills.setEnabled RPC(接口 + 分发 + 测试)"
```

---

## Task 2: app-server 接通 Skill 系统 + 两方法实现(Main.java)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(`startAppServer` 的 SessionRunner 工厂,`agent` 构造后 ~1160、SessionRunner `return new ...`~1176 之前 + 匿名类内加两方法)

**Interfaces:**
- Consumes:`SkillBuiltinExtractor(cacheRoot).extractAll()`;`new SkillStateStore(path)`;`new SkillRegistry(cacheRoot, userDir, projectDir, stateStore)` + `.reload()` + `.allSkills()` + `.stateStore()`;`SkillContextBuffer`;`registry.setSkillRegistry/​setSkillContextBuffer`(继承自 ToolRegistry);`agent.setSkillRegistry/​setSkillContextBuffer`;`SkillStateStore.disabled()/enable(name)/disable(name)`;`Skill.name()/description()/version()/author()/tags()/displaySource()`。
- Produces:SessionRunner 的 `skillsList()`/`skillsSetEnabled(name,enabled)` 生产实现;桌面 `load_skill` 可用。

> `registry` = 该工厂里的 `HitlToolRegistry`(变量名 `registry`);`agent` = `com.lyhn.wraith.agent.Agent`(变量名 `agent`);`root` = 会话工作目录字符串。三者均已在工厂内定义(`agent` 在 `Main.java:1160`)。

- [ ] **Step 1: 接线技能系统(在 agent 构造后、return SessionRunner 之前插入)**

In `Main.java` `startAppServer` 工厂,紧接 `agent.setRenderer(renderer);`(`~1161`)之后插入:

```java
                // ── Skill 系统接线(复刻交互路径:让 load_skill 可用 + 技能索引进系统提示)──
                java.nio.file.Path skHome = java.nio.file.Path.of(System.getProperty("user.home"));
                java.nio.file.Path skCacheDir = skHome.resolve(".wraith/skills-cache");
                java.nio.file.Path skUserDir = skHome.resolve(".wraith/skills");
                java.nio.file.Path skProjectDir = java.nio.file.Path.of(root).resolve(".wraith/skills");
                try {
                    new com.lyhn.wraith.skill.SkillBuiltinExtractor(skCacheDir).extractAll();
                } catch (Exception ex) {
                    System.err.println("内置 skill 解压失败: " + ex.getMessage());
                }
                com.lyhn.wraith.skill.SkillStateStore skillStateStore =
                        new com.lyhn.wraith.skill.SkillStateStore(skHome.resolve(".wraith/skills.json"));
                com.lyhn.wraith.skill.SkillRegistry skillRegistry = new com.lyhn.wraith.skill.SkillRegistry(
                        skCacheDir, skUserDir, skProjectDir, skillStateStore);
                skillRegistry.reload();
                com.lyhn.wraith.skill.SkillContextBuffer skillContextBuffer =
                        new com.lyhn.wraith.skill.SkillContextBuffer();
                registry.setSkillRegistry(skillRegistry);
                registry.setSkillContextBuffer(skillContextBuffer);
                agent.setSkillRegistry(skillRegistry);
                agent.setSkillContextBuffer(skillContextBuffer);
```

(`skillRegistry` 与 `skillStateStore` 为 effectively-final 局部,可被下面匿名 SessionRunner 闭包引用。)

- [ ] **Step 2: 在匿名 SessionRunner 内实现两方法**

In the anonymous `return new com.lyhn.wraith.runtime.appserver.AppServer.SessionRunner() { ... }`(`~1176`),在其它方法(如 `configTestProvider`/`deleteSession`)旁加:

```java
                    public java.util.Map<String, Object> skillsList() {
                        java.util.List<java.util.Map<String, Object>> list = new java.util.ArrayList<>();
                        java.util.Set<String> disabled = skillRegistry.stateStore().disabled();
                        for (com.lyhn.wraith.skill.Skill s : skillRegistry.allSkills()) {
                            java.util.Map<String, Object> v = new java.util.LinkedHashMap<>();
                            v.put("name", s.name());
                            v.put("description", s.description());
                            v.put("version", s.version() != null ? s.version() : "");
                            v.put("author", s.author() != null ? s.author() : "");
                            v.put("tags", s.tags());
                            v.put("source", s.displaySource());
                            v.put("enabled", !disabled.contains(s.name()));
                            list.add(v);
                        }
                        return java.util.Map.of("skills", list);
                    }
                    public java.util.Map<String, Object> skillsSetEnabled(String name, boolean enabled) {
                        if (enabled) skillRegistry.stateStore().enable(name);
                        else skillRegistry.stateStore().disable(name);
                        skillRegistry.reload();
                        return java.util.Map.of("ok", true);
                    }
```

- [ ] **Step 3: 编译 + 全量 Java 套件(接线不破坏现有,且真实 registry 可用)**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false test 2>&1 | grep -E "Tests run: [0-9]{3,}|BUILD"`
Expected: `Tests run: <N>, Failures: 0, Errors: 0` + `BUILD SUCCESS`(N 应 ≥ 上一基线)。

- [ ] **Step 4: 眼验接通(可选但强烈建议,需重建 jar)**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests package && cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar`
然后重启桌面 app,在对话里让其 `load_skill web-access` —— 应成功(不再返回「Skill 系统未初始化」)。此步为运行时确认,非自动化测试。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/cli/Main.java
git commit -m "feat(skills): app-server 接通 Skill 系统 + skillsList/skillsSetEnabled 实现(修 load_skill 未初始化)"
```

---

## Task 3: 类型 + preload/IPC 桥

**Files:**
- Modify: `desktop/src/shared/types.ts`(加两 interface)
- Modify: `desktop/src/preload/index.ts`(声明 + 实现)
- Modify: `desktop/src/main/index.ts`(2 个 handler)

**Interfaces:**
- Produces:`SkillView`/`SkillListResult` 类型;`window.wraith.skillsList(): Promise<SkillListResult>`;`window.wraith.setSkillEnabled(name: string, enabled: boolean): Promise<{ ok: boolean }>`。

- [ ] **Step 1: 加类型**

In `desktop/src/shared/types.ts`,在 `ModelListResult` 之后加:

```ts
export interface SkillView {
  name: string
  description: string
  version: string
  author: string
  tags: string[]
  source: 'builtin' | 'user' | 'project'
  enabled: boolean
}

export interface SkillListResult {
  skills: SkillView[]
}
```

- [ ] **Step 2: preload 声明 + 实现**

In `desktop/src/preload/index.ts`,`WraithApi` 接口里(靠近 `modelList` 声明处)加:

```ts
  skillsList(): Promise<SkillListResult>
  setSkillEnabled(name: string, enabled: boolean): Promise<{ ok: boolean }>
```

确保文件顶部 `import type { ... }` 从 `../shared/types` 引入 `SkillListResult`(与既有类型导入并列)。实现处(靠近 `modelList()` 实现)加:

```ts
  skillsList() {
    return ipcRenderer.invoke('wraith:skillsList') as Promise<SkillListResult>
  },
  setSkillEnabled(name, enabled) {
    return ipcRenderer.invoke('wraith:setSkillEnabled', name, enabled) as Promise<{ ok: boolean }>
  },
```

- [ ] **Step 3: main IPC handler**

In `desktop/src/main/index.ts`,在 `wraith:modelList` handler 附近加:

```ts
ipcMain.handle('wraith:skillsList', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.list', {})
})

ipcMain.handle('wraith:setSkillEnabled', async (_e, name: string, enabled: boolean) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.setEnabled', { name, enabled })
})
```

- [ ] **Step 4: typecheck**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat(skills): 桥接 skillsList / setSkillEnabled + SkillView 类型"
```

---

## Task 4: skillsView 纯函数(按来源分组)

**Files:**
- Create: `desktop/src/renderer/lib/skillsView.ts`
- Test: `desktop/test/skillsView.test.ts`

**Interfaces:**
- Consumes:`SkillView`(Task 3)。
- Produces:`groupSkillsBySource(skills: SkillView[]): { source: 'builtin'|'user'|'project'; label: string; skills: SkillView[] }[]` —— 组序固定(内置→用户→项目)、空组省略、组内保序。

- [ ] **Step 1: Write the failing test**

Create `desktop/test/skillsView.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { groupSkillsBySource } from '../src/renderer/lib/skillsView'
import type { SkillView } from '../src/shared/types'

const sk = (name: string, source: SkillView['source']): SkillView =>
  ({ name, description: '', version: '', author: '', tags: [], source, enabled: true })

describe('groupSkillsBySource', () => {
  it('按来源分组,组序固定 内置→用户→项目,组内保序', () => {
    const groups = groupSkillsBySource([sk('a', 'user'), sk('b', 'builtin'), sk('c', 'project'), sk('d', 'user')])
    expect(groups.map(g => g.source)).toEqual(['builtin', 'user', 'project'])
    expect(groups.map(g => g.label)).toEqual(['内置', '用户', '项目'])
    expect(groups.find(g => g.source === 'user')!.skills.map(s => s.name)).toEqual(['a', 'd'])
  })
  it('空组省略', () => {
    const groups = groupSkillsBySource([sk('b', 'builtin')])
    expect(groups.map(g => g.source)).toEqual(['builtin'])
  })
  it('空输入返回空数组', () => {
    expect(groupSkillsBySource([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/skillsView.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: Implement**

Create `desktop/src/renderer/lib/skillsView.ts`:

```ts
import type { SkillView } from '../../shared/types'

/** 按来源分组:组序固定 内置→用户→项目;空组省略;组内保持传入顺序。 */
export function groupSkillsBySource(
  skills: SkillView[],
): { source: 'builtin' | 'user' | 'project'; label: string; skills: SkillView[] }[] {
  const order: Array<{ source: 'builtin' | 'user' | 'project'; label: string }> = [
    { source: 'builtin', label: '内置' },
    { source: 'user', label: '用户' },
    { source: 'project', label: '项目' },
  ]
  return order
    .map(o => ({ source: o.source, label: o.label, skills: skills.filter(s => s.source === o.source) }))
    .filter(g => g.skills.length > 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/skillsView.test.ts && npm run typecheck`
Expected: PASS(3)+ typecheck 无错。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/lib/skillsView.ts desktop/test/skillsView.test.ts
git commit -m "feat(skills): groupSkillsBySource 纯函数(按来源分组)"
```

---

## Task 5: SkillsPanel 组件 + nav 接线

**Files:**
- Create: `desktop/src/renderer/components/SkillsPanel.tsx`
- Modify: `desktop/src/renderer/App.tsx`(view union + onOpenSkills + 面板分支)
- Modify: `desktop/src/renderer/components/Sidebar.tsx`(nav 项 + prop)

**Interfaces:**
- Consumes:`window.wraith.skillsList()` / `window.wraith.setSkillEnabled(name, enabled)`(Task 3);`groupSkillsBySource`(Task 4);`SkillView`(Task 3)。
- Produces:无下游(叶子 UI)。

> 本任务无独立单测(面板 UI;纯逻辑已在 Task 4 覆盖)。验证:typecheck + vitest(既有不回归)+ build + 眼验。

- [ ] **Step 1: 创建 SkillsPanel**

Create `desktop/src/renderer/components/SkillsPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { SkillView } from '../../shared/types'
import { groupSkillsBySource } from '../lib/skillsView'

const SOURCE_BADGE: Record<SkillView['source'], string> = { builtin: '内置', user: '用户', project: '项目' }
const EMPTY_HINT: Record<SkillView['source'], string> = {
  builtin: '(无内置技能)',
  user: '把 SKILL.md 放到 ~/.wraith/skills/<名>/ 即可被加载',
  project: '把 SKILL.md 放到 <项目>/.wraith/skills/<名>/ 即可被加载',
}

export default function SkillsPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [skills, setSkills] = useState<SkillView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    try { const r = await window.wraith.skillsList(); setSkills(r.skills); setError(null) }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const toggle = useCallback(async (name: string, enabled: boolean): Promise<void> => {
    setSkills(prev => prev.map(s => (s.name === name ? { ...s, enabled } : s)))  // 乐观更新
    try { await window.wraith.setSkillEnabled(name, enabled); void refresh() }
    catch (err) { setError((err as Error).message); void refresh() }
  }, [refresh])

  const groups = groupSkillsBySource(skills)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="skills-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="text-sm font-bold text-fg">技能</span>
        <span className="text-xs text-fg-subtle">SKILL.md 决策手册 · load_skill 注入</span>
        <button data-testid="skills-refresh" onClick={() => void refresh()} disabled={busy}
          className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:border-accent disabled:opacity-60">
          {busy ? '扫描中…' : '⟳ 重新扫描'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && <div data-testid="skills-error" className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        {skills.length === 0 && !busy && !error && (
          <div className="text-xs text-fg-subtle">还没有技能。把 SKILL.md 放到 ~/.wraith/skills/&lt;名&gt;/ 试试。</div>
        )}
        {groups.map(g => (
          <section key={g.source} className="mb-4">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">{g.label}</div>
            <div className="flex flex-col gap-1.5">
              {g.skills.map(s => (
                <div key={s.name} data-testid="skill-row"
                  className={'rounded-lg border border-border p-3 ' + (s.enabled ? '' : 'opacity-50')}>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-fg">{s.name}</span>
                    <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[9px] text-fg-subtle">{SOURCE_BADGE[s.source]}</span>
                    {(s.version || s.author) && (
                      <span className="shrink-0 text-[10px] text-fg-subtle">{[s.version, s.author].filter(Boolean).join(' · ')}</span>
                    )}
                    <button data-testid="skill-toggle" onClick={() => void toggle(s.name, !s.enabled)}
                      className="ml-auto shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-accent">
                      {s.enabled ? '停用' : '启用'}
                    </button>
                  </div>
                  {s.description && <div className="mt-1 line-clamp-3 text-[11px] text-fg-muted">{s.description}</div>}
                  {s.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.tags.map(t => <span key={t} className="rounded bg-surface/60 px-1.5 py-0.5 text-[10px] text-fg-subtle">{t}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        {skills.length > 0 && (['user', 'project'] as const).map(src =>
          groups.some(g => g.source === src) ? null : (
            <div key={src} className="mb-2 text-[11px] text-fg-subtle">{SOURCE_BADGE[src]}:{EMPTY_HINT[src]}</div>
          ),
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: App.tsx 接线**

In `desktop/src/renderer/App.tsx`:

2a. `import SkillsPanel from './components/SkillsPanel'`(与其它面板 import 并列)。

2b. view union 加 `'skills'`(找到 `useState<'chat' | 'plugins' | 'automations' | 'im-gateway' | 'providers'>('chat')`,改为):
```ts
  const [view, setView] = useState<'chat' | 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills'>('chat')
```

2c. 给 `<Sidebar ... />` 传 `onOpenSkills={() => setView('skills')}`(与 `onOpenProviders` 并列)。

2d. 面板分支:在 `view === 'providers' ? (<ProvidersPanel .../>)` 分支后,增加:
```tsx
        ) : view === 'skills' ? (
          <SkillsPanel onBack={() => setView('chat')} />
```
(保持三元链结构:插入在 providers 分支与其后续分支之间。)

- [ ] **Step 3: Sidebar.tsx nav 项**

In `desktop/src/renderer/components/Sidebar.tsx`:

3a. `SidebarProps` 加 `onOpenSkills: () => void`(与 `onOpenProviders` 并列),并在解构参数里加 `onOpenSkills`。

3b. 在「Provider 配置」nav 按钮之后加:
```tsx
          {/* skills — enabled */}
          <button
            data-testid="nav-skills"
            onClick={onOpenSkills}
            className={'rounded-lg px-3 py-1.5 text-left text-xs ' +
              (activeNav === 'skills' ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}
          >
            📚 技能
          </button>
```

3c. `activeNav` 的类型若是联合字面量,加 `'skills'`(搜索 `activeNav` 的 prop 声明,如 `activeNav: ... | 'providers' | null` → 加 `| 'skills'`)。App.tsx 传入的 `activeNav={view === 'chat' ? null : view}` 已自动覆盖 'skills'。

- [ ] **Step 4: 验证**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npx vitest run && npm run build`
Expected: typecheck 无错;vitest 全绿(既有 + Task 4 的 skillsView);build PASS。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/components/SkillsPanel.tsx desktop/src/renderer/App.tsx desktop/src/renderer/components/Sidebar.tsx
git commit -m "feat(skills): 桌面「技能」面板(📚 nav + 按来源分组 + 启停 + 重扫)"
```

---

## 最终整支复审 + 门禁

- [ ] 全量 Java:`cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false test` → 0F/0E。
- [ ] 全量桌面:`cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npx vitest run && npm run build` → 全绿。
- [ ] 红线:`git diff main...feat/skills-panel | grep -iE "api[_-]?key|secret|sk-|Bearer"`(只应命中字段名/自指)。
- [ ] whole-branch review(opus):app-server 技能接线正确性(每会话 registry、project 目录用 root)、`load_skill` 修复、RPC 形状与 enabled 计算、nav/面板一致性、既有 tests 不回归。
- [ ] 眼验(重建 jar + 重启桌面):对话里 `load_skill web-access` 成功;「技能」面板列出 web-access(内置)、可停用/启用、重扫生效。
