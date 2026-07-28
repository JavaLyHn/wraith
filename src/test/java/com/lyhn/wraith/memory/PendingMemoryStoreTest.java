package com.lyhn.wraith.memory;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PendingMemoryStoreTest {

    private PendingFact fact(String id, String scope, String project) {
        return new PendingFact(id, "事实-" + id, "FACT", scope, null, "sess-1", project, "2026-07-23T00:00:00Z");
    }

    @Test
    void addListGetRemove(@TempDir File dir) {
        PendingMemoryStore store = new PendingMemoryStore(dir);
        store.add(fact("a", "project", "/proj"));
        assertEquals(1, store.list("/proj").size());
        assertTrue(store.get("a").isPresent());
        assertTrue(store.remove("a"));
        assertTrue(store.list("/proj").isEmpty());
        assertFalse(store.remove("a"));
    }

    @Test
    void listFiltersByProjectPlusGlobal(@TempDir File dir) {
        PendingMemoryStore store = new PendingMemoryStore(dir);
        store.add(fact("p1", "project", "/proj"));
        store.add(fact("p2", "project", "/other"));
        store.add(fact("g1", "global", null));
        List<PendingFact> visible = store.list("/proj");
        assertEquals(2, visible.size()); // p1 + g1,不含 /other 的 p2
        assertTrue(visible.stream().anyMatch(f -> f.id().equals("p1")));
        assertTrue(visible.stream().anyMatch(f -> f.id().equals("g1")));
    }

    @Test
    void persistsAcrossReload(@TempDir File dir) {
        new PendingMemoryStore(dir).add(fact("a", "project", "/proj"));
        PendingMemoryStore reloaded = new PendingMemoryStore(dir);
        assertEquals(1, reloaded.list("/proj").size());
    }

    @Test
    void clearRemovesGlobalAndProject(@TempDir File dir) {
        PendingMemoryStore store = new PendingMemoryStore(dir);
        store.add(fact("p1", "project", "/proj"));
        store.add(fact("p2", "project", "/other"));
        store.add(fact("g1", "global", null));
        store.clear("/proj");
        assertTrue(store.list("/proj").isEmpty());          // p1 + g1 清掉
        assertEquals(1, store.list("/other").size());       // /other 的 p2 保留
    }
}
