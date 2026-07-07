# 编辑技能改来源(移动作用域) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 编辑技能时可改"来源"，保存即把技能从 user↔project 移动；移动前后端检测目标同名冲突，有则拒绝。

**Architecture:** 后端 `SkillStore.existsInScope` 只读检测 + RPC `skills.existsInScope`；前端解锁来源下拉，`onSave` 改来源时先查冲突，无冲突则 `upsert` 新 + `delete` 旧。纯函数 `scopeToCleanup` 决定删旧 scope。

**Tech Stack:** Java 17/Maven（后端 + JUnit）；Electron/React/TS（IPC + 渲染 + vitest）。

## Global Constraints

- 包名 `com.lyhn.wraith`，Java 17。桌面工作目录 `desktop/`。
- 只放开"来源"，`name` 仍锁（不做 rename）；builtin 不涉及（只 fork）。
- 未改来源（同 scope）走原 upsert，行为不变。
- 复用 `SkillStore.resolveScopeDir` + `requireSafeName`（路径安全）。
- 门禁：Java `mvn -DskipTests=false -Dtest=...` 0F/0E；桌面 typecheck + vitest 不回归 + build 全绿。交付后重建 jar + 眼验。
- 无密钥面。提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。
- commit trailer：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 分支：`feat/skill-scope-move`（当前）。

## File Structure

- `src/main/java/com/lyhn/wraith/skill/SkillStore.java` — 加 `existsInScope`。
- `src/test/java/com/lyhn/wraith/skill/SkillStoreTest.java` — 加 existsInScope 测试。
- `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` — SessionRunner default `skillsExistsInScope` + dispatch `case "skills.existsInScope"`。
- `src/main/java/com/lyhn/wraith/cli/Main.java` — 匿名 SessionRunner override `skillsExistsInScope`。
- `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSkillsTest.java` — 加 existsInScope 测试(fake runner + dispatch)。
- `desktop/src/renderer/lib/skillEditor.ts` — 加 `scopeToCleanup`。
- `desktop/test/skillEditor.test.ts` — 加 `scopeToCleanup` 测试。
- `desktop/src/preload/index.ts` — 加 `skillExistsInScope`。
- `desktop/src/main/index.ts` — 加 `wraith:skillExistsInScope` handler。
- `desktop/src/renderer/components/SkillsPanel.tsx` — 编辑分支 `lockScope={false}`。
- `desktop/src/renderer/components/SkillEditor.tsx` — `save` 移动流 + import `scopeToCleanup`。

---

### Task 1: SkillStore.existsInScope + 单测（Java）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/skill/SkillStore.java`
- Test: `src/test/java/com/lyhn/wraith/skill/SkillStoreTest.java`

**Interfaces:**
- Produces: `SkillStore.existsInScope(String scope, String name): boolean` —— 供 Task 2 的 RPC 调用。

- [ ] **Step 1: 写失败测试**

在 `SkillStoreTest.java` 加两个方法（用既有 `@TempDir`/`List` 导入；若缺 `assertThrows`/`assertFalse` 静态导入，确保 `import static org.junit.jupiter.api.Assertions.*;`）：

```java
    @Test
    void existsInScopeDetectsPresencePerScope(@TempDir Path tmp) throws Exception {
        SkillStore store = new SkillStore(tmp.resolve("user"), tmp.resolve("project"));
        assertFalse(store.existsInScope("user", "foo"));
        store.upsert("user", "foo", "d", "", "", java.util.List.of(), "b");
        assertTrue(store.existsInScope("user", "foo"));
        assertFalse(store.existsInScope("project", "foo"), "user 有不代表 project 有");
    }

    @Test
    void existsInScopeRejectsBadScopeOrName(@TempDir Path tmp) {
        SkillStore store = new SkillStore(tmp.resolve("u"), tmp.resolve("p"));
        assertThrows(IllegalArgumentException.class, () -> store.existsInScope("builtin", "foo"));
        assertThrows(IllegalArgumentException.class, () -> store.existsInScope("user", "../evil"));
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=SkillStoreTest test 2>&1 | tail -20`
Expected: 编译失败（`existsInScope` 方法不存在）。

- [ ] **Step 3: 写实现**

在 `SkillStore.java` 的 `delete(...)` 方法之后、`resolveScopeDir` 之前，加：

```java
    /** 目标作用域下是否已存在该技能(&lt;scopeDir&gt;/&lt;name&gt;/SKILL.md)。scope/name 非法抛 IllegalArgumentException。 */
    public boolean existsInScope(String scope, String name) {
        Path dir = resolveScopeDir(scope);
        String safe = requireSafeName(name);
        return Files.isRegularFile(dir.resolve(safe).resolve("SKILL.md"));
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=SkillStoreTest test 2>&1 | grep -E "Tests run|BUILD" | tail -3`
Expected: `Tests run: N, Failures: 0, Errors: 0`（原 7 + 新 2 = 9），BUILD SUCCESS。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add src/main/java/com/lyhn/wraith/skill/SkillStore.java src/test/java/com/lyhn/wraith/skill/SkillStoreTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
feat(skill): SkillStore.existsInScope —— 检测某作用域下是否已有同名技能

供"移动作用域"前的冲突检测。复用 resolveScopeDir + requireSafeName(路径安全),只读。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

---

### Task 2: RPC skills.existsInScope 端到端（Java）

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSkillsTest.java`

**Interfaces:**
- Consumes: `SkillStore.existsInScope`（Task 1）。
- Produces: JSON-RPC `skills.existsInScope({scope,name})` → `{ "exists": boolean }`；供 Task 4 的桌面 IPC 调用。

- [ ] **Step 1: 写失败测试**

在 `AppServerSkillsTest.java` 里，(a) 给 `runWithStore` 的 fake `SessionRunner`（约 line 69-111 内）加一个方法：

```java
            public Map<String,Object> skillsExistsInScope(String scope, String name) {
                return Map.of("exists", store.existsInScope(scope, name));
            }
```

(b) 加两个测试方法：

```java
    @Test void existsInScopeTrueForPresentPerScope(@TempDir Path tmp) throws Exception {
        List<JsonNode> r = runWithStore(tmp,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.upsert\",\"params\":{\"scope\":\"user\",\"name\":\"mine\",\"body\":\"B\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.existsInScope\",\"params\":{\"scope\":\"user\",\"name\":\"mine\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.existsInScope\",\"params\":{\"scope\":\"project\",\"name\":\"mine\"}}");
        assertTrue(byId(r, 3).path("result").path("exists").asBoolean());
        assertFalse(byId(r, 4).path("result").path("exists").asBoolean());
    }

    @Test void existsInScopeMissingNameIsParamError() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"skills.existsInScope\",\"params\":{\"scope\":\"user\"}}");
        assertEquals(-32602, byId(r, 2).path("error").path("code").asInt());
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest=AppServerSkillsTest test 2>&1 | tail -20`
Expected: FAIL —— 未知方法 `skills.existsInScope`（dispatch 无此 case，existsInScope 请求得不到 result；或缺 default 方法编译错）。

- [ ] **Step 3: AppServer —— 加 SessionRunner default + dispatch case**

(a) 在 `AppServer.SessionRunner` 接口（`skillsFork` default 之后、接口右括号 `}` 之前，约 line 125）加：

```java
        /** 查某作用域下是否已存在同名技能(移动作用域前的冲突检测)。默认抛出。 */
        default java.util.Map<String, Object> skillsExistsInScope(String scope, String name) {
            throw new UnsupportedOperationException("skillsExistsInScope not implemented");
        }
```

(b) 在 `dispatch` 里 `case "skills.delete" -> {...}` 之后加（与 delete 同构：scope+name 守卫）：

```java
            case "skills.existsInScope" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                JsonNode p = msg.params();
                String scope = textParam(p, "scope");
                String name = textParam(p, "name");
                if (scope == null || scope.isBlank()) { writer.error(msg.id(), -32602, "缺 scope"); return true; }
                if (name == null || name.isBlank()) { writer.error(msg.id(), -32602, "缺 name"); return true; }
                try { writer.result(msg.id(), session.skillsExistsInScope(scope, name)); }
                catch (IllegalArgumentException e) { writer.error(msg.id(), -32602, e.getMessage()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
```

- [ ] **Step 4: Main.java —— override skillsExistsInScope**

在 `Main.java` 匿名 `SessionRunner`（`skillsDelete` override 附近，约 line 1402-1406）加：

```java
                    public java.util.Map<String,Object> skillsExistsInScope(String scope, String name) {
                        return java.util.Map.of("exists", skillStore.existsInScope(scope, name));
                    }
```

- [ ] **Step 5: 跑测试确认通过 + 全量 skill/appserver 不回归**

Run: `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests=false -Dtest="AppServerSkillsTest,SkillStoreTest" test 2>&1 | grep -E "Tests run|BUILD" | tail -4`
Expected: 两类 0F/0E，BUILD SUCCESS。

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/main/java/com/lyhn/wraith/cli/Main.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerSkillsTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
feat(skill): RPC skills.existsInScope —— 作用域同名冲突检测端到端

AppServer 加 SessionRunner default + dispatch case(与 skills.delete 同构守卫),
Main 匿名 runner override 到 skillStore.existsInScope。返回 {exists:boolean}。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

---

### Task 3: 前端纯函数 scopeToCleanup + 单测

**Files:**
- Modify: `desktop/src/renderer/lib/skillEditor.ts`
- Test: `desktop/test/skillEditor.test.ts`

**Interfaces:**
- Produces: `scopeToCleanup(initialSource, formScope): 'user'|'project'|null` —— 供 Task 4 的 `save` 决定移动后删哪个旧 scope。

- [ ] **Step 1: 写失败测试**

在 `desktop/test/skillEditor.test.ts` 末尾追加：

```ts
import { scopeToCleanup } from '../src/renderer/lib/skillEditor'

describe('scopeToCleanup', () => {
  it('同作用域(未移动)→null', () => {
    expect(scopeToCleanup('user', 'user')).toBeNull()
    expect(scopeToCleanup('project', 'project')).toBeNull()
  })
  it('跨作用域→返回旧 scope(要删的)', () => {
    expect(scopeToCleanup('project', 'user')).toBe('project')
    expect(scopeToCleanup('user', 'project')).toBe('user')
  })
  it('builtin/undefined 源→null(不删)', () => {
    expect(scopeToCleanup('builtin', 'user')).toBeNull()
    expect(scopeToCleanup(undefined, 'user')).toBeNull()
  })
})
```

（若首行 import 与文件顶部既有 import 重复报错，则并入顶部 import 行，不要重复声明。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/skillEditor.test.ts`
Expected: FAIL —— `scopeToCleanup` 未导出/未定义。

- [ ] **Step 3: 写实现**

在 `desktop/src/renderer/lib/skillEditor.ts` 末尾加：

```ts
/** 移动作用域后需删除的旧 scope;未移动/新建/builtin 源→null(无需删)。 */
export function scopeToCleanup(
  initialSource: 'builtin' | 'user' | 'project' | undefined,
  formScope: 'user' | 'project',
): 'user' | 'project' | null {
  if (initialSource !== 'user' && initialSource !== 'project') return null
  return initialSource === formScope ? null : initialSource
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npx vitest run test/skillEditor.test.ts`
Expected: PASS（既有 + 新 3 例全绿）。

- [ ] **Step 5: 提交**

```bash
cd /Users/aa00945/Desktop/wraith/desktop
git add src/renderer/lib/skillEditor.ts test/skillEditor.test.ts
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
feat(desktop): scopeToCleanup 纯函数(移动作用域后决定删哪个旧 scope)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

---

### Task 4: 桌面 IPC + 编辑器移动流

**Files:**
- Modify: `desktop/src/preload/index.ts`（加 `skillExistsInScope`）
- Modify: `desktop/src/main/index.ts`（加 IPC handler）
- Modify: `desktop/src/renderer/components/SkillsPanel.tsx`（解锁 scope）
- Modify: `desktop/src/renderer/components/SkillEditor.tsx`（`save` 移动流）

**Interfaces:**
- Consumes: RPC `skills.existsInScope`（Task 2）；`scopeToCleanup`（Task 3）；既有 `upsertSkill`/`deleteSkill`。

- [ ] **Step 1: preload —— 加 skillExistsInScope**

在 `desktop/src/preload/index.ts`，类型声明区（`deleteSkill` 声明附近，约 line 72）加：

```ts
  skillExistsInScope(scope: 'user' | 'project', name: string): Promise<{ exists: boolean }>
```

实现区（`deleteSkill` 实现附近，约 line 316）加：

```ts
  skillExistsInScope(scope, name) {
    return ipcRenderer.invoke('wraith:skillExistsInScope', scope, name) as Promise<{ exists: boolean }>
  },
```

- [ ] **Step 2: main —— 加 IPC handler**

在 `desktop/src/main/index.ts`，`ipcMain.handle('wraith:deleteSkill', …)`（约 line 505）之后加：

```ts
ipcMain.handle('wraith:skillExistsInScope', async (_e, scope: 'user' | 'project', name: string) => {
  const client = getClient()
  return client.request('skills.existsInScope', { scope, name })
})
```

> 注：`getClient()`/client 取法以该文件既有 skill handler（getSkill/deleteSkill）为准，逐字沿用同一获取方式（上面 `getClient()` 是占位——实现时复用邻近 handler 的同款代码）。

- [ ] **Step 3: SkillsPanel —— 解锁编辑态 scope**

在 `desktop/src/renderer/components/SkillsPanel.tsx` 第 61 行，把编辑分支的 `lockScope` 改为 `lockScope={false}`（`lockName` 保持）：

```tsx
    return <SkillEditor initial={mode.detail} lockName lockScope={false}
```

（其余属性不变。）

- [ ] **Step 4: SkillEditor —— save 移动流 + import**

在 `desktop/src/renderer/components/SkillEditor.tsx` 顶部 import（第 3 行 `import { validateSkillName, toUpsertPayload, type SkillFormState } from '../lib/skillEditor'`）加入 `scopeToCleanup`：

```tsx
import { validateSkillName, toUpsertPayload, scopeToCleanup, type SkillFormState } from '../lib/skillEditor'
```

把 `save`（约 line 33-40）整体替换为：

```tsx
  const save = async (): Promise<void> => {
    if (nameError) { setError(nameError); return }
    setSaving(true)
    try {
      const cleanup = scopeToCleanup(initial?.source, form.scope)
      if (cleanup) {
        const { exists } = await window.wraith.skillExistsInScope(form.scope, form.name)
        if (exists) {
          setError(`目标作用域「${form.scope}」已存在同名技能「${form.name}」，无法移动`)
          setSaving(false)
          return
        }
      }
      await window.wraith.upsertSkill(toUpsertPayload(form))
      if (cleanup) await window.wraith.deleteSkill(cleanup, form.name)
      onSaved()
    } catch (err) { setError((err as Error).message); setSaving(false) }
  }
```

- [ ] **Step 5: 门禁 —— typecheck + vitest 不回归 + build**

Run: `cd /Users/aa00945/Desktop/wraith/desktop && npm run typecheck && npm run test && npm run build`
Expected: typecheck exit 0；vitest 全绿（含 Task 3 scopeToCleanup + 既有不回归）；build 成功。

- [ ] **Step 6: 提交**

```bash
cd /Users/aa00945/Desktop/wraith/desktop
git add src/preload/index.ts src/main/index.ts src/renderer/components/SkillsPanel.tsx src/renderer/components/SkillEditor.tsx
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || echo "no secret hits"
git commit -m "$(cat <<'EOF'
feat(desktop): 编辑技能可改来源=移动作用域(冲突拒绝)

解锁编辑态"来源"下拉;save 改来源时先 skillExistsInScope 查冲突,有则拒绝提示、
不写不删,无则 upsert 新 + delete 旧。scopeToCleanup 决定删哪个旧 scope。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN
EOF
)"
```

---

## 交付后（人工/主循环）

1. `cd /Users/aa00945/Desktop/wraith && mvn -q -DskipTests package` 重建 jar → `cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar`。
2. 眼验（重启桌面 App）：编辑技能→"来源"下拉可选；user→project 保存后旧目录消失、新目录出现、面板 source 变；制造冲突（目标已有同名，如 fork 后编辑副本改回原 scope）→被拒提示、原件不变；未改来源编辑照常。
3. 通过 → `git checkout main && git merge --ff-only feat/skill-scope-move && git push origin main`（推送前用户点头）。

## Self-Review

**1. Spec 覆盖：**
- 后端 existsInScope → Task 1。✓ RPC skills.existsInScope → Task 2。✓ IPC → Task 4 Step 1-2。✓ scopeToCleanup → Task 3。✓ 解锁 scope → Task 4 Step 3。✓ save 移动流(查冲突→拒绝/写新删旧) → Task 4 Step 4。✓ 未改来源不变 → cleanup=null 分支。✓ 测试(Java existsInScope + RPC + scopeToCleanup vitest) → T1/T2/T3。✓ jar 重建 → 交付后。✓
**2. 占位符扫描：** 无 TBD；各步完整代码。仅 Task 4 Step 2 的 `getClient()` 显式标注为"以邻近 handler 既有取法为准逐字沿用"（非占位逻辑，是让实现者匹配该文件既有 client 获取方式，避免我臆造 API）。
**3. 类型/命名一致性：**
- `existsInScope(scope,name):boolean`（T1）↔ Main override 调用（T2）↔ RPC 返回 `{exists}`（T2）↔ preload `Promise<{exists:boolean}>`（T4）↔ SkillEditor 解构 `{exists}`（T4）—— 一致。✓
- `scopeToCleanup(initialSource, formScope)`（T3）↔ SkillEditor `scopeToCleanup(initial?.source, form.scope)`（T4）—— 签名一致（`initial?.source` 为 `'builtin'|'user'|'project'|undefined`，`form.scope` 为 `'user'|'project'`）。✓
- RPC 方法名 `skills.existsInScope` 在 AppServer dispatch / Main / IPC `client.request` 三处一致。✓
- `lockScope={false}` 仅改编辑分支，新建分支本就 `lockScope={false}`。✓
