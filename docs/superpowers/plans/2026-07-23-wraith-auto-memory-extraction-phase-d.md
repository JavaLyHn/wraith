# wraith 自动记忆提取 — Phase D(桌面触发 + Minor 收尾)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让桌面能**自己产候选**(非破坏地扫当前对话)+ 清掉 Phase C 终审的 5 条 Minor,使桌面「待确认」闭环。

**Architecture:** Task 1 加一条非破坏触发 `memory.extractNow`(五层:SessionRunner/AppServer/main IPC/preload/MemoryPanel 按钮),后端复用已存在的 `MemoryManager.runAutoExtraction(sessionId)`(同步、受 autoExtract 门控、扫短期记忆产候选、**不清对话**)。Task 2 修 5 条 Minor(搜索过滤/失败反馈/清空测试/emoji/T1 分支测试)。

**Tech Stack:** Java 17 / Maven;Electron + React + TS;Vitest + JUnit5/Mockito。

## Global Constraints

- 桌面触发用**非破坏** `runAutoExtraction`(扫当前 agent 短期记忆),**不**接 `clearHistory`(那会清空桌面对话,UX 差)。
- 沿既有 `memory.*` 五层桥模式(SessionRunner default-throw → AppServer case → main ipcMain.handle → preload decl/impl → 通道名 `wraith:memoryExtractNow` / RPC `memory.extractNow`)。
- 不破坏既有 MemoryPanel 行为;不改后端 A/B/C 已定语义(仅新增 extractNow 暴露 + 前端修补)。
- 测试:Java `mvn -q -DskipTests=false -Dtest=<Class> test`;桌面 `cd desktop && npx vitest run test/<f>` / `npm test` / `npm run typecheck`。基线:Java 1566/0F/0E、桌面 vitest 全绿。
- `git add` 仅本任务文件;禁 `git add .`/`-A`;不碰 WIP。

---

### Task 1: 桌面「整理记忆」触发 memory.extractNow(五层)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(SessionRunner default + handle case)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(匿名 session 实现)
- Modify: `desktop/src/shared/types.ts`(`ExtractNowResult`)
- Modify: `desktop/src/main/index.ts`(ipcMain.handle)
- Modify: `desktop/src/preload/index.ts`(decl + impl)
- Modify: `desktop/src/renderer/components/MemoryPanel.tsx`(按钮 + 处理)
- Test: `desktop/test/memoryPanelPending.test.tsx`(追加 extractNow 用例)

**Interfaces:**
- Consumes:`MemoryManager.runAutoExtraction(String sessionId)`(已存在,`public int`,同步/门控/扫短期记忆)。
- Produces:RPC `memory.extractNow` → `{enqueued:number}`;`window.wraith.memoryExtractNow()` → `Promise<ExtractNowResult>`。

- [ ] **Step 1: 后端 SessionRunner default(AppServer)**

在 `AppServer.SessionRunner` 的 `memoryPendingClear()` default 之后加:
```java
        /** 非破坏地扫当前对话短期记忆产候选(不清对话)。默认抛出。 */
        default java.util.Map<String, Object> memoryExtractNow() {
            throw new UnsupportedOperationException("memoryExtractNow not implemented");
        }
```

- [ ] **Step 2: 后端 AppServer 分派 case**

在 `handle(...)` 的 `case "memory.pendingClear" -> {...}` 之后加:
```java
            case "memory.extractNow" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                try { writer.result(msg.id(), session.memoryExtractNow()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
```

- [ ] **Step 3: 后端 Main 匿名 session 实现**

在 `Main.java` 匿名 session 的 `memoryPendingClear()` 实现之后加:
```java
                    public java.util.Map<String, Object> memoryExtractNow() {
                        int n = agent.getMemoryManager().runAutoExtraction("desktop-" + System.currentTimeMillis());
                        return java.util.Map.of("enqueued", n);
                    }
```

- [ ] **Step 4: 后端编译**

Run: `mvn -q -DskipTests=false compile`
Expected: 净;三层(接口/case/impl)对齐 `memoryExtractNow`。

- [ ] **Step 5: 桌面 types + main + preload**

(a) `desktop/src/shared/types.ts` 的 `PendingListResult` 之后:
```typescript

/** memory.extractNow 回包:本次扫描入队的候选数。 */
export interface ExtractNowResult {
  enqueued: number
}
```

(b) `desktop/src/main/index.ts` 的 `wraith:memoryPendingClear` handler 之后:
```typescript
ipcMain.handle('wraith:memoryExtractNow', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('memory.extractNow', {})
})
```

(c) `desktop/src/preload/index.ts`:接口声明区 `memoryPendingClear` 之后加:
```typescript
  memoryExtractNow(): Promise<ExtractNowResult>
```
实现区 `memoryPendingClear() {...}` 之后加:
```typescript
  memoryExtractNow() {
    return ipcRenderer.invoke('wraith:memoryExtractNow') as Promise<ExtractNowResult>
  },
```
并把 `ExtractNowResult` 加进对 `../shared/types` 的 type import 列表。

- [ ] **Step 6: 桌面 MemoryPanel 按钮 + 处理**

(a) `MemoryPanel.tsx` 组件内加(放在 `loadPending` 之后):
```tsx
  const doExtractNow = useCallback(async (): Promise<void> => {
    setBusy(true); setInitNotice(null)
    try {
      const r = await window.wraith.memoryExtractNow()
      setInitNotice(r.enqueued > 0 ? `🧠 已从本次对话抽取 ${r.enqueued} 条候选,请在下方待确认区复核` : 'ℹ️ 本次对话没有可沉淀的新事实')
      await loadPending()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [loadPending])
```

(b) 在搜索工具行(现 :92-105 那个 `flex ... border-b` div)里、`清空` 按钮之前(或 query 输入右侧)加一个按钮:
```tsx
        <button data-testid="memory-extract-now" onClick={() => void doExtractNow()} disabled={busy} title="扫描本次对话,把稳定事实提为待确认候选(不清空对话)"
          className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40">整理记忆</button>
```

- [ ] **Step 7: 追加桌面测试**

在 `desktop/test/memoryPanelPending.test.tsx` 的 `mockWraith` 里补 `memoryExtractNow: vi.fn(async () => ({ enqueued: 2 }))`(加进对象),并追加用例:
```tsx
  it('整理记忆键 → 调 memoryExtractNow 并刷新候选', async () => {
    const w = mockWraith()
    render(<MemoryPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('memory-extract-now')).toBeTruthy())
    fireEvent.click(screen.getByTestId('memory-extract-now'))
    await waitFor(() => expect(w.memoryExtractNow).toHaveBeenCalled())
    // 触发后会再次拉候选(memoryPendingList 至少被调 2 次:挂载 + 整理后)
    await waitFor(() => expect((w.memoryPendingList as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThanOrEqual(2))
  })
```

- [ ] **Step 8: 桌面测试 + typecheck**

Run: `cd desktop && npx vitest run test/memoryPanelPending.test.tsx && npm run typecheck`
Expected: 全绿(原 4 + 新 1 = 5);typecheck 0。

- [ ] **Step 9: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/main/java/com/lyhn/wraith/cli/Main.java desktop/src/shared/types.ts desktop/src/main/index.ts desktop/src/preload/index.ts desktop/src/renderer/components/MemoryPanel.tsx desktop/test/memoryPanelPending.test.tsx
git commit -m "feat(desktop): 记忆面板「整理记忆」按钮 + memory.extractNow 触发(非破坏扫当前对话产候选)"
```

---

### Task 2: Phase C 终审 5 条 Minor 收尾

**Files:**
- Modify: `desktop/src/renderer/components/MemoryPanel.tsx`
- Modify: `desktop/test/memoryPanelPending.test.tsx`
- Modify: `src/test/java/com/lyhn/wraith/memory/MemoryManagerPendingTest.java`

**Interfaces:** 无新接口;修补现有行为 + 补测试。

- [ ] **Step 1: 写失败/新测试**

(a) `desktop/test/memoryPanelPending.test.tsx` 追加两条:
```tsx
  it('清空键 → confirm 后调 memoryPendingClear', async () => {
    const w = mockWraith()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<MemoryPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('memory-pending-clear')).toBeTruthy())
    fireEvent.click(screen.getByTestId('memory-pending-clear'))
    await waitFor(() => expect(w.memoryPendingClear).toHaveBeenCalled())
    vi.restoreAllMocks()
  })

  it('批准返回 ok:false → 显示失败提示,不静默', async () => {
    const w = mockWraith({ memoryPendingApprove: vi.fn(async () => ({ ok: false })) })
    render(<MemoryPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('pending-approve-cand-1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pending-approve-cand-1'))
    await waitFor(() => expect(screen.getByText(/未生效|失败|不可/)).toBeTruthy())
  })
```

(b) `src/test/java/com/lyhn/wraith/memory/MemoryManagerPendingTest.java` 追加"存在但跨项目不可见的 oldId"分支(补 PC-T1-a):
```java
    @Test
    void approveReplacingRejectedForExistingButInvisibleOldId(@TempDir File dir) {
        MemoryManager m = managerWithTempMemory(dir); // currentProject = "/proj"
        // 直接塞一条属于别项目(/other)的长期条,使其对 /proj 不可见
        m.getLongTermMemory().store(new MemoryEntry("old-other", "别项目旧事实",
                MemoryEntry.MemoryType.FACT, java.util.Map.of("scope", "project", "project", "/other"), 5));
        m.getPendingStore().add(new PendingFact("c1", "新事实", "FACT", "global", "old-other", "s1", null, "2026-07-23T00:00:00Z"));
        assertFalse(m.approvePendingReplacing("c1", "old-other")); // 旧条存在但不可见 → 拒
        assertTrue(m.getPendingStore().get("c1").isPresent());      // 未领取
    }
```

- [ ] **Step 2: 跑测试确认新增的失败**

Run: `cd desktop && npx vitest run test/memoryPanelPending.test.tsx` + `mvn -q -DskipTests=false -Dtest=MemoryManagerPendingTest test`
Expected: 桌面「批准 ok:false 提示」失败(当前忽略 `{ok}`);Java 新增分支测试**应已通过**(Phase C 的守卫逻辑已覆盖该分支,此测试仅补验证——若失败说明守卫有漏,按 systematic-debugging 处理)。清空键测试可能已过(键已存在)。

- [ ] **Step 3: 写实现(MemoryPanel 5 项修补)**

在 `MemoryPanel.tsx` 内:

(1)+(2) `doApprove` / `doReplace` 改为用 `load(query)` 保留搜索过滤,并检查 `{ok}`:
```tsx
  const doApprove = useCallback(async (f: PendingFactView): Promise<void> => {
    try {
      const r = await window.wraith.memoryPendingApprove(f.id)
      if (!r.ok) { setInitNotice('⚠️ 批准未生效(可能已处理或非当前项目可见)'); return }
      await loadPending(); void load(query)
    } catch (err) { setError((err as Error).message) }
  }, [loadPending, load, query])

  const doReplace = useCallback(async (f: PendingFactView): Promise<void> => {
    if (!f.nearestExistingId) return
    try {
      const r = await window.wraith.memoryPendingApproveReplacing(f.id, f.nearestExistingId)
      if (!r.ok) { setInitNotice('⚠️ 替换未生效(旧条不存在/不可见,或候选已处理)'); return }
      await loadPending(); void load(query)
    } catch (err) { setError((err as Error).message) }
  }, [loadPending, load, query])
```

(3) `doReject` 检查 `{ok}`:
```tsx
  const doReject = useCallback(async (f: PendingFactView): Promise<void> => {
    try {
      const r = await window.wraith.memoryPendingReject(f.id)
      if (!r.ok) { setInitNotice('⚠️ 驳回未生效(可能已处理或非当前项目可见)'); return }
      await loadPending()
    } catch (err) { setError((err as Error).message) }
  }, [loadPending])
```

(4) emoji:把待确认区标题的 `🕵 待确认候选` 改为中性 `📥 待确认候选`(去掉侦探语义)。

> 说明:失败提示用现有 `initNotice`(面板已有该 state 与渲染位 :90),不新增 UI。`doClearPending` 已用 confirm,无需改。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/memoryPanelPending.test.tsx && mvn -q -DskipTests=false -Dtest=MemoryManagerPendingTest test`
Expected: 桌面全绿(含新失败提示用例、清空键用例);Java `MemoryManagerPendingTest` 全绿(含新分支测试,共 9)。

- [ ] **Step 5: 全量 + typecheck**

Run: `cd desktop && npm test && npm run typecheck`
Expected: 桌面全绿、typecheck 0。

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/components/MemoryPanel.tsx desktop/test/memoryPanelPending.test.tsx src/test/java/com/lyhn/wraith/memory/MemoryManagerPendingTest.java
git commit -m "polish(memory): 待确认区收尾 — 保留搜索过滤/失败反馈/清空+不可见oldId测试/emoji"
```

---

## Self-Review
- 桌面触发缺口(final review carry / PC-carry-2 前置) → Task 1(非破坏 extractNow 五层 + 按钮)。
- Minor: load(query) 丢过滤 / 忽略 {ok} / 清空未测 / 🕵 emoji / T1 分支未测 → Task 2 逐条对应。
- 类型一致:`memoryExtractNow` 名在 SessionRunner/case/impl/preload/main 通道五处一致;`ExtractNowResult{enqueued}` 与 Main `Map.of("enqueued", n)` 对应。
- 无占位;可测部分给全代码 + testid;后端 extractNow 是对已测 `runAutoExtraction` 的薄暴露(编译 + 既有 autoExtractDisabledSkips 测试兜底)。

## 明确不做
- 不接 `clearHistory` 到桌面(避免清空对话);extractNow 非破坏。
- 不做自动/定时触发;由用户点「整理记忆」按需触发(会话边界 /clear 触发仍在 CLI/TUI)。
