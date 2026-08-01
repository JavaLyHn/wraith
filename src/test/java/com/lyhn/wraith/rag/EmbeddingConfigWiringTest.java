package com.lyhn.wraith.rag;

import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「代码检索」面板里配的 Embedding 后端必须对**所有**入口生效:桌面面板的索引/检索、agent 的
 * search_code 工具、REPL 的 /index /search。
 *
 * <p>此前只有 app-server 一条路读配置(Main.ragEmbeddingClient),{@code CodeRetriever(String)} 与
 * {@code CodeIndex()} 用的是 env-only 的 {@code new EmbeddingClient()} —— 一律回落
 * ollama http://localhost:11434。后果:用户在面板里配好云端 embedding、索引也建成了,agent 一调
 * search_code 就去连本机 11434 报 Connection refused,而面板里检索一切正常。配置在层间掉了。
 *
 * <p>测法:把配置指向一个**必然连不上**的地址(127.0.0.1:1,端口 1 不会有服务),再看错误信息里
 * 出现的是谁 —— 出现 11434 就说明它压根没读配置。这比断言「用了配置对象」更硬:后者可以靠一个
 * getter 装样子,前者是真的发了请求。
 */
class EmbeddingConfigWiringTest {

    /** 端口 1 是保留端口,任何机器上都不会有服务在听 —— 连接必然失败且立刻失败。 */
    private static final String DEAD_URL = "http://127.0.0.1:1/v1";
    private static final String OLLAMA_PORT = "11434";

    @TempDir Path tmp;

    private String prevConfigDir;
    private String prevRagDir;

    @BeforeEach
    void redirectHome() throws Exception {
        prevConfigDir = System.getProperty("wraith.config.dir");
        prevRagDir = System.getProperty("wraith.rag.dir");
        // 绝不碰开发机真实的 ~/.wraith:配置与向量库全部重定向到临时目录
        System.setProperty("wraith.config.dir", tmp.resolve("cfg").toString());
        System.setProperty("wraith.rag.dir", tmp.resolve("rag").toString());
        Files.createDirectories(tmp.resolve("cfg"));
    }

    @AfterEach
    void restore() {
        restoreProp("wraith.config.dir", prevConfigDir);
        restoreProp("wraith.rag.dir", prevRagDir);
    }

    private static void restoreProp(String key, String previous) {
        if (previous == null) System.clearProperty(key);
        else System.setProperty(key, previous);
    }

    /** 写一份只配了 embedding 的 config.json 到重定向后的目录。 */
    private void writeEmbeddingConfig(String provider, String model, String baseUrl) throws Exception {
        Files.writeString(tmp.resolve("cfg").resolve("config.json"), """
                {
                  "embedding": {
                    "provider": "%s",
                    "model": "%s",
                    "baseUrl": "%s",
                    "apiKey": "test-only-not-a-real-key"
                  }
                }
                """.formatted(provider, model, baseUrl));
    }

    /** 造一条带向量的 chunk,好让 search_code 越过「尚未索引」直接走到 embed 查询那一步。 */
    private void seedOneChunk(Path project) throws Exception {
        try (VectorStore store = new VectorStore(project.toAbsolutePath().normalize().toString())) {
            store.insertChunks(List.of(new VectorStore.CodeChunkEntry(
                    CodeChunk.methodChunk("Login.java", "doLogin", "void doLogin(){}", 1, 3),
                    new float[]{0.1f, 0.2f, 0.3f})));
        }
    }

    // ── 纯函数层:配置 → 客户端 ────────────────────────────────────────────

    @Test
    void fromConfigTakesProviderModelAndBaseUrl() {
        WraithConfig.EmbeddingConfig e = new WraithConfig.EmbeddingConfig();
        e.setProvider("openai");
        e.setModel("BAAI/bge-m3");
        e.setBaseUrl("https://api.siliconflow.cn/v1");
        EmbeddingClient c = EmbeddingClient.fromConfig(e);
        assertEquals("openai", c.getProvider());
        assertEquals("BAAI/bge-m3", c.getModel());
    }

    @Test
    void fromConfigFallsBackToEnvWhenSectionIsEmpty() {
        // 桌面端没保存过配置时,config.json 里是个空的 "embedding": {} —— 那不该盖掉 EMBEDDING_* 环境变量
        String prev = System.getProperty("EMBEDDING_MODEL");
        System.setProperty("EMBEDDING_MODEL", "sentinel-from-env");
        try {
            assertEquals("sentinel-from-env", EmbeddingClient.fromConfig(new WraithConfig.EmbeddingConfig()).getModel(),
                    "空配置节应回落 env,而不是硬写成 provider 默认模型");
            assertEquals("sentinel-from-env", EmbeddingClient.fromConfig(null).getModel(),
                    "配置节缺失同样回落 env");
        } finally {
            restoreProp("EMBEDDING_MODEL", prev);
        }
    }

    @Test
    void fromConfigOrEnvReadsTheRedirectedConfigFile() throws Exception {
        writeEmbeddingConfig("openai", "BAAI/bge-m3", "https://api.siliconflow.cn/v1");
        EmbeddingClient c = EmbeddingClient.fromConfigOrEnv();
        assertEquals("openai", c.getProvider(), "没读到 config.json —— 路径解析被 static final 定死了?");
        assertEquals("BAAI/bge-m3", c.getModel());
    }

    // ── 行为层:两个默认入口真的按配置发请求 ──────────────────────────────

    @Test
    void searchCodeToolUsesConfiguredBackendNotLocalOllama() throws Exception {
        writeEmbeddingConfig("openai", "BAAI/bge-m3", DEAD_URL);
        Path project = tmp.resolve("project");
        Files.createDirectories(project);
        seedOneChunk(project);

        ToolRegistry reg = new ToolRegistry();
        reg.setProjectPath(project.toAbsolutePath().normalize().toString());
        String out = reg.executeTool("search_code", "{\"query\":\"用户登录的实现\"}");

        assertFalse(out.startsWith("未知工具"), "search_code 未注册:" + out);
        assertFalse(out.contains("尚未索引"), "种入的 chunk 没被看到,测试压根没走到 embed:" + out);
        assertFalse(out.contains(OLLAMA_PORT),
                "agent 的 search_code 仍在连本机 ollama,配置没传到工具层:" + out);
        assertTrue(out.contains("127.0.0.1:1"),
                "错误里应看到配置的那个地址,证明请求确实发给了配置的后端:" + out);
    }

    @Test
    void codeIndexDefaultCtorUsesConfiguredBackendNotLocalOllama() throws Exception {
        writeEmbeddingConfig("openai", "BAAI/bge-m3", DEAD_URL);
        Path project = tmp.resolve("project2");
        Files.createDirectories(project);
        Files.writeString(project.resolve("Login.java"), "class Login { void doLogin() {} }");

        List<String> progress = new ArrayList<>();
        // 无 client 的构造器 = REPL /index 走的那条路
        CodeIndex.IndexResult res = new CodeIndex(progress::add).index(project.toString());

        String log = String.join("\n", progress);
        assertFalse(log.contains(OLLAMA_PORT), "REPL /index 仍在连本机 ollama,配置没生效:" + log);
        assertTrue(log.contains("127.0.0.1:1"), "索引失败信息里应指向配置的后端:" + log);
        assertEquals(0, res.chunkCount(), "后端不可达时不该产出 chunk");
    }
}
