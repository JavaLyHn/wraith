package com.lyhn.wraith.cli;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** session.rewind 的历史截断:丢弃从第 k 条 user 消息(1-based,含)起的全部消息。 */
class MainTruncateAtUserOrdinalTest {

    private static List<LlmClient.Message> history() {
        return List.of(
                LlmClient.Message.system("SYS"),
                LlmClient.Message.user("第一问"),
                LlmClient.Message.assistant("第一答"),
                LlmClient.Message.user("第二问"),
                LlmClient.Message.assistant("第二答"),
                LlmClient.Message.user("第三问"),
                LlmClient.Message.assistant("第三答"));
    }

    @Test
    void middleOrdinalKeepsPrefix() {
        List<LlmClient.Message> kept = Main.truncateAtUserOrdinal(history(), 2);
        assertNotNull(kept);
        assertEquals(3, kept.size()); // system + 第一问 + 第一答
        assertEquals("第一答", kept.get(2).content());
    }

    @Test
    void firstOrdinalKeepsOnlySystem() {
        List<LlmClient.Message> kept = Main.truncateAtUserOrdinal(history(), 1);
        assertNotNull(kept);
        assertEquals(1, kept.size());
        assertEquals("system", kept.get(0).role());
    }

    @Test
    void ordinalBeyondHistoryReturnsNull() {
        assertNull(Main.truncateAtUserOrdinal(history(), 4));
    }

    @Test
    void invalidOrdinalOrNullHistoryReturnsNull() {
        assertNull(Main.truncateAtUserOrdinal(history(), 0));
        assertNull(Main.truncateAtUserOrdinal(history(), -1));
        assertNull(Main.truncateAtUserOrdinal(null, 1));
    }
}
