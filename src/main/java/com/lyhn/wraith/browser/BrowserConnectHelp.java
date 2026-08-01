package com.lyhn.wraith.browser;

import com.lyhn.wraith.browser.BrowserConnectivityCheck.Failure;
import com.lyhn.wraith.browser.BrowserConnectivityCheck.ProbeResult;

/**
 * 「按端口连接」失败时给用户的提示。纯函数，可测。
 *
 * 为什么要按失败原因分叉:老版本无论什么原因都甩同一段「请先用调试端口启动 Chrome」，
 * 在 Chrome 144+ 上是双重误导 ——
 *   ① 端口其实开着(由 chrome://inspect 的开关打开，只是不提供旧式 /json/*)，
 *      叫人去「先启动」是白折腾;
 *   ② 提示里的 --user-data-dir 指向独立 profile，里面没有任何登录态，
 *      而共享模式的全部意义就是复用已登录的 Chrome，照做等于自毁目的。
 */
public final class BrowserConnectHelp {

    private BrowserConnectHelp() {}

    public static String forFailedProbe(int port, ProbeResult probe) {
        Failure failure = probe.failure() == null ? Failure.UNREACHABLE : probe.failure();
        return switch (failure) {
            case BAD_PORT -> "❌ " + probe.message();
            case HTTP_ERROR -> httpError(port, probe.message());
            default -> unreachable(port, probe.message());
        };
    }

    /** 端口通、协议不对。这是 Chrome 144+ 上最常见的情况。 */
    private static String httpError(int port, String message) {
        return """
                ⚠️ 127.0.0.1:%d 有服务在监听，但它不提供旧式 CDP 调试接口(%s)。

                多半是 Chrome 144+ 的新机制:端口由 chrome://inspect/#remote-debugging 里的
                「Allow remote debugging」开关打开，这条新通道不再提供 /json/version，
                所以「按端口连接」用不了 —— 端口没问题，是协议对不上。

                → 请改点「连接(自动)」(命令行:/browser connect，不带端口)，它走 --autoConnect，
                  正是为这种情况准备的，而且复用的就是你当前这个已登录的 Chrome。

                (若确实想走旧式端口连接，需用命令行另起一个 Chrome 实例:
                   %s
                 ⚠️ 该 --user-data-dir 是独立 profile，里面没有你现有的登录态;
                    想要登录态请用「连接(自动)」。)
                """.formatted(port, message, macLaunchCommand(port)).trim();
    }

    /** 端口压根没监听。此时原来的启动指引是对的，但要补上「另一条更好的路」和登录态警告。 */
    private static String unreachable(int port, String message) {
        return """
                ❌ 未检测到 Chrome 调试端口 127.0.0.1:%d:%s

                端口没有监听。两条路:

                ① 推荐 —— 用你当前已登录的 Chrome:
                   在 Chrome 打开 chrome://inspect/#remote-debugging，勾选「Allow remote debugging」，
                   然后点「连接(自动)」(命令行:/browser connect)。

                ② 或者用命令行另起一个 Chrome 实例:
                   macOS:   %s
                   Windows: start chrome.exe --remote-debugging-port=%d --user-data-dir=%%TEMP%%\\wraith-chrome-profile
                   Linux:   google-chrome --remote-debugging-port=%d --user-data-dir=/tmp/wraith-chrome-profile
                   然后重新执行 /browser connect %d
                   ⚠️ --user-data-dir 是独立 profile，里面没有登录态;需要登录态请走 ①。
                """.formatted(port, message, macLaunchCommand(port), port, port, port).trim();
    }

    private static String macLaunchCommand(int port) {
        return "open -na \"Google Chrome\" --args --remote-debugging-port=" + port
                + " --user-data-dir=/tmp/wraith-chrome-profile";
    }
}
