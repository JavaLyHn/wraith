package com.lyhn.wraith.agent;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.render.Renderer;
import com.lyhn.wraith.render.StatusInfo;
import com.lyhn.wraith.tool.ToolRegistry.ToolExecutionResult;
import org.junit.jupiter.api.Test;

import java.io.OutputStream;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** 非命令类工具收尾必须回发 tool.output.delta/tool.result,否则桌面卡片永远 running。 */
class AgentToolCardEmitTest {

    /** 捕获式假渲染器(避 Mockito):只记录 appendToolOutputDelta/appendToolResult。 */
    static class CapturingRenderer implements Renderer {
        record Output(String callId, String stream, String chunk) {}
        record Result(String callId, boolean ok, int exitCode) {}
        final List<Output> outputs = new ArrayList<>();
        final List<Result> results = new ArrayList<>();

        @Override public void appendToolOutputDelta(String callId, String stream, String chunk) {
            outputs.add(new Output(callId, stream, chunk));
        }
        @Override public void appendToolResult(String callId, boolean ok, int exitCode) {
            results.add(new Result(callId, ok, exitCode));
        }
        // 以下为接口必需的最小实现
        @Override public void start() {}
        @Override public void close() {}
        @Override public PrintStream stream() { return new PrintStream(OutputStream.nullOutputStream()); }
        @Override public void appendToolCalls(List<LlmClient.ToolCall> toolCalls) {}
        @Override public void appendDiff(String filePath, String before, String after) {}
        @Override public void updateStatus(StatusInfo status) {}
        @Override public ApprovalResult promptApproval(ApprovalRequest request) { return ApprovalResult.approve(); }
        @Override public int openPalette(String title, List<String> items) { return -1; }
    }

    private static ToolExecutionResult result(String id, String name, String text, boolean timedOut, boolean ok) {
        return new ToolExecutionResult(id, name, "{}", text, 5L, timedOut, List.of(), ok);
    }

    @Test
    void nonCommandToolEmitsOutputAndOkResult() {
        CapturingRenderer r = new CapturingRenderer();
        Agent.emitToolCardResult(r, result("c1", "web_search", "搜索结果…", false, true));
        assertEquals(1, r.outputs.size());
        assertEquals("c1", r.outputs.get(0).callId());
        assertEquals("搜索结果…", r.outputs.get(0).chunk());
        assertEquals(List.of(new CapturingRenderer.Result("c1", true, 0)), r.results);
    }

    @Test
    void executeCommandIsSkippedEntirely() {
        // execute_command 已由 CommandOutputObserver 流式输出+收尾,再发就双份
        CapturingRenderer r = new CapturingRenderer();
        Agent.emitToolCardResult(r, result("c2", "execute_command", "hi", false, true));
        assertTrue(r.outputs.isEmpty());
        assertTrue(r.results.isEmpty());
    }

    @Test
    void timedOutToolEmitsNotOk() {
        CapturingRenderer r = new CapturingRenderer();
        Agent.emitToolCardResult(r, result("c3", "read_file", "工具执行超时（60秒），已取消", true, false));
        assertEquals(List.of(new CapturingRenderer.Result("c3", false, 1)), r.results);
    }

    @Test
    void failedPrefixEmitsNotOk() {
        CapturingRenderer r = new CapturingRenderer();
        Agent.emitToolCardResult(r, result("c4", "read_file", "工具执行失败: boom", false, false));
        assertEquals(List.of(new CapturingRenderer.Result("c4", false, 1)), r.results);
    }

    @Test
    void emptyResultEmitsOnlyResultNoOutput() {
        CapturingRenderer r = new CapturingRenderer();
        Agent.emitToolCardResult(r, result("c5", "todo_write", "", false, true));
        assertTrue(r.outputs.isEmpty());
        assertEquals(1, r.results.size());
    }

    @Test
    void oversizedResultIsTruncated() {
        CapturingRenderer r = new CapturingRenderer();
        String big = "x".repeat(20_000);
        Agent.emitToolCardResult(r, result("c6", "read_file", big, false, true));
        assertEquals(1, r.outputs.size());
        String chunk = r.outputs.get(0).chunk();
        assertTrue(chunk.length() < 20_000, "超长结果应截断");
        assertTrue(chunk.endsWith("…(已截断)"), "截断需有标记");
    }

    @Test
    void nullRendererIsSafeNoop() {
        assertDoesNotThrow(() -> Agent.emitToolCardResult(null, result("c7", "read_file", "x", false, true)));
    }

    // -----------------------------------------------------------------------
    // HITL / 策略拒绝的 execute_command：CommandOutputObserver 未触发，
    // emitToolCardResult 必须补发 tool.result（ok=false），否则桌面卡片永远 running。
    // -----------------------------------------------------------------------

    @Test
    void hitlDeniedExecuteCommandEmitsFailResult() {
        // HITL 拒绝：文本以 "[HITL]" 开头，CommandOutputObserver 未触发
        CapturingRenderer r = new CapturingRenderer();
        Agent.emitToolCardResult(r, result("c8", "execute_command",
                "[HITL] 操作已被拒绝：用户拒绝了此操作", false, false));
        // 必须补发一个 ok=false 的 tool.result
        assertEquals(1, r.results.size(), "HITL 拒绝的 execute_command 必须补发 tool.result");
        assertFalse(r.results.get(0).ok(), "HITL 拒绝结果 ok 应为 false");
        assertEquals("c8", r.results.get(0).callId());
    }

    @Test
    void hitlSkippedExecuteCommandEmitsFailResult() {
        // HITL 跳过：文本同样以 "[HITL]" 开头
        CapturingRenderer r = new CapturingRenderer();
        Agent.emitToolCardResult(r, result("c9", "execute_command",
                "[HITL] 操作已被跳过", false, false));
        assertEquals(1, r.results.size(), "HITL 跳过的 execute_command 必须补发 tool.result");
        assertFalse(r.results.get(0).ok());
    }

    @Test
    void policyDeniedExecuteCommandEmitsFailResult() {
        // 策略拒绝：文本以 "🛡️ 策略拒绝" 开头
        CapturingRenderer r = new CapturingRenderer();
        Agent.emitToolCardResult(r, result("c10", "execute_command",
                "🛡️ 策略拒绝: 命令不在白名单", false, false));
        assertEquals(1, r.results.size(), "策略拒绝的 execute_command 必须补发 tool.result");
        assertFalse(r.results.get(0).ok());
    }

    @Test
    void normalExecuteCommandStillSkipped() {
        // 正常执行的 execute_command：由 CommandOutputObserver 处理，emitToolCardResult 不应重复发
        CapturingRenderer r = new CapturingRenderer();
        Agent.emitToolCardResult(r, result("c11", "execute_command",
                "ls -la\n总用量 8\n…", false, true));
        assertTrue(r.outputs.isEmpty(), "正常执行的 execute_command 不应重复发 output.delta");
        assertTrue(r.results.isEmpty(), "正常执行的 execute_command 不应重复发 tool.result");
    }
}
