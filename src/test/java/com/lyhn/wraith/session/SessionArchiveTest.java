package com.lyhn.wraith.session;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

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
}
