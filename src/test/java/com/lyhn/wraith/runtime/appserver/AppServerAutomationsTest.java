package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * AppServer automations.* RPC 端到端测试。
 * 使用 @TempDir 隔离 automations.json；通过 wraith.automation.dir 系统属性注入基目录。
 */
class AppServerAutomationsTest {

    @TempDir
    Path tempDir;

    @AfterEach
    void clearProperty() {
        System.clearProperty("wraith.automation.dir");
    }

    /** 创建一个最小 AppServer 并执行给定请求序列，返回所有 JSON-RPC 回复。 */
    private List<JsonNode> run(String... requests) throws Exception {
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
        List<JsonNode> replies = new ArrayList<>();
        for (String ln : out.toString(StandardCharsets.UTF_8).split("\n"))
            if (!ln.isBlank()) replies.add(JsonRpc.MAPPER.readTree(ln));
        return replies;
    }

    private JsonNode byId(List<JsonNode> replies, int id) {
        return replies.stream().filter(n -> n.path("id").asInt(-1) == id)
                .findFirst().orElseThrow(() -> new AssertionError("no reply for id=" + id));
    }

    /** 最小合法 CRON 任务 JSON，id=task-1。 */
    private static String cronTaskJson(String expr) {
        return "{\"id\":\"task-1\",\"name\":\"Morning\",\"prompt\":\"summarize\","
                + "\"schedule\":{\"kind\":\"cron\",\"expr\":\"" + expr + "\"},"
                + "\"enabled\":true,\"createdAt\":0,\"enabledAt\":0}";
    }

    // -------------------------------------------------------------------------
    // Test 1: upsert + list round-trip
    // -------------------------------------------------------------------------
    @Test
    void upsertThenListReturnsCronTask() throws Exception {
        String taskJson = cronTaskJson("0 9 * * 1-5");
        List<JsonNode> replies = run(
                // id=2 upsert
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.upsert\",\"params\":" + taskJson + "}",
                // id=3 list
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.list\",\"params\":{}}"
        );

        // upsert should succeed
        JsonNode upsertRes = byId(replies, 2).get("result");
        assertNotNull(upsertRes, "automations.upsert 应返回 result");
        assertTrue(upsertRes.path("ok").asBoolean(), "automations.upsert 应返回 {ok:true}");

        // list should return the task
        JsonNode listRes = byId(replies, 3).get("result");
        assertNotNull(listRes, "automations.list 应返回 result");
        JsonNode tasks = listRes.get("tasks");
        assertNotNull(tasks, "缺 tasks 字段");
        assertTrue(tasks.isArray(), "tasks 应为数组");
        assertEquals(1, tasks.size(), "tasks 应含 1 条");
        assertEquals("task-1", tasks.get(0).path("id").asText(), "task id 不匹配");
        assertEquals("0 9 * * 1-5", tasks.get(0).path("schedule").path("expr").asText(), "cron expr 不匹配");
    }

    // -------------------------------------------------------------------------
    // Test 2: invalid cron upsert → error response (not ok)
    // -------------------------------------------------------------------------
    @Test
    void upsertInvalidCronReturnsError() throws Exception {
        String badTask = cronTaskJson("nope");
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.upsert\",\"params\":" + badTask + "}"
        );
        JsonNode reply = byId(replies, 2);
        assertNull(reply.get("result"), "非法 cron 不应返回 result");
        assertNotNull(reply.get("error"), "非法 cron 应返回 error");
        String msg = reply.get("error").path("message").asText();
        assertFalse(msg.isBlank(), "error message 不应为空");
    }

    // -------------------------------------------------------------------------
    // Test 3: remove → list empty
    // -------------------------------------------------------------------------
    @Test
    void removeTaskThenListIsEmpty() throws Exception {
        String taskJson = cronTaskJson("0 9 * * 1-5");
        List<JsonNode> replies = run(
                // id=2 upsert
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.upsert\",\"params\":" + taskJson + "}",
                // id=3 remove
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.remove\",\"params\":{\"id\":\"task-1\"}}",
                // id=4 list
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.list\",\"params\":{}}"
        );

        JsonNode removeRes = byId(replies, 3).get("result");
        assertNotNull(removeRes, "automations.remove 应返回 result");
        assertTrue(removeRes.path("ok").asBoolean(), "automations.remove 应返回 {ok:true}");

        JsonNode tasks = byId(replies, 4).get("result").get("tasks");
        assertNotNull(tasks, "list 应有 tasks");
        assertEquals(0, tasks.size(), "remove 后 tasks 应为空");
    }

    // -------------------------------------------------------------------------
    // Test 4: runs on empty → {runs:[]}
    // -------------------------------------------------------------------------
    @Test
    void runsOnEmptyReturnsEmptyList() throws Exception {
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.runs\",\"params\":{}}"
        );
        JsonNode result = byId(replies, 2).get("result");
        assertNotNull(result, "automations.runs 应返回 result");
        JsonNode runs = result.get("runs");
        assertNotNull(runs, "缺 runs 字段");
        assertTrue(runs.isArray(), "runs 应为数组");
        assertEquals(0, runs.size(), "空时 runs 应为空数组");
    }

    // -------------------------------------------------------------------------
    // Test 5: upsert preserves other tasks
    // -------------------------------------------------------------------------
    @Test
    void upsertPreservesOtherTasks() throws Exception {
        String task1 = cronTaskJson("0 9 * * 1-5");
        String task2 = "{\"id\":\"task-2\",\"name\":\"Evening\",\"prompt\":\"check\","
                + "\"schedule\":{\"kind\":\"interval\",\"everyMinutes\":60},"
                + "\"enabled\":true,\"createdAt\":0,\"enabledAt\":0}";
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.upsert\",\"params\":" + task1 + "}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.upsert\",\"params\":" + task2 + "}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.list\",\"params\":{}}"
        );
        JsonNode tasks = byId(replies, 4).get("result").get("tasks");
        assertNotNull(tasks);
        assertEquals(2, tasks.size(), "两个任务应都被保留");
    }

    // -------------------------------------------------------------------------
    // Test 7: 桌面完整线格式 upsert(带 projectPath/lastFiredAt 等 TS-only 字段)不得报错
    //   —— 回归锁:此前所有 upsert 测试都用 Java 形状(无 projectPath),漏掉了真实桌面 payload,
    //   导致 "Unrecognized field projectPath" 到活体才暴露。
    // -------------------------------------------------------------------------
    @Test
    void upsertAcceptsDesktopShapedPayload() throws Exception {
        String desktopTask = "{\"id\":\"task-9\",\"name\":\"D\",\"prompt\":\"p\","
                + "\"projectPath\":\"/proj\",\"workspace\":\"/proj\","
                + "\"schedule\":{\"kind\":\"interval\",\"everyMinutes\":10},"
                + "\"enabled\":true,\"createdAt\":1,\"enabledAt\":1,\"lastFiredAt\":null,"
                + "\"deliverTo\":[{\"platform\":\"qq\"}],\"approval\":{\"default\":\"deny\"}}";
        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.upsert\",\"params\":" + desktopTask + "}",
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.list\",\"params\":{}}"
        );
        JsonNode upsertReply = byId(replies, 2);
        assertNull(upsertReply.get("error"), "桌面形状 payload 不应报未知字段错误: " + upsertReply.path("error").path("message").asText());
        assertTrue(upsertReply.path("result").path("ok").asBoolean(), "upsert 应返回 {ok:true}");
        JsonNode tasks = byId(replies, 3).get("result").get("tasks");
        assertEquals(1, tasks.size());
        assertEquals("/proj", tasks.get(0).path("workspace").asText(), "workspace 应被保留");
    }

    // -------------------------------------------------------------------------
    // Test 6: runs filtered by taskId
    // -------------------------------------------------------------------------
    @Test
    void runsFilteredByTaskId() throws Exception {
        // Seed some runs directly via AutomationStore, then query via RPC
        System.setProperty("wraith.automation.dir", tempDir.toString());
        com.lyhn.wraith.automation.AutomationStore store =
                new com.lyhn.wraith.automation.AutomationStore(tempDir);
        com.lyhn.wraith.automation.AutomationRun r1 = new com.lyhn.wraith.automation.AutomationRun();
        r1.runId = "run-1"; r1.taskId = "task-A"; r1.startedAt = 1000L; r1.status = "success";
        com.lyhn.wraith.automation.AutomationRun r2 = new com.lyhn.wraith.automation.AutomationRun();
        r2.runId = "run-2"; r2.taskId = "task-B"; r2.startedAt = 2000L; r2.status = "success";
        store.putRun(r1);
        store.putRun(r2);

        List<JsonNode> replies = run(
                "{\"jsonrpc\":\"2.0\",\"id\":__ID__,\"method\":\"automations.runs\",\"params\":{\"taskId\":\"task-A\"}}"
        );
        JsonNode runs = byId(replies, 2).get("result").get("runs");
        assertNotNull(runs);
        assertEquals(1, runs.size(), "按 taskId 过滤后应只有 1 条");
        assertEquals("run-1", runs.get(0).path("runId").asText());
    }
}
