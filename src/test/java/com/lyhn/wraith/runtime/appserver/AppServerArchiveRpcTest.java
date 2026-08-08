package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.session.SessionMeta;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AppServerArchiveRpcTest {

    /** 记录被调到的参数,供断言。 */
    private static final class Spy {
        List<String> summaryPaths;
        String listPath;
        int listLimit = -999;
        String archivedId;
        Boolean archivedFlag;
        String archivedPath = "<unset>";
        String deletedId;
        String deletedPath = "<unset>";
        String archiveProjectPath;
    }

    /**
     * AppServer 吃的是 SessionRunnerFactory 而不是裸 SessionRunner。
     * renderer() 必须回真的 EventStreamRenderer —— 回 null 会让 session.start 就崩。
     */
    private static AppServer.SessionRunnerFactory factory(Spy spy) {
        return (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() {
                return r;
            }

            public String runTurn(String input) {
                return "";
            }

            public List<Map<String, Object>> projectSummary(List<String> paths) {
                spy.summaryPaths = paths;
                List<Map<String, Object>> out = new ArrayList<>();
                for (int i = 0; i < paths.size(); i++) {
                    // 第二项刻意给 null lastSessionAt(= 项目没会话):
                    // 前端 mergeSummaries 读这个键,所以序列化必须留 "lastSessionAt":null
                    // 而不是把键整个丢掉。Map.of 不吃 null → 只能 LinkedHashMap。
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("path", paths.get(i));
                    m.put("sessionCount", i == 1 ? 0 : 2);
                    m.put("lastSessionAt", i == 1 ? null : "2026-08-05T10:00:00Z");
                    out.add(m);
                }
                return out;
            }

            public List<SessionMeta> listSessionsForProject(String path, int limit) {
                spy.listPath = path;
                spy.listLimit = limit;
                return List.of(new SessionMeta("s1", path, "c", "u", "prov", "mod", "t", 1, false, null, null, null));
            }

            public boolean setSessionArchived(String sessionId, boolean archived, String path) {
                spy.archivedId = sessionId;
                spy.archivedFlag = archived;
                spy.archivedPath = path;
                return true;
            }

            public List<SessionMeta> listArchivedSessions(List<String> paths, int limit) {
                return List.of(new SessionMeta("a1", "/p", "c", "u", "prov", "mod", "t", 1, false, null, null,
                        "2026-08-05T09:00:00Z"));
            }

            public int archiveProjectSessions(String path) {
                spy.archiveProjectPath = path;
                return 3;
            }

            public boolean deleteSession(String id, String path) {
                spy.deletedId = id;
                spy.deletedPath = path;
                return true;
            }
            };
        };
    }

    /**
     * 起一个 in-process AppServer,发 session.start → 目标方法 → shutdown,回目标方法的 result 节点。
     * 形状抄 AppServerSessionTest.sessionListSerializesMetas(:40) —— 那里已经这么驱动了。
     */
    private static JsonNode call(AppServer.SessionRunnerFactory f, String method, String paramsJson)
            throws Exception {
        return drive(f, method, paramsJson, "result");
    }

    /** 同上,但回 error 节点(断言错误码用)。 */
    private static JsonNode callExpectError(AppServer.SessionRunnerFactory f, String method, String paramsJson)
            throws Exception {
        return drive(f, method, paramsJson, "error");
    }

    private static JsonNode drive(AppServer.SessionRunnerFactory f, String method, String paramsJson,
                                  String field) throws Exception {
        String in = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"" + method + "\",\"params\":" + paramsJson + "}",
                "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\",\"params\":{}}") + "\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(in.getBytes(StandardCharsets.UTF_8)), out, f).serve();
        String raw = out.toString(StandardCharsets.UTF_8);
        for (String ln : raw.split("\n")) {
            if (ln.isBlank()) continue;
            JsonNode n = JsonRpc.MAPPER.readTree(ln);
            if (n.path("id").asInt(-1) == 2 && n.has(field)) {
                return n.get(field);
            }
        }
        throw new AssertionError("没等到 id=2 的 " + field + ",原始输出:\n" + raw);
    }

    @Test
    void projectSummaryPassesPathsThrough() throws Exception {
        Spy spy = new Spy();
        JsonNode result = call(factory(spy), "session.projectSummary",
                "{\"paths\":[\"/a\",\"/b\"]}");

        assertEquals(List.of("/a", "/b"), spy.summaryPaths);
        assertTrue(result.has("summaries"));
        assertEquals(2, result.get("summaries").size());
        // 无会话的项目:lastSessionAt 这个键必须在、值是 null。丢键会让前端
        // mergeSummaries 读到 undefined 而不是 null,两者在 TS 里不是一回事。
        JsonNode second = result.get("summaries").get(1);
        assertTrue(second.has("lastSessionAt"), "键不能被丢掉");
        assertTrue(second.get("lastSessionAt").isNull());
        assertEquals(0, second.get("sessionCount").asInt());
    }

    @Test
    void projectSummaryMissingPathsIsInvalidParams() throws Exception {
        JsonNode err = callExpectError(factory(new Spy()), "session.projectSummary", "{}");
        assertEquals(-32602, err.get("code").asInt());
    }

    @Test
    void projectSummaryEmptyArrayIsLegal() throws Exception {
        // 空数组是合法输入(没有项目),不该退化成 -32602
        Spy spy = new Spy();
        JsonNode result = call(factory(spy), "session.projectSummary", "{\"paths\":[]}");
        assertEquals(List.of(), spy.summaryPaths);
        assertEquals(0, result.get("summaries").size());
    }

    @Test
    void listForProjectDefaultsLimitToFifty() throws Exception {
        Spy spy = new Spy();
        call(factory(spy), "session.listForProject", "{\"path\":\"/a\"}");
        assertEquals("/a", spy.listPath);
        assertEquals(50, spy.listLimit, "limit 缺省要有明确默认值,不能传 0 变成「全部」");
    }

    @Test
    void listForProjectMissingPathIsInvalidParams() throws Exception {
        JsonNode err = callExpectError(factory(new Spy()), "session.listForProject", "{}");
        assertEquals(-32602, err.get("code").asInt());
    }

    @Test
    void setArchivedWithoutPathPassesNull() throws Exception {
        Spy spy = new Spy();
        call(factory(spy), "session.setArchived", "{\"sessionId\":\"s1\",\"archived\":true}");
        assertEquals("s1", spy.archivedId);
        assertEquals(Boolean.TRUE, spy.archivedFlag);
        // Spy 的初值是 "<unset>",所以 assertNull 同时排除了「压根没被调到」
        assertNull(spy.archivedPath, "不给 path 必须传 null,让实现走活跃 store");
    }

    @Test
    void setArchivedWithPathPassesIt() throws Exception {
        Spy spy = new Spy();
        call(factory(spy), "session.setArchived",
                "{\"sessionId\":\"s1\",\"archived\":false,\"path\":\"/other\"}");
        assertEquals("/other", spy.archivedPath);
        assertEquals(Boolean.FALSE, spy.archivedFlag);
    }

    @Test
    void setArchivedMissingSessionIdIsInvalidParams() throws Exception {
        JsonNode err = callExpectError(factory(new Spy()), "session.setArchived",
                "{\"archived\":true}");
        assertEquals(-32602, err.get("code").asInt());
    }

    @Test
    void deleteWithPathPassesIt() throws Exception {
        Spy spy = new Spy();
        call(factory(spy), "session.delete", "{\"sessionId\":\"s1\",\"path\":\"/other\"}");
        assertEquals("s1", spy.deletedId);
        assertEquals("/other", spy.deletedPath);
    }

    @Test
    void deleteWithoutPathStaysBackwardCompatible() throws Exception {
        Spy spy = new Spy();
        JsonNode result = call(factory(spy), "session.delete", "{\"sessionId\":\"s1\"}");
        assertNull(spy.deletedPath, "旧调用方不传 path,必须收到 null");
        assertTrue(result.get("ok").asBoolean());
    }

    @Test
    void archiveProjectReturnsCount() throws Exception {
        Spy spy = new Spy();
        JsonNode result = call(factory(spy), "session.archiveProject", "{\"path\":\"/a\"}");
        assertEquals("/a", spy.archiveProjectPath);
        assertEquals(3, result.get("archived").asInt());
    }

    @Test
    void archiveProjectMissingPathIsInvalidParams() throws Exception {
        JsonNode err = callExpectError(factory(new Spy()), "session.archiveProject", "{}");
        assertEquals(-32602, err.get("code").asInt());
    }
}
