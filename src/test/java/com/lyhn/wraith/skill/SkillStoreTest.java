package com.lyhn.wraith.skill;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class SkillStoreTest {

    @Test void upsertWritesParseableSkill(@TempDir Path tmp) throws Exception {
        Path user = tmp.resolve("user"), project = tmp.resolve("project");
        SkillStore store = new SkillStore(user, project);
        store.upsert("user", "my-skill", "我的技能", "1.0", "me", List.of("a", "b"), "正文");
        Path md = user.resolve("my-skill").resolve("SKILL.md");
        assertTrue(Files.exists(md));
        var r = SkillFrontmatterParser.parse(Files.readString(md));
        assertEquals("my-skill", r.frontmatter().get("name"));
        assertEquals("我的技能", r.frontmatter().get("description"));
        assertEquals(List.of("a", "b"), r.frontmatter().get("tags"));
        assertEquals("正文", r.body());
    }

    @Test void upsertOverwritesSameName(@TempDir Path tmp) throws Exception {
        SkillStore store = new SkillStore(tmp.resolve("user"), tmp.resolve("project"));
        store.upsert("user", "s", "old", null, null, List.of(), "old body");
        store.upsert("user", "s", "new", null, null, List.of(), "new body");
        var r = SkillFrontmatterParser.parse(
                Files.readString(tmp.resolve("user").resolve("s").resolve("SKILL.md")));
        assertEquals("new", r.frontmatter().get("description"));
        assertEquals("new body", r.body());
    }

    @Test void deleteRemovesSkillDirAndIsIdempotent(@TempDir Path tmp) throws Exception {
        SkillStore store = new SkillStore(tmp.resolve("user"), tmp.resolve("project"));
        store.upsert("user", "gone", "d", null, null, List.of(), "b");
        Path dir = tmp.resolve("user").resolve("gone");
        assertTrue(Files.exists(dir));
        store.delete("user", "gone");
        assertFalse(Files.exists(dir));
        store.delete("user", "gone"); // 幂等,不抛
    }

    @Test void rejectsUnsafeNames(@TempDir Path tmp) {
        SkillStore store = new SkillStore(tmp.resolve("user"), tmp.resolve("project"));
        for (String bad : List.of("..", "../x", "a/b", "", ".", "a b", "a.b")) {
            assertThrows(IllegalArgumentException.class,
                    () -> store.upsert("user", bad, "d", null, null, List.of(), "b"),
                    "应拒绝非法 name: " + bad);
        }
    }

    @Test void rejectsNonUserProjectScope(@TempDir Path tmp) {
        SkillStore store = new SkillStore(tmp.resolve("user"), tmp.resolve("project"));
        assertThrows(IllegalArgumentException.class,
                () -> store.upsert("builtin", "x", "d", null, null, List.of(), "b"));
        assertThrows(IllegalArgumentException.class,
                () -> store.delete("bogus", "x"));
    }

    @Test void projectScopeWritesToProjectDir(@TempDir Path tmp) throws Exception {
        SkillStore store = new SkillStore(tmp.resolve("user"), tmp.resolve("project"));
        store.upsert("project", "p", "d", null, null, List.of(), "b");
        assertTrue(Files.exists(tmp.resolve("project").resolve("p").resolve("SKILL.md")));
    }
}
