# QQ 待发队列 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `~/.wraith/qq-pending.json` 的 QQ 待发积压(定时结果 + 待审批卡片)在桌面可视化:徽标计数、列表、删单条结果、清空结果;并修正确性问题——审批经桌面响应后,队列中同 approvalId 的过期卡片联动清除。

**Architecture:** Java 侧给 `QqPendingStore` 加 id 与四个查询/删除方法;store 实例从 `QqProvider` 上提到 `GatewayDaemon` 构造并注入(daemon 与 provider 共享同一实例锁);删除经 `RequestInbox` 新请求类型 `qq-pending-clear` 由 daemon 执行(桌面/AppServer 直写 JSON 会与 daemon enqueue 跨进程竞态,读安全写不行)。AppServer 加两个 RPC(`automations.qqPending` 直读 snapshot / `automations.qqPendingClear` 写 inbox)。桌面沿 types→preload→main IPC→renderer 既有桥,面板加徽标 + `QqPendingBlock` 区块。

**Tech Stack:** Java 17/Maven(JUnit5 @TempDir)+ Electron/electron-vite(React/TS,vitest)。

## Global Constraints

- 测试不得写真实 `~/.wraith`:Java 用 `@TempDir`;AppServer 测试沿用 `wraith.automation.dir` 系统属性(见 `AppServerAutomationsTest`)。
- desktop `npx tsc --noEmit`(在 `desktop/` 下 `npm run typecheck`)exit 0;`npm test`(vitest)基线不降。
- Java `mvn -q -DskipTests package` 通过;相关模块测试 `mvn test -DskipTests=false -Dtest=<类名>`(全量测试有 JDK26+Mockito 既有噪声,不作门禁)。
- 密钥不进日志/RPC;RPC 只暴露 taskName + answer 截断预览(≤120 字 + `…`)。
- 审批项**不可手删**(store 层 `removeById` 拒绝;daemon 层防御;UI 不给 ✕)——删了对应 run 永远卡 waiting_approval。
- UI 文案(逐字):按钮「清空结果」;提示条「QQ 仅支持被动回复:给机器人发任意一条消息,以上将自动送达」;徽标「QQ 待发 N」。
- RequestInbox 新类型字符串:`qq-pending-clear`(id=null → clearResults;id=<pendingId> → removeById)。
- push 需用户单独点头。

**并行性:** 组 1 = Task 1→2→3(Java,串行:2/3 消费 1 的新方法);组 2 = Task 4→5(桌面,串行:5 消费 4 的类型/桥)。**组 1 与组 2 可并行**(文件不重叠;RPC 形状已由 spec 锁定)。Task 6 汇合做全量门禁。

---

### Task 1: QqPendingStore 扩展(id + snapshot / removeById / clearResults / removeByApprovalId)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/automation/delivery/QqPendingStore.java`
- Test: `src/test/java/com/lyhn/wraith/automation/delivery/QqPendingStoreTest.java`(追加用例)

**Interfaces:**
- Consumes: 既有 `Pending{taskName,answer,ts,approvalId}`、`enqueue/drainAll/size`、`loadList()/writeAtomic()` 私有工具。
- Produces(Task 2/3 依赖,签名逐字):
  - `Pending.id`(public String,新字段)
  - `public synchronized List<Pending> snapshot()`
  - `public synchronized boolean removeById(String id)`(审批项返回 false 拒删)
  - `public synchronized int clearResults()`(返回清掉的条数)
  - `public synchronized int removeByApprovalId(String approvalId)`(返回清掉的条数)

- [ ] **Step 1: 追加失败测试**(`QqPendingStoreTest.java` 末尾追加,沿用文件既有 `@TempDir Path dir` 风格):

```java
    // ── QQ 待发队列 UI(2026-07-16 spec)新增方法 ──────────────────────────

    private QqPendingStore.Pending pending(String task, String answer, long ts, String approvalId) {
        QqPendingStore.Pending p = new QqPendingStore.Pending();
        p.taskName = task; p.answer = answer; p.ts = ts; p.approvalId = approvalId;
        return p;
    }

    @Test
    void enqueueAssignsIdWhenNull() {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(pending("t", "a", 1L, null));
        QqPendingStore.Pending got = store.snapshot().get(0);
        assertNotNull(got.id, "enqueue 应为 null id 赋 UUID");
        assertFalse(got.id.isBlank());
    }

    @Test
    void enqueueKeepsExistingId() {
        QqPendingStore store = new QqPendingStore(dir);
        QqPendingStore.Pending p = pending("t", "a", 1L, null);
        p.id = "stable-1"; // flush 失败重入队时保持 id 稳定
        store.enqueue(p);
        assertEquals("stable-1", store.snapshot().get(0).id);
    }

    @Test
    void snapshotDoesNotDrain() {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(pending("t1", "a1", 1L, null));
        store.enqueue(pending("t2", "a2", 2L, "ap-1"));
        List<QqPendingStore.Pending> snap = store.snapshot();
        assertEquals(2, snap.size());
        assertEquals(2, store.size(), "snapshot 不得清队");
    }

    @Test
    void removeByIdRemovesResultItem() {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(pending("t1", "a1", 1L, null));
        String id = store.snapshot().get(0).id;
        assertTrue(store.removeById(id));
        assertEquals(0, store.size());
        assertFalse(store.removeById(id), "重复删除应幂等返回 false");
    }

    @Test
    void removeByIdRefusesApprovalItem() {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(pending("t", "需要审批", 1L, "ap-1"));
        String id = store.snapshot().get(0).id;
        assertFalse(store.removeById(id), "审批项不可手删");
        assertEquals(1, store.size());
    }

    @Test
    void clearResultsKeepsApprovalItems() {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(pending("r1", "a", 1L, null));
        store.enqueue(pending("ap", "审批", 2L, "ap-1"));
        store.enqueue(pending("r2", "b", 3L, null));
        assertEquals(2, store.clearResults());
        List<QqPendingStore.Pending> left = store.snapshot();
        assertEquals(1, left.size());
        assertEquals("ap-1", left.get(0).approvalId);
    }

    @Test
    void removeByApprovalIdRemovesMatchingCards() {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(pending("ap", "审批", 1L, "ap-1"));
        store.enqueue(pending("r", "结果", 2L, null));
        assertEquals(1, store.removeByApprovalId("ap-1"));
        assertEquals(0, store.removeByApprovalId("ap-1"), "无匹配返回 0");
        assertEquals(1, store.size());
        assertNull(store.snapshot().get(0).approvalId);
    }

    @Test
    void legacyNullIdItemsToleratedAndClearedByClearResults() {
        // 遗留文件项无 id:snapshot 容忍 null id;removeById(null 目标)删不到;clearResults 能清
        QqPendingStore store = new QqPendingStore(dir);
        QqPendingStore.Pending legacy = pending("old", "旧结果", 1L, null);
        // 绕过 enqueue 的赋 id:直接手写文件(模拟旧版本落盘)
        try {
            java.nio.file.Files.writeString(dir.resolve("qq-pending.json"),
                "{\"pending\":[{\"taskName\":\"old\",\"answer\":\"旧结果\",\"ts\":1,\"approvalId\":null}]}");
        } catch (java.io.IOException e) { throw new java.io.UncheckedIOException(e); }
        assertNull(store.snapshot().get(0).id);
        assertEquals(1, store.clearResults());
        assertEquals(0, store.size());
        // 消除未使用告警
        assertNotNull(legacy);
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=QqPendingStoreTest`
Expected: FAIL(编译错:`snapshot()`/`removeById` 等符号不存在;`p.id` 字段不存在)

- [ ] **Step 3: 最小实现**(`QqPendingStore.java`):

Pending 类加字段(在 `public String taskName;` 之前):

```java
        /** 稳定标识:enqueue 时若为 null 则赋 UUID;flush 失败重入队保持不变。
         *  旧版本落盘的遗留项可能为 null(只能被 clearResults 清除)。 */
        public String id;
```

`enqueue` 改为(赋 id):

```java
    /** Appends {@code p} to the persisted list, assigning a UUID id if absent. */
    public synchronized void enqueue(Pending p) {
        if (p.id == null || p.id.isBlank()) {
            p.id = java.util.UUID.randomUUID().toString();
        }
        List<Pending> list = new ArrayList<>(loadList());
        list.add(p);
        writeAtomic(list);
    }
```

在 `size()` 之后追加四个方法:

```java
    /** 只读副本,不清队(供桌面 automations.qqPending 展示)。 */
    public synchronized List<Pending> snapshot() {
        return List.copyOf(loadList());
    }

    /**
     * 按 id 删除一条<strong>结果项</strong>。审批项(approvalId != null)拒删返回
     * false —— 删了对应 run 会永远卡在 waiting_approval,其唯一出口是批/拒。
     * id 无匹配也返回 false(幂等)。
     */
    public synchronized boolean removeById(String id) {
        if (id == null || id.isBlank()) return false;
        List<Pending> list = new ArrayList<>(loadList());
        for (int i = 0; i < list.size(); i++) {
            Pending p = list.get(i);
            if (id.equals(p.id)) {
                if (p.approvalId != null) return false; // 审批项不可手删
                list.remove(i);
                writeAtomic(list);
                return true;
            }
        }
        return false;
    }

    /** 清空所有结果项(approvalId == null,含遗留 null-id 项);审批项保留。返回清除条数。 */
    public synchronized int clearResults() {
        List<Pending> list = new ArrayList<>(loadList());
        int before = list.size();
        list.removeIf(p -> p.approvalId == null);
        if (list.size() != before) writeAtomic(list);
        return before - list.size();
    }

    /** 审批已定(批/拒)后清除队列中同 approvalId 的待发卡片,防冲刷发已失效键盘。返回清除条数。 */
    public synchronized int removeByApprovalId(String approvalId) {
        if (approvalId == null || approvalId.isBlank()) return 0;
        List<Pending> list = new ArrayList<>(loadList());
        int before = list.size();
        list.removeIf(p -> approvalId.equals(p.approvalId));
        if (list.size() != before) writeAtomic(list);
        return before - list.size();
    }
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `mvn test -DskipTests=false -Dtest=QqPendingStoreTest`
Expected: PASS(既有 + 新增用例全过;既有 `drainAll`/`persistsAcrossInstances` 不得回归)

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/automation/delivery/QqPendingStore.java src/test/java/com/lyhn/wraith/automation/delivery/QqPendingStoreTest.java
git commit -m "feat(automation): QqPendingStore 加 id + snapshot/removeById(拒删审批)/clearResults/removeByApprovalId"
```

---

### Task 2: daemon 接线(store 上提注入 + inbox qq-pending-clear + 审批联动清理)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/gateway/GatewayDaemon.java`(store 构造上提、`buildProviders` 签名、抽出 `handleInboxRequest`、poller 调用)
- Modify: `src/main/java/com/lyhn/wraith/gateway/qq/QqProvider.java:48-68`(生产构造改注入 store)
- Test: `src/test/java/com/lyhn/wraith/gateway/GatewayDaemonInboxTest.java`(新建)
- Modify(如有):调 `buildProviders(`/`new QqProvider(` 生产构造的既有测试(先 `grep -rn "buildProviders(\|new QqProvider(" src/test/java` 查清,按新签名修参数,行为断言不变)

**Interfaces:**
- Consumes(Task 1):`QqPendingStore.removeById(String)→boolean`、`clearResults()→int`、`removeByApprovalId(String)→int`。
- Produces:
  - `GatewayDaemon.handleInboxRequest(RequestInbox.Request r, Scheduler sch, Map<String, CompletableFuture<ApprovalResult>> pendingApprovals, QqPendingStore qqPending)`(static,package-private,供测试)
  - `QqProvider` 生产构造新签名:`QqProvider(WraithConfig.GatewayQqConfig qq, LlmClient client, QqPendingStore qqPending, Map<String, CompletableFuture<ApprovalResult>> pendingApprovals)`(原 `Path wraithDir` 参数移除——它只用于内部 `new QqPendingStore`)
  - `buildProviders` 新签名:`buildProviders(WraithConfig cfg, LlmClient client, QqPendingStore qqPending, Map<String, CompletableFuture<ApprovalResult>> pendingApprovals)`
  - RequestInbox 请求类型 `"qq-pending-clear"`:`Request("qq-pending-clear", pendingIdOrNull, null)`

**为什么上提 store:** daemon 与 QqProvider 必须共享**同一** `QqPendingStore` 实例——它的互斥是实例级 `synchronized`,两个实例各持一把锁对同一文件读改写会竞态。

- [ ] **Step 1: 写失败测试**(`GatewayDaemonInboxTest.java` 新建):

```java
package com.lyhn.wraith.gateway;

import com.lyhn.wraith.automation.RequestInbox;
import com.lyhn.wraith.automation.delivery.QqPendingStore;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * handleInboxRequest 的单元测试。run-now 分支依赖 Scheduler,由既有 poller 行为
 * 测试覆盖(本表不触发它),故 sch 传 null 只测 approval / qq-pending-clear 两分支。
 */
class GatewayDaemonInboxTest {

    @TempDir Path dir;

    private static QqPendingStore.Pending pending(String task, long ts, String approvalId) {
        QqPendingStore.Pending p = new QqPendingStore.Pending();
        p.taskName = task; p.answer = "x"; p.ts = ts; p.approvalId = approvalId;
        return p;
    }

    @Test
    void approvalResponseCompletesFutureAndRemovesPendingCard() {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(pending("ap", 1L, "ap-1"));
        Map<String, CompletableFuture<ApprovalResult>> approvals = new ConcurrentHashMap<>();
        CompletableFuture<ApprovalResult> f = new CompletableFuture<>();
        approvals.put("ap-1", f);

        GatewayDaemon.handleInboxRequest(
                new RequestInbox.Request("approval", "ap-1", "approve"), null, approvals, store);

        assertTrue(f.isDone());
        assertTrue(f.join().approved());
        assertEquals(0, store.size(), "审批已定 → 队列中同 approvalId 卡片应清除");
        assertTrue(approvals.isEmpty());
    }

    @Test
    void approvalResponseWithNoLiveFutureStillCleansCard() {
        // 审批已在别处解决(如 QQ 端点按)或已超时 → future 不在了,但过期卡片仍要清
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(pending("ap", 1L, "ap-2"));
        Map<String, CompletableFuture<ApprovalResult>> approvals = new ConcurrentHashMap<>();

        GatewayDaemon.handleInboxRequest(
                new RequestInbox.Request("approval", "ap-2", "reject"), null, approvals, store);

        assertEquals(0, store.size());
    }

    @Test
    void clearRequestWithoutIdClearsResultsOnly() {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(pending("r1", 1L, null));
        store.enqueue(pending("ap", 2L, "ap-1"));
        store.enqueue(pending("r2", 3L, null));

        GatewayDaemon.handleInboxRequest(
                new RequestInbox.Request("qq-pending-clear", null, null), null, new ConcurrentHashMap<>(), store);

        assertEquals(1, store.size(), "只清结果项,审批项保留");
        assertEquals("ap-1", store.snapshot().get(0).approvalId);
    }

    @Test
    void clearRequestWithIdRemovesSingleResult() {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(pending("r1", 1L, null));
        store.enqueue(pending("r2", 2L, null));
        String id = store.snapshot().get(0).id;

        GatewayDaemon.handleInboxRequest(
                new RequestInbox.Request("qq-pending-clear", id, null), null, new ConcurrentHashMap<>(), store);

        assertEquals(1, store.size());
        assertNotEquals(id, store.snapshot().get(0).id);
    }

    @Test
    void clearRequestTargetingApprovalItemIsRefused() {
        QqPendingStore store = new QqPendingStore(dir);
        store.enqueue(pending("ap", 1L, "ap-1"));
        String id = store.snapshot().get(0).id;

        GatewayDaemon.handleInboxRequest(
                new RequestInbox.Request("qq-pending-clear", id, null), null, new ConcurrentHashMap<>(), store);

        assertEquals(1, store.size(), "store 层拒删审批项(daemon 防御)");
    }

    @Test
    void unknownRequestTypeIsIgnored() {
        QqPendingStore store = new QqPendingStore(dir);
        assertDoesNotThrow(() -> GatewayDaemon.handleInboxRequest(
                new RequestInbox.Request("future-type", "x", null), null, new ConcurrentHashMap<>(), store));
    }
}
```

注:若 `ApprovalResult` 无 `approved()` 访问器,先 `grep -n "approved\|isApproved" src/main/java/com/lyhn/wraith/hitl/ApprovalResult.java` 用真实方法名替换断言。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=GatewayDaemonInboxTest`
Expected: FAIL(编译错:`handleInboxRequest` 不存在)

- [ ] **Step 3: 实现**

3a. `GatewayDaemon.java` 加 import:`com.lyhn.wraith.automation.delivery.QqPendingStore`。

3b. Step 2 区(`AutomationStore store = ...` 之后)加:

```java
        // QQ 待发队列:与 QqProvider 共享同一实例(实例级锁,双实例会对同一文件竞态)
        QqPendingStore qqPending = new QqPendingStore(wraithDir);
```

3c. Step 4 调用改:`List<ImProvider> providers = buildProviders(cfg, client, qqPending, pendingApprovals);`,`buildProviders` 签名同步改(`Path wraithDir` 参数删除,加 `QqPendingStore qqPending`),内部 QQ 分支改:

```java
        if (gw != null && gw.getQq() != null) {
            providers.add(new QqProvider(gw.getQq(), client, qqPending, pendingApprovals));
        }
```

(weixin 分支不用 wraithDir,无需动;若 `buildProviders` 内还有 wraithDir 其他用途,以 grep 为准保留参数并追加 qqPending——预期没有。)

3d. 抽出 handler(类底部,`buildProviders` 之前),poller 循环体改为调用它:

```java
    /**
     * 处理一条 RequestInbox 请求(package-private 供单测;run-now 需要 Scheduler,
     * approval / qq-pending-clear 不需要)。
     */
    static void handleInboxRequest(RequestInbox.Request r,
                                   Scheduler sch,
                                   Map<String, CompletableFuture<ApprovalResult>> pendingApprovals,
                                   QqPendingStore qqPending) {
        switch (r.type()) {
            case "run-now" -> sch.requestRunNow(r.id());
            case "approval" -> {
                CompletableFuture<ApprovalResult> ff = pendingApprovals.remove(r.id());
                if (ff != null) {
                    ff.complete("approve".equals(r.payload())
                            ? ApprovalResult.approve()
                            : ApprovalResult.reject("desktop rejected"));
                }
                // 审批已定 → 清掉队列中同 approvalId 的待发卡片(防冲刷发已失效键盘);
                // future 已不在(QQ 端已批/超时)也要清,故不放 if 内。
                qqPending.removeByApprovalId(r.id());
            }
            case "qq-pending-clear" -> {
                if (r.id() == null || r.id().isBlank()) {
                    qqPending.clearResults();
                } else {
                    qqPending.removeById(r.id()); // 审批项在 store 层拒删(防御)
                }
            }
            default -> { /* 未知类型:忽略,向前兼容 */ }
        }
    }
```

poller 内层 try 改为:

```java
                    try {
                        handleInboxRequest(r, sch, pendingApprovals, qqPending);
                    } catch (Exception e) {
                        System.err.println("[gateway] inbox 处理单条请求失败: " + e.getMessage());
                    }
```

3e. `QqProvider.java` 生产构造:签名改 `(WraithConfig.GatewayQqConfig qq, LlmClient client, QqPendingStore qqPending, Map<String, CompletableFuture<ApprovalResult>> pendingApprovals)`;删 `this.qqPending = new QqPendingStore(wraithDir);` 改 `this.qqPending = qqPending;`;删除不再使用的 `java.nio.file.Path` import。其余(PassiveWindow/adapter/wsLoop)逐字不动。

3f. `grep -rn "buildProviders(\|new QqProvider(" src/test/java` 修既有测试调用点(只改参数装配:自建 `new QqPendingStore(tempDir)` 传入;断言不动)。

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest='GatewayDaemonInboxTest,QqPendingStoreTest,QqProviderTest*,GatewayDaemon*Test'`(以 grep 实际存在的测试类为准)
Expected: PASS;随后 `mvn -q -DskipTests package` exit 0

- [ ] **Step 5: Commit**

```bash
git add -A src/main/java/com/lyhn/wraith/gateway src/test/java/com/lyhn/wraith/gateway
git commit -m "feat(gateway): 待发 store 上提共享 + inbox qq-pending-clear + 审批联动清过期卡片"
```

---

### Task 3: AppServer RPC(automations.qqPending / automations.qqPendingClear)

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(`automations.respondApproval` case 之后、`shutdown` 之前插两个 case)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerQqPendingTest.java`(新建)

**Interfaces:**
- Consumes(Task 1):`QqPendingStore.snapshot()`;既有 `automationRequestsDir()`(尊重 `wraith.automation.dir` 系统属性 → 测试隔离)、`RequestInbox.write(Request)`、`textParam(p, "id")`、`ok(msg)`。
- Produces(Task 4/5 依赖的线上形状,逐字):
  - `automations.qqPending` → `{"items":[{"id"?,"taskName","answerPreview","ts","kind":"result"|"approval","approvalId"?}],"count":N}`(preview ≤120 字,超长加 `…`;遗留 null-id 项省略 `id` 键)
  - `automations.qqPendingClear` params `{id?}` → `{"ok":true}`(写 inbox 即返,最终一致)

- [ ] **Step 1: 写失败测试**(`AppServerQqPendingTest.java` 新建;`run`/`byId` harness 逐字复制自 `AppServerAutomationsTest.java`——该套件的既有惯例是每个测试类自带 harness 副本):

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.automation.delivery.QqPendingStore;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** automations.qqPending / qqPendingClear RPC 测试;harness 复制自 AppServerAutomationsTest。 */
class AppServerQqPendingTest {

    @TempDir Path tempDir;

    @AfterEach
    void clearProperty() { System.clearProperty("wraith.automation.dir"); }

    private List<JsonNode> run(String... requests) throws Exception {
        System.setProperty("wraith.automation.dir", tempDir.toString());
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
            };
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String req : requests) lines.add(req.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(
                new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)),
                out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n"))
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }

    private JsonNode byId(List<JsonNode> replies, int id) {
        return replies.stream().filter(n -> n.path("id").asInt(-1) == id)
                .findFirst().orElseThrow(() -> new AssertionError("no reply for id=" + id));
    }

    @Test
    void qqPendingReturnsSnapshotWithPreview() throws Exception {
        QqPendingStore store = new QqPendingStore(tempDir);
        QqPendingStore.Pending r = new QqPendingStore.Pending();
        r.taskName = "daily"; r.answer = "a".repeat(130); r.ts = 1000L;
        store.enqueue(r);
        QqPendingStore.Pending ap = new QqPendingStore.Pending();
        ap.taskName = "deploy"; ap.answer = "需要审批"; ap.ts = 2000L; ap.approvalId = "ap-1";
        store.enqueue(ap);

        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.qqPending\",\"params\":{}}");
        JsonNode result = byId(replies, 2).path("result");
        assertEquals(2, result.path("count").asInt());
        JsonNode items = result.path("items");
        // 快照顺序 = 入队顺序(排序是渲染层职责,见 Task 5 sortQqPending)
        JsonNode first = items.get(0);
        assertEquals("result", first.path("kind").asText());
        String preview = first.path("answerPreview").asText();
        assertEquals(121, preview.length());
        assertTrue(preview.endsWith("…"));
        assertFalse(first.path("id").asText().isBlank());
        assertEquals(1000L, first.path("ts").asLong());
        JsonNode second = items.get(1);
        assertEquals("approval", second.path("kind").asText());
        assertEquals("ap-1", second.path("approvalId").asText());
    }

    @Test
    void qqPendingEmptyWhenNoFile() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.qqPending\",\"params\":{}}");
        JsonNode result = byId(replies, 2).path("result");
        assertEquals(0, result.path("count").asInt());
        assertTrue(result.path("items").isArray());
        assertEquals(0, result.path("items").size());
    }

    @Test
    void qqPendingClearWritesInboxRequest() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.qqPendingClear\",\"params\":{\"id\":\"some-id\"}}");
        assertTrue(byId(replies, 2).path("result").path("ok").asBoolean());
        Path reqDir = tempDir.resolve("automation-requests");
        List<Path> files;
        try (var s = Files.list(reqDir)) { files = s.filter(p -> p.toString().endsWith(".json")).toList(); }
        assertEquals(1, files.size());
        JsonNode req = JsonRpc.MAPPER.readTree(Files.readAllBytes(files.get(0)));
        assertEquals("qq-pending-clear", req.path("type").asText());
        assertEquals("some-id", req.path("id").asText());
        assertTrue(req.path("payload").isNull());
    }

    @Test
    void qqPendingClearWithoutIdMeansClearResults() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.qqPendingClear\",\"params\":{}}");
        assertTrue(byId(replies, 2).path("result").path("ok").asBoolean());
        Path reqDir = tempDir.resolve("automation-requests");
        List<Path> files;
        try (var s = Files.list(reqDir)) { files = s.filter(p -> p.toString().endsWith(".json")).toList(); }
        assertEquals(1, files.size());
        JsonNode req = JsonRpc.MAPPER.readTree(Files.readAllBytes(files.get(0)));
        assertEquals("qq-pending-clear", req.path("type").asText());
        assertTrue(req.path("id").isNull());
    }
}
```

注:`ok(msg)` 若非 `{"ok":true}` 形状(以 `grep -n "private.*void ok(" AppServer.java` 的真实实现为准),按真实形状调整两处 ok 断言;`run()` 里匿名 `SessionRunner` 只覆写两个方法能编译,是因为其余方法在接口里有默认实现——与 AppServerAutomationsTest 完全一致,如它能编译这里就能。

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn test -DskipTests=false -Dtest=AppServerQqPendingTest`
Expected: FAIL(`method not found: automations.qqPending`)

- [ ] **Step 3: 实现两个 case**(插在 `case "automations.respondApproval"` 块之后):

```java
            case "automations.qqPending" -> {
                // 直读快照:store 原子写(tmp→ATOMIC_MOVE)保证跨进程读到完整旧/新文件;
                // 写操作(删/清)必须经 RequestInbox 由 daemon 在其实例锁内执行。
                java.nio.file.Path wraithDir = automationRequestsDir().getParent();
                com.lyhn.wraith.automation.delivery.QqPendingStore qp =
                        new com.lyhn.wraith.automation.delivery.QqPendingStore(wraithDir);
                List<Map<String, Object>> items = new ArrayList<>();
                for (com.lyhn.wraith.automation.delivery.QqPendingStore.Pending pd : qp.snapshot()) {
                    Map<String, Object> m = new java.util.LinkedHashMap<>();
                    if (pd.id != null) m.put("id", pd.id);
                    m.put("taskName", pd.taskName == null ? "" : pd.taskName);
                    String ans = pd.answer == null ? "" : pd.answer;
                    m.put("answerPreview", ans.length() > 120 ? ans.substring(0, 120) + "…" : ans);
                    m.put("ts", pd.ts);
                    m.put("kind", pd.approvalId != null ? "approval" : "result");
                    if (pd.approvalId != null) m.put("approvalId", pd.approvalId);
                    items.add(m);
                }
                writer.result(msg.id(), Map.of("items", items, "count", items.size()));
            }
            case "automations.qqPendingClear" -> {
                JsonNode p = msg.params();
                String pendingId = textParam(p, "id"); // null → daemon 侧 clearResults
                try {
                    com.lyhn.wraith.automation.RequestInbox inbox =
                            new com.lyhn.wraith.automation.RequestInbox(automationRequestsDir());
                    inbox.write(new com.lyhn.wraith.automation.RequestInbox.Request(
                            "qq-pending-clear", pendingId, null));
                    ok(msg);
                } catch (java.io.IOException e) {
                    writer.error(msg.id(), -32000, "写入 qq-pending-clear 请求失败: " + e.getMessage());
                }
            }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn test -DskipTests=false -Dtest='AppServerQqPendingTest,AppServerAutomationsTest'`
Expected: PASS(邻居测试不回归);`mvn -q -DskipTests package` exit 0

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerQqPendingTest.java
git commit -m "feat(app-server): automations.qqPending 快照读 + qqPendingClear 经 inbox 转 daemon"
```

---

### Task 4: 桌面桥(shared 类型 + preload + main IPC)

**Files:**
- Modify: `desktop/src/shared/types.ts`(`AutomationTask` 接口附近追加)
- Modify: `desktop/src/preload/index.ts`(接口声明区 :67-71 附近 + 实现区 :350 附近,照 `automationsList` 双处范式)
- Modify: `desktop/src/main/index.ts`(`ipcMain.handle('wraith:automationsList', ...)` :899 附近追加两个 handler,client 获取方式逐字照抄邻居)

**Interfaces:**
- Consumes(Task 3 线上形状):`automations.qqPending` / `automations.qqPendingClear`。
- Produces(Task 5 依赖,逐字):
  - `types.ts`:`export interface QqPendingItem { id?: string; taskName: string; answerPreview: string; ts: number; kind: 'result' | 'approval'; approvalId?: string }`
  - `window.wraith.qqPending(): Promise<{ items: QqPendingItem[]; count: number }>`
  - `window.wraith.qqPendingClear(id?: string): Promise<{ ok: boolean }>`
  - IPC channel:`wraith:qqPending` / `wraith:qqPendingClear`

- [ ] **Step 1: types.ts 加接口**(`AutomationTask` 定义块之后):

```ts
/** QQ 待发队列条目(automations.qqPending 线上形状;遗留旧文件项可能无 id)。 */
export interface QqPendingItem {
  id?: string
  taskName: string
  answerPreview: string
  ts: number
  kind: 'result' | 'approval'
  approvalId?: string
}
```

- [ ] **Step 2: preload 声明 + 实现**(两处都在 automations 组末尾追加;import 处把 `QqPendingItem` 加进既有 shared/types import):

声明区:

```ts
  /** QQ 待发队列:快照读 + 删单条结果/清空结果(经 daemon,最终一致) */
  qqPending(): Promise<{ items: QqPendingItem[]; count: number }>
  qqPendingClear(id?: string): Promise<{ ok: boolean }>
```

实现区:

```ts
  qqPending() {
    return ipcRenderer.invoke('wraith:qqPending') as Promise<{ items: QqPendingItem[]; count: number }>
  },
  qqPendingClear(id) {
    return ipcRenderer.invoke('wraith:qqPendingClear', id) as Promise<{ ok: boolean }>
  },
```

- [ ] **Step 3: main IPC handler**(`desktop/src/main/index.ts` 的 `ipcMain.handle('wraith:automationsRuns', ...)` 之后追加;`client` 判空范式与邻居一致):

```ts
ipcMain.handle('wraith:qqPending', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.qqPending', {})
})
ipcMain.handle('wraith:qqPendingClear', async (_e, id?: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.qqPendingClear', id ? { id } : {})
})
```

- [ ] **Step 4: 门禁**

Run: `cd desktop && npm run typecheck && npm test`
Expected: typecheck exit 0;vitest 基线不降(本任务无新测试——纯桥接,无逻辑)

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/preload/index.ts desktop/src/main/index.ts
git commit -m "feat(desktop): qqPending/qqPendingClear 桥(types+preload+IPC→automations.* RPC)"
```

---

### Task 5: 桌面 UI(排序纯函数 + QqPendingBlock 区块 + 面板徽标)

**Files:**
- Create: `desktop/src/renderer/lib/qqPendingView.ts`
- Create: `desktop/src/renderer/components/QqPendingBlock.tsx`
- Modify: `desktop/src/renderer/components/AutomationsPanel.tsx`(state + 拉取 + 徽标 + 区块挂载)
- Test: `desktop/test/qqPendingView.test.ts`(新建)

**Interfaces:**
- Consumes(Task 4):`window.wraith.qqPending()` / `qqPendingClear(id?)`、`QqPendingItem`;复用 `desktop/src/renderer/lib/memoryView.ts` 的 `relativeTime(timestampMs, nowMs)`。
- Produces:`sortQqPending(items: QqPendingItem[]): QqPendingItem[]`(审批置顶,组内 ts 倒序)。

- [ ] **Step 1: 纯函数失败测试**(`desktop/test/qqPendingView.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { sortQqPending } from '../src/renderer/lib/qqPendingView'
import type { QqPendingItem } from '../src/shared/types'

const item = (over: Partial<QqPendingItem>): QqPendingItem => ({
  id: 'x', taskName: 't', answerPreview: 'a', ts: 0, kind: 'result', ...over,
})

describe('sortQqPending', () => {
  it('审批置顶,组内按 ts 倒序', () => {
    const sorted = sortQqPending([
      item({ id: 'r-old', ts: 1 }),
      item({ id: 'ap-old', ts: 2, kind: 'approval', approvalId: 'a1' }),
      item({ id: 'r-new', ts: 9 }),
      item({ id: 'ap-new', ts: 5, kind: 'approval', approvalId: 'a2' }),
    ])
    expect(sorted.map(i => i.id)).toEqual(['ap-new', 'ap-old', 'r-new', 'r-old'])
  })

  it('不改原数组', () => {
    const input = [item({ id: 'b', ts: 1 }), item({ id: 'a', ts: 2 })]
    const copy = [...input]
    sortQqPending(input)
    expect(input).toEqual(copy)
  })

  it('空数组返回空', () => {
    expect(sortQqPending([])).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run test/qqPendingView.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现纯函数**(`desktop/src/renderer/lib/qqPendingView.ts`):

```ts
import type { QqPendingItem } from '../../shared/types'

/** 排序:审批项置顶(⚠️ 阻塞任务执行),组内按 ts 倒序;不改原数组。 */
export function sortQqPending(items: QqPendingItem[]): QqPendingItem[] {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'approval' ? -1 : 1
    return b.ts - a.ts
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run test/qqPendingView.test.ts`
Expected: PASS 3/3

- [ ] **Step 5: QqPendingBlock 组件**(`desktop/src/renderer/components/QqPendingBlock.tsx` 新建;样式 className 以 AutomationsPanel 现用 Tailwind 词汇为基调,实现时对齐邻居风格微调可接受,结构与文案不可变):

```tsx
import { useState } from 'react'
import type { QqPendingItem } from '../../shared/types'
import { relativeTime } from '../lib/memoryView'
import { sortQqPending } from '../lib/qqPendingView'

/** QQ 待发队列区块:审批置顶提示去运行历史处理;结果项可单删;底部清空结果 + 被动回复提示。 */
export default function QqPendingBlock(
  { items, onRemove, onClearResults }:
  { items: QqPendingItem[]; onRemove: (id: string) => void; onClearResults: () => void },
): JSX.Element | null {
  const [clearConfirming, setClearConfirming] = useState(false)
  if (items.length === 0) return null
  const sorted = sortQqPending(items)
  const hasResults = sorted.some(i => i.kind === 'result')
  const now = Date.now()
  return (
    <div data-testid="qq-pending-block" className="mt-3 rounded-lg border border-border p-3">
      <div className="mb-2 text-xs font-medium text-fg">QQ 待发队列({items.length})</div>
      <ul className="space-y-1.5">
        {sorted.map((it, idx) => (
          <li key={it.id ?? `legacy-${idx}`} className="flex items-start gap-2 text-2xs">
            {it.kind === 'approval' ? (
              <>
                <span className="shrink-0">⚠️</span>
                <span className="min-w-0 flex-1 text-warning">
                  <span className="font-medium">{it.taskName}</span> 等待审批 —— 在「运行历史」中同意/拒绝
                </span>
              </>
            ) : (
              <>
                <span className="shrink-0">📋</span>
                <span className="min-w-0 flex-1 truncate text-fg-muted">
                  <span className="font-medium text-fg">{it.taskName}</span> {it.answerPreview}
                </span>
              </>
            )}
            <span className="shrink-0 text-fg-subtle">{relativeTime(it.ts, now)}</span>
            {it.kind === 'result' && it.id && (
              <button data-testid="qq-pending-remove" title="删除这条待发结果"
                onClick={() => onRemove(it.id!)}
                className="shrink-0 text-fg-subtle hover:text-danger">×</button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2 text-2xs text-fg-subtle">
        <span>QQ 仅支持被动回复:给机器人发任意一条消息,以上将自动送达</span>
        {hasResults && (
          clearConfirming ? (
            <span className="shrink-0">
              确认?
              <button data-testid="qq-pending-clear-confirm" className="ml-1 text-danger"
                onClick={() => { setClearConfirming(false); onClearResults() }}>清空</button>
              <button className="ml-1" onClick={() => setClearConfirming(false)}>取消</button>
            </span>
          ) : (
            <button data-testid="qq-pending-clear" className="shrink-0 hover:text-danger"
              onClick={() => setClearConfirming(true)}>清空结果</button>
          )
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: AutomationsPanel 接线。** 在面板中:

6a. state + 拉取(与 `fetchTasks` 并列):

```tsx
  const [qqPending, setQqPending] = useState<QqPendingItem[]>([])
  const fetchQqPending = useCallback(async () => {
    try { const { items } = await window.wraith.qqPending(); setQqPending(items) }
    catch { setQqPending([]) } // 后端断连等:视为无积压,不打扰
  }, [])
```

6b. 既有 mount-useEffect 里 `void fetchTasks()` 后加 `void fetchQqPending()`;`runs-changed` 防抖回调里 `void fetchTasks()` 后同样加 `void fetchQqPending()`(依赖数组补 `fetchQqPending`)。

6c. 动作:

```tsx
  const handleQqRemove = useCallback(async (id: string) => {
    await window.wraith.qqPendingClear(id)
    setTimeout(() => { void fetchQqPending() }, 3500) // daemon poller 2-3s 消费,延后刷一次
  }, [fetchQqPending])
  const handleQqClearResults = useCallback(async () => {
    await window.wraith.qqPendingClear()
    setTimeout(() => { void fetchQqPending() }, 3500)
  }, [fetchQqPending])
```

6d. 徽标:面板标题行(实现时找到渲染「自动化」标题/工具条的 JSX)追加:

```tsx
  {qqPending.length > 0 && (
    <span data-testid="qq-pending-badge"
      className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-2xs text-warning">
      QQ 待发 {qqPending.length}
    </span>
  )}
```

6e. 区块挂载:任务列表/详情区之下(面板主滚动区末尾)加:

```tsx
  <QqPendingBlock items={qqPending} onRemove={id => { void handleQqRemove(id) }}
    onClearResults={() => { void handleQqClearResults() }} />
```

import 补 `QqPendingItem`(shared/types)与 `QqPendingBlock`。

- [ ] **Step 7: 门禁**

Run: `cd desktop && npm run typecheck && npm test`
Expected: typecheck exit 0;vitest 全绿(基线 + 新 3 例)

- [ ] **Step 8: Commit**

```bash
git add desktop/src/renderer/lib/qqPendingView.ts desktop/src/renderer/components/QqPendingBlock.tsx desktop/src/renderer/components/AutomationsPanel.tsx desktop/test/qqPendingView.test.ts
git commit -m "feat(desktop): 自动化面板 QQ 待发队列区块 + 徽标(审批置顶/单删/清空结果)"
```

---

### Task 6: 汇合门禁

**Files:** 无新改动(只跑门禁;发现问题回对应任务修)。

- [ ] **Step 1: Java 全量打包 + 相关测试**

Run: `mvn -q -DskipTests package && mvn test -DskipTests=false -Dtest='QqPendingStoreTest,GatewayDaemonInboxTest,AppServerQqPendingTest,AppServerAutomationsTest,QqDeliveryAdapter*Test'`
Expected: package exit 0;列出测试全 PASS

- [ ] **Step 2: 桌面全量**

Run: `cd desktop && npm run typecheck && npm test`
Expected: typecheck 0;vitest 基线不降

- [ ] **Step 3: 安全扫描(提交已完成,针对整个 feature 范围)**

Run: `git diff <feature-base>..HEAD | grep -iE "api[_-]?key|secret|sk-|Bearer" | grep -v clientSecret`(clientSecret 为既有字段名出现于上下文属正常;不得有新增密钥值)
Expected: 无新增密钥字面量

- [ ] **Step 4: 不 push(等用户点头);向用户提供眼验路径**:重装 jar(`mvn package` + cp `~/.wraith/wraith.jar`)→ 重启 `wraith gateway` 与桌面 dev → 造积压(关 QQ 会话窗口期跑一次任务)→ 面板看徽标/区块 → 删一条/清空 → 给 QQ 机器人发消息验证冲刷。
