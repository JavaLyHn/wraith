package com.lyhn.wraith.runtime.appserver;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.session.SessionMeta;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class AppServerApprovalRespondTest {

    @Test
    void respondParsesModifiedArgsAndAllowNetwork() throws Exception {
        AtomicReference<ApprovalResult> got = new AtomicReference<>();
        AppServer.SessionRunnerFactory factory = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) {
                    ApprovalRequest req = ApprovalRequest.of("execute_command", "{\"command\":\"curl x\"}", null, null, null);
                    got.set(r.promptApproval(req));
                    return "ok";
                }
                public List<SessionMeta> listSessions() { return List.of(); }
                public List<LlmClient.Message> resume(String id) { return List.of(); }
                public String persistTurn() { return null; }
            };
        };

        PipedOutputStream feed = new PipedOutputStream();
        PipedInputStream in = new PipedInputStream(feed, 1 << 16);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Thread server = new Thread(() -> { try { new AppServer(in, out, factory).serve(); } catch (Exception e) { throw new RuntimeException(e); } });
        server.setDaemon(true);
        server.start();

        feed.write(("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}\n"
                + "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"turn.submit\",\"params\":{\"input\":\"hi\"}}\n")
                .getBytes(StandardCharsets.UTF_8));
        feed.flush();

        // 等 approval.requested 出现(approvalId 确定为 appr_1,但仍从事件里取,防守)
        String approvalId = null;
        long deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline && approvalId == null) {
            String s = out.toString(StandardCharsets.UTF_8);
            if (s.contains("approval.requested")) {
                for (String ln : s.split("\n")) {
                    if (ln.contains("approval.requested")) {
                        approvalId = JsonRpc.MAPPER.readTree(ln).get("params").get("approvalId").asText();
                    }
                }
            }
            if (approvalId == null) Thread.sleep(20);
        }
        assertNotNull(approvalId, "应发出 approval.requested");

        feed.write(("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"approval.respond\",\"params\":{"
                + "\"approvalId\":\"" + approvalId + "\",\"decision\":\"MODIFIED\","
                + "\"modifiedArgs\":\"{\\\"command\\\":\\\"curl y\\\"}\",\"allowNetwork\":true}}\n")
                .getBytes(StandardCharsets.UTF_8));
        feed.flush();

        deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline && got.get() == null) Thread.sleep(20);
        ApprovalResult result = got.get();
        assertNotNull(result);
        assertEquals(ApprovalResult.Decision.MODIFIED, result.decision());
        assertEquals("{\"command\":\"curl y\"}", result.modifiedArguments());
        assertTrue(result.allowNetworkOnce());

        feed.write("{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}\n".getBytes(StandardCharsets.UTF_8));
        feed.flush();
        server.join(2000);
    }

    @Test
    void respondDefaultsAllowNetworkFalse() throws Exception {
        // 同上骨架,respond 为 {"approvalId":…,"decision":"APPROVED"}(无 allowNetwork/modifiedArgs);
        // 断言 decision==APPROVED、modifiedArguments()==null、allowNetworkOnce()==false。
        AtomicReference<ApprovalResult> got = new AtomicReference<>();
        AppServer.SessionRunnerFactory factory = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) {
                    got.set(r.promptApproval(ApprovalRequest.of("execute_command", "{\"command\":\"ls\"}", null, null, null)));
                    return "ok";
                }
                public List<SessionMeta> listSessions() { return List.of(); }
                public List<LlmClient.Message> resume(String id) { return List.of(); }
                public String persistTurn() { return null; }
            };
        };
        PipedOutputStream feed = new PipedOutputStream();
        PipedInputStream in = new PipedInputStream(feed, 1 << 16);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Thread server = new Thread(() -> { try { new AppServer(in, out, factory).serve(); } catch (Exception e) { throw new RuntimeException(e); } });
        server.setDaemon(true);
        server.start();
        feed.write(("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}\n"
                + "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"turn.submit\",\"params\":{\"input\":\"hi\"}}\n")
                .getBytes(StandardCharsets.UTF_8));
        feed.flush();
        String approvalId = null;
        long deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline && approvalId == null) {
            String s = out.toString(StandardCharsets.UTF_8);
            for (String ln : s.split("\n")) {
                if (ln.contains("approval.requested")) {
                    approvalId = JsonRpc.MAPPER.readTree(ln).get("params").get("approvalId").asText();
                }
            }
            if (approvalId == null) Thread.sleep(20);
        }
        assertNotNull(approvalId);
        feed.write(("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"approval.respond\",\"params\":{"
                + "\"approvalId\":\"" + approvalId + "\",\"decision\":\"APPROVED\"}}\n").getBytes(StandardCharsets.UTF_8));
        feed.flush();
        deadline = System.currentTimeMillis() + 2000;
        while (System.currentTimeMillis() < deadline && got.get() == null) Thread.sleep(20);
        assertNotNull(got.get());
        assertEquals(ApprovalResult.Decision.APPROVED, got.get().decision());
        assertNull(got.get().modifiedArguments());
        assertFalse(got.get().allowNetworkOnce());
        feed.write("{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}\n".getBytes(StandardCharsets.UTF_8));
        feed.flush();
        server.join(2000);
    }

    @Test
    void invalidDecisionRejectedAndApprovedAllParses() throws Exception {
        // 不需要 runner 交错:decision 校验发生在 resolveApproval 之前;
        // APPROVED_ALL 对不存在的 approvalId 是 no-op,但能证明枚举解析通过(返回 ok 而非 -32602)。
        AppServer.SessionRunnerFactory factory = (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) { return "ok"; }
                public List<SessionMeta> listSessions() { return List.of(); }
                public List<LlmClient.Message> resume(String id) { return List.of(); }
                public String persistTurn() { return null; }
            };
        };
        String in = String.join("\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"approval.respond\",\"params\":{\"approvalId\":\"x\",\"decision\":\"BOGUS\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"approval.respond\",\"params\":{\"approvalId\":\"x\",\"decision\":\"APPROVED_ALL\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, factory).serve();
        String s = out.toString(StandardCharsets.UTF_8);
        boolean sawInvalid = false;
        boolean sawApprovedAllOk = false;
        for (String ln : s.split("\n")) {
            if (ln.isBlank()) continue;
            var n = JsonRpc.MAPPER.readTree(ln);
            if (n.path("id").asInt(-1) == 2 && n.has("error")) {
                assertEquals(-32602, n.get("error").get("code").asInt());
                sawInvalid = true;
            }
            if (n.path("id").asInt(-1) == 3 && n.has("result")) {
                sawApprovedAllOk = true;
            }
        }
        assertTrue(sawInvalid, "BOGUS decision 应回 -32602");
        assertTrue(sawApprovedAllOk, "APPROVED_ALL 应解析通过并回 ok");
    }
}
