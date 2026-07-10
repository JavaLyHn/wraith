package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * gateway.config.get 只读:验证安全视图字段齐全,且**绝不回传 clientSecret 明文**(密钥红线)。
 * 不测 gateway.config.set —— 它写真实 ~/.wraith/config.json(WraithConfig 路径为 static final,
 * 测试无法隔离),写入语义与 BindCommand 一致、已由生产路径覆盖。
 */
class AppServerGatewayConfigTest {

    private List<JsonNode> run(String... requests) throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
            };
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        int id = 2;
        for (String req : requests) lines.add(req.replace("__ID__", String.valueOf(id++)));
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)), out, f).serve();
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n"))
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }

    private JsonNode byId(List<JsonNode> replies, int id) {
        return replies.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst().orElseThrow();
    }

    @Test
    void gatewayConfigGetReturnsSafeViewWithoutSecret() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"gateway.config.get\",\"params\":{}}");
        JsonNode res = byId(r, 2).get("result");
        assertNotNull(res, "gateway.config.get 应返回 result");
        assertTrue(res.has("bound"), "缺 bound");
        assertTrue(res.has("hasSecret"), "缺 hasSecret");
        assertTrue(res.has("appId"), "缺 appId");
        assertTrue(res.has("ownerOpenid"), "缺 ownerOpenid");
        assertTrue(res.has("workspace"), "缺 workspace");
        // 密钥红线:安全视图绝不能包含明文 clientSecret
        assertFalse(res.has("clientSecret"), "gateway.config.get 绝不能返回 clientSecret 明文");
    }

    @Test
    void gatewayConfigGetFeishuReturnsSafeViewWithoutSecret() throws Exception {
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"gateway.config.get\",\"params\":{\"platform\":\"feishu\"}}");
        JsonNode res = byId(r, 2).get("result");
        assertNotNull(res, "gateway.config.get(feishu) 应返回 result");
        assertTrue(res.has("bound"), "缺 bound");
        assertTrue(res.has("hasSecret"), "缺 hasSecret");
        assertTrue(res.has("appId"), "缺 appId");
        assertTrue(res.has("ownerOpenid"), "缺 ownerOpenid");
        assertTrue(res.has("region"), "缺 region");
        assertTrue(res.has("workspace"), "缺 workspace");
        // 密钥红线:绝不回 appSecret 明文
        assertFalse(res.has("appSecret"), "gateway.config.get(feishu) 绝不能返回 appSecret 明文");
    }

    @Test
    void gatewayConfigGetDefaultsToQqWhenNoPlatform() throws Exception {
        // 无 platform 参 → 沿用 QQ 视图(向后兼容,QQ 现有桌面面板不受影响)
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"gateway.config.get\",\"params\":{}}");
        JsonNode res = byId(r, 2).get("result");
        assertTrue(res.has("workspace"));
        assertFalse(res.has("clientSecret"), "QQ 视图也绝不回 clientSecret");
        assertFalse(res.has("region"), "QQ 视图不含 region 字段");
    }
}
