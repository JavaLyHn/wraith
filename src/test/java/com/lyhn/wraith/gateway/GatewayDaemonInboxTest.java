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
        assertTrue(f.join().isApproved());
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
