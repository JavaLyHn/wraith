package com.lyhn.wraith.rag;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.net.ConnectException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 索引<b>跑到一半</b>后端挂掉时，那条失败信息也要带上可行动的诊断。
 *
 * <p>上一个提交（{@code fbeee84}）只接了「开跑前探测」那条路。真实场景还有另一条：
 * 索引已经开始，中途 ollama 被关掉 / 崩了 —— 那时用户看到的是
 * {@code 首个失败原因：Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434}，
 * 同一个 IPv6 障眼法，同样会把人引去查 IPv6（真实原因是服务没在跑）。
 *
 * <p>诊断插在<b>原文之前</b>，原文一律保留 —— 「连接被拒」「401 key 错」「429 限流」
 * 是完全不同的事，只给一句友好话会把人引到错的地方去查。
 */
class IndexFailureHintTest {

    @TempDir
    Path tempDir;

    /** 造一个有 N 个文件的小项目（每个文件至少切出一块）。 */
    private Path project(int files) throws Exception {
        Path root = tempDir.resolve("proj" + files);
        Files.createDirectories(root);
        for (int i = 0; i < files; i++) {
            Files.writeString(root.resolve("C" + i + ".java"),
                    "package p;\npublic class C" + i + " { void hi() { System.out.println(" + i + "); } }\n");
        }
        return root;
    }

    /** 前 {@code okCount} 块成功，之后一律抛 {@code failure}。 */
    private static EmbeddingClient flaky(int okCount, Exception failure) {
        AtomicInteger n = new AtomicInteger();
        return new EmbeddingClient("ollama", "nomic-embed-text:latest", "http://localhost:11434", "") {
            @Override public float[] embed(String text) throws IOException {
                if (n.getAndIncrement() < okCount) {
                    return new float[]{1f, 2f, 3f, 4f};
                }
                if (failure instanceof IOException io) throw io;
                throw new IOException(failure);
            }
        };
    }

    private static List<String> sink() {
        return Collections.synchronizedList(new ArrayList<>());
    }

    @Test
    @DisplayName("跑到一半连不上:结果消息里带「ollama 没在运行」与 IPv6 澄清")
    void midRunConnectFailureCarriesTheHint() throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        System.setProperty("wraith.rag.embed.concurrency", "1");
        Path root = project(12);

        CodeIndex.IndexResult r = new CodeIndex(
                flaky(3, new ConnectException("Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434")),
                sink()::add).index(root.toString());

        String msg = r.message();
        assertTrue(r.failedChunks() > 0, "该有失败块: " + msg);
        assertTrue(msg.contains("没在运行"), "该带上可行动诊断: " + msg);
        assertTrue(msg.contains("IPv6"), "该点破 IPv6 障眼法: " + msg);
        assertTrue(msg.contains("Failed to connect to"), "原文必须保留: " + msg);
    }

    @Test
    @DisplayName("429 限流不套「没在运行」那套话 —— 那会把人引到错的地方去查")
    void throttlingGetsNoConnectHint() throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        System.setProperty("wraith.rag.embed.concurrency", "1");
        Path root = project(12);

        CodeIndex.IndexResult r = new CodeIndex(
                flaky(3, new IOException("Embedding API 请求失败 [429]: rate limited")),
                sink()::add).index(root.toString());

        String msg = r.message();
        assertTrue(r.failedChunks() > 0, msg);
        assertFalse(msg.contains("没在运行"), "429 不是「没在运行」: " + msg);
        assertTrue(msg.contains("429"), "原文必须保留: " + msg);
    }

    @Test
    @DisplayName("全成功时一个字都不加")
    void successAddsNothing() throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        Path root = project(3);

        CodeIndex.IndexResult r = new CodeIndex(flaky(9999, new IOException("never")))
                .index(root.toString());

        assertTrue(r.message().contains("索引完成"), r.message());
        assertFalse(r.message().contains("没在运行"), r.message());
        assertFalse(r.message().contains("不完整"), r.message());
    }

    @Test
    @DisplayName("诊断只出现一次 —— 早停那条进度线与最终结果不该各说一遍同样的长段")
    void hintAppearsOnlyOnceInTheResult() throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        System.setProperty("wraith.rag.embed.concurrency", "1");
        Path root = project(30);   // 足够触发 ABORT_AFTER_CONSECUTIVE_FAILURES=20

        CodeIndex.IndexResult r = new CodeIndex(
                flaky(0, new ConnectException("Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434")),
                sink()::add).index(root.toString());

        int occurrences = r.message().split("没在运行", -1).length - 1;
        assertTrue(occurrences == 1, "结果消息里该只出现一次,实际 " + occurrences + " 次: " + r.message());
    }
}
