package com.lyhn.wraith.tool;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class ToolRegistryUiIntentTest {

    @Test
    void openPanelAcceptsKnownPanel() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("open_panel", "{\"panel\":\"im-gateway\"}");
        assertTrue(out.contains("im-gateway"), "合法面板应回确认串,含面板 id;实际: " + out);
    }

    @Test
    void openPanelNormalizesMcpAlias() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("open_panel", "{\"panel\":\"mcp\"}");
        assertTrue(out.contains("plugins"), "别名 mcp 应归一到 plugins;实际: " + out);
    }

    @Test
    void openPanelRejectsUnknownPanel() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("open_panel", "{\"panel\":\"nope\"}");
        assertTrue(out.startsWith("open_panel 失败"), "非法面板应回失败串;实际: " + out);
    }

    @Test
    void openPanelIsExposedToLlm() {
        ToolRegistry reg = new ToolRegistry();
        boolean present = reg.getToolDefinitions().stream().anyMatch(t -> t.name().equals("open_panel"));
        assertTrue(present, "open_panel 应出现在 getToolDefinitions()");
    }

    @Test
    void imConnectAcceptsKnownPlatform() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("im_connect", "{\"platform\":\"weixin\"}");
        assertTrue(out.contains("weixin"), "合法平台应回确认串;实际: " + out);
    }

    @Test
    void imConnectRejectsUnknownPlatform() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("im_connect", "{\"platform\":\"telegram\"}");
        assertTrue(out.startsWith("im_connect 失败"), "非法平台应回失败串;实际: " + out);
    }

    @Test
    void imConnectIsExposedToLlm() {
        ToolRegistry reg = new ToolRegistry();
        boolean present = reg.getToolDefinitions().stream().anyMatch(t -> t.name().equals("im_connect"));
        assertTrue(present, "im_connect 应出现在 getToolDefinitions()");
    }
}
