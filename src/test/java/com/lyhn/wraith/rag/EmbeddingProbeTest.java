package com.lyhn.wraith.rag;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.ConnectException;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 「测试连接」按钮的后端。
 *
 * <p><b>为什么值得单独做一个</b>：此前验证 embedding 后端唯一的办法是<b>点「建立索引」</b>
 * —— 那是一次上千个代码块的整库扫描。配错一个字符（端口 / 模型名 / key），
 * 用户要么等它跑完，要么盯着一句 OkHttp 原文猜。
 *
 * <p><b>它必须回什么，各有各的理由</b>：
 * <ul>
 *   <li><b>维度</b>（{@code dim}）—— 本仓库最阴的一类故障就在这：768 维索引 + 1024 维查询，
 *       {@code cosineSimilarity} 曾经安静地返回 0.0（现由 {@link VectorStore} 抛错兜住）。
 *       把维度摊在按钮下面，是让人在建索引<b>之前</b>就看见冲突。</li>
 *   <li><b>耗时</b>（{@code latencyMs}）—— 单块耗时 × 上千块就是整库索引的量级。
 *       本机实测：nomic-embed-text 冷启动 0.6s、热 0.06s；bge-m3 冷 2.2s、热 0.16s。
 *       一次探测就能让人知道这库要索引 1 分钟还是 1 小时。</li>
 *   <li><b>provider / model / baseUrl 回显</b>—— 表单留空时后端会填默认
 *       （{@link EmbeddingClient#of}），回显的是<b>实际生效</b>的那套，不是表单里那套。</li>
 * </ul>
 *
 * <p><b>纪律照旧</b>：失败时原文一律保留，诊断（{@link EmbeddingErrorHint}）另放一个字段
 * —— 「连不上」「401 key 错」「429 限流」是三件不同的事，只给友好话会把人引到错的地方去查。
 */
class EmbeddingProbeTest {

    private static final String OLLAMA = "http://localhost:11434";

    /** 固定维度的桩，不发网络。 */
    private static EmbeddingClient stub(int dim) {
        return new EmbeddingClient("ollama", "nomic-embed-text:latest", OLLAMA, "") {
            @Override public float[] embed(String text) {
                if (text == null || text.isBlank()) {
                    // 真实行为:EmbeddingClient.embed("") 直接回 float[0]。探测文本若为空
                    // 就会把一个好后端误判成「回了空向量」——这条桩是为了钉住那个坑。
                    return new float[0];
                }
                float[] v = new float[dim];
                for (int i = 0; i < dim; i++) v[i] = i;
                return v;
            }
        };
    }

    private static EmbeddingClient failing(Exception e) {
        return new EmbeddingClient("ollama", "nomic-embed-text:latest", OLLAMA, "") {
            @Override public float[] embed(String text) throws IOException {
                if (e instanceof IOException io) throw io;
                throw new IOException(e);
            }
        };
    }

    @Test
    @DisplayName("连得上:回 ok + 真实维度 + 耗时 + 实际生效的 provider/model/baseUrl")
    void successReportsDimensionAndLatency() {
        Map<String, Object> r = EmbeddingProbe.probe(stub(768), null, "");
        assertEquals(true, r.get("ok"), String.valueOf(r));
        assertEquals(768, r.get("dim"), "维度必须是向量的真实长度: " + r);
        assertTrue(r.get("latencyMs") instanceof Long, "要有耗时: " + r);
        assertTrue(((Long) r.get("latencyMs")) >= 0);
        assertEquals("ollama", r.get("provider"));
        assertEquals("nomic-embed-text:latest", r.get("model"));
        assertEquals(OLLAMA, r.get("baseUrl"));
        assertNull(r.get("error"), "成功不该带 error: " + r);
    }

    @Test
    @DisplayName("探测文本不能为空 —— 空串走的是 embed 的 float[0] 早退,好后端会被判成坏的")
    void probeTextIsNotBlank() {
        assertFalse(EmbeddingProbe.PROBE_TEXT.isBlank());
        // 桩对空串回 float[0];能拿到 768 就证明传下去的不是空串
        assertEquals(768, EmbeddingProbe.probe(stub(768), null, "").get("dim"));
    }

    @Test
    @DisplayName("回了空向量算失败 —— 0 维向量会让相关度全为 0,那不是「连接正常」")
    void emptyVectorIsAFailureNotASuccess() {
        Map<String, Object> r = EmbeddingProbe.probe(stub(0), null, "");
        assertEquals(false, r.get("ok"), "0 维不能算通过: " + r);
        assertTrue(String.valueOf(r.get("error")).contains("空向量")
                        || String.valueOf(r.get("error")).contains("0 维"),
                "要说清是空向量而不是网络问题: " + r);
    }

    @Test
    @DisplayName("连不上:原文保留在 error,诊断另放 hint(两个字段,不合并)")
    void failureKeepsRawTextAndAddsHintSeparately() {
        Map<String, Object> r = EmbeddingProbe.probe(
                failing(new ConnectException("Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434")),
                null, "");
        assertEquals(false, r.get("ok"));
        assertTrue(String.valueOf(r.get("error")).contains("Failed to connect to"),
                "原文必须保留: " + r);
        assertTrue(String.valueOf(r.get("hint")).contains("没在运行"), "该给可行动诊断: " + r);
        assertTrue(String.valueOf(r.get("hint")).contains("IPv6"), "该点破 IPv6 障眼法: " + r);
    }

    @Test
    @DisplayName("诊断说不出话时不硬凑 —— 401 只给原文,不给一句「可能是没在运行」")
    void noHintWhenNothingCertainToSay() {
        Map<String, Object> r = EmbeddingProbe.probe(
                failing(new IOException("Embedding API 请求失败 [401]: invalid api key")), null, "");
        assertEquals(false, r.get("ok"));
        assertTrue(String.valueOf(r.get("error")).contains("401"));
        assertTrue(r.get("hint") == null || String.valueOf(r.get("hint")).isEmpty(),
                "无话可说就别说: " + r);
    }

    @Test
    @DisplayName("红线:apiKey 绝不出现在回包里(有服务端会在 401 消息里回显 key)")
    void apiKeyNeverLeaksIntoTheResult() {
        String key = "sk-live-should-never-be-echoed-0123456789";
        Map<String, Object> r = EmbeddingProbe.probe(
                failing(new IOException("Embedding API 请求失败 [401]: invalid key " + key)), null, key);
        assertFalse(String.valueOf(r).contains(key), "回包里出现了 apiKey: " + r);
        assertTrue(String.valueOf(r.get("error")).contains("redacted"), "该抹成占位: " + r);
        assertTrue(String.valueOf(r.get("error")).contains("401"), "抹 key 不该把原文也抹掉: " + r);
    }

    // ---- 与已有索引的兼容性:这是「建索引之前就该看见」的那部分 ----

    @Test
    @DisplayName("维度与索引不一致:警告点名两个维度,并说清后果是「检索会报错」")
    void dimensionConflictWithExistingIndexWarns() {
        Map<String, Object> r = EmbeddingProbe.probe(stub(1024),
                new VectorStore.IndexMeta("nomic-embed-text:latest", 768), "");
        assertEquals(true, r.get("ok"), "后端本身是通的: " + r);
        String w = String.valueOf(r.get("warning"));
        assertTrue(w.contains("768") && w.contains("1024"), "两个维度都要点名: " + w);
        assertTrue(w.contains("重建"), "要给出动作: " + w);
    }

    @Test
    @DisplayName("维度相同但模型不同:也要警告 —— 这种不报错,只是结果全是垃圾")
    void sameDimensionDifferentModelStillWarns() {
        Map<String, Object> r = EmbeddingProbe.probe(
                new EmbeddingClient("ollama", "mxbai-embed-large:latest", OLLAMA, "") {
                    @Override public float[] embed(String text) { return new float[768]; }
                },
                new VectorStore.IndexMeta("nomic-embed-text:latest", 768), "");
        String w = String.valueOf(r.get("warning"));
        assertTrue(w.contains("nomic-embed-text:latest") && w.contains("mxbai-embed-large:latest"),
                "两个模型名都要点名: " + w);
        // 后果与维度冲突不同:维度对得上,检索不会抛,只是相关度毫无意义
        assertTrue(w.contains("不会报错") || w.contains("不报错"),
                "这种不报错,得说清 —— 否则用户等着看报错: " + w);
    }

    @Test
    @DisplayName("同模型同维度:一个字都不加")
    void matchingIndexProducesNoWarning() {
        Map<String, Object> r = EmbeddingProbe.probe(stub(768),
                new VectorStore.IndexMeta("nomic-embed-text:latest", 768), "");
        assertNull(r.get("warning"), String.valueOf(r));
    }

    @Test
    @DisplayName("模型名只差大小写/首尾空格不算换模型 —— 不该逼人重建整库")
    void modelNameComparisonIsLenient() {
        Map<String, Object> r = EmbeddingProbe.probe(stub(768),
                new VectorStore.IndexMeta("  Nomic-Embed-Text:Latest ", 768), "");
        assertNull(r.get("warning"), String.valueOf(r));
    }

    @Test
    @DisplayName("没有索引元信息(没建过 / 老索引没记过)时不猜、不警告")
    void unknownIndexMetaProducesNoWarning() {
        assertNull(EmbeddingProbe.probe(stub(768), null, "").get("warning"));
        assertNull(EmbeddingProbe.probe(stub(768), new VectorStore.IndexMeta(null, 0), "").get("warning"));
        assertNull(EmbeddingProbe.probe(stub(768), new VectorStore.IndexMeta("", 0), "").get("warning"));
    }

    @Test
    @DisplayName("失败时不谈索引兼容性 —— 连都没连上,拿不到维度就无从比较")
    void failureDoesNotSpeculateAboutTheIndex() {
        Map<String, Object> r = EmbeddingProbe.probe(failing(new ConnectException("Failed to connect")),
                new VectorStore.IndexMeta("nomic-embed-text:latest", 768), "");
        assertEquals(false, r.get("ok"));
        assertNull(r.get("warning"), "没连上就别谈维度: " + r);
        assertNull(r.get("dim"), "没连上就没有维度可报: " + r);
    }

    @Test
    @DisplayName("消息为 null 的异常也要给出人能读的东西,不能回一句 null")
    void nullMessageExceptionStillReadable() {
        Map<String, Object> r = EmbeddingProbe.probe(failing(new IOException()), null, "");
        assertEquals(false, r.get("ok"));
        String err = String.valueOf(r.get("error"));
        assertFalse(err.isBlank());
        assertFalse(err.equals("null"), "要退回类名而不是字面 null: " + err);
    }

    // ---- 表单值 → 实际生效的 key:测的必须正是保存会落盘的那套 ----

    @Test
    @DisplayName("apiKey 留空 = 沿用已存的 —— 与 embeddingSet 的「空=保留旧 key」严格一致")
    void blankFormKeyInheritsTheSavedOne() {
        // 若这里不继承,云端后端「测试连接」就永远是 401:面板的 API KEY 框从不回填已存 key
        // (embeddingGet 只回 hasKey),用户不重打一遍就测不了 —— 而保存却是好的。
        assertEquals("saved-key", EmbeddingProbe.effectiveKey("saved-key", ""));
        assertEquals("saved-key", EmbeddingProbe.effectiveKey("saved-key", "   "));
        assertEquals("saved-key", EmbeddingProbe.effectiveKey("saved-key", null));
    }

    @Test
    @DisplayName("表单填了就用表单的 —— 否则「换了 key 再测」测的还是旧 key")
    void formKeyOverridesTheSavedOne() {
        assertEquals("new-key", EmbeddingProbe.effectiveKey("saved-key", "new-key"));
        assertEquals("new-key", EmbeddingProbe.effectiveKey(null, "  new-key  "), "该 trim");
    }

    @Test
    @DisplayName("两边都没有 → 空串,不是 null(本机 ollama 本来就不需要 key)")
    void noKeyAnywhereGivesEmptyString() {
        assertEquals("", EmbeddingProbe.effectiveKey(null, null));
        assertEquals("", EmbeddingProbe.effectiveKey("", ""));
    }

    @Test
    @DisplayName("超长错误体要截断 —— 有的服务端会把整页 HTML 塞进 4xx 响应体")
    void hugeErrorBodyIsTruncated() {
        Map<String, Object> r = EmbeddingProbe.probe(
                failing(new IOException("x".repeat(5000))), null, "");
        assertTrue(String.valueOf(r.get("error")).length() < 600, "该截断: 长度="
                + String.valueOf(r.get("error")).length());
    }
}
