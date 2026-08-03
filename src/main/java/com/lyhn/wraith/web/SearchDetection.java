package com.lyhn.wraith.web;

import java.io.File;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Locale;

/**
 * 「未配置」提示要用的两个廉价检测。
 *
 * <p><b>都必须有上界</b>：这两个检测跑在一句提示的生成路径上，一旦挂住就是 agent 挂住。
 * 端口检测用 300ms 超时；docker 检测只查 {@code PATH} 各段下有没有那个文件，
 * <b>不执行 {@code docker --version}</b>——起进程更慢，而且可能触发 Docker Desktop 唤醒。
 *
 * <p>纯函数重载全部注入 {@code PATH} 与平台标记，测试不碰本机真实环境。
 */
public final class SearchDetection {

    private SearchDetection() {}

    /**
     * SearXNG docker 镜像的默认端口，也是引导命令里用的那个。
     *
     * <p>放在这里而不是 {@code UnconfiguredSearchProvider}：那边的无参构造要引用本类的两个
     * 检测方法，本类的端口探测又要用这个端口——常量留在那边就成了环。依赖是单向的：
     * {@code UnconfiguredSearchProvider} → {@code SearchDetection}。
     */
    public static final int SEARXNG_DEFAULT_PORT = 8888;
    public static final String SEARXNG_LOCAL_URL = "http://localhost:" + SEARXNG_DEFAULT_PORT;

    /** 生产入口：查本机真实 {@code PATH}。 */
    public static boolean dockerOnPath() {
        return dockerOnPath(System.getenv("PATH"), File.pathSeparator, isWindows());
    }

    /**
     * @param pathEnv       {@code PATH} 的原始值，null/空当作没有
     * @param pathSeparator 段分隔符（POSIX {@code :}，Windows {@code ;}）
     * @param windows       true 时找 {@code docker.exe}，否则找 {@code docker}
     */
    static boolean dockerOnPath(String pathEnv, String pathSeparator, boolean windows) {
        if (pathEnv == null || pathEnv.isBlank()) {
            return false;
        }
        String executable = windows ? "docker.exe" : "docker";
        for (String segment : pathEnv.split(java.util.regex.Pattern.quote(pathSeparator))) {
            if (segment == null || segment.isBlank()) {
                continue;
            }
            try {
                File candidate = new File(segment.trim(), executable);
                // Windows 上 canExecute() 对普通文件也返回 true,所以那边只看存在性;
                // POSIX 上必须要求可执行位,否则 PATH 里一个同名的普通文件会误报。
                if (candidate.isFile() && (windows || candidate.canExecute())) {
                    return true;
                }
            } catch (Exception ignored) {
                // 段本身非法（非法路径字符等）——跳过，不是致命错误
            }
        }
        return false;
    }

    /** 生产入口：探 {@code localhost:8888}（SearXNG docker 镜像的默认端口）。 */
    public static boolean searxngPortListening() {
        return portListening("127.0.0.1", SEARXNG_DEFAULT_PORT, 300);
    }

    /**
     * TCP connect 探测。只判断「有没有人在听」，<b>不发任何请求</b>——
     * 主动探 {@code /search?format=json} 会让提示变慢，且可能打扰一个无关的服务。
     */
    static boolean portListening(String host, int port, int timeoutMillis) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), timeoutMillis);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }
}
