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

    @Test
    void gatewayConfigGetWecomReturnsSafeViewWithoutSecret() throws Exception {
        // 视图字段齐全,且绝不回传 secret 明文(密钥红线)
        List<JsonNode> r = run("{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"gateway.config.get\",\"params\":{\"platform\":\"wecom\"}}");
        JsonNode res = byId(r, 2).get("result");
        assertNotNull(res, "gateway.config.get(wecom) 应返回 result");
        assertTrue(res.has("bound"), "缺 bound");
        assertTrue(res.has("hasSecret"), "缺 hasSecret");
        assertTrue(res.has("botId"), "缺 botId");
        assertTrue(res.has("ownerUserid"), "缺 ownerUserid");
        assertTrue(res.has("workspace"), "缺 workspace");
        // 密钥红线:绝不回 secret 明文
        assertFalse(res.has("secret"), "gateway.config.get(wecom) 绝不能返回 secret 明文");
        assertFalse(res.path("bound").asBoolean(), "未配置时 bound 应为 false");
        assertFalse(res.path("hasSecret").asBoolean(), "未配置时 hasSecret 应为 false");
    }

    @Test
    void gatewayConfigSetWecomAndGetShowsHasSecretTrue() throws Exception {
        // set 写入 secret → get 回的 hasSecret=true,但视图不含明文
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"gateway.config.set\",\"params\":{\"platform\":\"wecom\",\"botId\":\"testBot\",\"secret\":\"s3cr3t\",\"ownerUserid\":\"user1\",\"workspace\":\"ws1\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"gateway.config.get\",\"params\":{\"platform\":\"wecom\"}}"
        );
        // set 返回 ok
        JsonNode setRes = byId(replies, 2);
        assertFalse(setRes.has("error"), "gateway.config.set(wecom) 不应出错");
        // get 视图 hasSecret=true,无明文
        JsonNode getRes = byId(replies, 3).get("result");
        assertNotNull(getRes);
        assertTrue(getRes.path("hasSecret").asBoolean(), "set secret 后 hasSecret 应为 true");
        assertTrue(getRes.path("bound").asBoolean(), "set secret 后 bound 应为 true");
        assertEquals("testBot", getRes.path("botId").asText());
        assertEquals("user1", getRes.path("ownerUserid").asText());
        assertEquals("ws1", getRes.path("workspace").asText());
        assertFalse(getRes.has("secret"), "get 视图绝不含 secret 明文");
    }

    @Test
    void gatewayConfigSetWecomEmptySecretKeepsExisting() throws Exception {
        // 先 set 有效 secret,再 set 空 secret → hasSecret 保持 true(不覆盖)
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"gateway.config.set\",\"params\":{\"platform\":\"wecom\",\"botId\":\"testBot\",\"secret\":\"mySecret\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"gateway.config.set\",\"params\":{\"platform\":\"wecom\",\"botId\":\"testBot\"}}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"gateway.config.get\",\"params\":{\"platform\":\"wecom\"}}"
        );
        JsonNode getRes = byId(replies, 4).get("result");
        assertNotNull(getRes);
        assertTrue(getRes.path("hasSecret").asBoolean(), "空 secret 不覆盖,hasSecret 应保持 true");
        assertFalse(getRes.has("secret"), "get 视图绝不含 secret 明文");
    }
}
