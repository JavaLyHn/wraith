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
        return of(baseUrl, null, error);
    }

    /** 带 provider 的版本：只有 provider 真是 ollama 时才说 ollama 那套话。 */
    public static String of(String baseUrl, String provider, Throwable error) {
        if (error == null) {
            return "";
        }
        return build(baseUrl, provider, error.getMessage(), error instanceof ConnectException);
    }

    /**
     * 只有消息字符串时用这个(名字与 of 不同是必须的:两者第二参都可为 null,同名会歧义)（{@code CodeIndex} 的 {@code EmbedOutcome.firstError} 存的就是消息）。
     *
     * <p><b>代价说清</b>：拿不到 {@code instanceof ConnectException} 这一路判据，只能靠
     * 「消息以 {@code Failed to connect to} 开头」。OkHttp 的 {@code ConnectException} 消息
     * 恒是这个前缀，所以真实场景覆盖得住；代价是别的库若抛出同样措辞会被误判 ——
     * 而误判的后果只是多一句建议，不会盖掉原文。
     */
    public static String ofMessage(String baseUrl, String errorMessage) {
        return build(baseUrl, null, errorMessage, false);
    }

    /** 带 provider 的消息版。 */
    public static String ofMessage(String baseUrl, String provider, String errorMessage) {
        return build(baseUrl, provider, errorMessage, false);
    }

    private static String build(String baseUrl, String provider, String errorMessage,
                                boolean connectException) {
        String msg = errorMessage == null ? "" : errorMessage;
        if (msg.isEmpty() && !connectException) {
            return "";
        }

        // 模型没拉过:服务是通的,别让人去启动服务
        if (msg.contains("not found, try pulling it first") || msg.contains("model not found")) {
            String model = modelFrom(msg);
            return "这个模型在 ollama 里还没有。先拉一次：`ollama pull "
                    + (model.isEmpty() ? "<模型名>" : model) + "`，再重试。";
        }

        // 只认「连不上」。读超时是「连上了但慢」,401/402/429 各有各的处理 —— 都不在这里说话。
        boolean connectFailure = connectException || msg.startsWith("Failed to connect to");
        if (!connectFailure) {
            return "";
        }

        Host host = hostOf(baseUrl);
        // 验证地址:**端口用配置的那个**(写死 11434 会叫人去查一个他没在用的端口),
        // 而主机名规范成 127.0.0.1 —— `localhost` 正是引起这场混乱的那个名字,
        // 用 IPv4 字面量验证才不带解析这个变量。
        String verifyUrl = "http://" + host.verifyDisplay;
        String ipv6Note = " 顺带一句：报错里若出现 `[0:0:0:0:0:0:0:1]`，那是 IPv6 回环地址，"
                + "但它**不是**原因 —— Java 会先试 127.0.0.1，那串只是最后一个尝试过的地址。";
        if (host.local && isOllama(provider)) {
            return "连不上本机的 embedding 服务（" + host.display + "）。最常见的原因是 "
                    + "**ollama 没在运行**：Windows 上从开始菜单启动 Ollama（托盘会出现图标），"
                    + "或在命令行跑 `ollama serve`；用 `curl " + verifyUrl + "/api/version` "
                    + "或浏览器打开 " + verifyUrl + " 验证（应显示 Ollama is running）。" + ipv6Note;
        }
        if (host.local) {
            // provider 不是 ollama:可能是本机中转/自建服务,让人去起 ollama 就答错了
            return "本机 " + host.display + " 上没有服务在监听。检查这个服务是否已启动、"
                    + "端口与 BASE URL 是否写对（当前 provider 是 "
                    + (provider == null || provider.isBlank() ? "未指定" : provider.trim()) + "）。" + ipv6Note;
        }
        if (!host.display.isEmpty()) {
            return "连不上 " + host.display + "。检查 BASE URL 是否写对、网络与防火墙是否放行；"
                    + "云端后端还要确认这个地址确实提供 embedding 接口。";
        }
        return "";
    }

    /** provider 为空按默认（ollama）算 —— {@code EmbeddingClient.of} 的缺省就是它。 */
    private static boolean isOllama(String provider) {
        if (provider == null || provider.isBlank()) {
            return true;
        }
        return "ollama".equals(provider.trim().toLowerCase(Locale.ROOT));
    }

    /**
     * @param display      给人看的 host:port（原样,来自配置）
     * @param verifyDisplay 验证命令里用的 host:port（本机时主机名规范成 127.0.0.1）
     */
    private record Host(String display, String verifyDisplay, boolean local) {}

    /** 解析 baseUrl 的 host:port；解析不了就给空（宁可不说话，也不要说错）。 */
    private static Host hostOf(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            return new Host("", "", false);
        }
        try {
            URI uri = URI.create(baseUrl.trim());
            String host = uri.getHost();
            if (host == null || host.isBlank()) {
                return new Host("", "", false);
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
            String verifyHost = local ? "127.0.0.1" : host;
            String verifyDisplay = port > 0 ? verifyHost + ":" + port : verifyHost;
            return new Host(display, verifyDisplay, local);
        } catch (Exception malformed) {
            return new Host("", "", false);
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
