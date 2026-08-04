package com.lyhn.wraith.rag;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.nio.file.Path;
import java.sql.*;
import java.util.ArrayList;
import java.util.List;

/**
 * SQLite 向量存储 + 代码关系图谱持久化
 * <p>
 * 向量以 JSON 数组形式存储在 SQLite 中，检索时在内存计算余弦相似度。
 * 对于代码库规模（通常几百到几千个块），此方案足够；规模再大可换 FAISS / pgvector 等。
 */
public class VectorStore implements AutoCloseable {
    private static final ObjectMapper mapper = new ObjectMapper();
    private final Connection connection;
    private final String projectPath;

    public VectorStore(String projectPath) throws SQLException {
        this.projectPath = projectPath;
        String dbDir = System.getProperty("wraith.rag.dir",
                System.getProperty("user.home") + "/.wraith/rag");
        java.io.File dir = new java.io.File(dbDir);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        String dbPath = dir.getAbsolutePath() + "/codebase.db";
        this.connection = DriverManager.getConnection("jdbc:sqlite:" + dbPath);
        initTables();
    }

    private void initTables() throws SQLException {
        // 代码块表：存储分块内容和向量
        String createChunks = """
                CREATE TABLE IF NOT EXISTS code_chunks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_path TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    chunk_type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    embedding_json TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """;

        // 代码关系表：存储类/方法间的依赖关系
        String createRelations = """
                CREATE TABLE IF NOT EXISTS code_relations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_path TEXT NOT NULL,
                    from_file TEXT NOT NULL,
                    from_name TEXT NOT NULL,
                    to_file TEXT,
                    to_name TEXT,
                    relation_type TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """;

        // 索引元数据：记住这份索引是用哪个 embedding 模型建的。
        // 换模型不重建索引会让检索全军覆没(相关度全 0),而面板要能在「保存配置」那一刻就提示重建,
        // 就必须能诚实回答「索引是用哪个模型建的」—— 此前这个信息压根没被记录过。
        // 用独立小表而不是给 code_chunks 加列:CREATE TABLE IF NOT EXISTS 对新库老库都成立,
        // 不需要 ALTER TABLE 与迁移判断;老库读出来是 null,由上层显示「未知」而不是编一个模型名。
        String createMeta = """
                CREATE TABLE IF NOT EXISTS index_meta (
                    project_path TEXT PRIMARY KEY,
                    embedding_model TEXT,
                    embedding_dim INTEGER,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """;

        // 索引加速查询
        String createIdxProject = "CREATE INDEX IF NOT EXISTS idx_project ON code_chunks(project_path)";
        String createIdxFile = "CREATE INDEX IF NOT EXISTS idx_file ON code_chunks(file_path)";
        String createIdxType = "CREATE INDEX IF NOT EXISTS idx_type ON code_chunks(chunk_type)";
        String createIdxRelProject = "CREATE INDEX IF NOT EXISTS idx_rel_project ON code_relations(project_path)";
        String createIdxRelFrom = "CREATE INDEX IF NOT EXISTS idx_rel_from ON code_relations(from_name)";
        String createIdxRelTo = "CREATE INDEX IF NOT EXISTS idx_rel_to ON code_relations(to_name)";

        try (Statement stmt = connection.createStatement()) {
            stmt.execute(createChunks);
            stmt.execute(createRelations);
            stmt.execute(createMeta);
            stmt.execute(createIdxProject);
            stmt.execute(createIdxFile);
            stmt.execute(createIdxType);
            stmt.execute(createIdxRelProject);
            stmt.execute(createIdxRelFrom);
            stmt.execute(createIdxRelTo);
        }
    }

    /**
     * 清空指定项目的索引数据
     */
    public void clearProject() throws SQLException {
        String deleteChunks = "DELETE FROM code_chunks WHERE project_path = ?";
        String deleteRelations = "DELETE FROM code_relations WHERE project_path = ?";
        // 元数据一起清:留着会指向一个已经不存在的索引
        String deleteMeta = "DELETE FROM index_meta WHERE project_path = ?";
        try (PreparedStatement ps1 = connection.prepareStatement(deleteChunks);
             PreparedStatement ps2 = connection.prepareStatement(deleteRelations);
             PreparedStatement ps3 = connection.prepareStatement(deleteMeta)) {
            ps1.setString(1, projectPath);
            ps2.setString(1, projectPath);
            ps3.setString(1, projectPath);
            ps1.executeUpdate();
            ps2.executeUpdate();
            ps3.executeUpdate();
        }
    }

    /**
     * 批量插入代码块（事务保护）
     */
    public void insertChunks(List<CodeChunkEntry> entries) throws SQLException {
        String sql = """
                INSERT INTO code_chunks (project_path, file_path, chunk_type, name, content, embedding_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """;
        boolean autoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            for (CodeChunkEntry entry : entries) {
                ps.setString(1, projectPath);
                ps.setString(2, entry.chunk.filePath());
                ps.setString(3, entry.chunk.chunkType());
                ps.setString(4, entry.chunk.name());
                ps.setString(5, entry.chunk.content());
                ps.setString(6, embeddingToJson(entry.embedding));
                ps.addBatch();
            }
            ps.executeBatch();
            connection.commit();
        } catch (SQLException e) {
            connection.rollback();
            throw e;
        } finally {
            connection.setAutoCommit(autoCommit);
        }
    }

    /**
     * 批量插入代码关系（事务保护）
     */
    public void insertRelations(List<CodeRelation> relations) throws SQLException {
        String sql = """
                INSERT INTO code_relations (project_path, from_file, from_name, to_file, to_name, relation_type)
                VALUES (?, ?, ?, ?, ?, ?)
                """;
        boolean autoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            for (CodeRelation rel : relations) {
                ps.setString(1, projectPath);
                ps.setString(2, rel.fromFile());
                ps.setString(3, rel.fromName());
                ps.setString(4, rel.toFile());
                ps.setString(5, rel.toName());
                ps.setString(6, rel.relationType());
                ps.addBatch();
            }
            ps.executeBatch();
            connection.commit();
        } catch (SQLException e) {
            connection.rollback();
            throw e;
        } finally {
            connection.setAutoCommit(autoCommit);
        }
    }

    /**
     * 语义检索：根据查询向量返回最相似的 TopK 代码块。
     *
     * <p><b>维度不一致时抛异常，而不是返回一堆 0 分结果。</b> 换了 embedding 模型却没重建索引
     * 时会撞上这件事：{@code cosineSimilarity} 对不等长向量返回 0（它是个数学原语，这没问题），
     * 于是 search 会安静地返回若干条相关度全为 {@code 0.0000} 的结果 —— 那<b>看起来像</b>
     * 「这个库里没有相关代码」，是一句假话，用户无从知道真正原因是维度变了。
     *
     * <p>实测（真 ollama）：用 {@code nomic-embed-text}（768 维）建好索引后拿 1024 维查询向量
     * （{@code bge-m3} 那一档）去搜，返回 3 条结果、分数全 0、不抛任何异常。
     * 而换模型这件事<b>一定会发生</b>：默认的 {@code nomic-embed-text} 是纯英文模型，
     * 中文查询排序是错的（实测「打印发票」把 AuthService 排在 InvoicePrinter 前面）。
     */
    public List<SearchResult> search(float[] queryEmbedding, int topK) throws SQLException {
        // 空查询向量(embed 对空文本就返回 float[0])直接给空结果。此前它会走下去,
        // 与库里每条都"长度不等"→ 相似度 0 → 返回一堆 0 分结果 —— 与维度不一致同一种假话。
        if (queryEmbedding == null || queryEmbedding.length == 0) {
            return new ArrayList<>();
        }
        String sql = "SELECT file_path, chunk_type, name, content, embedding_json FROM code_chunks WHERE project_path = ?";
        List<SearchResult> candidates = new ArrayList<>();

        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, projectPath);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String embeddingJson = rs.getString("embedding_json");
                    if (embeddingJson == null || embeddingJson.isEmpty()) {
                        continue;
                    }
                    float[] embedding = jsonToEmbedding(embeddingJson);
                    // 库里这条为空(embedding 落盘失败)不算不一致;空库也不算 —— 那是「还没建索引」
                    if (queryEmbedding.length > 0 && embedding.length > 0
                            && queryEmbedding.length != embedding.length) {
                        throw new SQLException(
                                "索引与当前 embedding 模型的向量维度不一致：索引里是 " + embedding.length
                                + " 维，当前模型给出 " + queryEmbedding.length + " 维。"
                                + "这通常是换过 embedding 模型（provider / model）导致的 —— "
                                + "请在「代码检索」面板点『重建索引』后再检索。");
                    }
                    double similarity = cosineSimilarity(queryEmbedding, embedding);
                    candidates.add(new SearchResult(
                            rs.getString("file_path"),
                            rs.getString("chunk_type"),
                            rs.getString("name"),
                            rs.getString("content"),
                            similarity
                    ));
                }
            }
        }

        // 按相似度降序排序，取 TopK
        candidates.sort((a, b) -> Double.compare(b.similarity(), a.similarity()));
        return candidates.size() > topK ? new ArrayList<>(candidates.subList(0, topK)) : candidates;
    }

    /**
     * 根据关键词检索代码块（不经过 Embedding，用于精确匹配类名/方法名）
     */
    public List<SearchResult> searchByKeyword(String keyword) throws SQLException {
        String sql = """
                SELECT file_path, chunk_type, name, content FROM code_chunks
                WHERE project_path = ? AND (name LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
                """;
        List<SearchResult> results = new ArrayList<>();
        String escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        String pattern = "%" + escaped + "%";

        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, projectPath);
            ps.setString(2, pattern);
            ps.setString(3, pattern);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    results.add(new SearchResult(
                            rs.getString("file_path"),
                            rs.getString("chunk_type"),
                            rs.getString("name"),
                            rs.getString("content"),
                            0.3
                    ));
                }
            }
        }
        return results;
    }

    /**
     * 图谱检索：查询与指定名称相关的所有关系
     */
    public List<CodeRelation> getRelations(String name) throws SQLException {
        String sql = """
                SELECT from_file, from_name, to_file, to_name, relation_type FROM code_relations
                WHERE project_path = ? AND (from_name = ? OR to_name = ?)
                """;
        List<CodeRelation> results = new ArrayList<>();

        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, projectPath);
            ps.setString(2, name);
            ps.setString(3, name);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    results.add(new CodeRelation(
                            rs.getString("from_file"),
                            rs.getString("from_name"),
                            rs.getString("to_file"),
                            rs.getString("to_name"),
                            rs.getString("relation_type")
                    ));
                }
            }
        }
        return results;
    }

    /**
     * 获取指定类/方法的所有 outgoing 关系
     */
    public List<CodeRelation> getOutgoingRelations(String name) throws SQLException {
        String sql = """
                SELECT from_file, from_name, to_file, to_name, relation_type FROM code_relations
                WHERE project_path = ? AND from_name = ?
                """;
        List<CodeRelation> results = new ArrayList<>();
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, projectPath);
            ps.setString(2, name);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    results.add(new CodeRelation(
                            rs.getString("from_file"),
                            rs.getString("from_name"),
                            rs.getString("to_file"),
                            rs.getString("to_name"),
                            rs.getString("relation_type")
                    ));
                }
            }
        }
        return results;
    }

    /**
     * 统计当前项目的索引数据量
     */
    public IndexStats getStats() throws SQLException {
        String chunkSql = "SELECT COUNT(*) FROM code_chunks WHERE project_path = ?";
        String relSql = "SELECT COUNT(*) FROM code_relations WHERE project_path = ?";
        int chunks = 0;
        int relations = 0;

        try (PreparedStatement ps = connection.prepareStatement(chunkSql)) {
            ps.setString(1, projectPath);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) chunks = rs.getInt(1);
            }
        }
        try (PreparedStatement ps = connection.prepareStatement(relSql)) {
            ps.setString(1, projectPath);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) relations = rs.getInt(1);
            }
        }
        IndexMeta meta = readIndexMeta();
        return new IndexStats(chunks, relations, meta.embeddingModel(), meta.embeddingDim());
    }

    private double cosineSimilarity(float[] a, float[] b) {
        if (a.length != b.length) {
            return 0.0;
        }
        double dot = 0.0;
        double normA = 0.0;
        double normB = 0.0;
        for (int i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA == 0.0 || normB == 0.0) {
            return 0.0;
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private String embeddingToJson(float[] embedding) {
        try {
            return mapper.writeValueAsString(embedding);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("向量序列化失败", e);
        }
    }

    private float[] jsonToEmbedding(String json) {
        try {
            return mapper.readValue(json, float[].class);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("向量反序列化失败", e);
        }
    }

    @Override
    public void close() throws SQLException {
        if (connection != null && !connection.isClosed()) {
            connection.close();
        }
    }

    /**
     * 带向量的代码块条目
     */
    public record CodeChunkEntry(CodeChunk chunk, float[] embedding) {}

    /**
     * 检索结果
     */
    public record SearchResult(String filePath, String chunkType,
                                String name, String content, double similarity) {}

    /**
     * 索引统计。
     *
     * <p>{@code embeddingModel} 为 {@code null} 表示这份索引建立时没有记录模型（老索引）——
     * <b>不知道就说不知道</b>，上层据此显示「未知」，不许回落成某个默认模型名。
     */
    public record IndexStats(int chunkCount, int relationCount,
                             String embeddingModel, int embeddingDim) {
        /** 兼容旧构造：不带模型信息。 */
        public IndexStats(int chunkCount, int relationCount) {
            this(chunkCount, relationCount, null, 0);
        }
    }

    /** 索引元数据。字段含义同 {@link IndexStats}。 */
    public record IndexMeta(String embeddingModel, int embeddingDim) {}

    /**
     * 记下这份索引是用哪个模型、多少维建的。空模型名不写 —— 存个空串等于假装记录过。
     */
    public void recordIndexMeta(String embeddingModel, int embeddingDim) throws SQLException {
        if (embeddingModel == null || embeddingModel.isBlank()) {
            return;
        }
        String sql = """
                INSERT INTO index_meta (project_path, embedding_model, embedding_dim, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(project_path) DO UPDATE SET
                    embedding_model = excluded.embedding_model,
                    embedding_dim = excluded.embedding_dim,
                    updated_at = CURRENT_TIMESTAMP
                """;
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, projectPath);
            ps.setString(2, embeddingModel.trim());
            ps.setInt(3, embeddingDim);
            ps.executeUpdate();
        }
    }

    /** 读回元数据；没记过时两个字段分别是 {@code null} 与 {@code 0}。 */
    public IndexMeta readIndexMeta() throws SQLException {
        String sql = "SELECT embedding_model, embedding_dim FROM index_meta WHERE project_path = ?";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, projectPath);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    String model = rs.getString("embedding_model");
                    return new IndexMeta(model == null || model.isBlank() ? null : model,
                            rs.getInt("embedding_dim"));
                }
            }
        }
        return new IndexMeta(null, 0);
    }
}
