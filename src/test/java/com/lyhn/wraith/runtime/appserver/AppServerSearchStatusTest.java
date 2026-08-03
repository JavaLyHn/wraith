package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code config.getSearch} 的分发。
 *
 * <p>这条测试存在的直接原因：上一轮我<b>断言过一个 dispatch case 不存在，而它存在</b>
 * （grep 用的名字对不上）。分发这一层薄，但它是「面板拿不到状态」与「后端没实现」
 * 两种故障的分界线，值得有一条真跑 {@code serve()} 的测试钉住。
 */
class AppServerSearchStatusTest {

    private static List<JsonNode> run(AppServer.SessionRunnerFactory f, String request) throws Exception {
        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
                request,
                "{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String line : out.toString(StandardCharsets.UTF_8).split("\n")) {
            if (line.isBlank()) continue;
            try { replies.add(JsonRpc.MAPPER.readTree(line)); } catch (Exception ignored) { }
        }
        return replies;
    }

    private static JsonNode byId(List<JsonNode> replies, int id) {
        return replies.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst().orElseThrow();
    }

    private static AppServer.SessionRunnerFactory factory(Map<String, Object> status) {
        WraithConfig cfg = new WraithConfig();
        return (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public Map<String, Object> modelList() { return ModelCatalog.result(cfg, "deepseek", "m", false); }
            public Map<String, Object> searchStatus() {
                if (status == null) throw new UnsupportedOperationException("searchStatus not implemented");
                return status;
            }
        };
    }

    @Test
    @DisplayName("config.getSearch 把 {provider, ready} 原样回给前端")
    void statusIsRoutedBack() throws Exception {
        List<JsonNode> replies = run(factory(Map.of("provider", "searxng", "ready", true)),
                "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"config.getSearch\",\"params\":{}}");

        JsonNode result = byId(replies, 7).path("result");
        assertEquals("searxng", result.path("provider").asText());
        assertTrue(result.path("ready").asBoolean(), "ready 该是 true");
    }

    @Test
    @DisplayName("未配置时 ready:false 也要正常回,而不是报错 —— 前端要靠它画黄角标")
    void notReadyIsAResultNotAnError() throws Exception {
        List<JsonNode> replies = run(factory(Map.of("provider", "unconfigured", "ready", false)),
                "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"config.getSearch\",\"params\":{}}");

        JsonNode reply = byId(replies, 7);
        assertFalse(reply.has("error"), "「没配」不是错误: " + reply);
        assertFalse(reply.path("result").path("ready").asBoolean());
    }

    @Test
    @DisplayName("老后端没实现这个方法时回 JSON-RPC error,不把 app-server 打崩")
    void unimplementedBecomesJsonRpcError() throws Exception {
        List<JsonNode> replies = run(factory(null),
                "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"config.getSearch\",\"params\":{}}");

        assertEquals(-32000, byId(replies, 7).path("error").path("code").asInt());
    }
}
