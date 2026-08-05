package com.lyhn.wraith.cli;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

/**
 * {@code wraith --no-snapshot} —— 本次运行不存快照。
 *
 * <p><b>起因</b>（用户）：「能不能在 wraith 启动终端时加上一个命令保持不开启快照功能」。
 * 此前只有环境变量与系统属性，Windows 的 cmd 上写起来尤其别扭
 * （{@code set WRAITH_SNAPSHOT_ENABLED=false && wraith}）。
 *
 * <p>放在 {@code cli} 包里是因为 {@code applyNoSnapshotFlag} 是包私有的内部助手 ——
 * 为了测试把它放开成 public 会白扩一圈 API。
 */
class NoSnapshotFlagTest {

    @AfterEach
    void clearProperties() {
        System.clearProperty("wraith.snapshot.enabled");
    }

    @Test
    @DisplayName("--no-snapshot 关掉快照,并且**把参数摘掉**")
    void noSnapshotFlagDisablesAndIsConsumed() {
        String[] left = Main.applyNoSnapshotFlag(new String[]{"--no-snapshot"});

        assertEquals("false", System.getProperty("wraith.snapshot.enabled"));
        assertArrayEquals(new String[0], left, "参数必须被摘掉: " + List.of(left));
    }

    @Test
    @DisplayName("**摘掉参数是必需的** —— 下游按 args[0] 认子命令,多一个参数就认不出来")
    void flagIsRemovedSoSubcommandsStillParse() {
        String[] left = Main.applyNoSnapshotFlag(new String[]{"--no-snapshot", "terminal", "doctor"});
        assertArrayEquals(new String[]{"terminal", "doctor"}, left,
                "wraith --no-snapshot terminal doctor 必须仍然认得出子命令: " + List.of(left));
    }

    @Test
    @DisplayName("两种写法都认,大小写与空白不敏感")
    void acceptsBothSpellings() {
        for (String flag : List.of("--no-snapshot", "--no-snapshots", " --NO-SNAPSHOT ")) {
            System.clearProperty("wraith.snapshot.enabled");
            Main.applyNoSnapshotFlag(new String[]{flag});
            assertEquals("false", System.getProperty("wraith.snapshot.enabled"), flag + " 没被认出来");
        }
    }

    @Test
    @DisplayName("没给参数时**原样返回同一个数组** —— 绝大多数启动都走这条路")
    void withoutTheFlagNothingChanges() {
        String[] args = {"app-server"};
        assertSame(args, Main.applyNoSnapshotFlag(args));
        assertNull(System.getProperty("wraith.snapshot.enabled"));
    }

    @Test
    void nullAndEmptyArgsAreSafe() {
        assertArrayEquals(new String[0], Main.applyNoSnapshotFlag(null));
        assertArrayEquals(new String[0], Main.applyNoSnapshotFlag(new String[0]));
    }

}
