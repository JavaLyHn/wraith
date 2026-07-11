package com.lyhn.wraith.skill;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Skill 文件写/删。仅作用于用户层(~/.wraith/skills)与项目层(&lt;root&gt;/.wraith/skills);
 * 内置层只读,不在此列。name 经目录安全校验,杜绝路径穿越。写用同目录 temp + 原子 move。
 */
public final class SkillStore {

    private static final Pattern SAFE_NAME = Pattern.compile("^[A-Za-z0-9_-]+$");

    private final Path userSkillsDir;
    private final Path projectSkillsDir;

    public SkillStore(Path userSkillsDir, Path projectSkillsDir) {
        this.userSkillsDir = userSkillsDir;
        this.projectSkillsDir = projectSkillsDir;
    }

    /** scope: "user" | "project"。建/改一个技能(同名覆盖)。 */
    public void upsert(String scope, String name, String description, String version,
                       String author, List<String> tags, String body) throws IOException {
        Path dir = resolveScopeDir(scope);
        String safe = requireSafeName(name);
        Path skillDir = dir.resolve(safe);
        Files.createDirectories(skillDir);
        String content = SkillFrontmatterWriter.serialize(safe, description, version, author, tags, body);
        Path target = skillDir.resolve("SKILL.md");
        Path tmp = skillDir.resolve("SKILL.md.tmp");
        Files.writeString(tmp, content);
        try {
            try {
                Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            Files.deleteIfExists(tmp);
            throw e;
        }
    }

    /**
     * 把源技能的 references/ 递归复制到 &lt;scopeDir&gt;/&lt;name&gt;/references/(fork 时保留参考文件)。
     * srcReferencesDir 为 null / 非目录则 no-op。
     */
    public void copyReferences(String scope, String name, Path srcReferencesDir) throws IOException {
        if (srcReferencesDir == null || !Files.isDirectory(srcReferencesDir)) {
            return;
        }
        Path dir = resolveScopeDir(scope);
        String safe = requireSafeName(name);
        Path destRefs = dir.resolve(safe).resolve("references");
        try (var walk = Files.walk(srcReferencesDir)) {
            for (Path src : walk.toList()) {
                Path dst = destRefs.resolve(srcReferencesDir.relativize(src).toString());
                if (Files.isDirectory(src)) {
                    Files.createDirectories(dst);
                } else {
                    Files.createDirectories(dst.getParent());
                    Files.copy(src, dst, StandardCopyOption.REPLACE_EXISTING);
                }
            }
        }
    }

    /** 删除 &lt;scopeDir&gt;/&lt;name&gt;/ 整个目录,幂等(不存在即 no-op)。 */
    public void delete(String scope, String name) throws IOException {
        Path dir = resolveScopeDir(scope);
        String safe = requireSafeName(name);
        Path skillDir = dir.resolve(safe);
        if (!Files.exists(skillDir)) {
            return;
        }
        List<Path> paths;
        try (var walk = Files.walk(skillDir)) {
            paths = walk.sorted(Comparator.reverseOrder()).toList();
        } catch (java.nio.file.NoSuchFileException e) {
            return; // 目录在 exists 检查后消失,视为已删,幂等
        }
        for (Path p : paths) {
            Files.deleteIfExists(p);
        }
    }

    /** 目标作用域下是否已存在该技能(&lt;scopeDir&gt;/&lt;name&gt;/SKILL.md)。scope/name 非法抛 IllegalArgumentException。 */
    public boolean existsInScope(String scope, String name) {
        // 有意直接查文件系统(而非内存 SkillRegistry):registry 的 skillsByName 会用 user 遮蔽
        // 同名 project 副本,只有读 FS 才能发现被遮蔽的同名件——这是"移动作用域防覆盖"的承重属性,勿改。
        Path dir = resolveScopeDir(scope);
        String safe = requireSafeName(name);
        return Files.isRegularFile(dir.resolve(safe).resolve("SKILL.md"));
    }

    private Path resolveScopeDir(String scope) {
        return switch (scope == null ? "" : scope) {
            case "user" -> userSkillsDir;
            case "project" -> projectSkillsDir;
            default -> throw new IllegalArgumentException("非法 scope(仅 user/project): " + scope);
        };
    }

    private static String requireSafeName(String name) {
        if (name == null || !SAFE_NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("非法技能名(仅允许字母/数字/下划线/连字符): " + name);
        }
        return name;
    }
}
