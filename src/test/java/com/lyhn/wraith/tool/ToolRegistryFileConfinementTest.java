package com.lyhn.wraith.tool;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/** 工具边界锁:文件工具必须拒绝 workspace 外路径(spec §4.2)。 */
class ToolRegistryFileConfinementTest {

    private static final ObjectMapper M = new ObjectMapper();

    private static String args(String key, String value) {
        ObjectNode n = M.createObjectNode();
        n.put(key, value);
        return n.toString();
    }

    @Test
    void writeFileRejectsPathOutsideWorkspace() throws Exception {
        Path ws = Files.createTempDirectory("wraith-conf-ws-");
        ToolRegistry reg = new ToolRegistry();
        reg.setProjectPath(ws.toString());

        String escapeName = "escape-" + System.nanoTime() + ".txt";
        ObjectNode a = M.createObjectNode();
        a.put("path", "../" + escapeName);
        a.put("content", "should not be written");
        String out = reg.executeToolOutput("write_file", a.toString()).text();

        // PathGuard 抛 PolicyException,executeTool 统一格式化为拒绝消息
        assertTrue(out.contains("拒绝") || out.toLowerCase().contains("policy")
                        || out.contains("越界") || out.contains("失败"),
                "越界写入应被拒绝,实际输出: " + out);
        // 越界写若发生会落在 workspace 的父目录下,精确检查该真实路径
        assertFalse(Files.exists(ws.getParent().resolve(escapeName)),
                "越界文件不应被创建");
    }

    @Test
    void readFileRejectsAbsolutePathOutsideWorkspace() throws Exception {
        Path ws = Files.createTempDirectory("wraith-conf-ws2-");
        ToolRegistry reg = new ToolRegistry();
        reg.setProjectPath(ws.toString());

        String out = reg.executeToolOutput("read_file", args("path", "/etc/hosts")).text();
        assertTrue(out.contains("拒绝") || out.toLowerCase().contains("policy")
                        || out.contains("越界") || out.contains("失败"),
                "越界读取应被拒绝,实际输出: " + out);
    }

    @Test
    void writeFileAllowsPathInsideWorkspace() throws Exception {
        Path ws = Files.createTempDirectory("wraith-conf-ws3-");
        ToolRegistry reg = new ToolRegistry();
        reg.setProjectPath(ws.toString());

        ObjectNode a = M.createObjectNode();
        a.put("path", "inside.txt");
        a.put("content", "ok");
        String out = reg.executeToolOutput("write_file", a.toString()).text();

        assertTrue(Files.exists(ws.resolve("inside.txt")), "workspace 内写入应成功: " + out);
        assertEquals("ok", Files.readString(ws.resolve("inside.txt")));
    }
}
