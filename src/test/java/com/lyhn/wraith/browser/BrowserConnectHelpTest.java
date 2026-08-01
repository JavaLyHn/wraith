package com.lyhn.wraith.browser;

import com.lyhn.wraith.browser.BrowserConnectivityCheck.Failure;
import com.lyhn.wraith.browser.BrowserConnectivityCheck.ProbeResult;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「按端口连接」失败提示。老版本不管什么原因都甩同一段「请先用调试端口启动 Chrome」，
 * 在 Chrome 144+ 上是双重误导:
 *   ① 端口其实开着(只是不提供旧式 /json/*),叫人去"先启动"纯属白折腾;
 *   ② 提示里的 --user-data-dir 指向独立 profile,里面没有任何登录态,
 *      而共享模式的全部意义就是复用已登录的 Chrome —— 照做等于自毁目的。
 * 真机复现:Chrome 150,9222 由 chrome://inspect 开关打开,所有 /json/* 路径均 404。
 */
class BrowserConnectHelpTest {

    private static ProbeResult http404() {
        return new ProbeResult(false, null, "HTTP 404", Failure.HTTP_ERROR);
    }

    private static ProbeResult refused() {
        return new ProbeResult(false, null, "Connection refused", Failure.UNREACHABLE);
    }

    @Test
    void httpErrorDoesNotClaimPortIsMissing() {
        String help = BrowserConnectHelp.forFailedProbe(9222, http404());
        assertFalse(help.contains("未检测到 Chrome 调试端口"),
                "端口明明在监听,不能说「未检测到」");
        assertFalse(help.startsWith("❌ 未检测到"),
                "首行就把用户带偏了");
        assertTrue(help.contains("HTTP 404"), "仍要保留原始状态码便于排查");
    }

    @Test
    void httpErrorPointsAtAutoConnectFirst() {
        String help = BrowserConnectHelp.forFailedProbe(9222, http404());
        assertTrue(help.contains("连接(自动)"), "这种情况唯一该做的就是改用「连接(自动)」");
        assertTrue(help.contains("chrome://inspect"), "要说明端口是被这个开关打开的");
    }

    @Test
    void unreachableKeepsTheLaunchInstructions() {
        String help = BrowserConnectHelp.forFailedProbe(9222, refused());
        assertTrue(help.contains("未检测到"), "端口真没开时,原提示是对的");
        assertTrue(help.contains("--remote-debugging-port=9222"));
        assertTrue(help.contains("Connection refused"));
    }

    @Test
    void anyLaunchInstructionWarnsAboutLostLoginState() {
        // 只要提到 --user-data-dir,就必须说清那是独立 profile、没有登录态,
        // 否则用户按共享模式的预期照做,结果拿到一个空白 Chrome。
        for (ProbeResult probe : new ProbeResult[]{http404(), refused()}) {
            String help = BrowserConnectHelp.forFailedProbe(9222, probe);
            if (help.contains("--user-data-dir")) {
                assertTrue(help.contains("登录态"),
                        "提到独立 profile 却不说没有登录态 —— 用户会白忙一场:" + help);
            }
        }
    }

    @Test
    void badPortSaysSoPlainly() {
        String help = BrowserConnectHelp.forFailedProbe(80,
                new ProbeResult(false, null, "端口必须在 1024-65535 之间", Failure.BAD_PORT));
        assertTrue(help.contains("1024-65535"));
        assertFalse(help.contains("--remote-debugging-port"),
                "端口号本身非法时,给启动命令没有意义");
    }
}
