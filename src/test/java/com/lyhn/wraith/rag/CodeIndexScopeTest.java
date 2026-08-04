package com.lyhn.wraith.rag;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 索引范围开关接到 {@code CodeIndex} 上。
 *
 * <p><b>过滤点在 {@code collectFiles} 的 {@code visitFile}</b>，理由两条：
 * <ul>
 *   <li><b>越早排除越省</b>。唯一的真成本是逐块 embedding 的网络往返
 *       （本机 bge-m3 实测 9718 块 18 分 13 秒）。在收集阶段排掉，分块、关系分析、
 *       embedding 三样全省。</li>
 *   <li><b>关系与块自动一致</b>。同一份 {@code filesToIndex} 既喂 chunker 也喂 analyzer，
 *       不会出现「块排掉了但关系还在」的错配 —— 本文件有一条测试专门钉这个，
 *       因为「自动一致」如果只是注释，重构时就会失效。</li>
 * </ul>
 */
class CodeIndexScopeTest {

    @TempDir
    Path tempDir;

    /** 不发网络的桩:维度固定 4。 */
    private static EmbeddingClient stub() {
        return new EmbeddingClient("ollama", "stub:1", "http://127.0.0.1:1", "") {
            @Override public float[] embed(String text) {
                return new float[]{1f, 2f, 3f, 4f};
            }
        };
    }

    /**
     * 造一个混合项目:主代码 / 测试 / 文档 / skills-md 各若干。
     * skills-md 刻意放进来 —— 它是运行时载荷,「排除文档」不许动它。
     */
    private Path project() throws Exception {
        Path root = tempDir.resolve("proj");
        Files.createDirectories(root.resolve("src/main/java/com/lyhn"));
        Files.createDirectories(root.resolve("src/test/java/com/lyhn"));
        Files.createDirectories(root.resolve("docs"));
        Files.createDirectories(root.resolve("src/main/resources/skills/web-access"));
        Files.createDirectories(root.resolve("desktop/test"));

        Files.writeString(root.resolve("src/main/java/com/lyhn/Alpha.java"),
                "package com.lyhn;\npublic class Alpha { void run() { new Beta().go(); } }\n");
        Files.writeString(root.resolve("src/main/java/com/lyhn/Beta.java"),
                "package com.lyhn;\npublic class Beta { void go() { System.out.println(1); } }\n");
        // 测试文件里**调用主代码** —— 关系一致性那条测试要靠它
        Files.writeString(root.resolve("src/test/java/com/lyhn/AlphaTest.java"),
                "package com.lyhn;\npublic class AlphaTest { void t() { new Alpha().run(); } }\n");
        Files.writeString(root.resolve("desktop/test/panel.test.ts"),
                "export function t(): void { console.log('x') }\n");
        Files.writeString(root.resolve("docs/design.md"), "# 设计\n\n为什么这么做。\n");
        Files.writeString(root.resolve("README.md"), "# 项目\n\n说明。\n");
        Files.writeString(root.resolve("src/main/resources/skills/web-access/SKILL.md"),
                "# web-access\n\n工具选择表。\n");
        return root;
    }

    private CodeIndex.IndexResult run(Path root, boolean excludeTests, boolean excludeDocs) {
        System.setProperty("wraith.rag.dir", tempDir.resolve("db-" + excludeTests + "-" + excludeDocs).toString());
        return new CodeIndex(stub(), excludeTests, excludeDocs).index(root.toString());
    }

    @Test
    @DisplayName("默认(两个开关都关):7 个文件全进 —— 行为与开关引入前完全一致")
    void defaultIndexesEverything() throws Exception {
        CodeIndex.IndexResult r = run(project(), false, false);
        assertEquals(7, r.fileCount(), "7 个文件都该进: " + r.message());
        assertEquals(0, r.excludedTests());
        assertEquals(0, r.excludedDocs());
    }

    @Test
    @DisplayName("排除测试:3 个测试文件不进,主代码/文档/skills 全留")
    void excludeTestsDropsOnlyTests() throws Exception {
        CodeIndex.IndexResult r = run(project(), true, false);
        assertEquals(5, r.fileCount(),
                "剩 Alpha/Beta/design.md/README.md/SKILL.md 五个: " + r.message());
        assertEquals(2, r.excludedTests(), "AlphaTest.java + desktop/test/panel.test.ts");
        assertEquals(0, r.excludedDocs());
    }

    @Test
    @DisplayName("排除文档:.md 不进,但 **skills 下的 md 必须留** —— 那是运行时载荷")
    void excludeDocsKeepsSkillMarkdown() throws Exception {
        CodeIndex.IndexResult r = run(project(), false, true);
        assertEquals(2, r.excludedDocs(), "design.md + README.md,不含 SKILL.md");
        assertEquals(0, r.excludedTests());
        assertEquals(5, r.fileCount(), "SKILL.md 还在: " + r.message());
    }

    @Test
    @DisplayName("排除的文件数要回给面板 —— 不报的话用户看到块数暴跌会以为索引出错了")
    void excludedCountsAreReported() throws Exception {
        CodeIndex.IndexResult r = run(project(), true, true);
        assertEquals(2, r.excludedTests());
        assertEquals(2, r.excludedDocs());
        assertEquals(3, r.fileCount(),
                "只剩 Alpha.java / Beta.java / SKILL.md —— SKILL.md 是运行时载荷不算文档: "
                        + r.message());
    }

    @Test
    @DisplayName("**关系与块自动一致**:排除测试后,不许有任何一端落在测试文件上的关系")
    void relationsNeverReferenceExcludedFiles() throws Exception {
        Path root = project();
        // 先确认不开开关时,测试文件**确实**产生了关系(否则这条测试没有判别力)
        CodeIndex.IndexResult all = run(root, false, false);
        assertTrue(all.relationCount() > 0, "基线该有关系: " + all.message());

        System.setProperty("wraith.rag.dir", tempDir.resolve("db-rel").toString());
        CodeIndex.IndexResult r = new CodeIndex(stub(), true, false).index(root.toString());
        assertTrue(r.relationCount() >= 0);
        try (VectorStore store = new VectorStore(root.toAbsolutePath().normalize().toString())) {
            for (CodeRelation rel : store.getRelations("Alpha")) {
                assertFalse(String.valueOf(rel.fromFile()).contains("AlphaTest"),
                        "排除测试后仍有来自测试文件的关系: " + rel.fromFile());
                assertFalse(String.valueOf(rel.toFile()).contains("AlphaTest"),
                        "排除测试后仍有指向测试文件的关系: " + rel.toFile());
            }
        }
    }

    @Test
    @DisplayName("全部文件都被排除时给一句人话,不是崩或者静默 0 块")
    void everythingExcludedIsExplained() throws Exception {
        Path root = tempDir.resolve("onlytests");
        Files.createDirectories(root.resolve("src/test/java"));
        Files.writeString(root.resolve("src/test/java/OnlyTest.java"),
                "public class OnlyTest { void t() {} }\n");
        System.setProperty("wraith.rag.dir", tempDir.resolve("db-empty").toString());
        CodeIndex.IndexResult r = new CodeIndex(stub(), true, false).index(root.toString());
        assertEquals(0, r.chunkCount());
        assertEquals(1, r.excludedTests());
        assertTrue(r.message().contains("排除") || r.message().contains("范围"),
                "该说清是被范围设置排掉的,而不是「没有代码文件」: " + r.message());
    }

    @Test
    @DisplayName("**索引时必须把范围写进 index_meta** —— 变异测试抓到的覆盖缺口")
    void indexRecordsScopeIntoMeta() throws Exception {
        // 这条是补的:原先所有 index_meta 测试都直接调 VectorStore.recordIndexMeta,
        // 于是把 CodeIndex 里那句改成 (null, null) 时**一条都不红** —— 而那正是
        // 设计里标成「最容易漏」的一环(范围变了但模型没变时,已有的陈旧检测都不会响)。
        Path root = project();
        System.setProperty("wraith.rag.dir", tempDir.resolve("db-meta").toString());
        new CodeIndex(stub(), true, false).index(root.toString());
        try (VectorStore store = new VectorStore(root.toAbsolutePath().normalize().toString())) {
            VectorStore.IndexMeta m = store.readIndexMeta();
            assertEquals(Boolean.TRUE, m.excludeTests(), "索引时的范围没被记下来");
            assertEquals(Boolean.FALSE, m.excludeDocs());
            // 而且据此能算出「范围不符」:当前设置与索引记录不一致时要提示
            assertTrue(RagScopeFilter.scopeMismatchWarning(m, false, false) != null,
                    "索引排除了测试而当前设置不排除,该提示重建");
            assertEquals(null, RagScopeFilter.scopeMismatchWarning(m, true, false),
                    "一致时不该提示");
        }
    }

    @Test
    @DisplayName("旧构造器仍可用且等价于两个开关都关 —— 已有调用点不该被迫改")
    void legacyConstructorStillMeansNoFiltering() throws Exception {
        Path root = project();
        System.setProperty("wraith.rag.dir", tempDir.resolve("db-legacy").toString());
        CodeIndex.IndexResult r = new CodeIndex(stub()).index(root.toString());
        assertEquals(7, r.fileCount());
        assertEquals(0, r.excludedTests());
        assertEquals(0, r.excludedDocs());
    }
}
