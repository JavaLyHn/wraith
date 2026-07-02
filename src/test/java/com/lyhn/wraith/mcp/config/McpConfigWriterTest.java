package com.lyhn.wraith.mcp.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class McpConfigWriterTest {

    @Test
    void upsertCreatesFileAndParentDirs(@TempDir Path dir) throws Exception {
        Path f = dir.resolve(".wraith").resolve("mcp.json");
        McpConfigWriter.upsert(f, "srv", "npx", List.of("-y", "pkg"), Map.of("KEY", "v1"));
        String json = Files.readString(f);
        assertTrue(json.contains("\"srv\""));
        assertTrue(json.contains("\"npx\""));
        assertTrue(json.contains("\"v1\""));
    }

    @Test
    void upsertPreservesUnknownFieldsAndDisabled(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("mcp.json");
        Files.writeString(f, """
                {"customTop":1,"mcpServers":{"srv":{"command":"old","disabled":true,"customField":"keep"}}}""");
        McpConfigWriter.upsert(f, "srv", "new-cmd", List.of(), Map.of());
        String json = Files.readString(f);
        assertTrue(json.contains("\"customTop\""), "顶层未知字段保留");
        assertTrue(json.contains("\"customField\""), "server 级未知字段保留");
        assertTrue(json.contains("\"disabled\""), "disabled 保留");
        assertTrue(json.contains("\"new-cmd\""));
        assertFalse(json.contains("\"old\""));
    }

    @Test
    void upsertClearsHttpFieldsWhenWritingStdio(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("mcp.json");
        Files.writeString(f, """
                {"mcpServers":{"srv":{"url":"https://x","headers":{"A":"B"}}}}""");
        McpConfigWriter.upsert(f, "srv", "cmd", List.of(), Map.of());
        String json = Files.readString(f);
        assertFalse(json.contains("\"url\""), "stdio 覆盖时清 url(transport 二选一校验)");
        assertFalse(json.contains("\"headers\""));
    }

    @Test
    void emptyEnvValueKeepsExistingAndIgnoresNew(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("mcp.json");
        Files.writeString(f, """
                {"mcpServers":{"srv":{"command":"c","env":{"TOKEN":"secret-old"}}}}""");
        McpConfigWriter.upsert(f, "srv", "c", List.of(), Map.of("TOKEN", "", "NEW_EMPTY", "", "NEW", "nv"));
        String json = Files.readString(f);
        assertTrue(json.contains("secret-old"), "空串=保留现值");
        assertFalse(json.contains("NEW_EMPTY"), "原无此 key 的空串被忽略");
        assertTrue(json.contains("\"nv\""));
    }

    @Test
    void removeReturnsFalseWhenAbsentTrueWhenRemoved(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("mcp.json");
        assertFalse(McpConfigWriter.remove(f, "srv"), "文件不存在");
        Files.writeString(f, """
                {"mcpServers":{"srv":{"command":"c"},"other":{"command":"o"}}}""");
        assertFalse(McpConfigWriter.remove(f, "ghost"));
        assertTrue(McpConfigWriter.remove(f, "srv"));
        String json = Files.readString(f);
        assertFalse(json.contains("\"srv\""));
        assertTrue(json.contains("\"other\""));
    }

    @Test
    void corruptJsonThrowsInsteadOfClobbering(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("mcp.json");
        Files.writeString(f, "not json{{");
        assertThrows(IOException.class, () -> McpConfigWriter.upsert(f, "s", "c", List.of(), Map.of()));
        assertThrows(IOException.class, () -> McpConfigWriter.remove(f, "s"));
        assertEquals("not json{{", Files.readString(f), "坏文件原样保留,绝不覆盖");
    }

    @Test
    void upsertRefusesToClobberNonObjectNodes(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("mcp.json");
        Files.writeString(f, "{\"mcpServers\":[1,2,3]}");
        assertThrows(IOException.class, () -> McpConfigWriter.upsert(f, "s", "c", List.of(), Map.of()));
        assertEquals("{\"mcpServers\":[1,2,3]}", Files.readString(f), "异形内容原样保留");
        Files.writeString(f, "{\"mcpServers\":{\"srv\":42}}");
        assertThrows(IOException.class, () -> McpConfigWriter.upsert(f, "srv", "c", List.of(), Map.of()));
    }
}
