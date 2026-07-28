# wraith 自动记忆提取 — Phase C(桌面「待确认」区)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让候选待确认记忆能在桌面 `MemoryPanel` 里被人工复核——列候选、批准(ADD)/替换旧条(SUPERSEDE)/驳回;并收口 Phase B 终审带来的后端对称性(reject/oldId 可见性守卫)。

**Architecture:** Task 1 纯 Java 后端:给 `rejectPending` 与 `approvePendingReplacing` 的 `oldId` 补可见性守卫(对齐 approve)。Task 2 桌面三层桥:`shared/types` 加候选视图类型 + `preload` 声明/实现 `memoryPending*` + `main` `ipcMain.handle` 转发 `memory.pending*` RPC。Task 3 `MemoryPanel` 顶部「待确认」区(消费 Task 2 的 preload API)+ vitest。

**Tech Stack:** Java 17 / Maven(后端);Electron + React 18 + TypeScript(桌面);Vitest + @testing-library/react(jsdom)。

## Global Constraints

- 后端复用 Phase A/B 的 `MemoryManager`(`listPending`/`approvePending`/`approvePendingReplacing`/`rejectPending`/`clearPending`/`getPendingStore`/`getCurrentProject`)、`LongTermMemory`(`retrieve(id)`、`public static isVisibleInProject(MemoryEntry, projectKey)`、`markSuperseded`)、`PendingFact`(record:id,fact,type,scope,nearestExistingId,sourceSessionId,project,createdAt)。
- 桌面桥沿既有 `memory.*` 三层模式:`main` `ipcMain.handle('wraith:memoryX', ...)` → `client.request('memory.x', {...})`;`preload` 声明 + `ipcRenderer.invoke('wraith:memoryX', ...)`;RPC 名 `memory.pendingList/pendingApprove/pendingApproveReplacing/pendingReject/pendingClear`(Phase B 已实现)。
- `MemoryPanel` 用 `window.wraith.*`(无 props 注入),沿其现有 `load()`/`useCallback`/`useState` 与 testid 风格;新增区不破坏既有列表/搜索/保存/WRAITH.md 区。
- 后端测试 `mvn -q -DskipTests=false -Dtest=<Class> test`(默认 skip);桌面测试 `cd desktop && npx vitest run test/<file>`。基线:Java 1566/0F/0E、桌面 vitest 全绿。
- `git add` 仅本任务文件;禁止 `git add .`/`-A`;不碰 WIP。

---

### Task 1: 后端对称化 — reject/oldId 可见性守卫(收 PC-carry-1)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/memory/MemoryManager.java`(`rejectPending`、`approvePendingReplacing`)
- Test: `src/test/java/com/lyhn/wraith/memory/MemoryManagerPendingTest.java`

**Interfaces:**
- Consumes:`isPendingVisible`(Phase B 已加)、`LongTermMemory.retrieve(id)`(→`Optional<MemoryEntry>`)、`LongTermMemory.isVisibleInProject(entry, projectKey)`(`public static`)、`currentProject`。
- Produces:`rejectPending(id)` 仅对当前项目可见候选生效;`approvePendingReplacing(id, oldId)` 要求 `oldId` 存在且当前项目可见,否则返回 false 且不 ADD/不 supersede。

- [ ] **Step 1: 追加失败测试**

在 `MemoryManagerPendingTest` 追加:

```java
    @Test
    void rejectRejectedForCandidateNotVisibleInCurrentProject(@TempDir File dir) {
        MemoryManager m = managerWithTempMemory(dir); // currentProject = "/proj"
        m.getPendingStore().add(new PendingFact("cx", "别项目候选", "FACT", "project", null, "s1", "/other", "2026-07-23T00:00:00Z"));
        assertFalse(m.rejectPending("cx"));                    // 不可见 → 拒
        assertTrue(m.getPendingStore().get("cx").isPresent());  // 未被误删
    }

    @Test
    void approveReplacingRejectedForMissingOrInvisibleOldId(@TempDir File dir) {
        MemoryManager m = managerWithTempMemory(dir);
        m.getPendingStore().add(new PendingFact("c1", "用户偏好 Java 17", "FACT", "global", "nope", "s1", null, "2026-07-23T00:00:00Z"));
        assertFalse(m.approvePendingReplacing("c1", "nope"));   // oldId 不存在 → 拒
        assertTrue(m.getLongTermMemory().getAll().isEmpty());    // 未 ADD
        assertTrue(m.getPendingStore().get("c1").isPresent());   // 候选仍在(未领取)
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -q -DskipTests=false -Dtest=MemoryManagerPendingTest test`
Expected: 新用例失败——当前 `rejectPending` 无可见性守卫(会删别项目候选)、`approvePendingReplacing` 不校验 oldId(会 ADD 且对不存在 oldId 调 markSuperseded 返回 true)。

- [ ] **Step 3: 写实现**

把 `MemoryManager` 的 `rejectPending` 与 `approvePendingReplacing` 替换为(其余不动):

```java
    public boolean rejectPending(String id) {
        PendingFact pf = pendingStore.get(id).orElse(null);
        if (pf == null || !isPendingVisible(pf)) {
            return false;
        }
        return pendingStore.remove(id);
    }

    public boolean approvePendingReplacing(String id, String oldId) {
        PendingFact pf = pendingStore.get(id).orElse(null);
        if (pf == null || !isPendingVisible(pf)) {
            return false;
        }
        // 旧条必须存在且当前项目可见,才允许超请;否则整体拒(不 ADD、不 supersede)
        MemoryEntry old = longTermMemory.retrieve(oldId).orElse(null);
        if (old == null || !LongTermMemory.isVisibleInProject(old, currentProject)) {
            return false;
        }
        if (!pendingStore.remove(id)) {
            return false;
        }
        storeFact(pf.fact(), pf.scope());
        longTermMemory.markSuperseded(oldId);
        return true;
    }
```

> 注:`approvePending`(纯 ADD)不变(Phase B 已含可见性 + 领取原子)。`import com.lyhn.wraith.memory.MemoryEntry` 已在同包无需 import。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -q -DskipTests=false -Dtest=MemoryManagerPendingTest test`
Expected: 全通过(Phase B 的 6 + 新 2 = 8;含 Phase A/B 原有的正向 replacing 用例仍绿——其 oldId 是当前项目可见条)。

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/memory/MemoryManager.java src/test/java/com/lyhn/wraith/memory/MemoryManagerPendingTest.java
git commit -m "feat(memory): reject/超请 oldId 补可见性守卫(对齐 approve,收口 Phase B 终审)"
```

---

### Task 2: 桌面三层桥 memoryPending*(types + preload + main)

**Files:**
- Modify: `desktop/src/shared/types.ts`(加 `PendingFactView` + `PendingListResult`)
- Modify: `desktop/src/preload/index.ts`(接口声明 + 实现)
- Modify: `desktop/src/main/index.ts`(`ipcMain.handle` 转发)

**Interfaces:**
- Consumes:Phase B RPC `memory.pendingList/pendingApprove/pendingApproveReplacing/pendingReject/pendingClear`。
- Produces:`window.wraith.memoryPendingList()` → `PendingListResult`;`memoryPendingApprove(id)`/`memoryPendingReject(id)`/`memoryPendingClear()` → `{ok:boolean}`;`memoryPendingApproveReplacing(id, oldId)` → `{ok:boolean}`。

- [ ] **Step 1: 加共享类型**

在 `desktop/src/shared/types.ts` 的 `MemoryListResult`(约 :282)之后追加:

```typescript

/** 待确认候选记忆视图(AppServer memory.pendingList 回包 pending[])。 */
export interface PendingFactView {
  id: string
  fact: string
  type: string
  scope: string // 'project' | 'global'
  nearestExistingId: string | null
  sourceSessionId: string
  project: string | null
  createdAt: string
}

export interface PendingListResult {
  project: string
  pending: PendingFactView[]
}
```

- [ ] **Step 2: main IPC 转发**

在 `desktop/src/main/index.ts` 的 `wraith:memoryClear` handler(约 :995-998)之后追加:

```typescript
ipcMain.handle('wraith:memoryPendingList', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('memory.pendingList', {})
})
ipcMain.handle('wraith:memoryPendingApprove', async (_e, id: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('memory.pendingApprove', { id })
})
ipcMain.handle('wraith:memoryPendingApproveReplacing', async (_e, id: string, oldId: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('memory.pendingApproveReplacing', { id, oldId })
})
ipcMain.handle('wraith:memoryPendingReject', async (_e, id: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('memory.pendingReject', { id })
})
ipcMain.handle('wraith:memoryPendingClear', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('memory.pendingClear', {})
})
```

- [ ] **Step 3: preload 声明 + 实现**

(a) 声明:在 `desktop/src/preload/index.ts` 接口里 `memoryInitProject(...)` 声明(约 :94)之后加:

```typescript
  memoryPendingList(): Promise<PendingListResult>
  memoryPendingApprove(id: string): Promise<{ ok: boolean }>
  memoryPendingApproveReplacing(id: string, oldId: string): Promise<{ ok: boolean }>
  memoryPendingReject(id: string): Promise<{ ok: boolean }>
  memoryPendingClear(): Promise<{ ok: boolean }>
```

确保该文件顶部对 `shared/types` 的 import 里含 `PendingListResult`(与 `MemoryListResult` 同处 import;若是 `import type { ... } from '...'` 列表,加进去)。

(b) 实现:在 `memoryClear() {...}`(约 :441-443)实现之后加:

```typescript
  memoryPendingList() {
    return ipcRenderer.invoke('wraith:memoryPendingList') as Promise<PendingListResult>
  },
  memoryPendingApprove(id) {
    return ipcRenderer.invoke('wraith:memoryPendingApprove', id) as Promise<{ ok: boolean }>
  },
  memoryPendingApproveReplacing(id, oldId) {
    return ipcRenderer.invoke('wraith:memoryPendingApproveReplacing', id, oldId) as Promise<{ ok: boolean }>
  },
  memoryPendingReject(id) {
    return ipcRenderer.invoke('wraith:memoryPendingReject', id) as Promise<{ ok: boolean }>
  },
  memoryPendingClear() {
    return ipcRenderer.invoke('wraith:memoryPendingClear') as Promise<{ ok: boolean }>
  },
```

(注意逗号:preload 的 wraith API 是对象字面量,各方法以 `,` 分隔;按该文件既有分隔风格补齐。)

- [ ] **Step 4: typecheck**

Run: `cd desktop && npm run typecheck`
Expected: 退出 0、无错(类型三层对齐:`PendingListResult` 在 types 定义、preload 声明/实现/import 一致、main invoke 通道名与 preload 一致 `wraith:memoryPending*`)。

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat(desktop): memoryPending* 三层桥(types/preload/main IPC → memory.pending* RPC)"
```

---

### Task 3: MemoryPanel「待确认」区 + 单测

**Files:**
- Modify: `desktop/src/renderer/components/MemoryPanel.tsx`
- Test: `desktop/test/memoryPanelPending.test.tsx`(新)

**Interfaces:**
- Consumes:Task 2 `window.wraith.memoryPendingList/Approve/ApproveReplacing/Reject/Clear`;`PendingFactView`;既有 `scopeLabel`。
- Produces:UI(testid):`memory-pending-section`(仅在有候选时渲染)、每条 `memory-pending-item`、按钮 `pending-approve-<id>` / `pending-replace-<id>`(仅 nearestExistingId 存在时) / `pending-reject-<id>`、`memory-pending-clear`。

- [ ] **Step 1: 写失败测试**

写入 `desktop/test/memoryPanelPending.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import MemoryPanel from '../src/renderer/components/MemoryPanel'
import type { PendingFactView } from '../src/shared/types'

afterEach(cleanup)

const PENDING: PendingFactView[] = [
  { id: 'cand-1', fact: '用户偏好 Java 17', type: 'FACT', scope: 'project', nearestExistingId: null, sourceSessionId: 's1', project: '/proj', createdAt: '2026-07-23T00:00:00Z' },
  { id: 'cand-2', fact: '用户住在旧金山', type: 'FACT', scope: 'global', nearestExistingId: 'fact-old99', sourceSessionId: 's1', project: null, createdAt: '2026-07-23T00:00:00Z' },
]

function mockWraith(over: Record<string, unknown> = {}) {
  const w = {
    memoryList: vi.fn(async () => ({ project: '/proj', entries: [], wraithMdExists: false, wraithMdPath: '' })),
    memorySearch: vi.fn(async () => ({ project: '/proj', entries: [] })),
    memoryPendingList: vi.fn(async () => ({ project: '/proj', pending: PENDING })),
    memoryPendingApprove: vi.fn(async () => ({ ok: true })),
    memoryPendingApproveReplacing: vi.fn(async () => ({ ok: true })),
    memoryPendingReject: vi.fn(async () => ({ ok: true })),
    memoryPendingClear: vi.fn(async () => ({ ok: true })),
    ...over,
  }
  ;(window as unknown as { wraith: Record<string, unknown> }).wraith = w
  return w
}

describe('MemoryPanel 待确认区', () => {
  it('渲染候选 + 批准调 memoryPendingApprove(id)', async () => {
    const w = mockWraith()
    render(<MemoryPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('memory-pending-section')).toBeTruthy())
    expect(screen.getByText('用户偏好 Java 17')).toBeTruthy()
    expect(screen.getByText('用户住在旧金山')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pending-approve-cand-1'))
    await waitFor(() => expect(w.memoryPendingApprove).toHaveBeenCalledWith('cand-1'))
  })

  it('nearestExistingId 存在 → 有替换键,调 memoryPendingApproveReplacing(id, oldId)', async () => {
    const w = mockWraith()
    render(<MemoryPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('pending-replace-cand-2')).toBeTruthy())
    expect(screen.queryByTestId('pending-replace-cand-1')).toBeNull() // cand-1 无 nearest → 无替换键
    fireEvent.click(screen.getByTestId('pending-replace-cand-2'))
    await waitFor(() => expect(w.memoryPendingApproveReplacing).toHaveBeenCalledWith('cand-2', 'fact-old99'))
  })

  it('驳回调 memoryPendingReject(id)', async () => {
    const w = mockWraith()
    render(<MemoryPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('pending-reject-cand-1')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pending-reject-cand-1'))
    await waitFor(() => expect(w.memoryPendingReject).toHaveBeenCalledWith('cand-1'))
  })

  it('无候选 → 不渲染待确认区', async () => {
    mockWraith({ memoryPendingList: vi.fn(async () => ({ project: '/proj', pending: [] })) })
    render(<MemoryPanel onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('memory-back')).toBeTruthy()) // 面板已挂载
    expect(screen.queryByTestId('memory-pending-section')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/memoryPanelPending.test.tsx`
Expected: FAIL —— `memory-pending-section` 等 testid 不存在(面板尚无待确认区);`window.wraith.memoryPendingList` 未被调用。

- [ ] **Step 3: 写实现(MemoryPanel 加待确认区)**

在 `MemoryPanel.tsx`:

(a) 顶部 import 补类型 + 图标:
```tsx
import { ArrowLeft, Brain, Search, Trash2, Plus, X, FileText, Check, RotateCcw } from 'lucide-react'
import type { MemoryEntryView, PendingFactView } from '../../shared/types'
```

(b) 组件内加 state + 加载/动作(放在现有 `load` useCallback 之后):
```tsx
  const [pending, setPending] = useState<PendingFactView[]>([])

  const loadPending = useCallback(async (): Promise<void> => {
    try {
      const r = await window.wraith.memoryPendingList()
      setPending(r.pending)
    } catch (err) { setError((err as Error).message) }
  }, [])

  const doApprove = useCallback(async (f: PendingFactView): Promise<void> => {
    try { await window.wraith.memoryPendingApprove(f.id); await loadPending(); void load() }
    catch (err) { setError((err as Error).message) }
  }, [loadPending, load])

  const doReplace = useCallback(async (f: PendingFactView): Promise<void> => {
    if (!f.nearestExistingId) return
    try { await window.wraith.memoryPendingApproveReplacing(f.id, f.nearestExistingId); await loadPending(); void load() }
    catch (err) { setError((err as Error).message) }
  }, [loadPending, load])

  const doReject = useCallback(async (f: PendingFactView): Promise<void> => {
    try { await window.wraith.memoryPendingReject(f.id); await loadPending() }
    catch (err) { setError((err as Error).message) }
  }, [loadPending])

  const doClearPending = useCallback(async (): Promise<void> => {
    if (!window.confirm('清空全部待确认候选?(不影响已入库的长期记忆)')) return
    try { await window.wraith.memoryPendingClear(); await loadPending() }
    catch (err) { setError((err as Error).message) }
  }, [loadPending])
```

(c) 在现有 `useEffect(() => { void load() }, [load])` 之后加载候选:
```tsx
  useEffect(() => { void loadPending() }, [loadPending])
```

(d) 渲染:在滚动区 `<div className="min-h-0 flex-1 overflow-y-auto ...">`(现 :109)**内部最上方**、`{busy && ...}` 之前插入待确认区:
```tsx
        {pending.length > 0 && (
          <div data-testid="memory-pending-section" className="mb-3 rounded-lg border border-warn/40 bg-warn/5 p-2">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-xs font-semibold text-warn">🕵 待确认候选 ({pending.length})</span>
              <button data-testid="memory-pending-clear" onClick={() => void doClearPending()}
                className="ml-auto text-3xs text-fg-subtle hover:text-danger">清空</button>
            </div>
            <div className="flex flex-col gap-1.5">
              {pending.map((f) => (
                <div key={f.id} data-testid="memory-pending-item" className="rounded-lg border border-border bg-bg px-2.5 py-1.5">
                  <div className="whitespace-pre-wrap break-words text-xs text-fg">{f.fact}</div>
                  <div className="mt-1 flex items-center gap-2 text-3xs text-fg-subtle">
                    <span className={'rounded px-1.5 py-0.5 ' + (f.scope === 'global' ? 'bg-accent/12 text-accent' : 'bg-surface text-fg-muted')}>{scopeLabel(f.scope)}</span>
                    {f.nearestExistingId && <span title={f.nearestExistingId}>↔ 相似既有条</span>}
                    <span className="ml-auto flex items-center gap-1">
                      <button data-testid={`pending-approve-${f.id}`} onClick={() => void doApprove(f)} title="批准入库"
                        className="flex items-center gap-0.5 rounded border border-ok/50 px-1.5 py-0.5 text-ok hover:bg-ok/10"><Check className="h-3 w-3" strokeWidth={2} />批准</button>
                      {f.nearestExistingId && (
                        <button data-testid={`pending-replace-${f.id}`} onClick={() => void doReplace(f)} title="批准并替换相似旧条"
                          className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-fg-muted hover:border-accent hover:text-accent"><RotateCcw className="h-3 w-3" strokeWidth={1.5} />替换</button>
                      )}
                      <button data-testid={`pending-reject-${f.id}`} onClick={() => void doReject(f)} title="驳回"
                        className="rounded border border-border px-1.5 py-0.5 text-fg-subtle hover:border-danger hover:text-danger">驳回</button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/memoryPanelPending.test.tsx`
Expected: 4 用例通过。

- [ ] **Step 5: 全量单测 + typecheck**

Run: `cd desktop && npm test && npm run typecheck`
Expected: 全绿(既有 + 新 4);typecheck 0。

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/components/MemoryPanel.tsx desktop/test/memoryPanelPending.test.tsx
git commit -m "feat(desktop): MemoryPanel 待确认区 — 列候选/批准/替换/驳回/清空"
```

---

## Self-Review(写完对照 spec)

**1. Spec/carry 覆盖**:
- 桌面「待确认(N)」区、列候选(fact + scope + nearestExistingId 对照)、批准(ADD)/替换旧条(SUPERSEDE)/驳回 → Task 3。(spec 提的「编辑后批准」YAGNI 本期不做,记后续。)
- preload/IPC `memory.pending*` 通道 → Task 2。
- PC-carry-1(reject/oldId 可见性守卫)→ Task 1。
- 其余 carry(文案半/全角、List 全限定、缺 oldId CLI 提示、RPC catch 收口)= 纯 CLI/cosmetic,本计划不含,留清理。

**2. Placeholder scan**:无 TBD;可测部分(MemoryManager 行为、MemoryPanel 交互)给全代码 + testid;preload/main 桥沿既有无单测层,以 typecheck 兜底(明确标注)。

**3. Type consistency**:`PendingFactView` 8 字段与 Java `PendingFact` / RPC `pendingFactJson` 输出一一对应;`window.wraith.memoryPending*` 签名在 preload 声明/实现/main 通道名/测试 mock 四处一致;`MemoryManager.rejectPending/approvePendingReplacing` 签名不变(仅收紧行为);`isVisibleInProject` 用 `public static`。

## 明确不做(YAGNI)

- 「编辑后批准」(改候选文本再入库):本期只 批准/替换/驳回;要编辑可先驳回再 /save 或后续加。
- 待确认区不做实时轮询/推送刷新(打开面板即拉一次 + 每次动作后刷新);会话边界抽取产生的新候选需重开面板/重新进入可见。
- 侧栏入口红点(N>0)本期不做,留后续。

## ⚠️ 真机联调必读(供最终测试流程)

Phase C 的桌面 UI 要真正看到候选,后端必须是**含 Phase A/B RPC 的新 jar**:dev 下桌面 spawn 的是 `~/.wraith/wraith.jar`(非 target/)。故联调前必须:`mvn -q -DskipTests package` → `cp target/<artifact>.jar ~/.wraith/wraith.jar` → 重启 App(见记忆 desktop_dev_jar_sync_quirk)。否则 `memory.pending*` RPC 会「method not found」。
