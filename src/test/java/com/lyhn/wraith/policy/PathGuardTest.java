package com.lyhn.wraith.policy;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.AnnotatedElementContext;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.junit.jupiter.api.io.CleanupMode;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.io.TempDirFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.junit.jupiter.api.Assertions.*;

class PathGuardTest {

    @TempDir(factory = TargetTempDirFactory.class, cleanup = CleanupMode.ALWAYS)
    Path root;

    @TempDir(factory = TargetTempDirFactory.class, cleanup = CleanupMode.ALWAYS)
    Path outside;

    @Test
    void allowsRelativePathInsideRoot() throws Exception {
        PathGuard guard = new PathGuard(root.toString());
        Path resolved = guard.resolveSafe("src/Main.java");
        assertTrue(resolved.startsWith(root.toRealPath()));
        assertTrue(resolved.endsWith(Path.of("src", "Main.java")));
    }

    @Test
    void allowsAbsolutePathInsideRoot() throws Exception {
        PathGuard guard = new PathGuard(root.toString());
        Path target = root.resolve("a/b.txt");
        Path resolved = guard.resolveSafe(target.toString());
        assertTrue(resolved.startsWith(root.toRealPath()));
    }

    @Test
    void allowsCurrentDirectory() throws Exception {
        PathGuard guard = new PathGuard(root.toString());
        Path resolved = guard.resolveSafe(".");
        assertEquals(root.toRealPath(), resolved);
    }

    @Test
    void allowsNonExistingTargetForCreate() throws Exception {
        PathGuard guard = new PathGuard(root.toString());
        Path resolved = guard.resolveSafe("nested/deeply/new-file.txt");
        assertTrue(resolved.startsWith(root.toRealPath()));
        assertFalse(Files.exists(resolved));
    }

    @Test
    void rejectsAbsolutePathOutsideRoot() {
        PathGuard guard = new PathGuard(root.toString());
        PolicyException ex = assertThrows(PolicyException.class,
                () -> guard.resolveSafe("/etc/passwd"));
        assertTrue(ex.getMessage().contains("路径越界"));
        // 拒绝信息须给出补救指引:把外部内容 clone/复制进项目根内的子目录。
        assertTrue(ex.getMessage().contains("项目根内的子目录"));
    }

    @Test
    void rejectsParentTraversalEscape() {
        PathGuard guard = new PathGuard(root.toString());
        assertThrows(PolicyException.class,
                () -> guard.resolveSafe("../../etc/passwd"));
    }

    @Test
    void rejectsParentTraversalThroughLeadingDots() {
        PathGuard guard = new PathGuard(root.toString());
        assertThrows(PolicyException.class,
                () -> guard.resolveSafe(".."));
    }

    @Test
    void rejectsBlankPath() {
        PathGuard guard = new PathGuard(root.toString());
        assertThrows(PolicyException.class, () -> guard.resolveSafe(""));
        assertThrows(PolicyException.class, () -> guard.resolveSafe("   "));
        assertThrows(PolicyException.class, () -> guard.resolveSafe(null));
    }

    @Test
    void rejectsSymlinkEscapingRoot() throws IOException {
        Path outsideTarget = outside.resolve("secret.txt");
        Files.writeString(outsideTarget, "leak");

        Path linkInsideRoot = root.resolve("backdoor");
        try {
            Files.createSymbolicLink(linkInsideRoot, outside);
        } catch (UnsupportedOperationException | IOException e) {
            // 当前文件系统不支持符号链接（Windows 无管理员权限），跳过此用例
            assumeTrue(false, "当前文件系统不支持创建符号链接: " + e.getMessage());
            return;
        }

        PathGuard guard = new PathGuard(root.toString());
        PolicyException ex = assertThrows(PolicyException.class,
                () -> guard.resolveSafe("backdoor/secret.txt"));
        assertTrue(ex.getMessage().contains("路径越界"));
    }

    @Test
    void rejectNullRoot() {
        assertThrows(IllegalArgumentException.class, () -> new PathGuard(null));
        assertThrows(IllegalArgumentException.class, () -> new PathGuard(""));
        assertThrows(IllegalArgumentException.class, () -> new PathGuard("  "));
    }

    static final class TargetTempDirFactory implements TempDirFactory {
        @Override
        public Path createTempDirectory(AnnotatedElementContext elementContext,
                                        ExtensionContext extensionContext) throws IOException {
            Path parent = Path.of("target", "path-guard-test").toAbsolutePath();
            Files.createDirectories(parent);
            return Files.createTempDirectory(parent, "junit-");
        }
    }
}
