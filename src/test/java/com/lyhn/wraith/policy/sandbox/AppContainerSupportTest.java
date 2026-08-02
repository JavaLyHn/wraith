package com.lyhn.wraith.policy.sandbox;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * AppContainer 的可用性判定与发射器脚本落盘。
 *
 * <p>注意这里能验的只是 <b>Java 侧的判定逻辑</b>。真正的 Win32 调用、ACL 授权、
 * 管道 DACL 是否够用，只能在真 Windows 上验（见 {@code wraith sandbox doctor}）。
 */
class AppContainerSupportTest {

    // ---------- 版本解析 ----------

    @Test
    void majorVersionParsesWindowsForm() {
        assertEquals(10, AppContainerSupport.majorVersion("10.0"));  // Win11 也报 10.0
        assertEquals(6, AppContainerSupport.majorVersion("6.1"));    // Win7
        assertEquals(11, AppContainerSupport.majorVersion("11"));
    }

    @Test
    void majorVersionTolerantOfGarbage() {
        assertEquals(-1, AppContainerSupport.majorVersion(null));
        assertEquals(-1, AppContainerSupport.majorVersion(""));
        assertEquals(-1, AppContainerSupport.majorVersion("what"));
    }

    // ---------- 平台判定 ----------

    @Test
    @DisplayName("非 Windows 直接判负,且不去做后续那些昂贵探测")
    void nonWindowsShortCircuits() {
        AppContainerSupport.Diagnosis d = AppContainerSupport.compute("Mac OS X", "14.0");
        assertFalse(d.ready());
        assertEquals("非 Windows 平台", d.reason());
        // 短路了就只该有「平台」这一项;继续往下探测纯属浪费
        assertEquals(1, d.checks().size(), "非 Windows 不该再探测 PowerShell / 脚本");
        assertEquals("平台", d.checks().get(0).name());
    }

    @Test
    @DisplayName("Windows 版本过低要指出「需 10 及以上」,而不是只说失败")
    void oldWindowsRejectedWithActionableDetail() {
        AppContainerSupport.Diagnosis d = AppContainerSupport.compute("Windows 7", "6.1");
        assertFalse(d.ready());
        AppContainerSupport.Check ver = d.checks().stream()
                .filter(c -> c.name().equals("Windows 版本")).findFirst().orElseThrow();
        assertFalse(ver.ok());
        assertTrue(ver.detail().contains("10"), "应说清需要的版本: " + ver.detail());
    }

    @Test
    @DisplayName("在 mac 上跑 Windows 分支:powershell 找不到 → 不 ready,且原因可读")
    void windowsWithoutPowershellIsNotReady() {
        // 本机不是 Windows,StdioCommand.resolveExecutable 恒返回 null,
        // 正好模拟「组策略把 PowerShell 拿掉了」这种情况
        AppContainerSupport.Diagnosis d = AppContainerSupport.compute("Windows 11", "10.0");
        assertFalse(d.ready());
        assertNotNull(d.reason());
        AppContainerSupport.Check ps = d.checks().stream()
                .filter(c -> c.name().equals("powershell.exe")).findFirst().orElseThrow();
        assertFalse(ps.ok());
    }

    @Test
    @DisplayName("reason 取的是第一条失败项,不是笼统一句「不可用」")
    void reasonNamesTheFailingCheck() {
        AppContainerSupport.Diagnosis d = AppContainerSupport.compute("Windows 11", "10.0");
        assertNotNull(d.reason());
        List<String> failed = d.checks().stream().filter(c -> !c.ok()).map(AppContainerSupport.Check::name).toList();
        assertFalse(failed.isEmpty());
        assertTrue(d.reason().startsWith(failed.get(0)),
                "reason 应指向第一条失败项 " + failed.get(0) + ",实际: " + d.reason());
    }

    @Test
    @DisplayName("失败结果不进缓存 —— 否则用户修好环境后不重启就永远显示无沙箱")
    void failureIsNotCached() {
        // 本机非 Windows,diagnose() 必然 not ready
        AppContainerSupport.resetCache();
        assertFalse(AppContainerSupport.diagnose().ready());

        // 若失败被缓存了,下面这次会直接吃缓存;这里断言的是「缓存没被写脏」
        AppContainerSupport.Diagnosis again = AppContainerSupport.diagnose();
        assertFalse(again.ready());
        assertNotSame(AppContainerSupport.diagnose(), again,
                "失败结果被缓存了 —— 环境修好后不重启就恢复不了");
    }

    // ---------- 脚本落盘 ----------

    @Test
    @DisplayName("发射器脚本能从 jar 释放出来 —— PowerShell 读不了 jar 内条目")
    void launcherExtractsFromResources(@org.junit.jupiter.api.io.TempDir Path tmp) throws Exception {
        String prev = System.getProperty("wraith.config.dir");
        try {
            System.setProperty("wraith.config.dir", tmp.toString());
            AppContainerSupport.resetCache();

            String p = AppContainerSupport.ensureLauncher();
            assertNotNull(p);
            Path script = Path.of(p);
            assertTrue(Files.isRegularFile(script));
            assertTrue(script.startsWith(tmp), "必须落在被 override 的配置目录下: " + p);
            assertTrue(Files.readString(script).contains("CreateAppContainerProfile"),
                    "释放出来的应是真脚本内容");
        } finally {
            if (prev == null) System.clearProperty("wraith.config.dir");
            else System.setProperty("wraith.config.dir", prev);
            AppContainerSupport.resetCache();
        }
    }

    @Test
    @DisplayName("内容变了要覆写 —— 只判存在会让用户一直跑着升级前的旧发射器且完全无感")
    void staleLauncherGetsOverwritten(@org.junit.jupiter.api.io.TempDir Path tmp) throws Exception {
        String prev = System.getProperty("wraith.config.dir");
        try {
            System.setProperty("wraith.config.dir", tmp.toString());
            AppContainerSupport.resetCache();

            Path script = tmp.resolve("sandbox").resolve(AppContainerSupport.SCRIPT_NAME);
            Files.createDirectories(script.getParent());
            Files.writeString(script, "# 上一个版本留下的旧脚本");

            AppContainerSupport.ensureLauncher();
            assertTrue(Files.readString(script).contains("CreateAppContainerProfile"),
                    "旧内容应被覆盖");
        } finally {
            if (prev == null) System.clearProperty("wraith.config.dir");
            else System.setProperty("wraith.config.dir", prev);
            AppContainerSupport.resetCache();
        }
    }

    @Test
    @DisplayName("内容一致时不重写(避免每条命令都碰盘)")
    void identicalLauncherNotRewritten(@org.junit.jupiter.api.io.TempDir Path tmp) throws Exception {
        String prev = System.getProperty("wraith.config.dir");
        try {
            System.setProperty("wraith.config.dir", tmp.toString());
            AppContainerSupport.resetCache();

            String p = AppContainerSupport.ensureLauncher();
            long t1 = Files.getLastModifiedTime(Path.of(p)).toMillis();
            Files.setLastModifiedTime(Path.of(p), java.nio.file.attribute.FileTime.fromMillis(t1 - 10_000));
            long marked = Files.getLastModifiedTime(Path.of(p)).toMillis();

            AppContainerSupport.ensureLauncher();
            assertEquals(marked, Files.getLastModifiedTime(Path.of(p)).toMillis(),
                    "内容没变却重写了文件");
        } finally {
            if (prev == null) System.clearProperty("wraith.config.dir");
            else System.setProperty("wraith.config.dir", prev);
            AppContainerSupport.resetCache();
        }
    }
}
