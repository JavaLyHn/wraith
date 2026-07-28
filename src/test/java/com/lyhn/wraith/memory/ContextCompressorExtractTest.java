package com.lyhn.wraith.memory;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ContextCompressorExtractTest {

    private MemoryEntry entry(String content) {
        return new MemoryEntry("user-x", content, MemoryEntry.MemoryType.CONVERSATION,
                Map.of("source", "user"), MemoryEntry.estimateTokens(content));
    }

    @Test
    void extractsDurableFactsAndFiltersEphemeral() throws Exception {
        LlmClient llm = mock(LlmClient.class);
        // 模型返回 4 行:1 条稳定事实(含"项目"命中 DURABLE_FACT_HINTS)、
        // 1 条冒号事实、1 条一次性任务(EPHEMERAL 前缀)、1 条猜测(SPECULATION)。
        String out = "用户偏好使用 Java 17\n项目路径：/Users/x/wraith\n帮我新建一个文件\n这可能是个笔误";
        when(llm.chat(anyList(), isNull()))
                .thenReturn(new LlmClient.ChatResponse("assistant", out, null, null, 0, 0, 0));
        ContextCompressor c = new ContextCompressor(llm);

        List<String> facts = c.extractFactCandidates(List.of(entry("聊天内容")));

        assertTrue(facts.contains("用户偏好使用 Java 17"));
        assertTrue(facts.contains("项目路径：/Users/x/wraith"));
        assertFalse(facts.stream().anyMatch(f -> f.startsWith("帮我")));   // EPHEMERAL 前缀被过滤
        assertFalse(facts.stream().anyMatch(f -> f.contains("笔误")));      // SPECULATION 被过滤
    }

    @Test
    void emptyInputReturnsEmpty() {
        ContextCompressor c = new ContextCompressor(mock(LlmClient.class));
        assertTrue(c.extractFactCandidates(List.of()).isEmpty());
    }
}
