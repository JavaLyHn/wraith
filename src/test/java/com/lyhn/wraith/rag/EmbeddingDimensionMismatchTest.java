package com.lyhn.wraith.rag;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 换了 embedding 模型而没重建索引时，检索必须<b>报错</b>，不能静默返回零相关。
 *
 * <p><b>实测过的症状</b>（真 ollama，本机）：用 {@code nomic-embed-text}（768 维）建好索引后，
 * 拿一个 1024 维的查询向量（{@code bge-m3} 那一档）去搜 —— 返回 <b>3 条结果、
 * 相关度全 {@code 0.0000}、不抛任何异常</b>。用户看到的是「有结果但全不相关」，
 * 而界面上没有任何异常信号，无从知道原因是维度变了。
 *
 * <p><b>为什么这会真的发生</b>：默认模型 {@code nomic-embed-text} 是<b>纯英文</b>的。
 * 同样在本机实测：查「打印发票」时它把 {@code AuthService} 排在
 * {@code InvoicePrinter} 前面（0.6250 vs 0.5643）—— 而面板的占位文字自己写着
 * 「按语义搜代码如『用户登录实现』」。于是任何中文用户都会去换一个多语言模型，
 * 一换就踩这个坑。
 *
 * <p><b>为什么选择抛异常而不是继续返回 0</b>：0 分结果**看起来像**「这个库里没有相关代码」，
 * 那是一句假话；一条点名两个维度、并说「请重建索引」的错误信息是<b>可行动的</b>。
 * {@code cosineSimilarity} 对不等长返回 0 本身没问题（它是个数学原语），
 * 该负责的是 {@code search}：它知道「库」和「查询」这两个概念。
 */
class EmbeddingDimensionMismatchTest {

    @TempDir
    Path tempDir;

    /** 造一个可控维度的向量。 */
    private static float[] vec(int dim) {
        float[] v = new float[dim];
        for (int i = 0; i < dim; i++) {
            v[i] = (float) Math.sin(i + 1);
        }
        return v;
    }

    private VectorStore storeWith(int dim, String project) throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        VectorStore store = new VectorStore(project);
        store.insertChunks(List.of(
                new VectorStore.CodeChunkEntry(
                        new CodeChunk(project + "/A.java", "class", "A", "class A {}", 1, 1), vec(dim)),
                new VectorStore.CodeChunkEntry(
                        new CodeChunk(project + "/B.java", "class", "B", "class B {}", 1, 1), vec(dim))));
        return store;
    }

    @Test
    @DisplayName("维度一致:照常检索")
    void matchingDimensionsSearchNormally() throws Exception {
        try (VectorStore store = storeWith(768, "/p/match")) {
            List<VectorStore.SearchResult> hits = store.search(vec(768), 5);
            assertEquals(2, hits.size());
        }
    }

    @Test
    @DisplayName("维度不一致:抛异常,并把两个维度都说出来")
    void mismatchThrowsWithBothDimensions() throws Exception {
        try (VectorStore store = storeWith(768, "/p/mismatch")) {
            Exception e = assertThrows(Exception.class, () -> store.search(vec(1024), 5));
            String msg = e.getMessage() == null ? "" : e.getMessage();
            assertTrue(msg.contains("768"), "要说出索引的维度: " + msg);
            assertTrue(msg.contains("1024"), "要说出当前模型的维度: " + msg);
            assertTrue(msg.contains("重建"), "要给出可行动的下一步(重建索引): " + msg);
        }
    }

    @Test
    @DisplayName("绝不返回一堆 0 分结果 —— 那看起来像「库里没有相关代码」,是假话")
    void neverReturnsZeroScoredResults() throws Exception {
        try (VectorStore store = storeWith(768, "/p/nozero")) {
            try {
                List<VectorStore.SearchResult> hits = store.search(vec(1024), 5);
                assertTrue(hits.isEmpty(),
                        "没抛异常的话至少不能返回 0 分结果,实际返回了 " + hits.size() + " 条");
            } catch (Exception expected) {
                // 抛异常是期望行为
            }
        }
    }

    @Test
    @DisplayName("空索引不该被当成维度不一致 —— 那是「还没建索引」,两回事")
    void emptyIndexIsNotAMismatch() throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        try (VectorStore store = new VectorStore("/p/empty")) {
            assertTrue(store.search(vec(1024), 5).isEmpty(), "空库应返回空结果而不是报错");
        }
    }

    @Test
    @DisplayName("空查询向量不算不一致 —— embed 失败已由上游处理,这里只要别误报")
    void emptyQueryVectorIsNotAMismatch() throws Exception {
        try (VectorStore store = storeWith(768, "/p/emptyq")) {
            assertTrue(store.search(new float[0], 5).isEmpty());
        }
    }
}
