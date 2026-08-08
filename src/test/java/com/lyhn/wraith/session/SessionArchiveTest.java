package com.lyhn.wraith.session;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 归档落盘/读取的向后兼容与语义测试(Task 1 起步用)。
 *
 * <p>核心断言:未归档会话的 {@code archivedAt} 必须是 {@code null}(不是空串、不是 "null")。
 * 这同时验证了向后兼容——老会话文件里根本没有这个 key,读出来自然是 null。
 */
class SessionArchiveTest {

    private List<LlmClient.Message> sampleHistory() {
        return List.of(
                LlmClient.Message.system("SYSTEM PROMPT"),
                LlmClient.Message.user("帮我看看登录"),
                LlmClient.Message.assistant("好的"));
    }

    @Test
    void metaWithoutArchivedAtKeyReadsAsNull(@TempDir Path home) {
        // 模拟老会话:persist 一次(新代码 archivedAt=null 时不写这个 key),再读回
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());

        List<SessionMeta> metas = store.list(10);
        assertEquals(1, metas.size());
        assertNull(metas.get(0).archivedAt(), "未归档会话的 archivedAt 必须是 null,不能是空串");
    }

    @Test
    void archivedSessionLeavesListAndEntersListArchived(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());
        String id = store.list(10).get(0).id();

        assertTrue(store.setArchived(id, true));

        assertEquals(0, store.list(10).size(), "归档后不该再进主列表");
        List<SessionMeta> archived = store.listArchived(10);
        assertEquals(1, archived.size());
        assertNotNull(archived.get(0).archivedAt(), "归档条目必须有 archivedAt");
        assertEquals(id, archived.get(0).id());
    }

    @Test
    void unarchiveRestoresToList(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());
        String id = store.list(10).get(0).id();
        store.setArchived(id, true);

        assertTrue(store.setArchived(id, false));

        assertEquals(1, store.list(10).size());
        assertNull(store.list(10).get(0).archivedAt());
        assertEquals(0, store.listArchived(10).size());
    }

    @Test
    void archivedSessionStillResumableAndPeekable(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());
        String id = store.list(10).get(0).id();
        store.setArchived(id, true);

        assertEquals(2, store.peek(id).size(), "归档只影响列表,不影响按 id 读");
        assertEquals(2, store.resume(id).size());
    }

    @Test
    void archivingPreservesStarredAndName(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());
        String id = store.list(10).get(0).id();
        store.setStarred(id, true);
        store.rename(id, "登录排查");

        store.setArchived(id, true);

        SessionMeta m = store.listArchived(10).get(0);
        assertTrue(m.starred(), "归档不该抹掉重点标记");
        assertEquals("登录排查", m.name(), "归档不该抹掉自定义名");
    }

    @Test
    void setArchivedOnMissingIdReturnsFalse(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        assertFalse(store.setArchived("20260101-000000-dead", true));
    }

    @Test
    void projectWithAllSessionsArchivedListsEmpty(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());
        String id = store.list(10).get(0).id();
        store.setArchived(id, true);

        // 钉住 spec §3.2 那一行:全归档的项目 list() 为空 → switchToProject 的自动恢复
        // 不进 resume 分支 → 落到一个干净的新会话。这是正确行为,不需要特判。
        assertEquals(0, store.list(10).size());
        assertEquals(1, store.listArchived(10).size());
    }

    @Test
    void archiveAllIsIdempotent(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.persist(sampleHistory());
        store.startNew();
        store.persist(List.of(
                LlmClient.Message.system("S"),
                LlmClient.Message.user("第二个会话")));

        assertEquals(2, store.archiveAll());
        assertEquals(0, store.list(10).size());
        assertEquals(2, store.listArchived(10).size());
        assertEquals(0, store.archiveAll(), "已全部归档时再调必须回 0");
    }
}
