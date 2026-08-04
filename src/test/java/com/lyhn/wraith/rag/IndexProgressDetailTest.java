package com.lyhn.wraith.rag;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 索引的进度与结果都要有<b>内容</b>，不能只是数字。
 *
 * <p><b>用户实测</b>：建索引时面板上只有一行「进度：36/326 块」——「仅仅是数字变化，
 * 没有详细的内容」；建完之后也只剩「已索引 326 块 · 0 关系」，看不出索引了什么。
 *
 * <p>而那个 <b>0 关系</b>本身就是个需要解释的东西：关系图谱只从 {@code .java} 提取
 * （{@code CodeIndex} 里那句 {@code file.toString().endsWith(".java")}）。
 * 非 Java 项目必然是 0，但界面一个字都不说，读起来像是失败了。
 *
 * <p>本文件守的是<b>后端得先有这些信息</b>：进度消息里要带当前文件，结果里要带
 * 文件数 / Java 文件数 / 耗时。面板怎么排版是另一层的事。
 */
class IndexProgressDetailTest {

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

    private Path project(int javaFiles, int otherFiles) throws Exception {
        Path root = tempDir.resolve("proj-" + javaFiles + "-" + otherFiles);
        Files.createDirectories(root);
        for (int i = 0; i < javaFiles; i++) {
            Files.writeString(root.resolve("C" + i + ".java"),
                    "package p;\npublic class C" + i + " { void hi() { System.out.println(1); } }\n");
        }
        for (int i = 0; i < otherFiles; i++) {
            Files.writeString(root.resolve("s" + i + ".py"),
                    "def hello():\n    return 'hi'\n\ndef bye():\n    return 'bye'\n");
        }
        return root;
    }

    private List<String> messages() {
        return Collections.synchronizedList(new CopyOnWriteArrayList<>());
    }

    @Test
    @DisplayName("进度消息带上当前文件名与百分比 —— 只有 n/m 等于什么都没说")
    void progressCarriesFileAndPercent() throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        System.setProperty("wraith.rag.embed.concurrency", "1");   // 串行,进度可预期
        List<String> msgs = messages();
        Path root = project(3, 0);

        new CodeIndex(stub(), msgs::add).index(root.toString());

        List<String> progress = msgs.stream().filter(m -> m.contains("进度")).toList();
        assertTrue(!progress.isEmpty(), "该有进度消息: " + msgs);
        assertTrue(progress.stream().anyMatch(m -> m.contains("%")),
                "进度该带百分比: " + progress);
        assertTrue(progress.stream().anyMatch(m -> m.contains(".java")),
                "进度该带当前文件名,否则用户只看到数字在跳: " + progress);
    }

    @Test
    @DisplayName("进度里只写文件名不写全路径 —— 全路径会把那一行撑爆")
    void progressUsesFileNameNotFullPath() throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        System.setProperty("wraith.rag.embed.concurrency", "1");
        List<String> msgs = messages();
        Path root = project(2, 0);

        new CodeIndex(stub(), msgs::add).index(root.toString());

        for (String m : msgs.stream().filter(x -> x.contains("进度")).toList()) {
            assertTrue(!m.contains(root.toString()),
                    "进度里出现了全路径,会把那一行撑爆: " + m);
        }
    }

    @Test
    @DisplayName("结果带文件数、Java 文件数、耗时 —— 面板要靠它们说明「索引了什么」")
    void resultCarriesFileCounts() throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        Path root = project(2, 3);

        CodeIndex.IndexResult r = new CodeIndex(stub()).index(root.toString());

        assertEquals(5, r.fileCount(), "5 个文件(2 java + 3 py)");
        assertEquals(2, r.javaFileCount(), "其中 2 个是 Java");
        assertTrue(r.elapsedMs() >= 0, "耗时该被记下来");
        assertTrue(r.chunkCount() > 0);
    }

    @Test
    @DisplayName("非 Java 项目:关系必然是 0,而 javaFileCount=0 正是可以据此解释的依据")
    void nonJavaProjectHasZeroRelationsAndZeroJavaFiles() throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        Path root = project(0, 4);

        CodeIndex.IndexResult r = new CodeIndex(stub()).index(root.toString());

        assertEquals(0, r.javaFileCount());
        assertEquals(0, r.relationCount(),
                "关系只从 .java 提取,没有 Java 文件就该是 0(这不是故障)");
        assertTrue(r.chunkCount() > 0, "但代码块照样有 —— 分块支持多语言");
    }

    @Test
    @DisplayName("有 Java 文件时关系不为 0 —— 否则上一条的解释会变成掩盖真故障的借口")
    void javaProjectDoesProduceRelations() throws Exception {
        System.setProperty("wraith.rag.dir", tempDir.toString());
        Path root = project(2, 0);

        CodeIndex.IndexResult r = new CodeIndex(stub()).index(root.toString());

        assertEquals(2, r.javaFileCount());
        assertTrue(r.relationCount() > 0, "有 Java 文件却 0 关系,那才是真出问题了");
    }

    @Test
    @DisplayName("路径不存在这条早退路径也要给出结构完整的结果(不能让面板读到脏值)")
    void missingPathStillReturnsWellFormedResult() {
        CodeIndex.IndexResult r = new CodeIndex(stub()).index(tempDir.resolve("nope").toString());
        assertEquals(0, r.chunkCount());
        assertEquals(0, r.fileCount());
        assertEquals(0, r.javaFileCount());
        assertTrue(r.message().contains("不存在"));
    }
}
