package com.lyhn.wraith.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * {@code config.json} 的 {@code rag} 节：索引范围设置。
 *
 * <p><b>为什么不塞进 {@code EmbeddingConfig}</b>：那一节是<b>后端连接参数</b>
 * （provider / model / baseUrl / apiKey）。索引范围不是后端的属性 —— 同一个后端
 * 可以建不同范围的索引。混在一起以后会出现「改索引范围要动 embedding 配置」这种别扭事。
 */
class WraithConfigRagTest {

    private static final ObjectMapper M = new ObjectMapper();

    @Test
    @DisplayName("默认(整节缺失)时两个开关都是 false —— 行为与引入前一致")
    void missingSectionMeansNoFiltering() throws Exception {
        WraithConfig cfg = M.readValue("{}", WraithConfig.class);
        // getRag 可以回 null(表示没配过);调用方按 false 处理
        WraithConfig.RagConfig rag = cfg.getRag();
        boolean excludeTests = rag != null && rag.isExcludeTests();
        boolean excludeDocs = rag != null && rag.isExcludeDocs();
        assertFalse(excludeTests);
        assertFalse(excludeDocs);
    }

    @Test
    @DisplayName("读得出 JSON 里的两个开关")
    void readsBothSwitches() throws Exception {
        WraithConfig cfg = M.readValue(
                "{\"rag\":{\"excludeTests\":true,\"excludeDocs\":false}}", WraithConfig.class);
        assertNotNull(cfg.getRag());
        assertEquals(true, cfg.getRag().isExcludeTests());
        assertEquals(false, cfg.getRag().isExcludeDocs());
    }

    @Test
    @DisplayName("未知字段不炸 —— 老 jar 写的 config 与新 jar 写的要能互读")
    void unknownFieldsAreIgnored() throws Exception {
        WraithConfig cfg = M.readValue(
                "{\"rag\":{\"excludeTests\":true,\"futureKnob\":\"x\"}}", WraithConfig.class);
        assertEquals(true, cfg.getRag().isExcludeTests());
    }

    @Test
    @DisplayName("序列化回去仍是 rag 节,字段名不变(桌面表单靠它)")
    void serializesBack() throws Exception {
        WraithConfig cfg = new WraithConfig();
        WraithConfig.RagConfig rag = new WraithConfig.RagConfig();
        rag.setExcludeTests(true);
        cfg.setRag(rag);
        String json = M.writeValueAsString(cfg);
        assertEquals(true, M.readValue(json, WraithConfig.class).getRag().isExcludeTests());
    }

    @Test
    @DisplayName("rag 节与 embedding 节互不影响 —— 改范围不该动后端配置")
    void ragAndEmbeddingAreIndependent() throws Exception {
        WraithConfig cfg = M.readValue(
                "{\"embedding\":{\"provider\":\"ollama\",\"model\":\"bge-m3:latest\"},"
                        + "\"rag\":{\"excludeTests\":true}}", WraithConfig.class);
        assertEquals("bge-m3:latest", cfg.getEmbedding().getModel());
        assertEquals(true, cfg.getRag().isExcludeTests());
        // 反向:只有 embedding 时 rag 仍是 null(没配过),不是被填了默认对象
        WraithConfig only = M.readValue("{\"embedding\":{\"provider\":\"ollama\"}}", WraithConfig.class);
        assertNull(only.getRag());
    }
}
