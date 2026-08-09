package com.lyhn.wraith.tool;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class UiIntentToolsTest {

    private static LlmClient.ToolCall call(String id, String name) {
        return new LlmClient.ToolCall(id, new LlmClient.ToolCall.Function(name, "{}"));
    }

    @Test
    void filterKeepsOnlyUiIntentTools() {
        List<LlmClient.ToolCall> in = List.of(
                call("a", "read_file"),
                call("b", "open_panel"),
                call("c", "execute_command"),
                call("d", "im_connect"));
        List<LlmClient.ToolCall> out = UiIntentTools.filter(in);
        assertEquals(2, out.size());
        assertEquals("open_panel", out.get(0).function().name());
        assertEquals("im_connect", out.get(1).function().name());
    }

    @Test
    void filterReturnsEmptyWhenNoUiIntentTool() {
        assertTrue(UiIntentTools.filter(List.of(call("a", "read_file"))).isEmpty());
    }

    @Test
    void filterIsNullAndEmptySafe() {
        assertTrue(UiIntentTools.filter(null).isEmpty());
        assertTrue(UiIntentTools.filter(List.of()).isEmpty());
    }

    @Test
    void filterToleratesNullFunctionOrName() {
        // 极端防御:function 为 null 的畸形 ToolCall 不能让过滤炸掉
        List<LlmClient.ToolCall> in = List.of(new LlmClient.ToolCall("x", null), call("b", "open_panel"));
        List<LlmClient.ToolCall> out = UiIntentTools.filter(in);
        assertEquals(1, out.size());
        assertEquals("open_panel", out.get(0).function().name());
    }

    @Test
    void namesContainsExactlyTheThreeUiIntentTools() {
        assertEquals(java.util.Set.of("open_panel", "im_connect", "present_options"), UiIntentTools.NAMES);
    }

    @Test
    void everyUiIntentNameIsActuallyARegisteredTool() {
        // 防改名静默失配:NAMES 与 ToolRegistry 的注册名是两份字面量,断言它们联动
        ToolRegistry reg = new ToolRegistry();
        for (String name : UiIntentTools.NAMES) {
            assertTrue(reg.hasTool(name), "UiIntentTools.NAMES 里的 " + name + " 应是已注册工具");
        }
    }
}
