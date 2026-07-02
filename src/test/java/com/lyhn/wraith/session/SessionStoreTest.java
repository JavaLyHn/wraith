package com.lyhn.wraith.session;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SessionStoreTest {

    private List<LlmClient.Message> sampleHistory() {
        return List.of(
                LlmClient.Message.system("SYSTEM PROMPT"),
                LlmClient.Message.user("帮我重构 Foo 类"),
                LlmClient.Message.assistant("好的,我来看看"));
    }

    @Test
    void persistsAndResumes(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());

        List<SessionMeta> metas = store.list(10);
        assertEquals(1, metas.size());
        SessionMeta meta = metas.get(0);
        assertEquals("帮我重构 Foo 类", meta.title());
        assertEquals(1, meta.turns());
        assertEquals("deepseek", meta.provider());

        List<LlmClient.Message> restored = store.resume(meta.id());
        assertEquals(2, restored.size()); // system 不持久化
        assertEquals("user", restored.get(0).role());
        assertEquals("帮我重构 Foo 类", restored.get(0).content());
        assertEquals("assistant", restored.get(1).role());
    }

    @Test
    void startNewCreatesSeparateSession(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "p", "m");
        store.persist(sampleHistory());
        store.startNew();
        store.persist(List.of(
                LlmClient.Message.system("s"),
                LlmClient.Message.user("第二个会话")));
        assertEquals(2, store.list(10).size());
    }

    @Test
    void emptyHistoryWritesNothing(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "p", "m");
        store.persist(List.of(LlmClient.Message.system("only system")));
        assertTrue(store.list(10).isEmpty());
    }

    @Test
    void projectsAreIsolated(@TempDir Path home) {
        SessionStore a = SessionStore.open(home, "/proj/a", "p", "m");
        SessionStore b = SessionStore.open(home, "/proj/b", "p", "m");
        a.persist(sampleHistory());
        assertEquals(1, a.list(10).size());
        assertTrue(b.list(10).isEmpty());
    }

    @Test
    void currentIdTracksLazyCreateStartNewAndResume(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "p", "m");
        assertNull(store.currentId()); // id 是懒创建的,首次 persist 前为 null

        store.persist(sampleHistory());
        String first = store.currentId();
        assertEquals(store.list(10).get(0).id(), first);

        store.startNew();
        assertNull(store.currentId()); // 新会话尚未落盘

        store.resume(first);
        assertEquals(first, store.currentId()); // resume 把活跃 id 切回来
    }

    @Test
    void deleteCurrentRemovesFileAndResets(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "p", "m");
        store.persist(sampleHistory());
        assertEquals(1, store.list(10).size());

        store.deleteCurrent();
        assertTrue(store.list(10).isEmpty(), "当前会话文件应被删除");
        assertNull(store.currentId(), "状态应重置为无当前会话");
    }

    @Test
    void deleteCurrentWithoutSessionIsNoop(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "p", "m");
        assertDoesNotThrow(store::deleteCurrent);
        assertNull(store.currentId());
    }

    @Test
    void skipsCorruptLines(@TempDir Path home) throws Exception {
        SessionStore store = SessionStore.open(home, "/proj/a", "p", "m");
        store.persist(sampleHistory());
        SessionMeta meta = store.list(10).get(0);

        Path dir = home.resolve(".wraith").resolve("sessions").resolve(SessionStore.hash("/proj/a"));
        Path file = dir.resolve(meta.id() + ".jsonl");
        Files.writeString(file, "this is not json\n", StandardOpenOption.APPEND);

        List<LlmClient.Message> restored = store.resume(meta.id());
        assertEquals(2, restored.size()); // 垃圾行被跳过
    }
}
