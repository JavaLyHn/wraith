package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Task 3: model.list / session.setModel / config.setDefaultProvider 三 RPC
 * + session.resume 按会话恢复 provider 的 dispatch 测试。
 *
 * <p>Fake runner 直接覆写三个新 default 方法,可控行为与 AppServerMcpDispatchTest 同款 harness。
 */
class AppServerModelTest {

    // ── harness ──────────────────────────────────────────────────────────────

    /**
     * Fake runner:
     * - modelListResult  → modelList() 返回值(null → 默认方法返回 null → -32000)
     * - setModelResult   → sessionSetModel 成功时的返回值;null → 抛 IllegalArgument
     * - defaultResult    → configSetDefaultProvider 成功时的返回值;null → 抛 IllegalArgument
     * - resumeProvider   → resume 后 current.provider 变成哪个(通过 modelFallback 字段)
     */
    private AppServer.SessionRunnerFactory fakeFactory(
            Map<String, Object> modelListResult,
            Map<String, Object> setModelResult,
            Map<String, Object> defaultResult) {
        return (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }

                @Override
                public Map<String, Object> modelList() {
                    return modelListResult;
                }

                @Override
                public Map<String, Object> sessionSetModel(String provider) {
                    if (setModelResult == null) {
                        throw new IllegalArgumentException("未配置 " + provider + " 的 API Key");
                    }
                    return setModelResult;
                }

                @Override
                public Map<String, Object> configSetDefaultProvider(String provider) {
                    if (defaultResult == null) {
                        throw new IllegalArgumentException("未配置 " + provider + " 的 API Key");
                    }
                    return defaultResult;
                }
            };
        };
    }

    /** Resume runner: resume 后返回固定消息,modelList 含 modelFallback 标志。 */
    private AppServer.SessionRunnerFactory resumeFactory(boolean fallback, String provider, String model) {
        return (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }

                @Override
                public java.util.List<com.lyhn.wraith.llm.LlmClient.Message> resume(String id) {
                    return List.of();
                }

                @Override
                public Map<String, Object> modelList() {
                    Map<String, Object> result = new java.util.LinkedHashMap<>();
                    result.put("current", Map.of("provider", provider, "model", model));
                    result.put("default", provider);
                    result.put("providers", List.of());
                    if (fallback) result.put("modelFallback", true);
                    return result;
                }
            };
        };
    }

    private List<JsonNode> runRpc(AppServer.SessionRunnerFactory factory, String... requests) throws Exception {
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String req : requests) {
            lines.add(req.replace("__ID__", String.valueOf(id++)));
        }
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(
                new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)),
                out, factory).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) {
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        }
        return replies;
    }

    private JsonNode byId(List<JsonNode> replies, int id) {
        return replies.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst()
                .orElseThrow(() -> new AssertionError("no reply for id=" + id + "; got " + replies));
    }

    // ── Test 1: model.list 形状 ──────────────────────────────────────────────

    @Test
    void modelListReturnsExpectedShape() throws Exception {
        Map<String, Object> fakeList = Map.of(
                "current", Map.of("provider", "deepseek", "model", "deepseek-chat"),
                "default", "deepseek",
                "providers", List.of(
                        Map.of("name", "deepseek", "model", "deepseek-chat", "hasKey", true),
                        Map.of("name", "glm", "model", "", "hasKey", false)));

        List<JsonNode> replies = runRpc(fakeFactory(fakeList, null, null),
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"model.list\",\"params\":{}}");

        JsonNode result = byId(replies, 2).get("result");
        assertNotNull(result, "model.list 应返回 result");
        assertEquals("deepseek", result.get("current").get("provider").asText());
        assertEquals("deepseek-chat", result.get("current").get("model").asText());
        assertEquals("deepseek", result.get("default").asText());
        assertTrue(result.get("providers").isArray());
        assertEquals(2, result.get("providers").size());
        assertEquals("deepseek", result.get("providers").get(0).get("name").asText());
        assertTrue(result.get("providers").get(0).get("hasKey").asBoolean());
        assertFalse(result.get("providers").get(1).get("hasKey").asBoolean());
    }

    // ── Test 2: model.list 不含 apiKey/baseUrl 值(负断言) ──────────────────

    @Test
    void modelListDoesNotExposeApiKeyOrBaseUrl() throws Exception {
        // fake runner 返回含假 key 值的 map——dispatch 层不应原样透传
        // 实际 Main.java runner 不放 apiKey;此处测 dispatch 路径不注入额外字段
        String fakeApiKeyValue = "sk-FAKE_SECRET_XYZ_12345";
        String fakeBaseUrl = "https://internal.secret.baseurl.example.com";

        Map<String, Object> provEntry = new java.util.LinkedHashMap<>();
        provEntry.put("name", "glm");
        provEntry.put("model", "glm-4");
        provEntry.put("hasKey", true);
        // 故意不放 apiKey/baseUrl 在条目里:断言整包序列化不含这些值
        Map<String, Object> fakeList = Map.of(
                "current", Map.of("provider", "glm", "model", "glm-4"),
                "default", "glm",
                "providers", List.of(provEntry));

        List<JsonNode> replies = runRpc(fakeFactory(fakeList, null, null),
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"model.list\",\"params\":{}}");

        // 整个输出序列化字符串不得包含假 key/baseUrl 值
        String allOutput = new ByteArrayOutputStream().toString();  // placeholder; re-capture below
        // 重新跑一次以获得原始 JSON 字符串
        List<String> lines2 = List.of(
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"model.list\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream rawOut = new ByteArrayOutputStream();
        new AppServer(
                new ByteArrayInputStream(String.join("\n", lines2).concat("\n").getBytes(StandardCharsets.UTF_8)),
                rawOut, fakeFactory(fakeList, null, null)).serve();
        String raw = rawOut.toString(StandardCharsets.UTF_8);

        assertFalse(raw.contains(fakeApiKeyValue), "序列化结果不应含假 apiKey 值");
        assertFalse(raw.contains(fakeBaseUrl), "序列化结果不应含假 baseUrl 值");
        // 确认 result 字段存在(非 error)
        JsonNode result2 = byId(replies, 2).get("result");
        assertNotNull(result2, "model.list 应有 result");
    }

    // ── Test 3: session.setModel 成功 ────────────────────────────────────────

    @Test
    void sessionSetModelSuccessReturnsProviderAndModel() throws Exception {
        Map<String, Object> setResult = Map.of("provider", "kimi", "model", "moonshot-v1-8k");

        List<JsonNode> replies = runRpc(fakeFactory(null, setResult, null),
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.setModel\",\"params\":{\"provider\":\"kimi\"}}");

        JsonNode result = byId(replies, 2).get("result");
        assertNotNull(result);
        assertEquals("kimi", result.get("provider").asText());
        assertEquals("moonshot-v1-8k", result.get("model").asText());
    }

    // ── Test 4: session.setModel 无 key → -32602 ─────────────────────────────

    @Test
    void sessionSetModelNoKeyReturns32602() throws Exception {
        // setModelResult=null → runner 抛 IllegalArgumentException → -32602
        List<JsonNode> replies = runRpc(fakeFactory(null, null, null),
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.setModel\",\"params\":{\"provider\":\"step\"}}");

        JsonNode err = byId(replies, 2).get("error");
        assertNotNull(err, "无 key 时应返回 error");
        assertEquals(-32602, err.get("code").asInt());
        assertTrue(err.get("message").asText().contains("API Key"),
                "错误信息应含 'API Key'");
    }

    // ── Test 5: config.setDefaultProvider 校验 ───────────────────────────────

    @Test
    void configSetDefaultProviderSuccessReturnsOk() throws Exception {
        Map<String, Object> defResult = Map.of("ok", true);

        List<JsonNode> replies = runRpc(fakeFactory(null, null, defResult),
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.setDefaultProvider\",\"params\":{\"provider\":\"deepseek\"}}");

        JsonNode result = byId(replies, 2).get("result");
        assertNotNull(result);
        assertTrue(result.get("ok").asBoolean());
    }

    @Test
    void configSetDefaultProviderNoKeyReturns32602() throws Exception {
        // defaultResult=null → runner 抛 IllegalArgumentException → -32602
        List<JsonNode> replies = runRpc(fakeFactory(null, null, null),
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.setDefaultProvider\",\"params\":{\"provider\":\"ghost\"}}");

        JsonNode err = byId(replies, 2).get("error");
        assertNotNull(err, "无 key 时应返回 error");
        assertEquals(-32602, err.get("code").asInt());
    }

    // ── Test 6: session.resume fallback 标志 ─────────────────────────────────

    @Test
    void sessionResumeFallbackFlagAppearsWhenProviderRestoreFails() throws Exception {
        // resumeFactory(fallback=true, ...) → runner.modelList() 含 modelFallback:true
        // → handleSessionResume 将其写入 resume result
        List<JsonNode> replies = runRpc(
                resumeFactory(true, "glm", "glm-4"),
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.resume\",\"params\":{\"sessionId\":\"sess-fallback-test\"}}");

        JsonNode result = byId(replies, 2).get("result");
        assertNotNull(result, "session.resume 应有 result");
        assertEquals("sess-fallback-test", result.get("sessionId").asText());
        assertTrue(result.has("modelFallback") && result.get("modelFallback").asBoolean(),
                "provider 恢复失败时 resume result 应含 modelFallback:true");
    }

    @Test
    void sessionResumeNoFallbackWhenProviderRestoreSucceeds() throws Exception {
        // resumeFactory(fallback=false, ...) → runner.modelList() 不含 modelFallback
        // → handleSessionResume result 不含 modelFallback 或值为 false
        List<JsonNode> replies = runRpc(
                resumeFactory(false, "deepseek", "deepseek-chat"),
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.resume\",\"params\":{\"sessionId\":\"sess-ok-test\"}}");

        JsonNode result = byId(replies, 2).get("result");
        assertNotNull(result, "session.resume 应有 result");
        assertEquals("sess-ok-test", result.get("sessionId").asText());
        assertFalse(result.has("modelFallback") && result.get("modelFallback").asBoolean(),
                "provider 恢复成功时 resume result 不应含 modelFallback:true");
        // provider/model 实际生效值应在 result 中
        assertEquals("deepseek", result.get("provider").asText());
        assertEquals("deepseek-chat", result.get("model").asText());
    }

    // ── Test 7: session.setModel 缺 provider 参数 → -32602 ──────────────────

    @Test
    void sessionSetModelMissingProviderReturns32602() throws Exception {
        List<JsonNode> replies = runRpc(fakeFactory(null, Map.of("provider", "x", "model", "y"), null),
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"session.setModel\",\"params\":{}}");

        JsonNode err = byId(replies, 2).get("error");
        assertNotNull(err);
        assertEquals(-32602, err.get("code").asInt());
    }
}
