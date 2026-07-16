package com.lyhn.wraith.automation.delivery;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class QqPendingStoreTest {

    @TempDir Path dir;

    @Test
    void drainAllOnEmptyReturnsEmptyList() {
        QqPendingStore store = new QqPendingStore(dir);
        List<QqPendingStore.Pending> result = store.drainAll();
        assertTrue(result.isEmpty(), "drainAll() on empty store should return empty list");
        assertEquals(0, store.size());
    }

    @Test
    void enqueueThenDrainAllReturnsItemsAndClears() {
        QqPendingStore store = new QqPendingStore(dir);
        QqPendingStore.Pending p1 = new QqPendingStore.Pending();
        p1.taskName = "task1";
        p1.answer = "Hello World";
        p1.ts = 1000L;

        QqPendingStore.Pending p2 = new QqPendingStore.Pending();
        p2.taskName = "task2";
        p2.answer = "Scheduled result";
        p2.ts = 2000L;

        store.enqueue(p1);
        store.enqueue(p2);
        assertEquals(2, store.size());

        List<QqPendingStore.Pending> drained = store.drainAll();
        assertEquals(2, drained.size());
        assertEquals("task1", drained.get(0).taskName);
        assertEquals("Hello World", drained.get(0).answer);
        assertEquals(1000L, drained.get(0).ts);
        assertEquals("task2", drained.get(1).taskName);

        // After drain: store should be empty
        assertEquals(0, store.size());
        assertTrue(store.drainAll().isEmpty(), "Second drainAll() should be empty after first drain");
    }

    @Test
    void persistsAcrossInstances() {
        // Enqueue via first instance
        QqPendingStore store1 = new QqPendingStore(dir);
        QqPendingStore.Pending p = new QqPendingStore.Pending();
        p.taskName = "persisted-task";
        p.answer = "Persisted answer";
        p.ts = 9999L;
        store1.enqueue(p);

        // Fresh instance on same dir should see enqueued item
        QqPendingStore store2 = new QqPendingStore(dir);
        assertEquals(1, store2.size());

        List<QqPendingStore.Pending> drained = store2.drainAll();
        assertEquals(1, drained.size());
        assertEquals("persisted-task", drained.get(0).taskName);
        assertEquals("Persisted answer", drained.get(0).answer);
        assertEquals(9999L, drained.get(0).ts);

        // store2 is now empty; store1 (same file) also reads empty on next size() call
        assertEquals(0, store2.size());
    }

    @Test
    void drainAllPersistsClearSoFreshInstanceSeesEmpty() {
        QqPendingStore store = new QqPendingStore(dir);
        QqPendingStore.Pending p = new QqPendingStore.Pending();
        p.taskName = "t"; p.answer = "a"; p.ts = 1L;
        store.enqueue(p);

        store.drainAll(); // clears persisted file

        // A fresh instance on the same dir should see nothing
        QqPendingStore fresh = new QqPendingStore(dir);
        assertEquals(0, fresh.size());
        assertTrue(fresh.drainAll().isEmpty());
    }

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
}
