package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AppServerProviderConfigTest {
    private List<JsonNode> run(WraithConfig cfg, String... requests) throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public Map<String,Object> modelList() {
                return ModelCatalog.result(cfg, "deepseek", "m", false);
            }
            public Map<String,Object> configSetProvider(String id, String apiKey, String model, String baseUrl, String protocol) {
                WraithConfig.ProviderConfig pc = cfg.getProviders().getOrDefault(id, new WraithConfig.ProviderConfig());
                if (apiKey != null && !apiKey.isBlank()) pc.setApiKey(apiKey);
                if (model != null) pc.setModel(model);
                if (baseUrl != null) pc.setBaseUrl(baseUrl);
                if (protocol != null) pc.setProtocol(protocol);
                cfg.getProviders().put(id, pc);
                return Map.of("ok", true);
            }
            public Map<String,Object> configRemoveProvider(String id) {
                cfg.getProviders().remove(id); return Map.of("ok", true);
            }
            public Map<String,Object> configTestProvider(String id, String apiKey, String model, String baseUrl, String protocol) {
                if (apiKey == null || apiKey.isBlank()) return Map.of("ok", false, "error", "缺少 API Key");
                // 模拟连通成功;绝不回显 key
                return Map.of("ok", true, "model", model == null ? "" : model, "latencyMs", 5L);
            }
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String r : requests) lines.add(r.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)), out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n")) if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }
    private JsonNode byId(List<JsonNode> r, int id) {
        return r.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst().orElseThrow();
    }

    @Test void setProviderThenListShowsItWithoutKey() throws Exception {
        WraithConfig cfg = new WraithConfig();
        List<JsonNode> r = run(cfg,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.setProvider\",\"params\":{\"id\":\"openai\",\"apiKey\":\"sk-secret\",\"model\":\"gpt-4o\",\"baseUrl\":\"https://api.openai.com/v1\",\"protocol\":\"openai\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"model.list\",\"params\":{}}");
        assertTrue(byId(r,2).path("result").path("ok").asBoolean());
        // model.list 里出现 openai 且标 hasKey,且【全响应文本不含 apiKey 明文】
        String all = r.toString();
        assertTrue(all.contains("openai"));
        assertFalse(all.contains("sk-secret"), "回包绝不能含 apiKey 明文");
        // 验证 model.list 响应的 providers 数组中 openai 条目的 hasKey == true
        JsonNode modelListReply = byId(r, 3);
        JsonNode providersArray = modelListReply.path("result").path("providers");
        JsonNode openaiEntry = null;
        for (JsonNode entry : providersArray) {
            if ("openai".equals(entry.path("name").asText())) {
                openaiEntry = entry;
                break;
            }
        }
        assertNotNull(openaiEntry, "providers 中找不到 openai 条目");
        assertTrue(openaiEntry.path("hasKey").asBoolean(), "openai 的 hasKey 应该是 true");
    }
    @Test void removeProviderDropsIt() throws Exception {
        WraithConfig cfg = new WraithConfig();
        cfg.getProviders().put("openai", new WraithConfig.ProviderConfig("k","u","m"));
        List<JsonNode> r = run(cfg,
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.removeProvider\",\"params\":{\"id\":\"openai\"}}");
        assertTrue(byId(r,2).path("result").path("ok").asBoolean());
        assertFalse(cfg.getProviders().containsKey("openai"));
    }
    @Test void missingIdIsParamError() throws Exception {
        List<JsonNode> r = run(new WraithConfig(),
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.setProvider\",\"params\":{\"apiKey\":\"k\"}}");
        assertEquals(-32602, byId(r,2).path("error").path("code").asInt());
    }
    @Test void removeProviderMissingIdIsParamError() throws Exception {
        List<JsonNode> r = run(new WraithConfig(),
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.removeProvider\",\"params\":{}}");
        assertEquals(-32602, byId(r,2).path("error").path("code").asInt());
    }
    @Test void testProviderEchoesResultWithoutKey() throws Exception {
        List<JsonNode> r = run(new WraithConfig(),
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.testProvider\",\"params\":{\"id\":\"openai\",\"apiKey\":\"sk-canary-test\",\"model\":\"gpt-4o\"}}");
        JsonNode res = byId(r,2).path("result");
        assertTrue(res.path("ok").asBoolean(), "有 key 时应回 ok:true");
        assertEquals("gpt-4o", res.path("model").asText());
        assertFalse(r.toString().contains("sk-canary-test"), "回包绝不能含 apiKey 明文");
    }
    @Test void testProviderBlankKeyReturnsNotOk() throws Exception {
        List<JsonNode> r = run(new WraithConfig(),
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.testProvider\",\"params\":{\"id\":\"openai\",\"apiKey\":\"\"}}");
        JsonNode res = byId(r,2).path("result");
        assertFalse(res.path("ok").asBoolean());
        assertTrue(res.path("error").asText().contains("API Key"));
    }
    @Test void testProviderMissingIdIsParamError() throws Exception {
        List<JsonNode> r = run(new WraithConfig(),
            "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"config.testProvider\",\"params\":{\"apiKey\":\"k\"}}");
        assertEquals(-32602, byId(r,2).path("error").path("code").asInt());
    }
}
