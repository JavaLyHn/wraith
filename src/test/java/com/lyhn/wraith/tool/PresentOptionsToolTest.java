package com.lyhn.wraith.tool;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.render.ChoiceRequest;
import com.lyhn.wraith.render.ChoiceResult;
import com.lyhn.wraith.render.Renderer;
import com.lyhn.wraith.render.StatusInfo;
import org.junit.jupiter.api.Test;

import java.io.PrintStream;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PresentOptionsToolTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void validCallReturnsSelectedLabel() {
        Renderer mockRenderer = new MockRenderer(ChoiceResult.selected(0));
        PresentOptionsTool tool = new PresentOptionsTool(mockRenderer, MAPPER);

        String result = tool.execute(java.util.Map.of(
            "title", "选择方案",
            "options", "[{\"label\":\"方案A\"},{\"label\":\"方案B\"}]"
        ));

        assertEquals("方案A", result);
    }

    @Test
    void cancelledReturnsCancelledMarker() {
        Renderer mockRenderer = new MockRenderer(ChoiceResult.cancelled());
        PresentOptionsTool tool = new PresentOptionsTool(mockRenderer, MAPPER);

        String result = tool.execute(java.util.Map.of(
            "title", "选择",
            "options", "[{\"label\":\"A\"},{\"label\":\"B\"}]"
        ));

        assertEquals("__cancelled__", result);
    }

    @Test
    void tooFewOptionsReturnsError() {
        Renderer mockRenderer = new MockRenderer(ChoiceResult.cancelled());
        PresentOptionsTool tool = new PresentOptionsTool(mockRenderer, MAPPER);

        String result = tool.execute(java.util.Map.of(
            "title", "选择",
            "options", "[{\"label\":\"A\"}]"
        ));

        assertTrue(result.contains("失败") || result.contains("错误") || result.contains("error"));
    }

    @Test
    void duplicateLabelsReturnsError() {
        Renderer mockRenderer = new MockRenderer(ChoiceResult.cancelled());
        PresentOptionsTool tool = new PresentOptionsTool(mockRenderer, MAPPER);

        String result = tool.execute(java.util.Map.of(
            "title", "选择",
            "options", "[{\"label\":\"A\"},{\"label\":\"A\"}]"
        ));

        assertTrue(result.contains("失败") || result.contains("重复") || result.contains("error"));
    }

    private static class MockRenderer implements Renderer {
        private final ChoiceResult result;
        MockRenderer(ChoiceResult result) { this.result = result; }
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
