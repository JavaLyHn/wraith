package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SubAgentReviewStreamTest {

    private static PrintStream discard() {
        return new PrintStream(OutputStream.nullOutputStream());
    }

    /** 最小 LlmClient stub：chat() 先对 listener 发送一个 delta，再返回固定 ChatResponse。 */
    private static final class StubStreamingClient implements LlmClient {
        private final String delta;
        private final String responseContent;

        StubStreamingClient(String delta, String responseContent) {
            this.delta = delta;
            this.responseContent = responseContent;
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            return chat(messages, tools, StreamListener.NO_OP);
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener) throws IOException {
            if (delta != null && !delta.isEmpty()) {
                listener.onContentDelta(delta);
            }
            listener.finish();
            return new ChatResponse("assistant", responseContent, null, 10, 5);
        }

        @Override
        public String getModelName() { return "stub"; }

        @Override
        public String getProviderName() { return "stub"; }
    }

    @Test
    void reviewForwardsDeltasToExtraListener() {
        StubStreamingClient client = new StubStreamingClient(
                "审查中…",
                "{\"approved\":true,\"summary\":\"ok\",\"issues\":[]}"
        );
        SubAgent reviewer = new SubAgent("reviewer", AgentRole.REVIEWER, client, new ToolRegistry());
        List<String> captured = new ArrayList<>();
        LlmClient.StreamListener extra = new LlmClient.StreamListener() {
            @Override
            public void onContentDelta(String d) { captured.add(d); }
        };
        AgentMessage orig = AgentMessage.task("orchestrator", "原始任务");
        AgentMessage result = AgentMessage.result("worker-1", AgentRole.WORKER, "执行结果");
        reviewer.review(orig, result, discard(), extra);
        assertTrue(captured.stream().anyMatch(s -> s.contains("审查中")),
                "extra listener should receive reviewer content deltas");
    }

    @Test
    void reviewWithoutExtraStillWorks() {
        StubStreamingClient client = new StubStreamingClient(
                "",
                "{\"approved\":true,\"summary\":\"ok\",\"issues\":[]}"
        );
        SubAgent reviewer = new SubAgent("reviewer", AgentRole.REVIEWER, client, new ToolRegistry());
        AgentMessage orig = AgentMessage.task("orchestrator", "原始任务");
        AgentMessage result = AgentMessage.result("worker-1", AgentRole.WORKER, "执行结果");
        AgentMessage out = reviewer.review(orig, result, discard());
        assertNotNull(out);
    }
}
