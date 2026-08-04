package com.lyhn.wraith.rag;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 索引范围必须记进 {@code index_meta}。<b>这是这个特性最容易漏的一条。</b>
 *
 * <p>范围设置变了但 embedding 模型没变时，已有的两处陈旧检测
 * （{@code ragView.staleIndexWarning} 与 {@code EmbeddingProbe.compatibilityWarning}）
 * <b>都不会响</b> —— 它们比的是模型和维度。
 *
 * <p>后果：用户打开「排除测试」却没重建，索引里测试还在、检索照样返回测试，
 * 而界面<b>一个字都不说</b>。这是本仓库记了 8 次的 snapshot-vs-live，
 * 只不过这次陈旧的是「范围」而不是「模型」。
 *
 * <p><b>老库迁移</b>：{@code index_meta} 是后加的表，用
 * {@code CREATE TABLE IF NOT EXISTS} 对新老库都成立。但现在要<b>给这张表加两列</b>，
 * 老库里那张表没有这两列 —— 必须能就地补上而不丢已有数据，且重复执行不报错。
 * 这条单独测，因为开发机上的库正是老 schema。
 */
class IndexScopeMetaTest {

    @TempDir
    Path tempDir;

    private String db(String name) {
        System.setProperty("wraith.rag.dir", tempDir.resolve(name).toString());
        return tempDir.resolve("proj-" + name).toAbsolutePath().normalize().toString();
    }

    @Test
    @DisplayName("范围往返:写入 → 读回")
    void scopeRoundTrip() throws Exception {
        String project = db("rt");
        try (VectorStore s = new VectorStore(project)) {
            s.recordIndexMeta("bge-m3:latest", 1024, true, false);
            VectorStore.IndexMeta m = s.readIndexMeta();
            assertEquals("bge-m3:latest", m.embeddingModel());
            assertEquals(1024, m.embeddingDim());
            assertEquals(Boolean.TRUE, m.excludeTests());
            assertEquals(Boolean.FALSE, m.excludeDocs());
        }
    }

    @Test
    @DisplayName("没记过范围时读回 null,不是 false —— **不知道** 与 **知道是关的** 不是一回事")
    void unknownScopeIsNullNotFalse() throws Exception {
        String project = db("unknown");
        try (VectorStore s = new VectorStore(project)) {
            // 走旧签名(只记模型),范围保持未知
            s.recordIndexMeta("nomic-embed-text:latest", 768);
            VectorStore.IndexMeta m = s.readIndexMeta();
            assertEquals("nomic-embed-text:latest", m.embeddingModel());
            assertNull(m.excludeTests(), "未知必须是 null:当成 false 就会对老索引误报「范围不符」");
            assertNull(m.excludeDocs());
        }
    }

    @Test
    @DisplayName("老库(index_meta 没有这两列)能就地补列,已有数据不丢,重复打开不报错")
    void migratesOldIndexMetaTable() throws Exception {
        String project = db("migrate");
        Path dir = tempDir.resolve("migrate");
        java.nio.file.Files.createDirectories(dir);
        String url = "jdbc:sqlite:" + dir.resolve("codebase.db");
        // 手工造一个**老 schema**:index_meta 只有四列
        try (Connection c = DriverManager.getConnection(url); Statement st = c.createStatement()) {
            st.execute("""
                    CREATE TABLE index_meta (
                        project_path TEXT PRIMARY KEY,
                        embedding_model TEXT,
                        embedding_dim INTEGER,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )""");
            st.execute("INSERT INTO index_meta(project_path, embedding_model, embedding_dim) VALUES ('"
                    + project + "', 'nomic-embed-text:latest', 768)");
        }
        // 新代码打开:补列 + 老数据仍读得到 + 范围是未知
        try (VectorStore s = new VectorStore(project)) {
            VectorStore.IndexMeta m = s.readIndexMeta();
            assertEquals("nomic-embed-text:latest", m.embeddingModel(), "老数据不能丢");
            assertEquals(768, m.embeddingDim());
            assertNull(m.excludeTests());
        }
        // 再打开一次:补列是幂等的(重复 ALTER TABLE 会报 duplicate column)
        try (VectorStore s = new VectorStore(project)) {
            s.recordIndexMeta("bge-m3:latest", 1024, false, true);
            VectorStore.IndexMeta m = s.readIndexMeta();
            assertEquals(Boolean.FALSE, m.excludeTests());
            assertEquals(Boolean.TRUE, m.excludeDocs());
        }
    }

    // ---- 范围不符的判据(纯函数,与模型比较同一条纪律) ----

    @Test
    @DisplayName("范围不符要说话,并给出动作")
    void mismatchWarns() {
        String w = RagScopeFilter.scopeMismatchWarning(
                new VectorStore.IndexMeta("bge-m3", 1024, false, false), true, false);
        assertTrue(w != null && !w.isEmpty(), "当前设置排除测试而索引里含测试,该提示");
        assertTrue(w.contains("重建"), "要给出动作: " + w);
    }

    @Test
    @DisplayName("一致时一个字都不加")
    void matchingScopeIsSilent() {
        assertNull(RagScopeFilter.scopeMismatchWarning(
                new VectorStore.IndexMeta("bge-m3", 1024, true, false), true, false));
        assertNull(RagScopeFilter.scopeMismatchWarning(
                new VectorStore.IndexMeta("bge-m3", 1024, false, false), false, false));
    }

    @Test
    @DisplayName("**任一侧未知就不比较** —— 老索引没记过范围时宁可漏报")
    void unknownSideIsNotCompared() {
        assertNull(RagScopeFilter.scopeMismatchWarning(
                new VectorStore.IndexMeta("bge-m3", 1024, null, null), true, true),
                "老索引不知道范围,不许喊「快重建」");
        assertNull(RagScopeFilter.scopeMismatchWarning(null, true, true));
        // 只有一侧未知也不比
        assertNull(RagScopeFilter.scopeMismatchWarning(
                new VectorStore.IndexMeta("bge-m3", 1024, null, false), true, false));
    }

    @Test
    @DisplayName("两个开关各自不符都要点名,便于用户知道该开/关哪个")
    void namesWhichSwitchDisagrees() {
        String w1 = RagScopeFilter.scopeMismatchWarning(
                new VectorStore.IndexMeta("m", 1, false, false), true, false);
        assertTrue(w1.contains("测试"), w1);
        String w2 = RagScopeFilter.scopeMismatchWarning(
                new VectorStore.IndexMeta("m", 1, false, false), false, true);
        assertTrue(w2.contains("文档"), w2);
    }
}
