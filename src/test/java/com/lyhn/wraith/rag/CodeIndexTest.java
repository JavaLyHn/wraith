package com.lyhn.wraith.rag;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

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
}
