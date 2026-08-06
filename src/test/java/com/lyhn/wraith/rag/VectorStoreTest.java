package com.lyhn.wraith.rag;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class VectorStoreTest {

    private VectorStore store;

    @TempDir
    Path tempDir;

    private String originalRagDir;

    @BeforeEach
    void setUp() throws Exception {
        originalRagDir = System.getProperty("wraith.rag.dir");
        System.setProperty("wraith.rag.dir", tempDir.resolve("rag-store").toString());
        store = new VectorStore(tempDir.resolve("project").toString());
        store.clearProject();
    }

    @AfterEach
    void tearDown() throws Exception {
        try {
            if (store != null) {
                store.close();
            }
        } finally {
            if (originalRagDir == null) {
                System.clearProperty("wraith.rag.dir");
            } else {
                System.setProperty("wraith.rag.dir", originalRagDir);
            }
        }
    }

    @Test
    void testInsertAndSearch() throws Exception {
        CodeChunk chunk1 = CodeChunk.classChunk("Test.java", "TestClass",
                "public class TestClass {}", 1, 1);
        CodeChunk chunk2 = CodeChunk.methodChunk("Test.java", "TestClass.main",
                "public static void main(String[] args) {}", 2, 4);

        float[] emb1 = {1.0f, 0.0f, 0.0f};
        float[] emb2 = {0.0f, 1.0f, 0.0f};

        store.insertChunks(List.of(
                new VectorStore.CodeChunkEntry(chunk1, emb1),
                new VectorStore.CodeChunkEntry(chunk2, emb2)
        ));

        VectorStore.IndexStats stats = store.getStats();
        assertEquals(2, stats.chunkCount());

        float[] query = {1.0f, 0.0f, 0.0f};
        List<VectorStore.SearchResult> results = store.search(query, 2);
        assertEquals(2, results.size());
        assertEquals("TestClass", results.get(0).name());
        assertTrue(results.get(0).similarity() > 0.99);
    }

    @Test
    void testSearchByKeyword() throws Exception {
        CodeChunk chunk = CodeChunk.classChunk("Foo.java", "FooService",
                "public class FooService { public void bar() {} }", 1, 3);
        store.insertChunks(List.of(new VectorStore.CodeChunkEntry(chunk, new float[]{0.5f, 0.5f})));

        List<VectorStore.SearchResult> results = store.searchByKeyword("FooService");
        assertEquals(1, results.size());
        assertEquals("FooService", results.get(0).name());
    }

    @Test
    void testRelationStorage() throws Exception {
        CodeRelation rel = new CodeRelation("A.java", "A", "B.java", "B", "extends");
        store.insertRelations(List.of(rel));

        List<CodeRelation> results = store.getRelations("A");
        assertEquals(1, results.size());
        assertEquals("extends", results.get(0).relationType());
    }

    @Test
    void testClearProject() throws Exception {
        CodeChunk chunk = CodeChunk.fileChunk("readme.md", "# Hello");
        store.insertChunks(List.of(new VectorStore.CodeChunkEntry(chunk, new float[]{1.0f})));
        assertEquals(1, store.getStats().chunkCount());

        store.clearProject();
        assertEquals(0, store.getStats().chunkCount());
    }
}
