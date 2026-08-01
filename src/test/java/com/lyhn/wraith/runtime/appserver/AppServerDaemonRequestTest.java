package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「立即运行」与「自动化审批」也走 RequestInbox 请 daemon 干活。daemon 没运行时,老实现
 * 只写个请求文件就回 ok —— 界面点了没反应,而且**几小时后网关一起来那些请求会突然一起执行**
 * (任务凭空跑起来、审批凭空落地)。
 *
 * 这两件事无法本地兜底(需要 runner),所以正确行为是**如实报失败**并回收请求文件,
 * 而不是假装成功、留个定时炸弹。
 */
class AppServerDaemonRequestTest {

    @TempDir Path tempDir;

    private List<JsonNode> run(int awaitId, String... requests) throws Exception {
        System.setProperty("wraith.automation.dir", tempDir.toString());
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
        new AppServer(
                new ByteArrayInputStream(String.join("\n", lines).concat("\n").getBytes(StandardCharsets.UTF_8)),
                out, f).serve();
        // dispatchAsync 的回包由后台线程写出,可能晚于 serve() 返回
        String needle = "\"id\":" + awaitId;
        for (int i = 0; i < 100 && !out.toString(StandardCharsets.UTF_8).contains(needle); i++) Thread.sleep(50);
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n"))
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }

    private static JsonNode byId(List<JsonNode> replies, int id) {
        return replies.stream().filter(n -> n.path("id").asInt(-1) == id).findFirst()
                .orElseThrow(() -> new AssertionError("no reply for id=" + id));
    }

    private long requestFiles() throws Exception {
        Path dir = tempDir.resolve("automation-requests");
        if (!Files.exists(dir)) return 0;
        try (Stream<Path> s = Files.list(dir)) { return s.filter(p -> p.toString().endsWith(".json")).count(); }
    }

    @Test
    void runNowReportsGatewayNotRunning() throws Exception {
        List<JsonNode> replies = run(2,
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.runNow\",\"params\":{\"id\":\"t1\"}}");
        JsonNode res = byId(replies, 2).path("result");
        assertFalse(res.path("ok").asBoolean(true), "网关没跑时不能假装成功");
        assertEquals("gateway-not-running", res.path("reason").asText());
        assertEquals(0, requestFiles(), "必须回收请求文件,否则网关下次启动任务会凭空跑起来");
    }

    @Test
    void approvalReportsGatewayNotRunning() throws Exception {
        List<JsonNode> replies = run(2,
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.respondApproval\","
                        + "\"params\":{\"approvalId\":\"task1#1\",\"decision\":\"approve\"}}");
        JsonNode res = byId(replies, 2).path("result");
        assertFalse(res.path("ok").asBoolean(true), "网关没跑时审批不能假装落地");
        assertEquals("gateway-not-running", res.path("reason").asText());
        assertEquals(0, requestFiles(), "必须回收,否则审批会在网关启动时凭空生效");
    }

    /** 参数校验仍走同步错误路径,不该被异步化吞掉。 */
    @Test
    void stillValidatesParams() throws Exception {
        List<JsonNode> replies = run(0,
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.runNow\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.respondApproval\",\"params\":{\"approvalId\":\"a\"}}");
        assertTrue(byId(replies, 2).path("error").path("message").asText().contains("id"));
        assertTrue(byId(replies, 3).path("error").path("message").asText().contains("decision"));
    }
}
