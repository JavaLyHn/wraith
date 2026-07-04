package com.lyhn.wraith.gateway;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * GatewaySession 单测：用 5-arg enableMcp=false 构造保持 hermetic（不启动 MCP 子进程），
 * 用直接实现 LlmClient 的 {@link RecordingClient} 喂一条 canned assistant 文本，
 * 断言 {@link GatewaySession#runTurn(String)} 返回该文本。
 *
 * <p>stub 不调用 StreamListener → Agent 走 formatUserFacingResponse 非流式路径返回 content；
 * 生产环境真流式客户端会走 streamed 路径，靠 setReturnFinalResponseWhenStreamed(true) 拿回文本。
 */
class GatewaySessionTest {

    @Test
    @Timeout(15)
    void runTurnReturnsAssistantText(@TempDir Path tmp) throws Exception {
        String oldHome = System.getProperty("user.home");
        System.setProperty("user.home", tmp.toString()); // 隔离 SessionStore 落盘目录
        try {
            LlmClient client = new RecordingClient("你好,我在");
            // enableMcp=false：不触发 McpServerManager 的真 load/startAll
            GatewaySession s = new GatewaySession("sess-1", tmp.toString(), client, key -> {}, false);
            assertEquals("你好,我在", s.runTurn("在吗").trim());
            // persist 返回落盘后的 sessionId（首个 persist 惰性分配，故非空）
            String id = s.persist();
            assertNotNull(id, "persist() 应返回非空 sessionId");
            s.close();
        } finally {
            if (oldHome == null) {
                System.clearProperty("user.home");
            } else {
                System.setProperty("user.home", oldHome);
            }
        }
    }

    /** 直接实现 LlmClient，单条 canned assistant 文本，无工具调用 → agent.run 立即返回该文本。 */
    private static final class RecordingClient implements LlmClient {
        private final String cannedText;

        RecordingClient(String cannedText) {
            this.cannedText = cannedText;
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
            // 4-arg ctor: (role, content, toolCalls=null → 无工具, inputTokens, outputTokens)
            return new ChatResponse("assistant", cannedText, null, 50_000, 1_000);
        }

        @Override
        public String getModelName() {
            return "stub-model";
        }

        @Override
        public String getProviderName() {
            return "stub";
        }
    }
}
