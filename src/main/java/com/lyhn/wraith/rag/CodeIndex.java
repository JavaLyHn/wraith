package com.lyhn.wraith.rag;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 代码索引管理器：负责将代码库分块、向量化并持久化到 VectorStore
 */
public class CodeIndex {
    private static final Logger log = LoggerFactory.getLogger(CodeIndex.class);
    private final EmbeddingClient embeddingClient;
    private final CodeChunker chunker;
    private final CodeAnalyzer analyzer;
    private final ProgressListener progressListener;

    @FunctionalInterface
    public interface ProgressListener {
        void onProgress(String message);

        static ProgressListener noop() {
            return message -> {
            };
        }
    }

    /** 默认后端 = 配置里的「Embedding 后端」(没配过才回落 env/Ollama);别改回 new EmbeddingClient()。 */
    public CodeIndex() {
        this(EmbeddingClient.fromConfigOrEnv(), ProgressListener.noop());
    }

    public CodeIndex(EmbeddingClient embeddingClient) {
        this(embeddingClient, ProgressListener.noop());
    }

    public CodeIndex(ProgressListener progressListener) {
        this(EmbeddingClient.fromConfigOrEnv(), progressListener);
    }

    public CodeIndex(EmbeddingClient embeddingClient, ProgressListener progressListener) {
        this.embeddingClient = embeddingClient;
        this.chunker = new CodeChunker();
        this.analyzer = new CodeAnalyzer();
        this.progressListener = progressListener == null ? ProgressListener.noop() : progressListener;
    }

    /**
     * 索引指定路径的代码库
     *
     * @param projectPath 项目根目录
     * @return 索引统计信息
     */
    public IndexResult index(String projectPath) {
        long startedAt = System.nanoTime();
        Path root = Paths.get(projectPath).toAbsolutePath().normalize();
        if (!Files.exists(root)) {
            String message = "路径不存在: " + projectPath;
            emit("❌ " + message);
            return new IndexResult(0, 0, message);
        }

        emit("🔍 开始索引: " + root);

        List<Path> filesToIndex = new ArrayList<>();
        collectFiles(root, filesToIndex);
        emit("📁 发现 " + filesToIndex.size() + " 个文件待索引");

        // ── 阶段 1:分块 + 关系分析 ──────────────────────────────────────────
        // 刻意串行:CodeChunker / CodeAnalyzer 各自持有一个复用的 JavaParser 实例，不是线程安全的；
        // 而这一步是纯本地 CPU，占比极小（真正的时间全在阶段 2 的网络往返上），并行它没有收益。
        List<CodeChunk> allChunks = new ArrayList<>();
        List<CodeRelation> allRelations = new ArrayList<>();
        Set<String> chunkFailedFiles = new LinkedHashSet<>();

        int javaFiles = 0;
        for (Path file : filesToIndex) {
            try {
                allChunks.addAll(chunker.chunkFile(file));
                if (file.toString().endsWith(".java")) {
                    javaFiles++;
                    allRelations.addAll(analyzer.analyzeFile(file));
                }
            } catch (Exception e) {
                emit("   ⚠️ 分块失败: " + file + " - " + e.getMessage());
                log.warn("code chunking failed for file {}", file, e);
                chunkFailedFiles.add(file.toString());
            }
        }

        // ── 阶段 2:向量化(并发) ───────────────────────────────────────────
        EmbedOutcome embedded = embedAll(allChunks);

        // ── 阶段 3:持久化到 SQLite ────────────────────────────────────────
        try (VectorStore store = new VectorStore(root.toString())) {
            store.clearProject();
            store.insertChunks(embedded.entries);
            store.insertRelations(allRelations);
            // 记下这份索引用的是哪个模型/多少维。换模型不重建索引会让检索全军覆没
            // (相关度全 0),面板要靠这条在「保存 Embedding 配置」那一刻就提示重建。
            store.recordIndexMeta(embeddingClient.getModel(),
                    embedded.entries.isEmpty() ? 0 : embedded.entries.get(0).embedding().length);

            VectorStore.IndexStats stats = store.getStats();
            Set<String> failedFiles = new LinkedHashSet<>(chunkFailedFiles);
            failedFiles.addAll(embedded.failedFiles);
            String msg = summarize(stats, embedded, failedFiles.size());
            emit("✅ " + msg);
            long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000;
            return new IndexResult(stats.chunkCount(), stats.relationCount(), msg,
                    embedded.failedChunks, failedFiles.size(),
                    filesToIndex.size(), javaFiles, elapsedMs);
        } catch (Exception e) {
            String error = "持久化失败: " + e.getMessage();
            emit("❌ " + error);
            log.warn("code index persistence failed for root {}", root, e);
            return new IndexResult(0, 0, error);
        }
    }

    /**
     * 索引小结。有任何失败时必须把「不完整」和首个失败原因说出来 —— 残缺索引最坏的形态是
     * 静默:面板显示「已索引 N 块」，用户以为搜得全，实际有一批代码永远搜不到。
     */
    private String summarize(VectorStore.IndexStats stats, EmbedOutcome embedded, int failedFileCount) {
        if (embedded.failedChunks == 0 && failedFileCount == 0) {
            return String.format("索引完成：%d 个代码块，%d 条关系", stats.chunkCount(), stats.relationCount());
        }
        String reason = embedded.firstError == null ? "" : "；首个失败原因：" + embedded.firstError;
        String base = String.format("索引完成但不完整：%d 个代码块，%d 条关系（%d 个代码块向量化失败，涉及 %d 个文件失败，"
                        + "这些代码搜不到，建议重试）%s",
                stats.chunkCount(), stats.relationCount(), embedded.failedChunks, failedFileCount, reason);
        // 索引**跑到一半**后端挂掉是另一条真实路径(开跑前的探测已在 Main.ragIndex 处理)。
        // 那时用户看到的是同一个 IPv6 障眼法(「Failed to connect to localhost/[0:0:0:0:0:0:0:1]」),
        // 同样会把人引去查 IPv6 —— 真实原因是服务没在跑。诊断附在原文**之后**、单独一段:
        // 原文一律保留,「连接被拒」「401 key 错」「429 限流」是完全不同的事。
        String hint = EmbeddingErrorHint.ofMessage(embeddingClient.getBaseUrl(),
                embeddingClient.getProvider(), embedded.firstError);
        return hint.isEmpty() ? base : base + "\n\n" + hint;
    }

    /** 阶段 2 的产出:成功条目 + 失败账目(谁失败了、失败了多少、第一条原因)。 */
    private record EmbedOutcome(List<VectorStore.CodeChunkEntry> entries,
                                Set<String> failedFiles,
                                int failedChunks,
                                String firstError) {}

    /** 并发度。默认 8:实测单次 embedding 往返 ~0.8s，串行 7000 块要 1.6 小时，全在等网络。 */
    private static int concurrency() {
        return Math.max(1, Math.min(Integer.getInteger("wraith.rag.embed.concurrency", 8), 32));
    }

    /**
     * 连续失败到这个数且**一块都没成功**，就判定后端整体不可用并停手。
     *
     * <p>真实场景:免费额度耗尽后 siliconflow 对每个请求回 402「余额不足」。402 是 4xx，按设计不重试，
     * 于是 7000 多块会一块一块地失败到底 —— 白等好几分钟，最后只得到一句「全部失败」。
     * 早停把它变成几秒钟 + 一条说明原因的消息。
     */
    private static final int ABORT_AFTER_CONSECUTIVE_FAILURES = 20;

    private static boolean shouldAbort(int failed, int succeeded) {
        return succeeded == 0 && failed >= ABORT_AFTER_CONSECUTIVE_FAILURES;
    }

    private EmbedOutcome embedAll(List<CodeChunk> chunks) {
        int total = chunks.size();
        if (total == 0) {
            return new EmbedOutcome(List.of(), Set.of(), 0, null);
        }
        int threads = Math.min(concurrency(), total);
        emit(String.format("✂️ 切出 %d 个代码块，开始向量化（并发 %d）", total, threads));

        List<VectorStore.CodeChunkEntry> entries = Collections.synchronizedList(new ArrayList<>(total));
        Set<String> failedFiles = ConcurrentHashMap.newKeySet();
        AtomicInteger failedChunks = new AtomicInteger();
        AtomicReference<String> firstError = new AtomicReference<>();
        AtomicInteger done = new AtomicInteger();
        int step = Math.max(1, total / 50); // 约每 2% 一条进度，别把事件流刷爆

        AtomicBoolean aborted = new AtomicBoolean();
        AtomicInteger threadSeq = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(threads, r -> {
            Thread t = new Thread(r, "rag-embed-" + threadSeq.incrementAndGet()); // 带序号:线程转储里能看出并发度
            t.setDaemon(true); // 关掉 App 时不吊住 JVM
            return t;
        });
        try {
            List<Future<?>> futures = new ArrayList<>(total);
            for (CodeChunk chunk : chunks) {
                futures.add(pool.submit(() -> {
                    if (aborted.get()) {
                        failedChunks.incrementAndGet();
                        failedFiles.add(chunk.filePath());
                        return; // 已判定后端整体不可用,不再往墙上撞
                    }
                    try {
                        entries.add(new VectorStore.CodeChunkEntry(
                                chunk, embeddingClient.embed(chunk.toEmbeddingText())));
                    } catch (Exception e) {
                        failedChunks.incrementAndGet();
                        failedFiles.add(chunk.filePath());
                        firstError.compareAndSet(null, e.getMessage());
                        log.warn("embedding failed for chunk {} in {}", chunk.name(), chunk.filePath(), e);
                        if (shouldAbort(failedChunks.get(), entries.size()) && aborted.compareAndSet(false, true)) {
                            emit("❌ 前 " + ABORT_AFTER_CONSECUTIVE_FAILURES + " 块全部失败，判定后端整体不可用，"
                                    + "停止本次索引：" + e.getMessage());
                        }
                    }
                    int n = done.incrementAndGet();
                    if (n % step == 0 || n == total) {
                        // 只有 n/m 等于什么都没说(用户原话:「仅仅是数字变化,没有详细的内容」)。
                        // 带上刚完成的那一块所在文件 —— 措辞是「刚完成」而不是「正在处理」:
                        // 并发 8 条时"当前"没有唯一答案,说成正在处理就是一句不准的话。
                        // 只取文件名,全路径会把那一行撑爆。
                        emit(String.format("   进度 %d%%  %d/%d 块 · 刚完成 %s",
                                n * 100 / total, n, total, fileNameOf(chunk.filePath())));
                    }
                }));
            }
            for (Future<?> f : futures) {
                try {
                    f.get();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                } catch (ExecutionException e) {
                    // 单块异常已在任务内计账;这里只可能是任务体自身的意外
                    log.warn("embedding task failed unexpectedly", e.getCause());
                }
            }
        } finally {
            pool.shutdownNow();
        }
        return new EmbedOutcome(new ArrayList<>(entries), failedFiles, failedChunks.get(), firstError.get());
    }

    /** 取路径的最后一段（同时兼容 / 与 \\，Windows 上路径分隔符是后者）。 */
    private static String fileNameOf(String path) {
        if (path == null || path.isEmpty()) {
            return "(未知文件)";
        }
        int cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        return cut >= 0 && cut + 1 < path.length() ? path.substring(cut + 1) : path;
    }

    /**
     * 进度回调。**必须 synchronized**:阶段 2 从多个 worker 线程调它，而 listener 往往是个裸
     * 集合（测试里是 {@code messages::add}，一个 ArrayList）—— 不串行化就是数据竞争。
     */
    private synchronized void emit(String message) {
        progressListener.onProgress(message);
    }

    /**
     * 收集需要索引的文件（排除常见非代码目录）
     */
    private void collectFiles(Path root, List<Path> files) {
        try {
            Files.walkFileTree(root, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                    String dirName = dir.getFileName().toString();
                    // 跳过常见非代码目录
                    if (dirName.equals("node_modules") || dirName.equals("target")
                            || dirName.equals("build") || dirName.equals(".git")
                            || dirName.equals(".idea") || dirName.equals(".vscode")
                            || dirName.equals("dist") || dirName.equals("out")
                            || dirName.startsWith(".")) {
                        return FileVisitResult.SKIP_SUBTREE;
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    String name = file.getFileName().toString();
                    // 只索引文本代码文件
                    if (name.endsWith(".java") || name.endsWith(".py")
                            || name.endsWith(".js") || name.endsWith(".ts")
                            || name.endsWith(".go") || name.endsWith(".rs")
                            || name.endsWith(".c") || name.endsWith(".cpp")
                            || name.endsWith(".h") || name.endsWith(".md")
                            || name.endsWith(".xml") || name.endsWith(".properties")
                            || name.endsWith(".yaml") || name.endsWith(".yml")
                            || name.endsWith(".json") || name.endsWith(".sh")
                            || name.endsWith(".gradle") || name.endsWith(".kt")) {
                        files.add(file);
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(Path file, IOException exc) {
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            String message = "遍历文件失败: " + e.getMessage();
            emit("❌ " + message);
            log.warn("code index file traversal failed for root {}", root, e);
        }
    }

    /**
     * @param failedChunks 向量化失败的代码块数(>0 即索引不完整,这些代码搜不到)
     * @param failedFiles  至少有一个块失败的文件数
     */
    /**
     * 索引结果。
     *
     * <p>{@code fileCount} / {@code javaFileCount} / {@code elapsedMs} 是后补的：面板此前只能
     * 显示「已索引 N 块 · M 关系」，说不出「索引了什么」。其中 {@code javaFileCount} 尤其重要 ——
     * <b>关系图谱只从 {@code .java} 提取</b>，非 Java 项目必然 0 关系，
     * 界面得能据此解释而不是让用户以为失败了。
     */
    public record IndexResult(int chunkCount, int relationCount, String message,
                              int failedChunks, int failedFiles,
                              int fileCount, int javaFileCount, long elapsedMs) {
        public IndexResult(int chunkCount, int relationCount, String message) {
            this(chunkCount, relationCount, message, 0, 0, 0, 0, 0L);
        }

        public IndexResult(int chunkCount, int relationCount, String message,
                           int failedChunks, int failedFiles) {
            this(chunkCount, relationCount, message, failedChunks, failedFiles, 0, 0, 0L);
        }
    }
}
