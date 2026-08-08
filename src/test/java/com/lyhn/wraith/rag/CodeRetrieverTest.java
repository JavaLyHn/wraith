package com.lyhn.wraith.rag;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class CodeRetrieverTest {

    @TempDir
    Path tempDir;

    private VectorStore store;
    private String testProject;
    private String originalRagDir;

    @BeforeEach
    void setUp() throws Exception {
        originalRagDir = System.getProperty("wraith.rag.dir");
        System.setProperty("wraith.rag.dir", tempDir.resolve("rag-store").toString());
        testProject = tempDir.resolve("project").toString();
        store = new VectorStore(testProject);
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
    void hybridSearchBoostsCodeKeywordsFromNaturalLanguageQuery() throws Exception {
        CodeChunk getterChunk = CodeChunk.methodChunk(
                "src/main/java/com/example/Task.java",
                "Task.getId()",
                "public String getId() { return id; }",
                10, 12
        );
        CodeChunk agentChunk = CodeChunk.methodChunk(
                "src/main/java/com/example/Agent.java",
                "Agent.run(String userInput)",
                "ReAct 循环：读取用户输入，思考，必要时调用工具，再继续下一轮。",
                20, 40
        );

        store.insertChunks(List.of(
                new VectorStore.CodeChunkEntry(getterChunk, new float[]{1.0f, 0.0f}),
                new VectorStore.CodeChunkEntry(agentChunk, new float[]{0.80f, 0.20f})
        ));

        EmbeddingClient stubClient = new EmbeddingClient("ollama", "stub", "http://localhost", "") {
            @Override
            public float[] embed(String text) {
                return new float[]{1.0f, 0.0f};
            }
        };

        try (CodeRetriever retriever = new CodeRetriever(testProject, stubClient)) {
            List<VectorStore.SearchResult> results = retriever.hybridSearch("Agent的ReAct循环是怎么实现的", 5);

            assertFalse(results.isEmpty());
            assertEquals("Agent.run(String userInput)", results.get(0).name());
        }
    }
}
