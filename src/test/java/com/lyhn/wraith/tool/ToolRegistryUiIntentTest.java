package com.lyhn.wraith.tool;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
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

    /**
     * 新增面板必须同步登记 open_panel 的白名单,否则模型传该 panel 只拿到「未知面板」,
     * 动作卡永远不出现 —— 桌面渲染侧的 PanelId 里已有它,而 Java 侧漏登记就悄悄破掉了
     * 「聊天↔面板对等」这条已交付的不变量(「文档」面板首版就漏了这里,由 final review 抓出)。
     */
    @Test
    void openPanelAcceptsDocumentsPanel() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("open_panel", "{\"panel\":\"documents\"}");
        assertTrue(out.contains("documents"), "documents 应是合法面板;实际: " + out);
        assertFalse(out.startsWith("open_panel 失败"), "documents 不该被判成未知面板;实际: " + out);
    }

    @Test
    void openPanelAcceptsProjectsPanel() {
        ToolRegistry reg = new ToolRegistry();
        String out = reg.executeTool("open_panel", "{\"panel\":\"projects\"}");
        assertTrue(out.contains("projects"), "projects 应是合法面板;实际: " + out);
        assertFalse(out.startsWith("open_panel 失败"), "projects 不该被判成未知面板;实际: " + out);
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
