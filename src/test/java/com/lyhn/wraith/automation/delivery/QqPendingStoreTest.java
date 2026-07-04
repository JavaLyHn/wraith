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
}
