package com.lyhn.wraith.rag;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.ConnectException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * embedding 后端连不上时，把 OkHttp 那句原文翻译成可行动的话。
 *
 * <p><b>用户实测</b>：面板报
 * {@code 索引失败:embedding 后端探测失败:Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434}。
 *
 * <p><b>那句 {@code [0:0:0:0:0:0:0:1]} 是个障眼法</b>，它会把人（以及模型）引向
 * 「IPv6 vs IPv4」这个错方向。本机实测（Java 17，默认 JVM）：
 * <pre>
 * localhost 解析顺序: 127.0.0.1  0:0:0:0:0:0:0:1     ← IPv4 在前
 * 显式 [::1]     → Failed to connect to /[0:0:0:0:0:0:0:1]:11434   ← 斜杠前无主机名
 * 空端口 localhost → Failed to connect to localhost/[...]:11499     ← 有主机名
 * </pre>
 * 用户那条属于后者：<b>IPv4 已经先试过并失败，{@code ::1} 只是最后一个尝试的地址</b>。
 * 真实原因是那个端口上压根没有东西在监听 —— ollama 没在运行。
 *
 * <p><b>纪律：原文必须留着。</b>「连接被拒」「DNS 解析不了」「读超时」是三件不同的事，
 * 只给一句友好话会把人引到错的地方去查（{@code Main.ragIndex} 那段注释写的就是这条）。
 * 所以这里是<b>在原文之前加一句诊断</b>，不是替换它。
 */
class EmbeddingErrorHintTest {

    private static final String OLLAMA = "http://localhost:11434";

    @Test
    @DisplayName("本机连不上:点名「没在运行」是最常见原因,并给出验证命令")
    void localhostConnectFailureNamesTheLikelyCause() {
        String hint = EmbeddingErrorHint.of(OLLAMA,
                new ConnectException("Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434"));
        assertFalse(hint.isEmpty());
        assertTrue(hint.contains("11434"), hint);
        assertTrue(hint.contains("没在运行") || hint.contains("未启动"), hint);
        assertTrue(hint.contains("127.0.0.1:11434"), "要给一个能直接验的地址: " + hint);
    }

    @Test
    @DisplayName("显式点破 IPv6 障眼法 —— 不然每个人都会去查 IPv6")
    void debunksTheIpv6RedHerring() {
        String hint = EmbeddingErrorHint.of(OLLAMA,
                new ConnectException("Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434"));
        assertTrue(hint.contains("IPv6"), "要点名那串地址是什么: " + hint);
        assertTrue(hint.contains("不是") || hint.contains("并非") || hint.contains("无关"),
                "要说清它不是原因: " + hint);
    }

    @Test
    @DisplayName("远端地址给的是另一套话 —— 让人去开 ollama 是答错了")
    void remoteHostGetsADifferentHint() {
        String hint = EmbeddingErrorHint.of("https://api.siliconflow.cn/v1",
                new ConnectException("Failed to connect to api.siliconflow.cn/1.2.3.4:443"));
        assertFalse(hint.isEmpty());
        assertFalse(hint.contains("ollama serve"), "远端后端不该让人去起 ollama: " + hint);
        assertTrue(hint.contains("api.siliconflow.cn"), hint);
    }

    @Test
    @DisplayName("不是连接失败就不加话 —— 401/402/429 各有各的处理,别用「没在运行」盖过去")
    void nonConnectFailuresGetNoHint() {
        assertEquals("", EmbeddingErrorHint.of(OLLAMA,
                new IOException("Embedding API 请求失败 [401]: invalid api key")));
        assertEquals("", EmbeddingErrorHint.of(OLLAMA,
                new IOException("Embedding API 请求失败 [429]: rate limited")));
        assertEquals("", EmbeddingErrorHint.of(OLLAMA,
                new IOException("Ollama 返回的 embedding 格式不正确: {}")));
    }

    @Test
    @DisplayName("读超时不算连不上 —— 那是「连上了但慢」,让人去起 ollama 是错的")
    void readTimeoutIsNotAConnectFailure() {
        assertEquals("", EmbeddingErrorHint.of(OLLAMA, new java.net.SocketTimeoutException("timeout")));
    }

    @Test
    @DisplayName("模型没拉过(404 model not found)给的是「去 pull」而不是「去启动」")
    void missingModelSaysPullIt() {
        String hint = EmbeddingErrorHint.of(OLLAMA, new IOException(
                "Embedding API 请求失败 [404]: {\"error\":\"model \\\"bge-m3:latest\\\" not found, try pulling it first\"}"));
        assertTrue(hint.contains("ollama pull"), hint);
        assertFalse(hint.contains("没在运行"), "服务是通的,只是模型没拉: " + hint);
    }

    @Test
    @DisplayName("坏 URL / null 不许抛 —— 诊断层崩了会盖掉真正的错误")
    void malformedInputsAreSafe() {
        assertEquals("", EmbeddingErrorHint.of(null, new ConnectException("Failed to connect to x")));
        assertEquals("", EmbeddingErrorHint.of("not a url", (Throwable) null));
        assertEquals("", EmbeddingErrorHint.of("", (Throwable) null));
        // baseUrl 坏但异常是连接失败:至少不能抛
        EmbeddingErrorHint.of("http://[bad", new ConnectException("Failed to connect to x"));
    }

    @Test
    @DisplayName("127.0.0.1 / [::1] 字面量也算本机")
    void loopbackLiteralsCountAsLocal() {
        for (String url : new String[]{"http://127.0.0.1:11434", "http://[::1]:11434", "http://localhost:11434"}) {
            String hint = EmbeddingErrorHint.of(url, new ConnectException("Failed to connect"));
            assertTrue(hint.contains("没在运行"), url + " 该按本机处理: " + hint);
        }
    }

    // ---- 只有消息字符串的重载(CodeIndex.EmbedOutcome.firstError 存的就是消息) ----

    @Test
    @DisplayName("消息重载:OkHttp 那句原文照样识别得出来")
    void messageOverloadRecognizesOkHttpText() {
        String hint = EmbeddingErrorHint.ofMessage(OLLAMA,
                "Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434");
        assertTrue(hint.contains("没在运行"), hint);
        assertTrue(hint.contains("IPv6"), hint);
    }

    @Test
    @DisplayName("消息重载:非连接失败一律闭嘴(429 / 读超时的消息 / null / 空串)")
    void messageOverloadStaysQuietOtherwise() {
        assertEquals("", EmbeddingErrorHint.ofMessage(OLLAMA, "Embedding API 请求失败 [429]: rate limited"));
        assertEquals("", EmbeddingErrorHint.ofMessage(OLLAMA, "timeout"));
        assertEquals("", EmbeddingErrorHint.ofMessage(OLLAMA, null));
        assertEquals("", EmbeddingErrorHint.ofMessage(OLLAMA, ""));
    }

    @Test
    @DisplayName("消息重载:404 模型没拉也识别")
    void messageOverloadRecognizesMissingModel() {
        assertTrue(EmbeddingErrorHint.ofMessage(OLLAMA,
                        "Embedding API 请求失败 [404]: {\"error\":\"model \\\"bge-m3:latest\\\" not found, try pulling it first\"}")
                .contains("ollama pull"));
    }

    @Test
    @DisplayName("404 但不是「模型没拉」→ 说的是路径不存在(provider 与 baseUrl 不匹配)")
    void plain404PointsAtTheEndpointNotTheModel() {
        // 真实复现:provider 选了 openai 却填 ollama 的地址,打到 /embeddings 上,
        // ollama 回一句光秃秃的「404 page not found」——原文对,但没人看得出问题在哪。
        // 「404 且不是 model-not-found」是**能确定**的形态:那个路径不存在。
        String hint = EmbeddingErrorHint.of(OLLAMA, "openai",
                new java.io.IOException("Embedding API 请求失败 [404]: 404 page not found"));
        assertFalse(hint.isEmpty(), "这条 404 值得说话");
        assertFalse(hint.contains("ollama pull"), "不是模型没拉,别让人去 pull: " + hint);
        assertFalse(hint.contains("没在运行"), "服务是通的(它回了 404): " + hint);
        assertTrue(hint.contains("BASE URL") || hint.contains("baseUrl"), hint);
        assertTrue(hint.contains("/api/embeddings") && hint.contains("/embeddings"),
                "两种协议的真实路径都要给出来,人才能自己对照: " + hint);
    }

    @Test
    @DisplayName("404 里带 model not found 时仍走「去 pull」那条 —— 顺序不能被上一条抢掉")
    void modelNotFoundStillWinsOver404PathAdvice() {
        String hint = EmbeddingErrorHint.of(OLLAMA, "ollama", new java.io.IOException(
                "Embedding API 请求失败 [404]: {\"error\":\"model \\\"bge-m3:latest\\\" not found, try pulling it first\"}"));
        assertTrue(hint.contains("ollama pull"), hint);
        assertFalse(hint.contains("BASE URL"), "别把两条建议都糊上去: " + hint);
    }

    @Test
    @DisplayName("验证地址:端口用配置的那个,主机名规范成 127.0.0.1")
    void verifyUrlKeepsThePortAndNormalizesTheHost() {
        // 写死 11434 会叫人去查一个他没在用的端口(EmbeddingConfigWiringTest 就是这么红的)
        String custom = EmbeddingErrorHint.of("http://localhost:9999", "ollama",
                new ConnectException("Failed to connect"));
        assertTrue(custom.contains("127.0.0.1:9999"), "端口该保真: " + custom);
        assertFalse(custom.contains("11434"), "不该出现一个用户没配的端口: " + custom);
    }

    @Test
    @DisplayName("provider 不是 ollama 的本机地址:不建议去起 ollama(可能是本机中转/自建服务)")
    void nonOllamaLocalBackendGetsGenericAdvice() {
        String hint = EmbeddingErrorHint.of("http://127.0.0.1:1", "openai",
                new ConnectException("Failed to connect to /127.0.0.1:1"));
        assertFalse(hint.contains("ollama serve"), "provider 是 openai,让人去起 ollama 是答错了: " + hint);
        assertTrue(hint.contains("127.0.0.1:1"), hint);
        assertTrue(hint.contains("openai"), "该点出当前 provider,便于对照: " + hint);
    }

    @Test
    @DisplayName("provider 缺省(空)按 ollama 算 —— EmbeddingClient.of 的默认就是它")
    void blankProviderDefaultsToOllama() {
        assertTrue(EmbeddingErrorHint.of(OLLAMA, "", new ConnectException("Failed to connect"))
                .contains("ollama serve"));
        assertTrue(EmbeddingErrorHint.of(OLLAMA, null, new ConnectException("Failed to connect"))
                .contains("ollama serve"));
    }
}
