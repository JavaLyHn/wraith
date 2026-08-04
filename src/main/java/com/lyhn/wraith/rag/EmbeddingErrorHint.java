package com.lyhn.wraith.rag;

import java.net.ConnectException;
import java.net.URI;
import java.util.Locale;

/**
 * 把 embedding 后端的失败原文翻译成一句可行动的诊断。
 *
 * <p><b>起因</b>：面板报
 * {@code 索引失败:embedding 后端探测失败:Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434}。
 * 那句 {@code [0:0:0:0:0:0:0:1]} 是个<b>障眼法</b> —— 它把人引向「IPv6 vs IPv4」这个错方向。
 *
 * <p>本机实测（Java 17，默认 JVM）：
 * <pre>
 * localhost 解析顺序: 127.0.0.1  0:0:0:0:0:0:0:1     ← IPv4 在前（preferIPv6Addresses 默认 false）
 * 显式 [::1]      → Failed to connect to /[0:0:0:0:0:0:0:1]:11434   ← 斜杠前无主机名
 * 空端口 localhost → Failed to connect to localhost/[...]:11499     ← 有主机名
 * </pre>
 * 用户那条是后者：<b>IPv4 已经先试过并失败，{@code ::1} 只是最后一个尝试的地址</b>。
 * 真实原因是那个端口上压根没有东西在监听。
 *
 * <p><b>纪律：原文必须留着</b>（调用方在原文<b>之前</b>插这句，不是替换）。
 * 「连接被拒」「DNS 解析不了」「读超时」「401 key 错」「402 余额不足」是完全不同的事，
 * 只给一句友好话会把人引到错的地方去查。所以这里只在<b>能确定</b>的少数形态上说话，
 * 其余一律返回空串 —— 不知道就不说。
 */
public final class EmbeddingErrorHint {

    private EmbeddingErrorHint() {}

    /**
     * @return 要插在原文之前的诊断；无话可说时返回 {@code ""}
     */
    public static String of(String baseUrl, Throwable error) {
        if (error == null) {
            return "";
        }
        String msg = error.getMessage() == null ? "" : error.getMessage();

        // 模型没拉过:服务是通的,别让人去启动服务
        if (msg.contains("not found, try pulling it first") || msg.contains("model not found")) {
            String model = modelFrom(msg);
            return "这个模型在 ollama 里还没有。先拉一次：`ollama pull "
                    + (model.isEmpty() ? "<模型名>" : model) + "`，再重试。";
        }

        // 只认「连不上」。读超时是「连上了但慢」,401/402/429 各有各的处理 —— 都不在这里说话。
        boolean connectFailure = error instanceof ConnectException
                || msg.startsWith("Failed to connect to");
        if (!connectFailure) {
            return "";
        }

        Host host = hostOf(baseUrl);
        if (host.local) {
            return "连不上本机的 embedding 服务（" + host.display + "）。最常见的原因是 "
                    + "**ollama 没在运行**：Windows 上从开始菜单启动 Ollama（托盘会出现图标），"
                    + "或在命令行跑 `ollama serve`；用 `curl http://127.0.0.1:11434/api/version` "
                    + "或浏览器打开 http://127.0.0.1:11434 验证（应显示 Ollama is running）。"
                    + "顺带一句：原文里那个 `[0:0:0:0:0:0:0:1]` 是 IPv6 回环地址，"
                    + "但它**不是**原因 —— Java 会先试 127.0.0.1，那串只是最后一个尝试过的地址。";
        }
        if (!host.display.isEmpty()) {
            return "连不上 " + host.display + "。检查 BASE URL 是否写对、网络与防火墙是否放行；"
                    + "云端后端还要确认这个地址确实提供 embedding 接口。";
        }
        return "";
    }

    private record Host(String display, boolean local) {}

    /** 解析 baseUrl 的 host:port；解析不了就给空（宁可不说话，也不要说错）。 */
    private static Host hostOf(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            return new Host("", false);
        }
        try {
            URI uri = URI.create(baseUrl.trim());
            String host = uri.getHost();
            if (host == null || host.isBlank()) {
                return new Host("", false);
            }
            int port = uri.getPort();
            String display = port > 0 ? host + ":" + port : host;
            // URI.getHost() 对 IPv6 返回**带方括号**的形式(如 `[::1]`),比之前先剥掉
            String lower = host.toLowerCase(Locale.ROOT);
            if (lower.startsWith("[") && lower.endsWith("]")) {
                lower = lower.substring(1, lower.length() - 1);
            }
            boolean local = "localhost".equals(lower) || "127.0.0.1".equals(lower)
                    || "::1".equals(lower) || "0:0:0:0:0:0:0:1".equals(lower)
                    || lower.startsWith("127.");
            return new Host(display, local);
        } catch (Exception malformed) {
            return new Host("", false);
        }
    }

    /** 从 ollama 的 404 原文里抠出模型名；抠不出来返回空串。 */
    private static String modelFrom(String msg) {
        int start = msg.indexOf("model \\\"");
        int skip = 8;
        if (start < 0) {
            start = msg.indexOf("model \"");
            skip = 7;
        }
        if (start < 0) {
            return "";
        }
        String rest = msg.substring(start + skip);
        int end = rest.indexOf('\\');
        if (end < 0) {
            end = rest.indexOf('"');
        }
        return end > 0 ? rest.substring(0, end) : "";
    }
}
