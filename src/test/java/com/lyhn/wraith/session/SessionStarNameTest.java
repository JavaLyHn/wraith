package com.lyhn.wraith.session;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SessionStarNameTest {

    @TempDir Path home;

    private SessionStore openStore() {
        return SessionStore.open(home, "/proj-A", "deepseek", "deepseek-chat");
    }

    private String seedOneTurn(SessionStore s) {
        s.startNew();
        s.persist(List.of(LlmClient.Message.user("你好世界")));
        return s.currentId();
    }

    @Test void newSessionDefaultsStarredFalseNameNull() {
        SessionStore s = openStore();
        String id = seedOneTurn(s);
        SessionMeta m = s.meta(id);
        assertNotNull(m);
        assertFalse(m.starred());
        assertNull(m.name());
    }

    @Test void setStarredPersistsAndSurvivesNextPersist() {
        SessionStore s = openStore();
        String id = seedOneTurn(s);
        assertTrue(s.setStarred(id, true));
        assertTrue(s.meta(id).starred(), "setStarred 应写入 starred=true");
        // 同一会话再来一轮对话:persist 不得把 starred 冲掉
        s.persist(List.of(LlmClient.Message.user("你好世界"), LlmClient.Message.assistant("在"),
                LlmClient.Message.user("再来一句")));
        assertTrue(s.meta(id).starred(), "persist 必须保留已有 starred");
    }

    @Test void renameSetsAndClears() {
        SessionStore s = openStore();
        String id = seedOneTurn(s);
        assertTrue(s.rename(id, "部署脚本"));
        assertEquals("部署脚本", s.meta(id).name());
        assertTrue(s.rename(id, "  "));               // 空白 → 清除
        assertNull(s.meta(id).name(), "空白 name 应清除自定义名");
    }

    @Test void setStarredRenameOnMissingIdReturnsFalse() {
        SessionStore s = openStore();
        assertFalse(s.setStarred("nope-0000", true));
        assertFalse(s.rename("nope-0000", "x"));
    }

    @Test void legacyFileWithoutStarredNameReadsAsFalseNull() throws Exception {
        // 手写一个旧格式 meta 行(无 starred/name)+ 一条消息
        Path dir = home.resolve(".wraith").resolve("sessions").resolve(SessionStore.hash("/proj-A"));
        Files.createDirectories(dir);
        String legacy = "{\"v\":1,\"id\":\"20260101-000000-abcd\",\"cwd\":\"/proj-A\","
                + "\"createdAt\":\"2026-01-01T00:00:00Z\",\"updatedAt\":\"2026-01-01T00:00:00Z\","
                + "\"provider\":\"deepseek\",\"model\":\"deepseek-chat\",\"title\":\"旧会话\",\"turns\":1}\n"
                + "{\"role\":\"user\",\"content\":\"hi\"}\n";
        Files.writeString(dir.resolve("20260101-000000-abcd.jsonl"), legacy, StandardCharsets.UTF_8);
        SessionStore s = openStore();
        SessionMeta m = s.meta("20260101-000000-abcd");
        assertNotNull(m);
        assertFalse(m.starred());
        assertNull(m.name());
        assertEquals("旧会话", m.title());
    }

    @Test void deleteByIdRemovesFileAndIsIdempotent() {
        SessionStore s = openStore();
        String id = seedOneTurn(s);
        assertNotNull(s.meta(id));
        assertTrue(s.deleteById(id), "首次删除应返回 true");
        assertNull(s.currentId(), "删除当前会话后 currentId 应被重置为 null");
        assertNull(s.meta(id), "删除后 meta 应为 null");
        assertFalse(s.deleteById(id), "再次删除不存在的文件返回 false");
    }
}
