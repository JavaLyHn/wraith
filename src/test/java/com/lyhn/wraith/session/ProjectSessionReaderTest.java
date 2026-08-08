package com.lyhn.wraith.session;

import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class ProjectSessionReaderTest {

    /** 在指定项目下写 n 个会话,返回它们的 id(写入顺序)。 */
    private List<String> seed(Path home, String project, int n) {
        SessionStore store = SessionStore.open(home, project, "deepseek", "m1");
        List<String> ids = new java.util.ArrayList<>();
        for (int i = 0; i < n; i++) {
            store.startNew();
            store.persist(List.of(
                    LlmClient.Message.system("S"),
                    LlmClient.Message.user("消息 " + i)));
            ids.add(store.currentId());
        }
        return ids;
    }

    @Test
    void neverTouchedProjectYieldsZeroAndCreatesNoDirectory(@TempDir Path home) {
        List<ProjectSessionReader.Summary> out =
                ProjectSessionReader.summaries(home, List.of("/proj/never-used"));

        assertEquals(1, out.size());
        assertEquals("/proj/never-used", out.get(0).path());
        assertEquals(0, out.get(0).sessionCount());
        assertNull(out.get(0).lastSessionAt(), "无会话时 lastSessionAt 必须是 null,不是空串");
        assertFalse(Files.exists(home.resolve(".wraith").resolve("sessions")),
                "只读汇总不能在磁盘上建目录");
    }

    @Test
    void summariesKeepInputOrderAndCountPerProject(@TempDir Path home) {
        seed(home, "/proj/a", 3);
        seed(home, "/proj/b", 1);

        List<ProjectSessionReader.Summary> out =
                ProjectSessionReader.summaries(home, List.of("/proj/b", "/proj/a", "/proj/c"));

        assertEquals(List.of("/proj/b", "/proj/a", "/proj/c"),
                out.stream().map(ProjectSessionReader.Summary::path).toList());
        assertEquals(1, out.get(0).sessionCount());
        assertEquals(3, out.get(1).sessionCount());
        assertEquals(0, out.get(2).sessionCount());
        assertNotNull(out.get(1).lastSessionAt());
    }

    @Test
    void summaryExcludesArchivedFromCountAndTimestamp(@TempDir Path home) {
        List<String> ids = seed(home, "/proj/a", 2);
        SessionStore store = SessionStore.open(home, "/proj/a", "deepseek", "m1");
        store.setArchived(ids.get(0), true);

        ProjectSessionReader.Summary s =
                ProjectSessionReader.summaries(home, List.of("/proj/a")).get(0);

        assertEquals(1, s.sessionCount(), "归档的不该算进项目会话数");
    }

    @Test
    void recentReadsAnotherProjectWithoutSwitching(@TempDir Path home) {
        seed(home, "/proj/a", 5);

        List<SessionMeta> recent = ProjectSessionReader.recent(home, "/proj/a", 3);

        assertEquals(3, recent.size(), "limit 生效");
        assertEquals("/proj/a", recent.get(0).cwd());
    }

    @Test
    void archivedMergesAcrossProjectsNewestFirst(@TempDir Path home) {
        List<String> a = seed(home, "/proj/a", 1);
        List<String> b = seed(home, "/proj/b", 1);
        SessionStore.open(home, "/proj/a", "p", "m").setArchived(a.get(0), true);
        SessionStore.open(home, "/proj/b", "p", "m").setArchived(b.get(0), true);

        List<SessionMeta> out =
                ProjectSessionReader.archived(home, List.of("/proj/a", "/proj/b"), 0);

        assertEquals(2, out.size());
        // b 后归档 → 倒序在前
        assertEquals("/proj/b", out.get(0).cwd());
        assertEquals("/proj/a", out.get(1).cwd());
    }

    @Test
    void archiveAllOnOneProjectLeavesOtherAlone(@TempDir Path home) {
        seed(home, "/proj/a", 2);
        seed(home, "/proj/b", 1);

        assertEquals(2, ProjectSessionReader.archiveAll(home, "/proj/a"));

        assertEquals(0, ProjectSessionReader.summaries(home, List.of("/proj/a")).get(0).sessionCount());
        assertEquals(1, ProjectSessionReader.summaries(home, List.of("/proj/b")).get(0).sessionCount());
    }
}
