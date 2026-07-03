package com.lyhn.wraith.rag;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class CodeIndexTest {

    /**
     * 测试用桩:不发起网络请求,直接返回定长零向量。
     * 根因:EmbeddingClient 默认指向 localhost Ollama,测试环境无此服务,
     * embed() 抛 IOException → CodeIndex 静默跳过所有 chunk → chunkCount() == 0。
     * 修复侧:测试侧注入桩(断言逻辑正确,实现逻辑正确,仅测试依赖了不可用外部服务)。
     */
    private static final EmbeddingClient STUB_EMBEDDING_CLIENT = new EmbeddingClient() {
        private static final float[] FIXED_VECTOR = new float[4];

        @Override
        public float[] embed(String text) throws IOException {
            return FIXED_VECTOR;
        }
    };

    /**
     * 部分失败桩:对包含特定标记的 text 抛出 IOException,其余返回零向量。
     * 用于模拟部分文件嵌入失败的场景（T9 红绿测试）。
     */
    private static EmbeddingClient makePartialFailureClient(Set<String> failTriggerTokens) {
        return new EmbeddingClient() {
            private static final float[] FIXED_VECTOR = new float[4];

            @Override
            public float[] embed(String text) throws IOException {
                for (String token : failTriggerTokens) {
                    if (text != null && text.contains(token)) {
                        throw new IOException("stub: simulated embedding failure for token=" + token);
                    }
                }
                return FIXED_VECTOR;
            }
        };
    }

    @Test
    void testIndexNonExistentPath() {
        CodeIndex indexer = new CodeIndex(STUB_EMBEDDING_CLIENT, CodeIndex.ProgressListener.noop());
        CodeIndex.IndexResult result = indexer.index("/non/existent/path");
        assertEquals(0, result.chunkCount());
        assertTrue(result.message().contains("路径不存在"));
    }

    @Test
    void testIndexCurrentProject() {
        System.setProperty("wraith.rag.dir", "/tmp/wraith-test-rag-index");
        CodeIndex indexer = new CodeIndex(STUB_EMBEDDING_CLIENT, CodeIndex.ProgressListener.noop());
        // 索引测试资源目录
        CodeIndex.IndexResult result = indexer.index("src/test/resources/rag");
        assertTrue(result.chunkCount() > 0, "应该至少索引一个代码块");
        assertTrue(result.message().contains("索引完成"));
    }

    @Test
    void reportsProgressThroughListener() {
        System.setProperty("wraith.rag.dir", "/tmp/wraith-test-rag-index");
        List<String> messages = new ArrayList<>();
        CodeIndex indexer = new CodeIndex(STUB_EMBEDDING_CLIENT, messages::add);

        CodeIndex.IndexResult result = indexer.index("src/test/resources/rag");

        assertTrue(result.chunkCount() > 0, "应该至少索引一个代码块");
        assertTrue(messages.stream().anyMatch(message -> message.startsWith("🔍 开始索引")));
        assertTrue(messages.stream().anyMatch(message -> message.startsWith("📁 发现")));
        assertTrue(messages.stream().anyMatch(message -> message.startsWith("✅ 索引完成")));
    }

    /**
     * T9 红绿 — GREEN:部分文件 embed 失败时,IndexResult.message 必须包含失败计数。
     *
     * 场景:创建 2 个 .java 文件。stub EmbeddingClient 对包含 "FailableClass" 标记
     * 的 text 抛 IOException(模拟第一个文件的所有 chunk 失败),其余正常。
     * chunker 产生的 toEmbeddingText() 格式为 "[class:FailableClass] ..."
     * 所以类名 "FailableClass" 会出现在 embed text 里,可以安全匹配。
     * 断言:message 包含 "个文件失败"(证明 failedFiles 计数被反映进 summary)。
     *
     * RED 观察(不计数时):message 仅含 "索引完成" 而不含 "个文件失败",
     * 用户无法得知有文件被跳过。
     */
    @Test
    void partialEmbedFailure_messageMustContainFailureCount(@TempDir Path tempDir) throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.resolve("rag-store").toString());

        // 文件 A:类名含触发词 "FailableClass",chunk embed text 格式 "[class:FailableClass] ..."
        // — 触发 IOException(模拟第一个文件的所有 chunk 失败)
        Path fileA = tempDir.resolve("FailableClass.java");
        Files.writeString(fileA,
                "public class FailableClass { public void doSomething() {} }");

        // 文件 B:正常文件,embed 成功
        Path fileB = tempDir.resolve("OkFile.java");
        Files.writeString(fileB,
                "public class OkFile { public void ok() {} }");

        EmbeddingClient partialFailClient = makePartialFailureClient(Set.of("FailableClass"));
        CodeIndex indexer = new CodeIndex(partialFailClient, CodeIndex.ProgressListener.noop());

        CodeIndex.IndexResult result = indexer.index(tempDir.toString());

        // 核心断言:失败计数必须出现在 summary 中
        assertTrue(result.message().contains("个文件失败"),
                "partial failure: message 应含 '个文件失败',实际=" + result.message());
        // 成功的文件 B 应该贡献至少一个 chunk
        assertTrue(result.chunkCount() > 0,
                "OkFile 应成功索引至少一个代码块,chunkCount=" + result.chunkCount());
    }

    /**
     * T9 红绿 — ALL-SUCCESS:全部文件 embed 成功时,message 保持原有"索引完成"文案,
     * 不追加失败后缀。
     */
    @Test
    void allSuccess_messageDoesNotContainFailureSuffix(@TempDir Path tempDir) throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.resolve("rag-store").toString());

        Path fileA = tempDir.resolve("FileA.java");
        Files.writeString(fileA, "public class FileA { public void hello() {} }");

        Path fileB = tempDir.resolve("FileB.java");
        Files.writeString(fileB, "public class FileB { public void world() {} }");

        // 使用全成功桩
        CodeIndex indexer = new CodeIndex(STUB_EMBEDDING_CLIENT, CodeIndex.ProgressListener.noop());

        CodeIndex.IndexResult result = indexer.index(tempDir.toString());

        // 文案应含"索引完成"
        assertTrue(result.message().contains("索引完成"),
                "all-success: message 应含 '索引完成',实际=" + result.message());
        // 文案不应含失败后缀
        assertFalse(result.message().contains("个文件失败"),
                "all-success: message 不应含 '个文件失败',实际=" + result.message());
    }
}
