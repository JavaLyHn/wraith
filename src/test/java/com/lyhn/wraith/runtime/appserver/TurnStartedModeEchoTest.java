package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code turn.started} 必须回声本轮<b>实际生效</b>的模式。
 *
 * <p><b>用户的第二半诉求</b>：「现在切换模式仅仅是右下角这一个模式切换，
 * <b>不能知道 agent 当前有没有感知到模式的切换</b>」。
 *
 * <p>此前模式是一条<b>单向</b>的线：前端 {@code pendingMode}（一个 React state）→
 * {@code turn.submit} 的 mode 参数 → 后端分支。没有任何回声，于是：
 * <ul>
 *   <li>用户无法确认后端收到的是哪个模式</li>
 *   <li>更糟的是它会<b>静默降级</b>：分支条件是
 *       {@code if (!"plan".equals(mode) && !"team".equals(mode))} —— 任何拼错的、
 *       带空格的、大写的值都会安静地按 ReAct 跑，没人知道</li>
 * </ul>
 *
 * <p>所以回声的是<b>归一化之后</b>的值（后端真正要用的那个），不是原样回传参数 ——
 * 原样回传只能证明"我收到了字符串"，证明不了"我按它跑"。
 */
class TurnStartedModeEchoTest {

    /** 一次提交的观测结果：回声给前端的模式 + runTurn 实际收到的模式。 */
    private record Observed(String echoed, String actuallyRan) {}

    private static Observed submitObserved(String modeJson) throws Exception {
        List<JsonNode> frames = submit(modeJson);
        return new Observed(startedMode(frames), LAST_RUN_MODE.get());
    }

    /** runTurn 在另一条线程上跑，用它把实际收到的 mode 交出来。 */
    private static final java.util.concurrent.atomic.AtomicReference<String> LAST_RUN_MODE =
            new java.util.concurrent.atomic.AtomicReference<>("(runTurn 没被调用)");

    private static List<JsonNode> submit(String modeJson) throws Exception {
        WraithConfig cfg = new WraithConfig();
        LAST_RUN_MODE.set("(runTurn 没被调用)");
        java.util.concurrent.CountDownLatch ran = new java.util.concurrent.CountDownLatch(1);
        AppServer.SessionRunnerFactory f = (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public Map<String, Object> modelList() { return ModelCatalog.result(cfg, "deepseek", "m", false); }
            public String runTurn(String input, java.util.List<com.lyhn.wraith.llm.LlmClient.ContentPart> parts,
                                  java.util.List<String> names, String mode) {
                LAST_RUN_MODE.set(mode);
                ran.countDown();
                return "ok";
            }
        };

        String input = String.join("\n",
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"turn.submit\",\"params\":{\"input\":\"hi\""
                        + (modeJson == null ? "" : ",\"mode\":" + modeJson) + "}}") + "\n";

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Thread server = new Thread(() -> {
            try {
                new AppServer(new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8)), out, f).serve();
            } catch (Exception ignored) {
                // serve() 读到流尾就返回;本测试只关心 turn.started 那一帧
            }
        }, "test-appserver");
        server.setDaemon(true);
        server.start();
        server.join(TimeUnit.SECONDS.toMillis(5));
        // runTurn 跑在另一条线程上,serve() 返回不等于它已被调用
        ran.await(5, TimeUnit.SECONDS);

        List<JsonNode> frames = new ArrayList<>();
        for (String line : out.toString(StandardCharsets.UTF_8).split("\n")) {
            if (line.isBlank()) continue;
            try { frames.add(JsonRpc.MAPPER.readTree(line)); } catch (Exception ignored) { }
        }
        return frames;
    }

    private static String startedMode(List<JsonNode> frames) {
        for (JsonNode n : frames) {
            if ("turn.started".equals(n.path("method").asText())) {
                return n.path("params").path("mode").asText("(缺 mode 字段)");
            }
        }
        return "(没有 turn.started)";
    }

    @Test
    @DisplayName("react / plan / team 各自回声")
    void knownModesAreEchoed() throws Exception {
        assertEquals("react", startedMode(submit("\"react\"")));
        assertEquals("plan", startedMode(submit("\"plan\"")));
        assertEquals("team", startedMode(submit("\"team\"")));
    }

    @Test
    @DisplayName("没传 mode 时回声 react —— 缺省值也要说出来")
    void missingModeEchoesDefault() throws Exception {
        assertEquals("react", startedMode(submit(null)));
    }

    /**
     * <b>核心不变量:回声 == 实际跑的那个。</b>
     *
     * <p>不是「拼错就回 react」——那只是当下的某个具体行为。真正要守的是回声与行为
     * 不许分裂:UI 显示的模式必须是本轮真正生效的模式,否则就是换了一种假话。
     */
    @Test
    @DisplayName("回声必须等于 runTurn 真正收到的模式 —— 各种边角输入都不许分裂")
    void echoAlwaysMatchesWhatActuallyRan() throws Exception {
        for (String raw : new String[]{"\"react\"", "\"plan\"", "\"team\"", null,
                "\"planx\"", "\" plan \"", "\"PLAN\"", "\"\"", "\"Team\""}) {
            Observed o = submitObserved(raw);
            assertEquals(o.actuallyRan(), o.echoed(),
                    "mode=" + raw + " 时回声与实际执行不一致 —— UI 会显示一个没生效过的模式");
        }
    }

    @Test
    @DisplayName("认不出来的值落到 react(与分支行为一致);trim/大小写这类是宽容接受而不是降级")
    void unknownDegradesToReactWhileLenientFormsAreAccepted() throws Exception {
        assertEquals("react", AppServer.normalizeRunMode("planx"));
        assertEquals("react", AppServer.normalizeRunMode(""));
        assertEquals("react", AppServer.normalizeRunMode(null));
        // 此前 " plan " / "PLAN" 会安静地按 ReAct 跑(分支用的是 equals);现在归一化一次,
        // 它们真的按 plan 跑,所以回声 plan 才是与行为一致的那个
        assertEquals("plan", AppServer.normalizeRunMode(" plan "));
        assertEquals("plan", AppServer.normalizeRunMode("PLAN"));
        assertEquals("team", AppServer.normalizeRunMode("Team"));
    }

    @Test
    @DisplayName("turn.started 里原有字段没被挤掉")
    void existingFieldsSurvive() throws Exception {
        List<JsonNode> frames = submit("\"plan\"");
        JsonNode started = frames.stream()
                .filter(n -> "turn.started".equals(n.path("method").asText()))
                .findFirst().orElseThrow();
        assertTrue(started.path("params").hasNonNull("turnId"), started.toString());
        assertTrue(started.path("params").has("sessionId"), started.toString());
    }
}
