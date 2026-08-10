# 桌面端交互式选择器管道实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让桌面端 AI 调用 `present_options` 时弹出可点击的选择器弹窗，选择结果回传后端继续 ReAct 循环。

**Architecture:** 镜像现有 approval 管道（后端 `EventStreamRenderer.promptChoice` 阻塞 + `CompletableFuture` + `choice.requested` 事件；`AppServer.choice.respond` RPC 路由；前端 `ChoiceModal` 组件 + IPC + state）。交互方式：点击为主 + 键盘辅助（↑↓ 移动高亮、Enter 确认、ESC 取消）。

**Tech Stack:** Java 21（后端），TypeScript + React + shadcn Dialog（前端），JSON-RPC over stdio（IPC）

## Global Constraints

- 后端镜像 `promptApproval` 管道范式（EventStreamRenderer.java:227-247, AppServer.java:1449-1468）
- 前端镜像 `respondApproval` IPC 链路（preload/index.ts:261-263, main/index.ts:805-821）
- `choice.requested` 不进 transcript（与 approval.requested 一致，临时 modal 状态）
- `ChoiceResult` 用 `.isCancelled()` 不是 `.cancelled()`（Task 1 偏差）
- shadcn Dialog 组件复用现有 `./ui/dialog`（与 ApprovalModal 一致）
- openPalette 的 `-1` 覆写删除，让 default 委托 promptChoice（桌面端 `/resume`/`/config` 也走新弹窗）
- 前端测试用 vitest（`npx vitest run`），后端测试用 maven（`mvn test -Dtest=Xxx -DskipTests=false`）
- 全量回归预存在失败 8F+3E 是 Windows 平台问题（policy/sandbox/tool/util），不算回归

---

### Task 1: 后端 EventStreamRenderer.promptChoice 实现

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java`
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamRendererChoiceTest.java`（新增）

**Interfaces:**
- Consumes: `ChoiceRequest`, `ChoiceOption`, `ChoiceResult` from `com.lyhn.wraith.render`（已在 main）
- Produces: `EventStreamRenderer.promptChoice(ChoiceRequest)`, `EventStreamRenderer.resolveChoice(String, ChoiceResult)`, 删除 `openPalette` 覆写

- [ ] **Step 1: Write the failing test**

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class EventStreamRendererChoiceTest {

    private final ObjectMapper mapper = new ObjectMapper();

    /** JsonRpcWriter 需要一个 PrintStream 构造,但 promptChoice 的测试只验证 notify 发出的事件内容,
     *  不需要真正读 stdout。用 ByteArrayOutputStream 捕获即可。 */
    private EventStreamRenderer newRenderer() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        JsonRpcWriter writer = new JsonRpcWriter(new PrintStream(baos, true));
        return new EventStreamRenderer(writer, "test-session");
    }

    @Test
    void promptChoice_emitsChoiceRequestedEvent_withCorrectPayload() throws Exception {
        EventStreamRenderer renderer = newRenderer();
        List<ChoiceOption> opts = List.of(
                new ChoiceOption("方案A", "描述A"),
                new ChoiceOption("方案B", null)
        );
        ChoiceRequest req = new ChoiceRequest("选择", opts, true, "请选择");

        // 在另一个线程 resolve,模拟前端回传
        Thread resolver = new Thread(() -> {
            try { Thread.sleep(50); } catch (InterruptedException ignored) {}
            renderer.resolveChoice("choice_1", ChoiceResult.selected(1));
        });
        resolver.start();

        ChoiceResult result = renderer.promptChoice(req);

        assertFalse(result.isCancelled());
        assertEquals(1, result.selectedIndex());
    }

    @Test
    void promptChoice_returnsCancelledWhenResolvedCancelled() throws Exception {
        EventStreamRenderer renderer = newRenderer();
        ChoiceRequest req = new ChoiceRequest("选择",
                List.of(new ChoiceOption("A", null), new ChoiceOption("B", null)), true, null);

        Thread resolver = new Thread(() -> {
            try { Thread.sleep(50); } catch (InterruptedException ignored) {}
            renderer.resolveChoice("choice_1", ChoiceResult.cancelled());
        });
        resolver.start();

        ChoiceResult result = renderer.promptChoice(req);
        assertTrue(result.isCancelled());
    }

    @Test
    void promptChoice_returnsCancelledForEmptyOptions() {
        EventStreamRenderer renderer = newRenderer();
        ChoiceRequest req = new ChoiceRequest("空", List.of(), true, null);
        ChoiceResult result = renderer.promptChoice(req);
        assertTrue(result.isCancelled());
    }

    @Test
    void resolveChoice_unknownIdIsIgnored() {
        EventStreamRenderer renderer = newRenderer();
        // 不应抛异常
        renderer.resolveChoice("nonexistent", ChoiceResult.selected(0));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn test -Dtest=EventStreamRendererChoiceTest -DskipTests=false -Dsurefire.failIfNoTests=false`
Expected: FAIL — `promptChoice` method not found on EventStreamRenderer（走 default stub 返回 cancelled，不会发事件也不会被 resolveChoice 唤醒 → 第一个测试超时或失败）

- [ ] **Step 3: Implement promptChoice + resolveChoice in EventStreamRenderer**

在 EventStreamRenderer.java 中：

1. 顶部新增 import：
```java
import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
```

2. 在 `pendingReviews` 字段声明后（第 41 行附近）新增 choice 管道字段：
```java
// 交互式选择器管道（镜像 approval 管道,独立字段避免干扰）
private final java.util.concurrent.atomic.AtomicLong choiceSeq = new java.util.concurrent.atomic.AtomicLong();
private final Map<String, java.util.concurrent.CompletableFuture<ChoiceResult>> pendingChoices =
        new java.util.concurrent.ConcurrentHashMap<>();
```

3. **删除**第 225 行的 openPalette 覆写：
```java
@Override public int openPalette(String title, List<String> items) { return -1; } // v1 不暴露
```
（删除整行，让 default 委托 promptChoice）

4. 在 `resolvePlanReview` 方法后新增 promptChoice + resolveChoice：
```java
// ---- 交互式选择器阻塞管道（镜像 promptApproval）----

@Override public ChoiceResult promptChoice(ChoiceRequest request) {
    if (request == null || request.options() == null || request.options().isEmpty()) {
        return ChoiceResult.cancelled();
    }
    String choiceId = "choice_" + choiceSeq.incrementAndGet();
    java.util.concurrent.CompletableFuture<ChoiceResult> fut = new java.util.concurrent.CompletableFuture<>();
    pendingChoices.put(choiceId, fut);
    Map<String, Object> p = base();
    p.put("choiceId", choiceId);
    p.put("title", request.title() == null ? "请选择" : request.title());
    java.util.List<Map<String, Object>> opts = new java.util.ArrayList<>();
    for (ChoiceOption opt : request.options()) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("label", opt.label());
        o.put("description", opt.description());
        opts.add(o);
    }
    p.put("options", opts);
    p.put("allowCancel", request.allowCancel());
    p.put("hint", request.hint());
    writer.notify("choice.requested", p);
    try {
        return fut.get();
    } catch (Exception e) {
        return ChoiceResult.cancelled();
    } finally {
        pendingChoices.remove(choiceId);
    }
}

/** AppServer 收到 choice.respond 时调用;未知 choiceId 幂等忽略。 */
public void resolveChoice(String choiceId, ChoiceResult result) {
    java.util.concurrent.CompletableFuture<ChoiceResult> fut = pendingChoices.get(choiceId);
    if (fut != null) fut.complete(result);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mvn test -Dtest=EventStreamRendererChoiceTest -DskipTests=false -Dsurefire.failIfNoTests=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/EventStreamRenderer.java src/test/java/com/lyhn/wraith/runtime/appserver/EventStreamRendererChoiceTest.java
git commit -m "feat: EventStreamRenderer 实现 promptChoice 阻塞管道 + choice.requested 事件"
```

---

### Task 2: 后端 AppServer.choice.respond RPC 路由

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`
- Test: 扩展 `EventStreamRendererChoiceTest`（已存在）或新增 `AppServerChoiceRespondTest.java`

**Interfaces:**
- Consumes: `EventStreamRenderer.resolveChoice` from Task 1
- Produces: `AppServer` 处理 `choice.respond` RPC

- [ ] **Step 1: Write the failing test**

新增 `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerChoiceRespondTest.java`：

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.render.ChoiceOption;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class AppServerChoiceRespondTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void choiceRespond_resolvesPendingChoice() throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        JsonRpcWriter writer = new JsonRpcWriter(new PrintStream(baos, true));
        EventStreamRenderer renderer = new EventStreamRenderer(writer, "test-session");

        // 启动 promptChoice 阻塞
        List<ChoiceOption> opts = List.of(new ChoiceOption("A", null), new ChoiceOption("B", null));
        ChoiceRequest req = new ChoiceRequest("选", opts, true, null);
        var future = java.util.concurrent.CompletableFuture.supplyAsync(() -> renderer.promptChoice(req));

        // 等待 choice.requested 事件发出,拿到 choiceId
        Thread.sleep(100);
        String output = baos.toString();
        JsonNode notify = mapper.readTree(output.lines().findFirst().orElse("{}"));
        String choiceId = notify.path("params").path("choiceId").asText("");
        assertFalse(choiceId.isBlank(), "应有 choiceId");

        // 模拟 AppServer.handleChoiceRespond 的核心逻辑(直接调 resolveChoice)
        renderer.resolveChoice(choiceId, ChoiceResult.selected(0));

        ChoiceResult result = future.get(2, TimeUnit.SECONDS);
        assertFalse(result.isCancelled());
        assertEquals(0, result.selectedIndex());
    }

    @Test
    void choiceRespond_cancelledResultPropagates() throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        JsonRpcWriter writer = new JsonRpcWriter(new PrintStream(baos, true));
        EventStreamRenderer renderer = new EventStreamRenderer(writer, "test-session");

        List<ChoiceOption> opts = List.of(new ChoiceOption("A", null), new ChoiceOption("B", null));
        ChoiceRequest req = new ChoiceRequest("选", opts, true, null);
        var future = java.util.concurrent.CompletableFuture.supplyAsync(() -> renderer.promptChoice(req));

        Thread.sleep(100);
        String output = baos.toString();
        JsonNode notify = mapper.readTree(output.lines().findFirst().orElse("{}"));
        String choiceId = notify.path("params").path("choiceId").asText("");

        renderer.resolveChoice(choiceId, ChoiceResult.cancelled());

        ChoiceResult result = future.get(2, TimeUnit.SECONDS);
        assertTrue(result.isCancelled());
    }
}
```

注：这两个测试验证 resolveChoice 的端到端行为。AppServer.handleChoiceRespond 的 RPC 路由本身是薄包装（解析参数 + 调 resolveChoice），其单测需要完整 AppServer fixture（SessionStore 等），成本高于价值——靠集成路径覆盖。

- [ ] **Step 2: Run test to verify it fails**

Run: `mvn test -Dtest=AppServerChoiceRespondTest -DskipTests=false -Dsurefire.failIfNoTests=false`
Expected: 这两个测试其实会通过（因为 Task 1 已实现 resolveChoice）——它们是验证 Task 1 的端到端路径。如果 Task 1 正确，这里 PASS。如果 Task 1 有问题，FAIL。

（此 Task 的核心是 AppServer.java 的路由改动，Step 3 是关键）

- [ ] **Step 3: Add choice.respond route to AppServer**

在 AppServer.java 第 465 行 `case "plan.review.respond" -> handlePlanReviewRespond(msg);` 后新增：

```java
case "choice.respond" -> handleChoiceRespond(msg);
```

在 `handlePlanReviewRespond` 方法后（第 1480 行附近）新增：

```java
/** 处理前端的交互式选择器响应（镜像 handleApprovalRespond）。 */
private void handleChoiceRespond(JsonRpc.Incoming msg) {
    if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
    JsonNode p = msg.params();
    if (p == null) { writer.error(msg.id(), -32602, "missing params"); return; }
    String choiceId = p.path("choiceId").asText("");
    if (choiceId.isBlank()) { writer.error(msg.id(), -32602, "缺 choiceId"); return; }
    boolean cancelled = p.path("cancelled").asBoolean(false);
    int selectedIndex = p.path("selectedIndex").asInt(-1);
    ChoiceResult result = cancelled ? ChoiceResult.cancelled() : ChoiceResult.selected(selectedIndex);
    session.renderer().resolveChoice(choiceId, result);
    writer.result(msg.id(), java.util.Map.of("ok", true));
}
```

顶部新增 import：
```java
import com.lyhn.wraith.render.ChoiceResult;
```

- [ ] **Step 4: Run all choice tests + AppServer regression**

Run: `mvn test -Dtest=EventStreamRendererChoiceTest,AppServerChoiceRespondTest,AppServerTest -DskipTests=false -Dsurefire.failIfNoTests=false`
Expected: PASS（AppServerTest 是既有测试，确认无回归）

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerChoiceRespondTest.java
git commit -m "feat: AppServer 新增 choice.respond RPC 路由"
```

---

### Task 3: 前端类型 + IPC 桥 + main handler

**Files:**
- Modify: `desktop/src/shared/types.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/main/index.ts`

**Interfaces:**
- Consumes: 后端 `choice.requested` 事件（params: choiceId/title/options/allowCancel/hint）、`choice.respond` RPC
- Produces: `PendingChoice`/`ChoiceOption` 类型、`window.wraith.respondChoice` IPC

- [ ] **Step 1: Add types to shared/types.ts**

在文件中（approval 相关类型附近）新增：

```typescript
export interface ChoiceOption {
  label: string
  description: string | null
}
export interface PendingChoice {
  choiceId: string
  title: string
  options: ChoiceOption[]
  allowCancel: boolean
  hint: string | null
}
```

- [ ] **Step 2: Add IPC bridge to preload/index.ts**

1. 在 WraithApi 接口中（`respondApproval` 声明附近，第 28-32 行）新增：
```typescript
respondChoice(choiceId: string, cancelled: boolean, selectedIndex: number): Promise<void>
```

2. 在 `api` 对象实现中（`respondApproval` 实现附近，第 261-263 行）新增：
```typescript
respondChoice(choiceId, cancelled, selectedIndex) {
  return ipcRenderer.invoke('wraith:respondChoice', choiceId, cancelled, selectedIndex)
},
```

- [ ] **Step 3: Add IPC handler to main/index.ts**

在 `wraith:respondApproval` handler 后（第 821 行后）新增：

```typescript
ipcMain.handle(
  'wraith:respondChoice',
  async (_e, choiceId: string, cancelled: boolean, selectedIndex: number) => {
    if (!client) throw new Error('Backend not connected')
    await client.request('choice.respond', { choiceId, cancelled, selectedIndex })
  }
)
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: PASS（无类型错误）

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat: 前端 choice 管道 IPC 桥 + 类型定义"
```

---

### Task 4: 前端 transcriptReducer 处理 choice.requested

**Files:**
- Modify: `desktop/src/shared/transcriptReducer.ts`

**Interfaces:**
- Consumes: `PendingChoice` from Task 3
- Produces: `pendingChoice` state 字段、`clearChoice` action、`choice.requested` reducer case

- [ ] **Step 1: Add pendingChoice to TranscriptState + initialState**

在 `TranscriptState` 接口中（`pendingApproval` 字段后，第 172 行附近）新增：
```typescript
pendingChoice: PendingChoice | null
```

在 `initialState` 中（`pendingApproval: null,` 后，第 208 行附近）新增：
```typescript
pendingChoice: null,
```

顶部新增 import（如果还没有）：
```typescript
import type { PendingChoice } from './types'
```

- [ ] **Step 2: Add choice.requested reducer case**

在 `approval.requested` case 后（第 478 行附近）新增：

```typescript
// ── choice（交互式选择器,与 approval 一样是临时 modal 不进 transcript）──
case 'choice.requested': {
  const choiceId = typeof p['choiceId'] === 'string' ? p['choiceId'] : ''
  if (!choiceId) return state
  const title = typeof p['title'] === 'string' ? p['title'] : '请选择'
  const rawOptions = Array.isArray(p['options']) ? p['options'] : []
  const options: ChoiceOption[] = rawOptions.map((o: any) => ({
    label: typeof o?.label === 'string' ? o.label : '',
    description: o?.description == null ? null : String(o.description),
  }))
  const allowCancel = p['allowCancel'] === true
  const hint = typeof p['hint'] === 'string' ? p['hint'] : null
  return {
    ...state,
    pendingChoice: { choiceId, title, options, allowCancel, hint },
  }
}
```

顶部新增 import：
```typescript
import type { ChoiceOption } from './types'
```

- [ ] **Step 3: Add clearChoice helper**

在 `clearApproval` 函数后（第 823 行附近）新增：

```typescript
/** Clear a pending choice (call after the UI sends the respond RPC). */
export function clearChoice(state: TranscriptState): TranscriptState {
  return { ...state, pendingChoice: null }
}
```

- [ ] **Step 4: Handle resetSession + resume clear**

在 `resetSession` 和 `resumeSession` 相关的 state 重置处（搜索 `pendingApproval: null` 出现的其它位置，如第 879 行的 reducer return），同步加 `pendingChoice: null`。

用 Grep 找所有 `pendingApproval: null` 出现位置，逐一加 `pendingChoice: null`。

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/src/shared/transcriptReducer.ts
git commit -m "feat: transcriptReducer 处理 choice.requested 事件 + clearChoice"
```

---

### Task 5: 前端 ChoiceModal 组件

**Files:**
- Create: `desktop/src/renderer/components/ChoiceModal.tsx`
- Test: `desktop/test/ChoiceModal.test.tsx`

**Interfaces:**
- Consumes: `PendingChoice` from Task 3
- Produces: `ChoiceModal` 组件,props: choiceId/title/options/allowCancel/hint/onRespond/onReject

- [ ] **Step 1: Write the failing test**

```tsx
// desktop/test/ChoiceModal.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ChoiceModal from '../src/renderer/components/ChoiceModal'
import type { ChoiceOption } from '../src/shared/types'

const options: ChoiceOption[] = [
  { label: '方案A', description: '描述A' },
  { label: '方案B', description: null },
  { label: '方案C', description: '描述C' },
]

describe('ChoiceModal', () => {
  it('renders title and all options with descriptions', () => {
    render(
      <ChoiceModal
        title="选择方案"
        options={options}
        allowCancel={true}
        hint={null}
        onRespond={vi.fn()}
        onReject={vi.fn()}
      />
    )
    expect(screen.getByText('选择方案')).toBeTruthy()
    expect(screen.getByText('方案A')).toBeTruthy()
    expect(screen.getByText('描述A')).toBeTruthy()
    expect(screen.getByText('方案B')).toBeTruthy()
    expect(screen.getByText('方案C')).toBeTruthy()
    expect(screen.getByText('描述C')).toBeTruthy()
  })

  it('clicking an option calls onRespond with that index', () => {
    const onRespond = vi.fn()
    render(
      <ChoiceModal
        title="选"
        options={options}
        allowCancel={true}
        hint={null}
        onRespond={onRespond}
        onReject={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('方案B'))
    expect(onRespond).toHaveBeenCalledWith(1)
  })

  it('arrow down moves highlight, Enter confirms highlighted', () => {
    const onRespond = vi.fn()
    render(
      <ChoiceModal
        title="选"
        options={options}
        allowCancel={true}
        hint={null}
        onRespond={onRespond}
        onReject={vi.fn()}
      />
    )
    // 默认高亮第 0 项,按一次下 → 高亮第 1 项,Enter 确认
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith(1)
  })

  it('arrow up wraps to last item', () => {
    const onRespond = vi.fn()
    render(
      <ChoiceModal
        title="选"
        options={options}
        allowCancel={true}
        hint={null}
        onRespond={onRespond}
        onReject={vi.fn()}
      />
    )
    // 默认高亮第 0 项,按上 → 循环到最后一项(index 2),Enter 确认
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith(2)
  })

  it('ESC calls onReject when allowCancel=true', () => {
    const onReject = vi.fn()
    render(
      <ChoiceModal
        title="选"
        options={options}
        allowCancel={true}
        hint={null}
        onRespond={vi.fn()}
        onReject={onReject}
      />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onReject).toHaveBeenCalled()
  })

  it('ESC does nothing when allowCancel=false', () => {
    const onReject = vi.fn()
    render(
      <ChoiceModal
        title="选"
        options={options}
        allowCancel={false}
        hint={null}
        onRespond={vi.fn()}
        onReject={onReject}
      />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onReject).not.toHaveBeenCalled()
  })

  it('shows hint when provided', () => {
    render(
      <ChoiceModal
        title="选"
        options={options}
        allowCancel={true}
        hint="自定义提示"
        onRespond={vi.fn()}
        onReject={vi.fn()}
      />
    )
    expect(screen.getByText('自定义提示')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run ChoiceModal`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ChoiceModal**

```tsx
// desktop/src/renderer/components/ChoiceModal.tsx
import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import type { ChoiceOption } from '../../shared/types'

interface ChoiceModalProps {
  title: string
  options: ChoiceOption[]
  allowCancel: boolean
  hint: string | null
  onRespond: (selectedIndex: number) => void
  onReject: () => void
}

export default function ChoiceModal({
  title,
  options,
  allowCancel,
  hint,
  onRespond,
  onReject,
}: ChoiceModalProps): JSX.Element {
  const [highlighted, setHighlighted] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted(h => (h + 1) % options.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted(h => (h - 1 + options.length) % options.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onRespond(highlighted)
      } else if (e.key === 'Escape' && allowCancel) {
        e.preventDefault()
        onReject()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [options.length, highlighted, allowCancel, onRespond, onReject])

  const defaultHint = allowCancel
    ? '↑↓ 选择  Enter 确认  ESC 取消  或点击'
    : '↑↓ 选择  Enter 确认  或点击'

  return (
    <Dialog open onOpenChange={(open) => { if (!open && allowCancel) onReject() }}>
      <DialogContent className="max-w-md" onPointerDownOutside={(e) => { if (!allowCancel) e.preventDefault() }}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{hint ?? defaultHint}</DialogDescription>
        <div className="flex flex-col gap-1 mt-2">
          {options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onRespond(i)}
              className={`text-left px-3 py-2 rounded-md border transition-colors ${
                i === highlighted
                  ? 'border-accent bg-accent/10 ring-1 ring-accent'
                  : 'border-border hover:bg-muted'
              }`}
            >
              <div className="font-medium">{opt.label}</div>
              {opt.description && (
                <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
              )}
            </button>
          ))}
        </div>
        {allowCancel && (
          <div className="flex justify-end mt-3">
            <button
              type="button"
              onClick={onReject}
              className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              取消
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

注意：
- `Dialog open` 让组件受控打开（mount 即开）
- `onPointerDownOutside` 在 allowCancel=false 时阻止点遮罩关闭
- 键盘事件挂在 window 上（与 App.tsx 的 ESC 处理范式一致）
- 高亮用 ring + bg 突出

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run ChoiceModal`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/components/ChoiceModal.tsx desktop/test/ChoiceModal.test.tsx
git commit -m "feat: ChoiceModal 组件（点击为主 + 键盘辅助）"
```

---

### Task 6: 前端 App.tsx 接入 ChoiceModal

**Files:**
- Modify: `desktop/src/renderer/App.tsx`

**Interfaces:**
- Consumes: `ChoiceModal` from Task 5, `pendingChoice` state from Task 4, `respondChoice` IPC from Task 3
- Produces: ChoiceModal 渲染 + choice 回传 handler

- [ ] **Step 1: Add LocalAction types**

在 LocalAction union（第 87 行附近）新增：
```typescript
| { type: 'clearChoice' }
```

- [ ] **Step 2: Handle clearChoice in dispatch**

在 `if ('type' in action && action.type === 'clearApproval')` 附近（搜索 clearApproval 的处理）新增：
```typescript
if ('type' in action && action.type === 'clearChoice') {
  return clearChoice(state)
}
```

顶部 import `clearChoice`：
```typescript
import { clearChoice, ... } from '../shared/transcriptReducer'
```
（在现有 import 列表中加 clearChoice）

- [ ] **Step 3: Add choice respond/reject handlers**

在 `handleReject`（第 662-669 行）后新增：

```typescript
// ── choice handlers ───────────────────────────────────────────────────────
const handleChoiceRespond = useCallback(
  async (selectedIndex: number) => {
    if (!state.pendingChoice) return
    try {
      await window.wraith.respondChoice(state.pendingChoice.choiceId, false, selectedIndex)
    } finally {
      dispatch({ type: 'clearChoice' })
    }
  },
  [state.pendingChoice]
)

const handleChoiceReject = useCallback(async () => {
  if (!state.pendingChoice) return
  try {
    await window.wraith.respondChoice(state.pendingChoice.choiceId, true, -1)
  } finally {
    dispatch({ type: 'clearChoice' })
  }
}, [state.pendingChoice])
```

- [ ] **Step 4: Render ChoiceModal**

在 ApprovalModal 渲染块后（第 1380 行附近）新增：

```tsx
{state.pendingChoice && (
  <ChoiceModal
    key={state.pendingChoice.choiceId}
    title={state.pendingChoice.title}
    options={state.pendingChoice.options}
    allowCancel={state.pendingChoice.allowCancel}
    hint={state.pendingChoice.hint}
    onRespond={handleChoiceRespond}
    onReject={handleChoiceReject}
  />
)}
```

顶部 import：
```typescript
import ChoiceModal from './components/ChoiceModal'
```

- [ ] **Step 5: Update ESC global handler to not interrupt when choice pending**

找到第 716-723 行的 ESC 全局快捷键（中断 turn）：
```typescript
if (state.turn !== 'running' || state.pendingApproval || automationApproval) return
```
改为：
```typescript
if (state.turn !== 'running' || state.pendingApproval || state.pendingChoice || automationApproval) return
```

并在依赖数组加 `state.pendingChoice`。

- [ ] **Step 6: Verify TypeScript compiles + run frontend tests**

Run: `cd desktop && npx tsc --noEmit && npx vitest run`
Expected: PASS（无类型错误，现有测试不回归）

- [ ] **Step 7: Commit**

```bash
git add desktop/src/renderer/App.tsx
git commit -m "feat: App.tsx 接入 ChoiceModal + choice 回传 handler"
```

---

### Task 7: E2E mock + 全量回归

**Files:**
- Modify: `desktop/test/fixtures/mock-appserver.mjs`

**Interfaces:**
- Consumes: `choice.respond` RPC from Task 2

- [ ] **Step 1: Add choice.respond to mock-appserver**

读 `desktop/test/fixtures/mock-appserver.mjs`，找到 `approval.respond` 的 mock 实现，在附近新增 `choice.respond`：

```javascript
if (method === 'choice.respond') {
  // mock 直接返回 ok,不真正解析(测试场景不需要真实回传)
  return { ok: true }
}
```

如果 mock 有发 `choice.requested` 事件的测试场景,也一并补上（看现有 approval.requested mock 怎么发）。

- [ ] **Step 2: Run full frontend test suite**

Run: `cd desktop && npx vitest run`
Expected: PASS（所有测试通过,无回归）

- [ ] **Step 3: Run full backend test suite**

Run: `mvn test -DskipTests=false -Dsurefire.failIfNoTests=false`
Expected: 8F+3E 预存在 Windows 平台问题,无新增失败

- [ ] **Step 4: Commit**

```bash
git add desktop/test/fixtures/mock-appserver.mjs
git commit -m "test: E2E mock 补 choice.respond 响应"
```

---

### Task 8: 手动集成验证

**Files:** 无代码改动

- [ ] **Step 1: Build + run desktop**

```bash
cd desktop && npm run build
# 或 wraith -d 启动开发模式
```

- [ ] **Step 2: 验证 present_options**

在桌面端聊天中让 AI 给出多个方案（如"帮我设计一个个人网站,给几个方案"），确认：
1. AI 调用 present_options → ChoiceModal 弹出
2. 选项 label + description 正确显示
3. 鼠标点击选项 → 弹窗关闭 → AI 收到选中 label 继续
4. 方向键 ↑↓ 移动高亮,Enter 确认
5. ESC 取消（allowCancel=true 时）→ AI 收到 __cancelled__ 回退
6. allowCancel=false 时 ESC 无效

- [ ] **Step 3: 验证 HITL 审批不受影响**

触发一个需要审批的操作（如 execute_command）,确认 ApprovalModal 仍正常弹出,与 ChoiceModal 不互相干扰。

- [ ] **Step 4: 验证 /resume 续接会话**

`/resume` 列出会话时（如果走 openPalette），确认 ChoiceModal 弹出会话列表可点击选择。

注：如果 `/resume` 在桌面端不走 openPalette（可能走自己的 UI），则跳过此步。

---

## Self-Review

### Spec coverage
- ✅ 后端 EventStreamRenderer.promptChoice → Task 1
- ✅ 后端 AppServer.choice.respond 路由 → Task 2
- ✅ 前端类型 + IPC 桥 + main handler → Task 3
- ✅ 前端 transcriptReducer → Task 4
- ✅ 前端 ChoiceModal 组件 → Task 5
- ✅ 前端 App.tsx 接入 → Task 6
- ✅ E2E mock → Task 7
- ✅ 手动集成验证 → Task 8
- ✅ openPalette 移除覆写 → Task 1 Step 3
- ✅ choice.requested 不进 transcript → Task 4（只更新 pendingChoice state）

### Placeholder scan
- 无 TBD/TODO
- 每个步骤都有具体代码
- 测试代码完整

### Type consistency
- `ChoiceResult.isCancelled()` 在后端测试和实现中一致
- `PendingChoice` / `ChoiceOption` 在 types.ts、transcriptReducer、ChoiceModal、App.tsx 中签名一致
- `respondChoice(choiceId, cancelled, selectedIndex)` 在 preload、main、App.tsx 中签名一致
- `onRespond(selectedIndex)` / `onReject()` 在 ChoiceModal props 和 App.tsx handler 中一致
