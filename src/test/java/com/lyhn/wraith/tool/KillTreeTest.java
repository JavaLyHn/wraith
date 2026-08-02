package com.lyhn.wraith.tool;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeFalse;

/**
 * 超时清理必须连子孙一起杀。
 *
 * <p><b>为什么这是真缺陷而不是洁癖：</b>Windows 上杀 {@code cmd.exe} 不会连带杀它拉起的进程，
 * 超时的命令会留下一地孤儿——而 Windows 上又没有沙箱兜着它们。
 * macOS 同样有收益：Seatbelt 不阻止 fork。
 *
 * <p><b>这里没有覆盖「先收集后杀」的顺序</b>：{@code destroyForcibly()} 是异步的，
 * 紧接着查 {@code descendants()} 通常仍能查到，所以把顺序颠倒过来这些用例照样通过——
 * 那种用例只是看起来在守着。顺序的理由写在 {@code ToolRegistry.killTree} 的注释里，
 * 靠代码评审守，不假装有测试覆盖。
 */
class KillTreeTest {

    @Test
    @DisplayName("杀父进程时连子孙一起杀")
    void killsDescendantsNotJustTheDirectChild() throws Exception {
        assumeFalse(com.lyhn.wraith.policy.sandbox.ShellCommand.isWindows(
                System.getProperty("os.name", "")), "探针用的是 POSIX shell");

        // 父 shell 拉起一个长命子进程,自己也等着 —— 模拟 `npm run dev` 那类命令树
        Process p = new ProcessBuilder("bash", "-c", "sleep 60 & sleep 60").start();

        List<ProcessHandle> kids = waitForDescendants(p, 1);
        assertFalse(kids.isEmpty(), "前置条件不成立:没能造出子进程");

        ToolRegistry.killTree(p);

        assertTrue(p.waitFor(5, java.util.concurrent.TimeUnit.SECONDS), "父进程没死");
        for (ProcessHandle h : kids) {
            assertTrue(waitGone(h), "子孙进程 " + h.pid() + " 仍然活着 —— 只杀了直接子进程");
        }
    }

    @Test
    void nullProcessTolerated() {
        assertDoesNotThrow(() -> ToolRegistry.killTree(null));
    }

    private static List<ProcessHandle> waitForDescendants(Process p, int atLeast) throws Exception {
        for (int i = 0; i < 100; i++) {
            List<ProcessHandle> kids = p.toHandle().descendants().toList();
            if (kids.size() >= atLeast) return kids;
            Thread.sleep(20);
        }
        return p.toHandle().descendants().toList();
    }

    private static boolean waitGone(ProcessHandle h) throws Exception {
        for (int i = 0; i < 250; i++) {
            if (!h.isAlive()) return true;
            Thread.sleep(20);
        }
        return !h.isAlive();
    }
}
