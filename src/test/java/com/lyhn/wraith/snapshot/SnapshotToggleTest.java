package com.lyhn.wraith.snapshot;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 快照开关：启动参数 + 持久化 + 运行期立即生效。
 *
 * <p><b>起因</b>（用户）：「能不能在 wraith 启动终端时加上一个命令保持不开启快照功能……
 * 桌面端也加上一个按钮」。核查发现关快照此前<b>只有环境变量与系统属性两条路</b>，
 * 都是「本次运行」级别，<b>没有任何持久化位置</b> —— 所以桌面按钮点完没地方存。
 */
class SnapshotToggleTest {

    @AfterEach
    void clearProperties() {
        System.clearProperty("wraith.snapshot.enabled");
        System.clearProperty("wraith.config.dir");
    }

    // ── 取值链与来源 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("系统属性能关掉,且来源报告为 property")
    void propertyDisablesAndReportsItself() {
        System.setProperty("wraith.snapshot.enabled", "false");

        assertFalse(SnapshotConfig.fromEnvironment().enabled());
        assertEquals(SnapshotConfig.EnabledSource.PROPERTY, SnapshotConfig.enabledSource());
    }

    @Test
    @DisplayName("**config.json 里的设置要被读到** —— 桌面按钮存的就是这里")
    void configFileIsHonoured(@TempDir Path tempDir) throws Exception {
        System.setProperty("wraith.config.dir", tempDir.toString());
        Files.writeString(tempDir.resolve("config.json"),
                "{\"snapshot\":{\"enabled\":false}}");

        assertFalse(SnapshotConfig.fromEnvironment().enabled(),
                "config.json 说关掉了却没生效 —— 那桌面按钮等于没用");
        assertEquals(SnapshotConfig.EnabledSource.CONFIG, SnapshotConfig.enabledSource());
    }

    @Test
    @DisplayName("**系统属性压过 config.json** —— 显式设的人是在做本次运行的临时覆盖")
    void propertyWinsOverConfigFile(@TempDir Path tempDir) throws Exception {
        System.setProperty("wraith.config.dir", tempDir.toString());
        Files.writeString(tempDir.resolve("config.json"), "{\"snapshot\":{\"enabled\":true}}");
        System.setProperty("wraith.snapshot.enabled", "false");

        assertFalse(SnapshotConfig.fromEnvironment().enabled());
        assertEquals(SnapshotConfig.EnabledSource.PROPERTY, SnapshotConfig.enabledSource());
    }

    @Test
    @DisplayName("谁都没表态就默认开 —— 快照是安全网,不该悄悄不存")
    void defaultsToEnabled(@TempDir Path tempDir) {
        System.setProperty("wraith.config.dir", tempDir.toString());

        assertTrue(SnapshotConfig.fromEnvironment().enabled());
        assertEquals(SnapshotConfig.EnabledSource.DEFAULT, SnapshotConfig.enabledSource());
    }

    @Test
    @DisplayName("配置文件坏了退化成默认开,不把整条链带崩")
    void brokenConfigFallsBackToDefault(@TempDir Path tempDir) throws Exception {
        System.setProperty("wraith.config.dir", tempDir.toString());
        Files.writeString(tempDir.resolve("config.json"), "{ 这不是 JSON");

        assertTrue(SnapshotConfig.fromEnvironment().enabled());
    }

    @Test
    @DisplayName("**认不出的值不能当成关** —— `WRAITH_SNAPSHOT_ENABLED=maybe` 该被忽略")
    void unrecognisedValueIsIgnoredNotTreatedAsFalse(@TempDir Path tempDir) {
        System.setProperty("wraith.config.dir", tempDir.toString());
        System.setProperty("wraith.snapshot.enabled", "maybe");

        assertTrue(SnapshotConfig.fromEnvironment().enabled(), "写错值不该悄悄关掉安全网");
        assertEquals(SnapshotConfig.EnabledSource.DEFAULT, SnapshotConfig.enabledSource());
    }

    // ── 运行期立即生效 + 落盘 ───────────────────────────────────────────────

    @Test
    @DisplayName("**关掉之后立刻不再存** —— config 是构造时捕获的,不加运行期覆盖就要等重启")
    void togglingTakesEffectImmediately(@TempDir Path tempDir) throws Exception {
        Path project = tempDir.resolve("project");
        Files.createDirectories(project);
        Files.writeString(project.resolve("a.txt"), "hello");
        SideGitManager manager = new SideGitManager(project,
                new SnapshotConfig(true, tempDir.resolve("snapshots"), 50, List.of(".git")));

        assertTrue(manager.enabled());
        assertTrue(manager.preTurnSnapshot("turn-1", "开着") != null);

        manager.setEnabled(false);

        assertFalse(manager.enabled());
        assertNull(manager.preTurnSnapshot("turn-2", "关了"), "关掉之后还在写快照");
    }

    @Test
    @DisplayName("setEnabled 落盘到 config.json,并且当场生效")
    void serviceWritesToConfigAndAppliesAtOnce(@TempDir Path tempDir) throws Exception {
        System.setProperty("wraith.config.dir", tempDir.resolve("cfg").toString());
        Files.createDirectories(tempDir.resolve("cfg"));
        Path project = tempDir.resolve("project");
        Files.createDirectories(project);
        SnapshotService service = new SnapshotService(new SideGitManager(project,
                new SnapshotConfig(true, tempDir.resolve("snapshots"), 50, List.of(".git"))));

        String error = service.setEnabled(false);

        assertNull(error, "落盘失败: " + error);
        assertFalse(service.isEnabled(), "运行期没生效");
        String written = Files.readString(tempDir.resolve("cfg").resolve("config.json"));
        assertTrue(written.contains("\"snapshot\""), written);
        assertTrue(written.replaceAll("\\s+", "").contains("\"enabled\":false"), written);
        service.close();
    }

    @Test
    @DisplayName("再开回来也要落盘 —— 一个只能关不能开的开关是半个开关")
    void togglingBackOnPersistsToo(@TempDir Path tempDir) throws Exception {
        System.setProperty("wraith.config.dir", tempDir.resolve("cfg").toString());
        Files.createDirectories(tempDir.resolve("cfg"));
        Path project = tempDir.resolve("project");
        Files.createDirectories(project);
        SnapshotService service = new SnapshotService(new SideGitManager(project,
                new SnapshotConfig(true, tempDir.resolve("snapshots"), 50, List.of(".git"))));

        service.setEnabled(false);
        service.setEnabled(true);

        assertTrue(service.isEnabled());
        String written = Files.readString(tempDir.resolve("cfg").resolve("config.json"));
        assertTrue(written.replaceAll("\\s+", "").contains("\"enabled\":true"), written);
        service.close();
    }
}
