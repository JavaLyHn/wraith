package com.lyhn.wraith.render.inline;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.render.*;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class InlineApprovalPrompterTest {

    @Test
    void approveWhenSelected() {
        MockChoiceRenderer renderer = new MockChoiceRenderer(ChoiceResult.selected(0));
        InlineApprovalPrompter prompter = new InlineApprovalPrompter(
            new PrintStream(new ByteArrayOutputStream()),
            renderer,
            new BufferedReader(new StringReader(""))
        );

        ApprovalRequest req = ApprovalRequest.of("test_tool", "{}", "test");
        ApprovalResult result = prompter.prompt(req);

        assertEquals(ApprovalResult.Decision.APPROVED, result.decision());
    }

    @Test
    void rejectWhenSelected() {
        MockChoiceRenderer renderer = new MockChoiceRenderer(ChoiceResult.selected(2));
        InlineApprovalPrompter prompter = new InlineApprovalPrompter(
            new PrintStream(new ByteArrayOutputStream()),
            renderer,
            new BufferedReader(new StringReader("安全风险\n"))
        );

        ApprovalRequest req = ApprovalRequest.of("test_tool", "{}", "test");
        ApprovalResult result = prompter.prompt(req);

        assertEquals(ApprovalResult.Decision.REJECTED, result.decision());
        assertEquals("安全风险", result.reason());
    }

    @Test
    void skipWhenSelected() {
        MockChoiceRenderer renderer = new MockChoiceRenderer(ChoiceResult.selected(3));
        InlineApprovalPrompter prompter = new InlineApprovalPrompter(
            new PrintStream(new ByteArrayOutputStream()),
            renderer,
            new BufferedReader(new StringReader(""))
        );

        ApprovalRequest req = ApprovalRequest.of("test_tool", "{}", "test");
        ApprovalResult result = prompter.prompt(req);

        assertEquals(ApprovalResult.Decision.SKIPPED, result.decision());
    }

    @Test
    void approveAllWhenSelectedOnBuiltinTool() {
        // 非敏感请求 + 非 MCP 工具：selected(1) → promptApproveAllScope 直返 approveAll
        MockChoiceRenderer renderer = new MockChoiceRenderer(ChoiceResult.selected(1));
        InlineApprovalPrompter prompter = new InlineApprovalPrompter(
            new PrintStream(new ByteArrayOutputStream()),
            renderer,
            new BufferedReader(new StringReader(""))
        );

        ApprovalRequest req = ApprovalRequest.of("write_file", "{\"path\":\"a\"}", "test");
        ApprovalResult result = prompter.prompt(req);

        assertEquals(ApprovalResult.Decision.APPROVED_ALL, result.decision());
    }

    @Test
    void modifyWhenSelectedWithValidJson() {
        // 非敏感请求：selected(4) → promptForModifiedArgs 从 stdinReader 读合法 JSON
        MockChoiceRenderer renderer = new MockChoiceRenderer(ChoiceResult.selected(4));
        InlineApprovalPrompter prompter = new InlineApprovalPrompter(
            new PrintStream(new ByteArrayOutputStream()),
            renderer,
            new BufferedReader(new StringReader("{\"path\":\"safe.txt\"}\n"))
        );

        ApprovalRequest req = ApprovalRequest.of("write_file", "{\"path\":\"a\"}", "test");
        ApprovalResult result = prompter.prompt(req);

        assertEquals(ApprovalResult.Decision.MODIFIED, result.decision());
        assertNotNull(result.modifiedArguments());
        assertTrue(result.modifiedArguments().contains("safe.txt"));
    }

    @Test
    void cancelReturnsReject() {
        // promptChoice 返回 cancelled → 保守拒绝，reason="用户取消"
        MockChoiceRenderer renderer = new MockChoiceRenderer(ChoiceResult.cancelled());
        InlineApprovalPrompter prompter = new InlineApprovalPrompter(
            new PrintStream(new ByteArrayOutputStream()),
            renderer,
            new BufferedReader(new StringReader(""))
        );

        ApprovalRequest req = ApprovalRequest.of("test_tool", "{}", "test");
        ApprovalResult result = prompter.prompt(req);

        assertEquals(ApprovalResult.Decision.REJECTED, result.decision());
        assertEquals("用户取消", result.reason());
    }

    @Test
    void sensitiveRequestHasNoApproveAllOption() {
        // 敏感请求选项为 [批准, 拒绝, 跳过, 修改参数]（无全部放行），
        // selected(1) 落到 rejectIdx（sensitive 路径下 rejectIdx=1）
        MockChoiceRenderer renderer = new MockChoiceRenderer(ChoiceResult.selected(1));
        InlineApprovalPrompter prompter = new InlineApprovalPrompter(
            new PrintStream(new ByteArrayOutputStream()),
            renderer,
            new BufferedReader(new StringReader("敏感拒绝\n"))
        );

        ApprovalRequest req = ApprovalRequest.of("execute_command", "{}", "test", null, "敏感页面操作");
        ApprovalResult result = prompter.prompt(req);

        assertEquals(ApprovalResult.Decision.REJECTED, result.decision());
        assertEquals("敏感拒绝", result.reason());
    }

    private static class MockChoiceRenderer implements Renderer {
        private final ChoiceResult result;
        MockChoiceRenderer(ChoiceResult result) { this.result = result; }
        @Override public ChoiceResult promptChoice(ChoiceRequest request) { return result; }
        @Override public void start() {}
        @Override public void close() {}
        @Override public PrintStream stream() { return System.out; }
        @Override public void appendToolCalls(List<com.lyhn.wraith.llm.LlmClient.ToolCall> toolCalls) {}
        @Override public void appendDiff(String filePath, String before, String after) {}
        @Override public void updateStatus(StatusInfo status) {}
        @Override public ApprovalResult promptApproval(ApprovalRequest request) { return ApprovalResult.reject("test"); }
    }
}
