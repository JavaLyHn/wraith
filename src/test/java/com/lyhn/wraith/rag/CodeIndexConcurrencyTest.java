package com.lyhn.wraith.rag;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 整库索引是「一个代码块一次 HTTP 往返」。实测单次 embedding ~0.8s,本仓库切出约 7000 块 ——
 * 串行要 1.6 小时,而这 1.6 小时几乎全在等网络。所以阶段 2 必须并发。
 *
 * <p>并发带来两个必须钉住的约束:
 * <ol>
 *   <li>进度回调会从多个 worker 线程打进来。listener 往往是个裸集合(app-server 是 writer,
 *       测试里是 {@code messages::add} 的 ArrayList),不串行化就是数据竞争。</li>
 *   <li>失败账目要按块统计且不能静默。残缺索引最坏的形态是面板显示「已索引 N 块」,
 *       用户以为搜得全,其实有一批代码永远搜不到。</li>
 * </ol>
 */
class CodeIndexConcurrencyTest {

    @AfterEach
    void clearConcurrencyOverride() {
        System.clearProperty("wraith.rag.embed.concurrency");
    }

    /** 每次 embed 睡 120ms 并记录峰值并发。串行执行时峰值恒为 1。 */
    private static class ConcurrencyProbeClient extends EmbeddingClient {
        final AtomicInteger inFlight = new AtomicInteger();
        final AtomicInteger peak = new AtomicInteger();
        final AtomicInteger calls = new AtomicInteger();
        final Set<String> threads = Collections.synchronizedSet(new HashSet<>());

        @Override
        public float[] embed(String text) throws IOException {
            calls.incrementAndGet();
            threads.add(Thread.currentThread().getName());
            int now = inFlight.incrementAndGet();
            peak.accumulateAndGet(now, Math::max);
            try {
                Thread.sleep(120);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("interrupted");
            } finally {
                inFlight.decrementAndGet();
            }
            return new float[]{0.1f, 0.2f};
        }
    }

    /** 造 n 个各含一个类的 .java 文件 —— 每个文件至少切出 1 类 + 1 方法。 */
    private static void seedFiles(Path dir, int n) throws Exception {
        for (int i = 0; i < n; i++) {
            Files.writeString(dir.resolve("Klass" + i + ".java"),
                    "public class Klass" + i + " { public void run" + i + "() { int x = " + i + "; } }");
        }
    }

    @Test
    void embedsChunksConcurrently(@TempDir Path tmp) throws Exception {
        System.setProperty("wraith.rag.dir", tmp.resolve("rag").toString());
        System.setProperty("wraith.rag.embed.concurrency", "8");
        Path project = Files.createDirectories(tmp.resolve("project"));
        seedFiles(project, 12); // ≥24 块,足以让 8 路并发同时在飞

        ConcurrencyProbeClient probe = new ConcurrencyProbeClient();
        CodeIndex.IndexResult res = new CodeIndex(probe, CodeIndex.ProgressListener.noop()).index(project.toString());

        assertTrue(res.chunkCount() > 8, "块数不够,测不出并发:" + res.chunkCount());
        assertTrue(probe.peak.get() > 1,
                "embedding 仍是串行的(峰值并发=" + probe.peak.get() + "),整库索引会一直卡在等网络");
        assertTrue(probe.threads.size() > 1, "所有 embed 都在同一个线程上:" + probe.threads);
        assertEquals(0, res.failedChunks(), "探针不该失败");
    }

    @Test
    void concurrencyIsCappedByTheConfiguredValue(@TempDir Path tmp) throws Exception {
        System.setProperty("wraith.rag.dir", tmp.resolve("rag").toString());
        System.setProperty("wraith.rag.embed.concurrency", "2");
        Path project = Files.createDirectories(tmp.resolve("project"));
        seedFiles(project, 12);

        ConcurrencyProbeClient probe = new ConcurrencyProbeClient();
        new CodeIndex(probe, CodeIndex.ProgressListener.noop()).index(project.toString());

        // 免费额度有 RPM 上限,并发度必须真的可控 —— 不然只能靠退避硬扛
        assertTrue(probe.peak.get() <= 2, "并发度没被配置约束住,峰值=" + probe.peak.get());
        assertTrue(probe.peak.get() > 1, "配了 2 却仍是串行,峰值=" + probe.peak.get());
    }

    @Test
    void everyChunkIsEmbeddedExactlyOnce(@TempDir Path tmp) throws Exception {
        System.setProperty("wraith.rag.dir", tmp.resolve("rag").toString());
        System.setProperty("wraith.rag.embed.concurrency", "8");
        Path project = Files.createDirectories(tmp.resolve("project"));
        seedFiles(project, 10);

        ConcurrencyProbeClient probe = new ConcurrencyProbeClient();
        CodeIndex.IndexResult res = new CodeIndex(probe, CodeIndex.ProgressListener.noop()).index(project.toString());

        // 并发最容易出的错是漏块或重复提交:调用次数必须等于入库块数
        assertEquals(res.chunkCount(), probe.calls.get(),
                "embed 调用次数与入库块数不符 —— 有块被漏掉或被提交了两次");
    }

    @Test
    void progressCallbackIsSerializedAcrossWorkerThreads(@TempDir Path tmp) throws Exception {
        System.setProperty("wraith.rag.dir", tmp.resolve("rag").toString());
        System.setProperty("wraith.rag.embed.concurrency", "8");
        Path project = Files.createDirectories(tmp.resolve("project"));
        seedFiles(project, 12);

        // 直接检测「回调被重入」:进回调时 +1,出来时 -1,中途停留 3ms。
        // emit 若没串行化,多个 worker 线程会同时停在这 3ms 里,inside 就会 >1。
        AtomicInteger inside = new AtomicInteger();
        AtomicInteger overlaps = new AtomicInteger();
        List<String> messages = new CopyOnWriteArrayList<>();
        CodeIndex.ProgressListener detector = m -> {
            if (inside.incrementAndGet() > 1) overlaps.incrementAndGet();
            messages.add(m);
            try {
                Thread.sleep(3);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } finally {
                inside.decrementAndGet();
            }
        };

        new CodeIndex(new ConcurrencyProbeClient(), detector).index(project.toString());

        assertEquals(0, overlaps.get(),
                "进度回调被并发重入了 " + overlaps.get() + " 次 —— emit 必须 synchronized,"
                        + "否则裸集合 listener(既有测试传的就是 ArrayList::add)会被写坏");
        assertTrue(messages.stream().anyMatch(m -> m.startsWith("✅ 索引完成")), "收尾消息丢了:" + messages);
    }

    // ── 失败账目:不许静默 ────────────────────────────────────────────────

    @Test
    void partialFailureReportsChunkAndFileCountsAndFirstReason(@TempDir Path tmp) throws Exception {
        System.setProperty("wraith.rag.dir", tmp.resolve("rag").toString());
        Path project = Files.createDirectories(tmp.resolve("project"));
        Files.writeString(project.resolve("Bad.java"), "public class Bad { public void boom() {} }");
        Files.writeString(project.resolve("Good.java"), "public class Good { public void ok() {} }");

        EmbeddingClient failsOnBad = new EmbeddingClient() {
            @Override public float[] embed(String text) throws IOException {
                if (text.contains("Bad")) throw new IOException("Embedding API 请求失败 [401]: invalid api key");
                return new float[]{0.5f};
            }
        };
        CodeIndex.IndexResult res = new CodeIndex(failsOnBad, CodeIndex.ProgressListener.noop())
                .index(project.toString());

        assertTrue(res.failedChunks() > 0, "失败块数没进 IndexResult,面板无从得知索引残缺");
        assertEquals(1, res.failedFiles(), "失败文件数应为 1(Bad.java),实际=" + res.failedFiles());
        assertTrue(res.message().contains("不完整"),
                "文案没说这是个残缺索引:" + res.message());
        assertTrue(res.message().contains("401"),
                "没带上首个失败原因,用户不知道是 key 错了还是限流:" + res.message());
        assertTrue(res.chunkCount() > 0, "Good.java 应照常入库");
    }

    /**
     * 后端整体不可用(免费额度耗尽后 siliconflow 对每个请求回 402)时必须早停。
     * 402 是 4xx、按设计不重试,但如果不早停就会一块一块失败到底 —— 7000 多块白等几分钟,
     * 最后只得到一句「全部失败」。
     */
    @Test
    void abortsEarlyWhenEveryChunkFails(@TempDir Path tmp) throws Exception {
        System.setProperty("wraith.rag.dir", tmp.resolve("rag").toString());
        System.setProperty("wraith.rag.embed.concurrency", "4");
        Path project = Files.createDirectories(tmp.resolve("project"));
        seedFiles(project, 120); // ≥240 块,远多于早停阈值 20

        AtomicInteger attempts = new AtomicInteger();
        EmbeddingClient brokeAccount = new EmbeddingClient() {
            @Override public float[] embed(String text) throws IOException {
                attempts.incrementAndGet();
                throw new IOException("Embedding API 请求失败 [402]: "
                        + "{\"code\":30001,\"message\":\"Sorry, your account balance is insufficient\"}");
            }
        };
        List<String> log = new CopyOnWriteArrayList<>();
        CodeIndex.IndexResult res = new CodeIndex(brokeAccount, log::add).index(project.toString());

        assertEquals(0, res.chunkCount(), "全失败时不该有块入库");
        assertTrue(res.failedChunks() > 0, "失败要计账");
        // 早停:实际发出的请求数远少于总块数(留出并发在途的余量)
        assertTrue(attempts.get() < 100,
                "没有早停,发了 " + attempts.get() + " 次请求 —— 全失败时应尽早停手");
        assertTrue(log.stream().anyMatch(m -> m.contains("402")),
                "要把后端给的原因说出来(402 余额不足 ≠ 网络不通):" + log);
        assertTrue(res.message().contains("402"), "小结里也要带原因:" + res.message());
    }

    @Test
    void allSuccessCarriesZeroFailureCountsAndNoScaryWording(@TempDir Path tmp) throws Exception {
        System.setProperty("wraith.rag.dir", tmp.resolve("rag").toString());
        Path project = Files.createDirectories(tmp.resolve("project"));
        seedFiles(project, 3);

        CodeIndex.IndexResult res = new CodeIndex(new ConcurrencyProbeClient(), CodeIndex.ProgressListener.noop())
                .index(project.toString());

        assertEquals(0, res.failedChunks());
        assertEquals(0, res.failedFiles());
        assertFalse(res.message().contains("不完整"), "全成功不该报不完整:" + res.message());
    }

}
