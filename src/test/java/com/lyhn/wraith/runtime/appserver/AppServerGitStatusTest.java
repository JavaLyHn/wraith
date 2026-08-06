package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** {@code git.status} 的 JSON-RPC 分发边界。 */
class AppServerGitStatusTest {

    @Test
    void gitStatusPreservesBranchAndChangeCountsFromRunner() throws Exception {
        List<JsonNode> replies = run(factory(Map.of(
                "repo", true,
                "name", "wraith",
                "branch", "main",
                "insertions", 295,
                "deletions", 18,
                "untracked", 3)));

        JsonNode result = replyById(replies, 2).path("result");
        assertEquals("main", result.path("branch").asText());
        assertEquals(295, result.path("insertions").asInt());
        assertEquals(3, result.path("untracked").asInt());
    }

    @Test
    void missingGitStatusImplementationBecomesJsonRpcError() throws Exception {
        List<JsonNode> replies = run((writer, sessionId, workspaceDir) -> new AppServer.SessionRunner() {
            @Override
            public EventStreamRenderer renderer() {
                return new EventStreamRenderer(writer, sessionId);
            }

            @Override
            public String runTurn(String input) {
                return "ok";
            }
        });

        assertTrue(replyById(replies, 2).has("error"));
    }

    private static AppServer.SessionRunnerFactory factory(Map<String, Object> status) {
        return (writer, sessionId, workspaceDir) -> new AppServer.SessionRunner() {
            @Override
            public EventStreamRenderer renderer() {
                return new EventStreamRenderer(writer, sessionId);
            }

            @Override
            public String runTurn(String input) {
                return "ok";
            }

            @Override
            public Map<String, Object> gitStatus() {
                return status;
            }
        };
    }

    private static List<JsonNode> run(AppServer.SessionRunnerFactory factory) throws Exception {
        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"git.status\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8)), output, factory).serve();

        List<JsonNode> replies = new ArrayList<>();
        for (String line : output.toString(StandardCharsets.UTF_8).split("\n")) {
            if (!line.isBlank()) {
                replies.add(JsonRpc.MAPPER.readTree(line));
            }
        }
        return replies;
    }

    private static JsonNode replyById(List<JsonNode> replies, int id) {
        return replies.stream()
                .filter(reply -> reply.path("id").asInt(-1) == id)
                .findFirst()
                .orElseThrow(() -> new AssertionError("missing RPC reply " + id));
    }
}
