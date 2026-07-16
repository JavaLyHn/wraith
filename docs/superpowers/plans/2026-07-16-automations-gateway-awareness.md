# 自动化面板网关感知 + QQ 待发投递反馈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让自动化面板如实反映后端实时状态——网关未运行时显式提示并可一键启动、任务卡不再假称"运行中";QQ 待发结果被冲刷后即时消失并提示「已投递」。

**Architecture:** 纯桌面渲染层加"网关状态感知"(复用既有 `gatewayStatus`/`onGatewayEvent`/`gatewayStart` 桥,无新后端管道);flush 反馈走既有 stdout 机读标记范式(gateway 打 `WRAITH_QQ_FLUSHED n` → GatewayManager 解析派 `qq-flushed` 事件 → 面板重拉 + 提示),外加面板打开期 6s 轻轮询兜底。逻辑抽成纯函数单测,组件只渲染。

**Tech Stack:** Java 17/Maven(com.lyhn.wraith)+ Electron/electron-vite(React/TS,vitest)。

## Global Constraints

- 复用既有 gateway 桥(`gatewayStatus()`/`onGatewayEvent()`/`gatewayStart()`,preload:120/123/127),不新增后端管道。
- 一键启动直接 `gatewayStart()`,**绕开 IM 面板的 anyBound gate**(cron 不需 IM;GatewayDaemon 无 provider 也跑 cron)。
- 任务卡标签:`!enabled`→`⏸ 已暂停`;`enabled && running`→`● 运行中`;`enabled && 非running(stopped/starting/error)`→`已启用 · 网关未运行`(不称"运行中")。
- flush 计数语义:实际投递成功数 = drained − 失败重入队;普通项合并成功计 `plain.size()`,每条审批项成功各计 1;空队列返回 0。
- stdout 标记:`WRAITH_QQ_FLUSHED <n>`(与既有 `WRAITH_GATEWAY_STATUS` 同范式,均 `System.out.println` 直出)。
- 6s 轮询只在面板打开时、只刷新不弹提示;「✓ 已投递 N 条到 QQ」提示只由 `qq-flushed` 事件触发。
- 不改 IM 面板 anyBound gate;不改调度器架构;不写真实 `~/.wraith`(Java 用 @TempDir/MockWebServer,前端纯函数无 IO)。
- desktop `npm run typecheck` exit 0;`npm test`(vitest)基线不降;Java `mvn -q -DskipTests package` exit 0 + 相关测试类绿(全量测试有 JDK26+Mockito 既有噪声,不作门禁)。
- push 需用户单独点头。

**并行性:** Task 1(桌面纯函数)、Task 2→3(Java 链)、Task 4(shared 类型 + gatewayManager)彼此文件不重叠,可并行。Task 5(AutomationsPanel 接线)依赖 Task 1 的纯函数 + Task 4 的 `qq-flushed` 事件类型,须在其后。Task 6 汇合。为避免 git 提交竞态,建议串行提交。

---

### Task 1: gatewayGate.ts 纯函数(taskStatusLabel + gatewayPillView)

**Files:**
- Create: `desktop/src/renderer/lib/gatewayGate.ts`
- Test: `desktop/test/gatewayGate.test.ts`

**Interfaces:**
- Consumes: `GatewayState`、`GatewayStatus`(`desktop/src/shared/gateway.ts`,`GatewayState = 'stopped'|'starting'|'running'|'error'`;`GatewayStatus = { state: GatewayState; message?: string }`)。
- Produces(Task 5 依赖,逐字):
  - `taskStatusLabel(enabled: boolean, gatewayState: GatewayState): string`
  - `gatewayPillView(status: GatewayStatus): GatewayPillView`,`interface GatewayPillView { text: string; tone: 'ok'|'warn'|'err'|'muted'; action: 'start'|'retry'|null; hint?: string }`

- [ ] **Step 1: 写失败测试**(`desktop/test/gatewayGate.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { taskStatusLabel, gatewayPillView } from '../src/renderer/lib/gatewayGate'
import type { GatewayState } from '../src/shared/gateway'

describe('taskStatusLabel', () => {
  it('未启用 → 已暂停(与网关态无关)', () => {
    for (const s of ['stopped', 'starting', 'running', 'error'] as GatewayState[]) {
      expect(taskStatusLabel(false, s)).toBe('⏸ 已暂停')
    }
  })
  it('启用 + 网关运行中 → 运行中', () => {
    expect(taskStatusLabel(true, 'running')).toBe('● 运行中')
  })
  it('启用 + 网关非运行 → 已启用·网关未运行', () => {
    for (const s of ['stopped', 'starting', 'error'] as GatewayState[]) {
      expect(taskStatusLabel(true, s)).toBe('已启用 · 网关未运行')
    }
  })
})

describe('gatewayPillView', () => {
  it('running → ok 无按钮', () => {
    expect(gatewayPillView({ state: 'running' })).toEqual({ text: '网关运行中', tone: 'ok', action: null })
  })
  it('starting → muted 无按钮', () => {
    expect(gatewayPillView({ state: 'starting' })).toEqual({ text: '网关启动中…', tone: 'muted', action: null })
  })
  it('stopped → warn + start + hint', () => {
    const v = gatewayPillView({ state: 'stopped' })
    expect(v.tone).toBe('warn'); expect(v.action).toBe('start')
    expect(v.text).toBe('网关未运行'); expect(v.hint).toBe('启动后会连上已绑定的 QQ/飞书/微信')
  })
  it('error → err + retry + 带 message 摘要 + hint', () => {
    const v = gatewayPillView({ state: 'error', message: '认证失败' })
    expect(v.tone).toBe('err'); expect(v.action).toBe('retry')
    expect(v.text).toBe('网关异常 · 认证失败'); expect(v.hint).toBe('启动后会连上已绑定的 QQ/飞书/微信')
  })
  it('error 无 message → 只显示网关异常', () => {
    expect(gatewayPillView({ state: 'error' }).text).toBe('网关异常')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/gatewayGate.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现**(`desktop/src/renderer/lib/gatewayGate.ts`):

```ts
import type { GatewayState, GatewayStatus } from '../../shared/gateway'

/** 任务副标签:网关没跑时不称"运行中"(避免误导:调度器在网关里,网关没跑任务不执行)。 */
export function taskStatusLabel(enabled: boolean, gatewayState: GatewayState): string {
  if (!enabled) return '⏸ 已暂停'
  return gatewayState === 'running' ? '● 运行中' : '已启用 · 网关未运行'
}

export interface GatewayPillView {
  text: string
  tone: 'ok' | 'warn' | 'err' | 'muted'
  action: 'start' | 'retry' | null
  hint?: string
}

const CONNECT_HINT = '启动后会连上已绑定的 QQ/飞书/微信'

/** 头部胶囊视图:按网关四态给文案/色调/动作。stopped/error 才带启动/重试与副作用提示。 */
export function gatewayPillView(status: GatewayStatus): GatewayPillView {
  switch (status.state) {
    case 'running':
      return { text: '网关运行中', tone: 'ok', action: null }
    case 'starting':
      return { text: '网关启动中…', tone: 'muted', action: null }
    case 'error':
      return {
        text: '网关异常' + (status.message ? ' · ' + status.message : ''),
        tone: 'err', action: 'retry', hint: CONNECT_HINT,
      }
    case 'stopped':
    default:
      return { text: '网关未运行', tone: 'warn', action: 'start', hint: CONNECT_HINT }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/gatewayGate.test.ts`
Expected: PASS(全部用例)

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/lib/gatewayGate.ts desktop/test/gatewayGate.test.ts
git commit -m "feat(desktop): gatewayGate 纯函数 taskStatusLabel + gatewayPillView(+单测)"
```

---

### Task 2: QqDeliveryAdapter.flush 返回 int(实际投递数)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/automation/delivery/QqDeliveryAdapter.java`(方法 `flush`,约 :107-151;javadoc/`@return` 同步改)
- Test: `src/test/java/com/lyhn/wraith/automation/delivery/QqDeliveryAdapterTest.java`、`src/test/java/com/lyhn/wraith/automation/delivery/QqDeliveryAdapterApprovalFlushTest.java`(改断言:digest 字符串 → 计数)

**Interfaces:**
- Produces(Task 3 依赖):`public int flush(String freshMsgId)` —— 返回本次实际投递成功的条目数(见下)。
- Consumes:既有 `pending.drainAll()`、`api.sendC2C`、`api.sendC2CWithKeyboard`、`coalesce(...)`、`QqApproval.keyboardJson(...)`。

- [ ] **Step 1: 先改测试断言(TDD:先让它们表达新契约)。** 打开两个测试文件,按下述逐条改(仅改断言,MockWebServer 请求验证保留):

`QqDeliveryAdapterTest.java`:
- Case 3 `flush_coalescesIntroOnePost_pendingDrained`(约 :172-177):把
  ```java
  String digest = adapter.flush("FLUSH_MSG_ID");
  assertNotNull(digest, "flush should return the digest string");
  assertTrue(digest.contains("task-alpha"), ...);
  assertTrue(digest.contains("task-beta"), ...);
  assertTrue(digest.contains("2"), ...);
  ```
  改为
  ```java
  int delivered = adapter.flush("FLUSH_MSG_ID");
  assertEquals(2, delivered, "flush should report 2 delivered (coalesced plain)");
  ```
  (task-alpha/task-beta 的内容验证已由下方 POST body 断言 :188-189 覆盖,不丢覆盖。)
- Case 4 `flush_sendFailure_reEnqueuesItems_returnsNull`(约 :207-234):方法名改为 `flush_sendFailure_reEnqueuesItems_returnsZero`;把
  ```java
  String result = adapter.flush("FAIL_MSG_ID");
  assertNull(result, "flush should return null when send fails");
  ```
  改为
  ```java
  int delivered = adapter.flush("FAIL_MSG_ID");
  assertEquals(0, delivered, "flush should report 0 delivered when send fails");
  ```
  (re-enqueue 断言 :234 不动。)

`QqDeliveryAdapterApprovalFlushTest.java`:
- `flush_approvalItem_sendsKeyboardMessage`(约 :95):`adapter.flush("FRESH_MSG_ID");` 改为 `assertEquals(1, adapter.flush("FRESH_MSG_ID"), "one approval delivered");`(其余断言不动)。
- `flush_mixedItems_sendsKeyboardPlusCoalesced`(约 :139-143):把
  ```java
  String digest = adapter.flush("FRESH_MIXED");
  assertNotNull(digest, "flush must return digest for plain items");
  assertTrue(digest.contains("task-plain"), ...);
  ```
  改为
  ```java
  int delivered = adapter.flush("FRESH_MIXED");
  assertEquals(2, delivered, "1 approval + 1 plain delivered");
  ```
  (task-plain 内容由后续请求 body 断言覆盖;若该测试原本仅靠 digest 验 task-plain,则在取到的 plain 请求 body 上补一条 `assertTrue(body.contains("task-plain"))`。)
- `flush_approvalSendFailure_reEnqueues`(约 :194-197):方法名改 `..._returnsZero` 可选;把
  ```java
  String result = adapter.flush("FAIL_MSG_ID");
  assertNull(result, "flush should return null when no plain items");
  ```
  改为
  ```java
  int delivered = adapter.flush("FAIL_MSG_ID");
  assertEquals(0, delivered, "approval send failed, nothing delivered");
  ```
  (re-enqueue 与 approvalId 断言 :198-201 不动。)
- `flush_onlyPlainItems_coalescesBehaviorUnchanged`(约 :221-224):把
  ```java
  String digest = adapter.flush("PLAIN_FLUSH_ID");
  assertNotNull(digest, "plain flush must return digest");
  assertTrue(digest.contains("alpha"), ...);
  assertTrue(digest.contains("beta"), ...);
  ```
  改为
  ```java
  int delivered = adapter.flush("PLAIN_FLUSH_ID");
  assertEquals(2, delivered, "2 plain items delivered (coalesced)");
  ```
  (alpha/beta 内容:在取到的请求 body 上断言 `assertTrue(body.contains("alpha") && body.contains("beta"))`,把内容验证从 digest 迁到 body;msg_type:0 断言 :230 不动。)

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest='QqDeliveryAdapterTest,QqDeliveryAdapterApprovalFlushTest'`
Expected: FAIL(编译错:`flush` 仍返回 `String`,`int delivered = adapter.flush(...)` 类型不符)

- [ ] **Step 3: 实现**——把 `QqDeliveryAdapter.flush` 整体替换为(返回 int;javadoc 的 `@return` 改为"实际投递成功的条目数"):

```java
    public int flush(String freshMsgId) {
        List<QqPendingStore.Pending> ps = pending.drainAll();
        if (ps.isEmpty()) {
            return 0;
        }

        // Partition into plain deliveries and approval-pending items
        List<QqPendingStore.Pending> plain = new ArrayList<>();
        List<QqPendingStore.Pending> approvals = new ArrayList<>();
        for (QqPendingStore.Pending p : ps) {
            if (p.approvalId != null) {
                approvals.add(p);
            } else {
                plain.add(p);
            }
        }

        int delivered = 0;

        // Send each approval item as its own keyboard message
        for (QqPendingStore.Pending ap : approvals) {
            try {
                api.sendC2CWithKeyboard(ownerOpenid,
                        "⚠️ 定时任务需审批(点按钮同意/拒绝):",
                        freshMsgId,
                        QqApproval.keyboardJson(ap.approvalId));
                delivered++;
            } catch (IOException e) {
                // Re-enqueue on failure so it is retried on the next inbound DM
                pending.enqueue(ap);
                log.warn("QqDeliveryAdapter: flush 审批消息发送失败,已重新入队 approvalId={}", ap.approvalId, e);
            }
        }

        // Coalesce and send plain delivery items
        if (!plain.isEmpty()) {
            String digest = coalesce(plain);
            try {
                api.sendC2C(ownerOpenid, digest, freshMsgId);
                delivered += plain.size();
            } catch (IOException e) {
                for (QqPendingStore.Pending p : plain) pending.enqueue(p);
                log.warn("QqDeliveryAdapter: flush 发送失败,已重新入队 {} 条待发", plain.size(), e);
            }
        }

        return delivered;
    }
```

同时把方法上方 javadoc 里 `@return the coalesced digest string ... or {@code null}` 一行改为 `@return the number of pending items successfully delivered this flush (0 if nothing pending or all sends failed)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest='QqDeliveryAdapterTest,QqDeliveryAdapterApprovalFlushTest'`
Expected: PASS(两类全绿);随后 `mvn -q -DskipTests package` exit 0

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/automation/delivery/QqDeliveryAdapter.java src/test/java/com/lyhn/wraith/automation/delivery/QqDeliveryAdapterTest.java src/test/java/com/lyhn/wraith/automation/delivery/QqDeliveryAdapterApprovalFlushTest.java
git commit -m "feat(automation): QqDeliveryAdapter.flush 返回实际投递数(String→int)"
```

---

### Task 3: QqProvider flush 后打 stdout 标记

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/gateway/qq/QqProvider.java:102`(inbound handler 里的 flush 调用)

**Interfaces:**
- Consumes(Task 2):`qqDeliverRef.flush(String) → int`。
- Produces(Task 4 运行期解析):stdout 行 `WRAITH_QQ_FLUSHED <n>`(n>0 时)。

- [ ] **Step 1: 改代码。** 当前 `QqProvider.java:102` 为:

```java
                        qqDeliverRef.flush(inbound.msgId());
```

改为:

```java
                        int flushed = qqDeliverRef.flush(inbound.msgId());
                        if (flushed > 0) {
                            // 同 WRAITH_GATEWAY_STATUS(:130)机读标记范式:桌面 GatewayManager 解析 → 待发即时刷新 + 提示。
                            System.out.println("WRAITH_QQ_FLUSHED " + flushed);
                        }
```

- [ ] **Step 2: 编译校验(无独立单测——单行 stdout 标记由 Task 4 的解析测试 + 眼验覆盖)**

Run: `mvn -q -DskipTests package`
Expected: exit 0(BUILD SUCCESS)

- [ ] **Step 3: 快速自检**:`grep -n "WRAITH_QQ_FLUSHED" src/main/java/com/lyhn/wraith/gateway/qq/QqProvider.java` 应见新增 println;`QqProviderTest` 若涉及 inbound 回路,`mvn test -DskipTests=false -Dtest=QqProviderTest` 应仍绿。

- [ ] **Step 4: Commit**

```bash
git add src/main/java/com/lyhn/wraith/gateway/qq/QqProvider.java
git commit -m "feat(gateway): QQ flush 后打 WRAITH_QQ_FLUSHED stdout 标记(桌面即时反馈)"
```

---

### Task 4: gateway 事件类型 + gatewayManager 解析派发

**Files:**
- Modify: `desktop/src/shared/gateway.ts`(`GatewayEvent` 联合增一支)
- Modify: `desktop/src/main/gatewayManager.ts`(导出 `parseQqFlushedLine` + stdout 处理派 `qq-flushed`,约 :204-208)
- Test: `desktop/test/gatewayManager.test.ts`(追加 `parseQqFlushedLine` 用例)

**Interfaces:**
- Produces(Task 5 依赖):
  - `GatewayEvent` 增 `| { kind: 'qq-flushed'; count: number }`
  - `export function parseQqFlushedLine(line: string): number | null`
- Consumes:既有 `classifyGatewayStatusLine`(:109)、`this.onEvent(...)`(:173)、stdout `createInterface`(:204)。

- [ ] **Step 1: 写失败测试**(追加到 `desktop/test/gatewayManager.test.ts` 末尾;import 处补 `parseQqFlushedLine`):

```ts
import { parseQqFlushedLine } from '../src/main/gatewayManager'

describe('parseQqFlushedLine', () => {
  it('合法标记 → 计数', () => {
    expect(parseQqFlushedLine('WRAITH_QQ_FLUSHED 3')).toBe(3)
    expect(parseQqFlushedLine('WRAITH_QQ_FLUSHED 1')).toBe(1)
  })
  it('容忍前缀(与 classifyGatewayStatusLine 一致)', () => {
    expect(parseQqFlushedLine('12:00:00 INFO WRAITH_QQ_FLUSHED 2')).toBe(2)
  })
  it('非标记行 → null', () => {
    expect(parseQqFlushedLine('some log line')).toBeNull()
    expect(parseQqFlushedLine('WRAITH_GATEWAY_STATUS connected')).toBeNull()
  })
  it('计数缺失/非数字 → null', () => {
    expect(parseQqFlushedLine('WRAITH_QQ_FLUSHED')).toBeNull()
    expect(parseQqFlushedLine('WRAITH_QQ_FLUSHED x')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/gatewayManager.test.ts`
Expected: FAIL(`parseQqFlushedLine` 未导出)

- [ ] **Step 3a: 扩事件类型**(`desktop/src/shared/gateway.ts`,`GatewayEvent` 联合末尾追加):

```ts
  | { kind: 'qq-flushed'; count: number }
```

- [ ] **Step 3b: 加解析纯函数**(`desktop/src/main/gatewayManager.ts`,在 `classifyGatewayStatusLine`(:109)之后):

```ts
/**
 * 解析 daemon stdout 上的 QQ 冲刷标记:`WRAITH_QQ_FLUSHED <n>`。
 * 命中且 n 为非负整数 → 返回 n;否则 null。容忍标记前有 logback 前缀(同 classifyGatewayStatusLine)。
 */
export function parseQqFlushedLine(line: string): number | null {
  const m = line.match(/WRAITH_QQ_FLUSHED\s+(\d+)/)
  if (!m) return null
  const n = Number.parseInt(m[1]!, 10)
  return Number.isNaN(n) ? null : n
}
```

- [ ] **Step 3c: stdout 处理派事件**——在 gatewayManager stdout 的 `createInterface({ input: proc.stdout }).on('line', (l) => { ... })`(:204-208)块内,`this.pushLog(l)` 之后、状态解析旁,追加:

```ts
      const flushed = parseQqFlushedLine(l)
      if (flushed !== null && this.daemon === proc && !this.stopping) {
        this.onEvent({ kind: 'qq-flushed', count: flushed })
      }
```

(保持既有 `classifyGatewayStatusLine` 分支不变;两者互不影响——一行至多命中一个。)

- [ ] **Step 4: 跑测试确认通过 + typecheck**

Run: `cd desktop && npx vitest run test/gatewayManager.test.ts && npm run typecheck`
Expected: PASS + typecheck exit 0

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/gateway.ts desktop/src/main/gatewayManager.ts desktop/test/gatewayManager.test.ts
git commit -m "feat(desktop): GatewayEvent 增 qq-flushed + gatewayManager 解析 WRAITH_QQ_FLUSHED 标记"
```

---

### Task 5: AutomationsPanel 接线(胶囊 + 标签 + qq-flushed + 6s 轮询)

**Files:**
- Modify: `desktop/src/renderer/components/AutomationsPanel.tsx`

**Interfaces:**
- Consumes:`taskStatusLabel`/`gatewayPillView`(Task 1)、`GatewayStatus`/`GatewayEvent`(Task 4)、既有 `window.wraith.gatewayStatus()`/`onGatewayEvent()`/`gatewayStart()`/`qqPending()`。

- [ ] **Step 1: imports + state。** 顶部 import 增:

```tsx
import { taskStatusLabel, gatewayPillView } from '../lib/gatewayGate'
import type { GatewayStatus } from '../../shared/gateway'
```

在组件内(现有 `const [qqPending, ...]` 附近,约 :25)增:

```tsx
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>({ state: 'stopped' })
  const [flushToast, setFlushToast] = useState<number | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

- [ ] **Step 2: 网关状态 + qq-flushed + 6s 轮询 的 useEffect。** 在现有 mount useEffect(:36-53)之后新增一个独立 effect:

```tsx
  // 网关状态感知 + QQ flush 即时反馈 + 轻轮询兜底
  useEffect(() => {
    void window.wraith.gatewayStatus().then(setGatewayStatus).catch(() => { /* 断连:保持 stopped */ })
    const unsub = window.wraith.onGatewayEvent(evt => {
      if (evt.kind === 'status') {
        setGatewayStatus(evt.status)
      } else if (evt.kind === 'qq-flushed') {
        void fetchQqPending()
        setFlushToast(evt.count)
        if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current)
        flushTimerRef.current = setTimeout(() => setFlushToast(null), 3000)
      }
    })
    // 兜底:面板打开期每 6s 拉一次(覆盖终端起的网关/漏标记;只刷新不弹提示)
    const poll = setInterval(() => { void fetchQqPending() }, 6000)
    return () => {
      unsub()
      clearInterval(poll)
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current)
    }
  }, [fetchQqPending])
```

- [ ] **Step 3: 算胶囊视图。** 在 `const current = ...`(:62)之后增:

```tsx
  const pill = gatewayPillView(gatewayStatus)
  const pillToneCls = { ok: 'text-success', warn: 'text-warning', err: 'text-danger', muted: 'text-fg-subtle' }[pill.tone]
  const pillGlyph = { ok: '● ', warn: '⚠ ', err: '✕ ', muted: '' }[pill.tone]
```

- [ ] **Step 4: 头部胶囊。** 头部行(:116-121 的 QQ 待发 badge 之后、:122 的 `</div>` 之前)追加:

```tsx
        <span className="ml-auto flex items-center gap-1.5 text-2xs">
          <span data-testid="gateway-pill" className={pillToneCls} title={pill.hint}>{pillGlyph}{pill.text}</span>
          {pill.action && (
            <button data-testid="gateway-pill-action" onClick={() => void window.wraith.gatewayStart()}
              className="rounded bg-accent px-2 py-0.5 text-white">
              {pill.action === 'start' ? '启动网关' : '重试'}
            </button>
          )}
        </span>
```

- [ ] **Step 5: flush 瞬态提示条。** 在头部 `</div>`(:122)之后、`<div className="flex min-h-0 flex-1 panel-content">`(:123)之前插入:

```tsx
      {flushToast !== null && (
        <div data-testid="qq-flush-toast"
          className="border-b border-border bg-success/10 px-4 py-1.5 text-2xs text-success">
          ✓ 已投递 {flushToast} 条到 QQ
        </div>
      )}
```

- [ ] **Step 6: 任务卡标签 gateway-aware。** 把 :138-140 的按钮改为:

```tsx
                <button data-testid="automation-toggle" title={t.enabled ? '点击暂停' : '点击启用'}
                  onClick={() => void handleToggle(t)}
                  className={'shrink-0 rounded px-1.5 py-1 text-3xs whitespace-nowrap ' +
                    (t.enabled
                      ? (gatewayStatus.state === 'running' ? 'text-success hover:bg-surface/60' : 'text-fg-muted hover:bg-surface/60')
                      : 'text-fg-subtle hover:bg-surface/60')}>
                  {taskStatusLabel(t.enabled, gatewayStatus.state)}
                </button>
```

- [ ] **Step 7: typecheck + 全量 vitest**

Run: `cd desktop && npm run typecheck && npm test`
Expected: typecheck exit 0;vitest 全绿(基线 + Task1/Task4 新增用例;本任务无新测试——纯接线)

- [ ] **Step 8: Commit**

```bash
git add desktop/src/renderer/components/AutomationsPanel.tsx
git commit -m "feat(desktop): 自动化面板网关状态胶囊 + gateway-aware 任务标签 + QQ flush 即时反馈/轮询"
```

---

### Task 6: 汇合门禁

**Files:** 无新改动(只跑门禁;问题回对应任务修)。

- [ ] **Step 1: Java 全量打包 + 相关测试**

Run: `mvn -q -DskipTests package && mvn test -DskipTests=false -Dtest='QqDeliveryAdapterTest,QqDeliveryAdapterApprovalFlushTest,QqProviderTest'`
Expected: package exit 0;列出测试全 PASS

- [ ] **Step 2: 桌面全量**

Run: `cd desktop && npm run typecheck && npm test`
Expected: typecheck 0;vitest 基线不降(新增 gatewayGate + parseQqFlushedLine 用例通过)

- [ ] **Step 3: 安全扫描(整特性范围)**

Run: `git diff <feature-base>..HEAD | grep -E '^\+' | grep -iE "sk-[a-zA-Z0-9]{10}|Bearer [a-zA-Z0-9]"`
Expected: 无输出(无新增密钥字面量)

- [ ] **Step 4: 不 push(等用户点头);眼验路径**:重装 jar(`mvn package` + cp `~/.wraith/wraith.jar`)→ 重启 `wraith gateway`(或桌面「IM 网关」→启动)与桌面 dev → 自动化面板:网关停时头部「⚠ 网关未运行 · 启动网关」+ 任务卡「已启用 · 网关未运行」;点启动 → 变「● 网关运行中」+ 任务卡「● 运行中」;给 QQ bot 发消息 → 待发条目消失 + 顶部弹「✓ 已投递 N 条到 QQ」。

## Self-Review

**Spec 覆盖:** Part A(胶囊 Task1+Task5、任务标签 Task1+Task5)✓;Part B(flush→int Task2、stdout 标记 Task3、事件类型+解析 Task4、面板刷新+提示+轮询 Task5)✓;测试(纯函数 Task1/Task4、Java flush Task2)✓;不改 IM 面板/调度器 ✓。无遗漏。

**占位符扫描:** 无 TBD/TODO;每步含完整代码或精确断言替换。Task2 的测试改动因依赖既有测试体,已逐方法给出"从→到"的精确断言与行号锚点(非"类似 Task N")。

**类型一致:** `taskStatusLabel(enabled, gatewayState)`、`gatewayPillView(status)` 在 Task1 定义、Task5 调用一致;`GatewayPillView.tone` 四值与 Task5 的 `pillToneCls`/`pillGlyph` 映射键一致;`GatewayEvent` 的 `qq-flushed{count}` 在 Task4 定义、Task5 消费一致;`flush → int` 在 Task2 产出、Task3 消费一致;stdout 标记字符串 `WRAITH_QQ_FLUSHED` 在 Task3(打)与 Task4(解析正则)一致。
