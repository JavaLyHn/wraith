package com.lyhn.wraith.skill;

import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class ListSkillsToolTest {

    @Test
    void listsEnabledSkillWithNameAndDescription(@TempDir Path tempDir) throws IOException {
        SkillRegistry registry = registryWith(tempDir, "web-access", "联网工具决策手册", "body");
        ToolRegistry tools = new ToolRegistry();
        tools.setSkillRegistry(registry);

        String result = tools.executeTool("list_skills", "{}");

        assertTrue(result.contains("web-access"), result);
        assertTrue(result.contains("联网工具决策手册"), result);
        assertTrue(result.contains("user"), "应标注来源 displaySource");
    }

    @Test
    void notesDisabledCount(@TempDir Path tempDir) throws IOException {
        // 两个 user skill，其中一个被禁用 -> 启用 1、禁用 1
        writeUserSkill(tempDir, "enabled-one", "d1", "b1");
        writeUserSkill(tempDir, "disabled-one", "d2", "b2");
        Path userRoot = tempDir.resolve("user-skills");
        SkillStateStore state = new SkillStateStore(tempDir.resolve("skills.json"));
        state.disable("disabled-one");
        SkillRegistry registry = new SkillRegistry(null, userRoot, null, state);
        registry.reload();

        ToolRegistry tools = new ToolRegistry();
        tools.setSkillRegistry(registry);

        String result = tools.executeTool("list_skills", "{}");
        assertTrue(result.contains("enabled-one"), result);
        assertFalse(result.contains("disabled-one"), "禁用 skill 不应出现在启用清单里");
        assertTrue(result.contains("另有 1 个 skill 已禁用"), result);
    }

    @Test
    void emptyWhenNoEnabledSkills(@TempDir Path tempDir) throws IOException {
        SkillStateStore state = new SkillStateStore(tempDir.resolve("skills.json"));
        SkillRegistry registry = new SkillRegistry(null, tempDir.resolve("empty-user"), null, state);
        registry.reload();

        ToolRegistry tools = new ToolRegistry();
        tools.setSkillRegistry(registry);

        String result = tools.executeTool("list_skills", "{}");
        assertTrue(result.contains("没有启用任何 skill"), result);
    }

    @Test
    void failsWhenRegistryNull() {
        ToolRegistry tools = new ToolRegistry();
        // 不注入 skillRegistry
        String result = tools.executeTool("list_skills", "{}");
        assertTrue(result.contains("未初始化"), result);
    }

    private static SkillRegistry registryWith(Path tempDir, String name, String desc, String body) throws IOException {
        Path userRoot = writeUserSkill(tempDir, name, desc, body).getParent().getParent();
        SkillStateStore state = new SkillStateStore(tempDir.resolve("skills.json"));
        SkillRegistry registry = new SkillRegistry(null, userRoot, null, state);
        registry.reload();
        return registry;
    }

    private static Path writeUserSkill(Path tempDir, String name, String desc, String body) throws IOException {
        Path userRoot = tempDir.resolve("user-skills");
        Path skillDir = userRoot.resolve(name);
        Files.createDirectories(skillDir);
        Path skillMd = skillDir.resolve("SKILL.md");
        Files.writeString(skillMd,
                "---\nname: " + name
                        + "\ndescription: " + desc
                        + "\n---\n" + body + "\n");
        return skillMd;
    }
}
