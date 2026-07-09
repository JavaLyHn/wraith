package com.lyhn.wraith.session;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * beginTurn: 轮次开始即为"新会话"落最小桩(仅用户消息),使其立刻出现在会话列表；
 * 续接会话不重写(不覆盖历史)；末尾 persist(完整历史) 以同 id 覆写桩。
 */
class SessionStoreBeginTurnTest {

    @Test
    void beginTurnPersistsStubForNewConversationAndListsImmediately(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/begin", "p", "m");
        assertNull(store.currentId(), "全新会话开始前无 currentId");

        String id = store.beginTurn("你好世界");
        assertNotNull(id, "新会话 beginTurn 应分配 id");
        assertEquals(id, store.currentId());

        // 立刻可在列表查到(turn 未结束),标题取用户输入
        List<SessionMeta> list = store.list(50);
        assertEquals(1, list.size(), "桩应立即出现在会话列表");
        assertEquals(id, list.get(0).id());
        assertEquals("你好世界", list.get(0).title());
    }

    @Test
    void beginTurnIsIdempotentForContinuingSessionAndDoesNotClobber(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/begin-cont", "p", "m");
        // 已有一段历史(模拟续接会话)
        store.persist(List.of(
                LlmClient.Message.user("第一轮问题"),
                LlmClient.Message.assistant("第一轮回答")));
        String id = store.currentId();
        assertNotNull(id);

        // 续接中再 beginTurn:返回同一 id,不新建、不重写历史
        assertEquals(id, store.beginTurn("第二轮问题"));
        assertEquals(1, store.list(50).size(), "不应新建第二个会话");
        // 历史未被桩覆盖:仍是首轮标题
        assertEquals("第一轮问题", store.list(50).get(0).title());
    }

    @Test
    void finalPersistOverwritesStubWithSameId(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/begin-overwrite", "p", "m");
        String id = store.beginTurn("你好世界");
        assertNotNull(id);

        // 末尾 persist 完整历史 → 同 id 覆写桩,仍单条会话
        store.persist(List.of(
                LlmClient.Message.user("你好世界"),
                LlmClient.Message.assistant("我是 Wraith")));
        assertEquals(id, store.currentId(), "末尾 persist 复用同一 id");
        assertEquals(1, store.list(50).size());
    }

    @Test
    void beginTurnNoopForBlankInput(@TempDir Path home) {
        SessionStore store = SessionStore.open(home, "/proj/begin-blank", "p", "m");
        assertNull(store.beginTurn("   "), "空白输入不建会话");
        assertNull(store.beginTurn(null), "null 输入不建会话");
        assertNull(store.currentId());
        assertEquals(0, store.list(50).size());
    }
}
