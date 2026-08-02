package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.session.SessionMeta;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 同一个会话,所有事件必须报同一个 sessionId。
 *
 * <p>曾经不是:会话 id 在生命周期内换一次号 —— session.start 给的是 wire id(sess_…),
 * 首个 turn.completed 起 AppServer 换用 SessionStore 的持久化 id(20260802-…)。
 * 但 {@link EventStreamRenderer} 的 sessionId 是构造时定死的,它发的 thinking / message /
 * approval.requested 一直带着那个旧的 wire id。于是首轮之后,同一条流上两种 id 并存。
 *
 * <p>这不是理论问题,它已经咬过两次:
 *   1. desktop 的 notificationFilter 因此被迫常关(MULTI_SESSION_FILTER_ENABLED=false),
 *      注释里写明"启用会误丢弃 turn.completed 导致 turn 永卡 running";
 *   2. 2026-08-02 有人给 approval.requested 加了条 sessionId 判据,从第二轮起把所有交互式
 *      审批吞掉 —— 弹窗不出现、工具卡停在 running、对话再也推不动。
 *
 * <p>本用例把"一致"钉死,好让 sessionId 重新变成可以安全依赖的字段。
 */
class SessionIdConsistencyTest {

    private static final String PERSISTED = "20260802-112911-7e05";

    private static List<JsonNode> parseAll(String s) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        for (String ln : s.split("\n")) if (!ln.isBlank()) out.add(JsonRpc.MAPPER.readTree(ln));
        return out;
    }

    /**
     * 复刻真实行为:每轮吐一点正文(走 renderer 的 base()),并在 **beginTurn** 就把 id 换成持久化 id
     * ——「新会话:轮次开始即落桩」,换号点在轮次**开头**而不是结尾,所以分叉从第一轮就存在。
     * persistedFromStart=false 用来模拟"尚未落桩"的运行形态(两个 id 都还是 wire id)。
     */
    private static AppServer.SessionRunnerFactory factory(boolean persistedFromStart) {
        return (writer, sessionId, workspaceDir) -> {
            EventStreamRenderer r = new EventStreamRenderer(writer, sessionId);
            return new AppServer.SessionRunner() {
                public EventStreamRenderer renderer() { return r; }
                public String runTurn(String input) {
                    r.appendAssistantContentDelta("ok");
                    r.finishAssistantContent();
                    return "ok";
                }
                public List<SessionMeta> listSessions() { return List.of(); }
                public String beginTurn(String input) { return persistedFromStart ? PERSISTED : null; }
                public String persistTurn() { return persistedFromStart ? PERSISTED : null; }
            };
        };
    }

    /**
     * 跑一轮,返回 method → 该 method 报过的所有 sessionId。
     *
     * <p>用管道喂 stdin 而不是一次性 byte[]:轮次跑在独立线程上,而 shutdown 处理时**不 join**
     * 那个线程(AppServer 里 shutdown 直接 return false)。一次性喂完的话,shutdown 可能先被处理完、
     * serve() 已返回,而 message.delta 还没写出来 —— 断言就时灵时不灵。这里等到看见 turn.completed
     * 再发 shutdown。
     */
    private static Map<String, Set<String>> sessionIdsByMethod(boolean persistedFromStart) throws Exception {
        PipedOutputStream toServer = new PipedOutputStream();
        PipedInputStream serverIn = new PipedInputStream(toServer, 64 * 1024);
        CountDownLatch turnDone = new CountDownLatch(1);

        ByteArrayOutputStream captured = new ByteArrayOutputStream() {
            @Override public synchronized void write(byte[] b, int off, int len) {
                super.write(b, off, len);
                if (toString(StandardCharsets.UTF_8).contains("turn.completed")) turnDone.countDown();
            }
        };

        Thread server = new Thread(() -> {
            try {
                new AppServer(serverIn, captured, factory(persistedFromStart)).serve();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }, "test-appserver");
        server.setDaemon(true);
        server.start();

        send(toServer, "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        send(toServer, "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"turn.submit\",\"params\":{\"input\":\"hi\",\"mode\":\"react\"}}");
        assertTrue(turnDone.await(10, TimeUnit.SECONDS), "轮次没在 10s 内完成");
        send(toServer, "{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        toServer.close();
        server.join(5_000);

        Map<String, Set<String>> byMethod = new LinkedHashMap<>();
        for (JsonNode n : parseAll(captured.toString(StandardCharsets.UTF_8))) {
            if (!n.hasNonNull("method")) continue;
            JsonNode sid = n.path("params").path("sessionId");
            if (sid.isTextual()) {
                byMethod.computeIfAbsent(n.get("method").asText(), k -> new LinkedHashSet<>()).add(sid.asText());
            }
        }
        assertTrue(byMethod.containsKey("message.delta"), "没抓到渲染器发的事件,测试没测到东西:" + byMethod);
        return byMethod;
    }

    private static void send(PipedOutputStream to, String line) throws Exception {
        to.write((line + "\n").getBytes(StandardCharsets.UTF_8));
        to.flush();
    }

    @Test
    void allEventsOfOneSessionReportTheSameId() throws Exception {
        Map<String, Set<String>> byMethod = sessionIdsByMethod(true);

        Set<String> all = new LinkedHashSet<>();
        byMethod.values().forEach(all::addAll);
        assertTrue(all.size() == 1,
                "同一会话报了多个 sessionId,按事件类型拆开看:" + byMethod);
    }

    @Test
    void rendererEventsFollowThePersistedIdAfterFirstTurn() throws Exception {
        Map<String, Set<String>> byMethod = sessionIdsByMethod(true);

        // message.delta 出自 EventStreamRenderer.base(),与 approval.requested 同源 ——
        // 它跟不跟得上换号,决定了 approval 的 sessionId 可不可信。
        assertEquals(Set.of(PERSISTED), byMethod.get("message.delta"),
                "渲染器发的事件没跟上持久化 id:" + byMethod);
        assertEquals(Set.of(PERSISTED), byMethod.get("turn.completed"), byMethod.toString());
        assertEquals(Set.of(PERSISTED), byMethod.get("turn.started"), byMethod.toString());
    }

    @Test
    void staysOnWireIdWhenNothingIsEverPersisted() throws Exception {
        // 有的运行形态不落桩(beginTurn/persistTurn 都返回 null),那时全程用 wire id 是对的 ——
        // 这条防止"修一致性"被做成"提前编造一个 id"。
        Map<String, Set<String>> byMethod = sessionIdsByMethod(false);
        Set<String> all = new LinkedHashSet<>();
        byMethod.values().forEach(all::addAll);
        assertEquals(1, all.size(), "不落桩时也该只有一个 id:" + byMethod);
        assertTrue(all.iterator().next().startsWith("sess_"), "应保持 wire id,实际:" + all);
    }
}
