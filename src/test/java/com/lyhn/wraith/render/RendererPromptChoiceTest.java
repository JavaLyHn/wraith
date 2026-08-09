package com.lyhn.wraith.render;

import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import org.junit.jupiter.api.Test;
import java.io.PrintStream;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class RendererPromptChoiceTest {

    @Test
    void openPaletteDelegatesToPromptChoice() {
        List<String> items = List.of("alpha", "beta", "gamma");
        Renderer renderer = new Renderer() {
            @Override
            public ChoiceResult promptChoice(ChoiceRequest request) {
                assertEquals(3, request.options().size());
                assertEquals("beta", request.options().get(1).label());
                return ChoiceResult.selected(1);
            }
            @Override public void start() {}
            @Override public void close() {}
            @Override public PrintStream stream() { return System.out; }
            @Override public void appendToolCalls(List<com.lyhn.wraith.llm.LlmClient.ToolCall> toolCalls) {}
            @Override public void appendDiff(String filePath, String before, String after) {}
            @Override public void updateStatus(StatusInfo status) {}
            @Override public ApprovalResult promptApproval(ApprovalRequest request) { return ApprovalResult.reject("test"); }
        };

        int result = renderer.openPalette("test", items);
        assertEquals(1, result);
    }

    @Test
    void openPaletteReturnsNegOneWhenCancelled() {
        Renderer renderer = new Renderer() {
            @Override
            public ChoiceResult promptChoice(ChoiceRequest request) {
                return ChoiceResult.cancelled();
            }
            @Override public void start() {}
            @Override public void close() {}
            @Override public PrintStream stream() { return System.out; }
            @Override public void appendToolCalls(List<com.lyhn.wraith.llm.LlmClient.ToolCall> toolCalls) {}
            @Override public void appendDiff(String filePath, String before, String after) {}
            @Override public void updateStatus(StatusInfo status) {}
            @Override public ApprovalResult promptApproval(ApprovalRequest request) { return ApprovalResult.reject("test"); }
        };

        int result = renderer.openPalette("test", List.of("a", "b"));
        assertEquals(-1, result);
    }
}
