package com.lyhn.wraith.rag;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 索引要记住「我是用哪个 embedding 模型建的」。
 *
 * <p><b>为什么需要</b>：换了 embedding 模型而不重建索引，检索会全军覆没
 * （见 {@code EmbeddingDimensionMismatchTest}：实测返回一堆 0 分结果）。检索时报错是兜底，
 * 但那已经晚了 —— 用户是在「保存 Embedding 配置」那一刻埋下的雷，
 * 面板本该在那时就提示他重建。
 *
 * <p>而面板要做这个提示，得能诚实地回答一个问题：<b>索引是用哪个模型建的？</b>
 * 此前这个信息压根没被记录过，所以任何提示都只能靠猜（比如「这次会话里改过配置」——
 * 重启就丢，而索引是长期存在的）。
 *
 * <p><b>为什么用独立小表而不是给 code_chunks 加列</b>：{@code CREATE TABLE IF NOT EXISTS}
 * 对新库和老库都成立，不需要 {@code ALTER TABLE} 与迁移判断。老库读出来是 {@code null}，
 * 面板据此显示「未知」而不是编一个模型名 —— 不知道就说不知道。
 */
class IndexMetaTest {

    @TempDir
    Path tempDir;

    private static float[] vec(int dim) {
        float[] v = new float[dim];
        for (int i = 0; i < dim; i++) v[i] = (float) Math.cos(i + 1);
        return v;
    }

    private VectorStore store(String project) throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        return new VectorStore(project);
    }

    @Test
    @DisplayName("写入后读回模型名与维度")
    void recordsAndReadsBack() throws Exception {
        try (VectorStore s = store("/p/a")) {
            s.recordIndexMeta("nomic-embed-text:latest", 768);
            VectorStore.IndexMeta m = s.readIndexMeta();
            assertEquals("nomic-embed-text:latest", m.embeddingModel());
            assertEquals(768, m.embeddingDim());
        }
    }

    @Test
    @DisplayName("重建索引后是覆盖而不是追加 —— 否则读回的是上一次的模型")
    void rebuildOverwrites() throws Exception {
        try (VectorStore s = store("/p/b")) {
            s.recordIndexMeta("nomic-embed-text:latest", 768);
            s.recordIndexMeta("bge-m3:latest", 1024);
            VectorStore.IndexMeta m = s.readIndexMeta();
            assertEquals("bge-m3:latest", m.embeddingModel());
            assertEquals(1024, m.embeddingDim());
        }
    }

    @Test
    @DisplayName("老索引(没记过)读回 null —— 不知道就说不知道,不许编一个默认模型名")
    void legacyIndexReadsBackNull() throws Exception {
        try (VectorStore s = store("/p/legacy")) {
            s.insertChunks(List.of(new VectorStore.CodeChunkEntry(
                    new CodeChunk("/p/legacy/A.java", "class", "A", "class A {}", 1, 1), vec(768))));
            VectorStore.IndexMeta m = s.readIndexMeta();
            assertNull(m.embeddingModel(), "没记过就该是 null,而不是猜一个 nomic");
            assertEquals(0, m.embeddingDim());
        }
    }

    @Test
    @DisplayName("按项目隔离:另一个项目的记录不会串过来")
    void metaIsPerProject() throws Exception {
        try (VectorStore a = store("/p/one")) {
            a.recordIndexMeta("model-one", 111);
        }
        try (VectorStore b = store("/p/two")) {
            assertNull(b.readIndexMeta().embeddingModel(), "串项目了");
            b.recordIndexMeta("model-two", 222);
        }
        try (VectorStore a = store("/p/one")) {
            assertEquals("model-one", a.readIndexMeta().embeddingModel());
        }
    }

    @Test
    @DisplayName("clearProject 把元数据一起清掉 —— 留着会指向一个已经不存在的索引")
    void clearProjectAlsoClearsMeta() throws Exception {
        try (VectorStore s = store("/p/clear")) {
            s.recordIndexMeta("m", 768);
            s.clearProject();
            assertNull(s.readIndexMeta().embeddingModel());
        }
    }

    @Test
    @DisplayName("IndexStats 带上模型名 —— rag.status 靠它回给面板")
    void statsCarryTheModel() throws Exception {
        try (VectorStore s = store("/p/stats")) {
            s.insertChunks(List.of(new VectorStore.CodeChunkEntry(
                    new CodeChunk("/p/stats/A.java", "class", "A", "class A {}", 1, 1), vec(1024))));
            s.recordIndexMeta("bge-m3:latest", 1024);
            VectorStore.IndexStats st = s.getStats();
            assertEquals(1, st.chunkCount());
            assertEquals("bge-m3:latest", st.embeddingModel());
            assertEquals(1024, st.embeddingDim());
        }
    }

    @Test
    @DisplayName("空模型名不写进去 —— 存个空串等于假装记录过")
    void blankModelIsNotRecorded() throws Exception {
        try (VectorStore s = store("/p/blank")) {
            s.recordIndexMeta("   ", 768);
            assertNull(s.readIndexMeta().embeddingModel());
            s.recordIndexMeta(null, 768);
            assertNull(s.readIndexMeta().embeddingModel());
        }
    }

    @Test
    @DisplayName("真实索引流程会把模型记下来(端到端,不发网络:注入桩 client)")
    void codeIndexRecordsTheModel() throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        Path proj = tempDir.resolve("proj");
        Path src = proj.resolve("A.java");
        java.nio.file.Files.createDirectories(proj);
        java.nio.file.Files.writeString(src, "package p;\npublic class A { void hi() {} }\n");

        EmbeddingClient stub = new EmbeddingClient("ollama", "stub-model:1", "http://127.0.0.1:1", "") {
            @Override public float[] embed(String text) { return vec(4); }
        };
        new CodeIndex(stub).index(proj.toString());

        try (VectorStore s = new VectorStore(proj.toString())) {
            assertEquals("stub-model:1", s.readIndexMeta().embeddingModel());
            assertEquals(4, s.readIndexMeta().embeddingDim());
            assertTrue(s.getStats().chunkCount() > 0);
        }
    }
}
