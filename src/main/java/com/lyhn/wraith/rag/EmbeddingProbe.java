package com.lyhn.wraith.rag;

import com.lyhn.wraith.config.SecretRedaction;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 「测试连接」按钮的后端：发一次真实的 embedding 请求，把结论摊开。
 *
 * <p><b>为什么需要它</b>：此前验证 embedding 后端唯一的办法是点「建立索引」——
 * 那是一次上千个代码块的整库扫描。配错一个字符（端口 / 模型名 / key），
 * 用户要么等它跑完，要么盯着一句 OkHttp 原文猜。
 *
 * <p><b>回包里每个字段都有理由</b>：
 * <ul>
 *   <li>{@code dim} —— 本仓库最阴的一类故障就在维度上：768 维索引 + 1024 维查询，
 *       {@code cosineSimilarity} 曾安静地返回 0.0（现由 {@link VectorStore} 抛错兜住）。
 *       把维度摊在按钮下面，是让人在建索引<b>之前</b>就看见冲突。</li>
 *   <li>{@code latencyMs} —— 单次耗时 × 上千块 = 整库索引的量级。本机实测
 *       nomic-embed-text 冷 0.6s / 热 0.06s，bge-m3 冷 2.2s / 热 0.16s。</li>
 *   <li>{@code provider}/{@code model}/{@code baseUrl} —— 表单留空时 {@link EmbeddingClient#of}
 *       会填默认值，回显的是<b>实际生效</b>的那套，不是表单里那套。</li>
 *   <li>{@code warning} —— 与<b>已有索引</b>的兼容性。见 {@link #compatibilityWarning}。</li>
 *   <li>{@code error} + {@code hint} —— <b>两个字段，不合并</b>。原文一律保留：
 *       「连不上」「401 key 错」「429 限流」是三件不同的事，只给一句友好话会把人引到
 *       错的地方去查。诊断（{@link EmbeddingErrorHint}）说不出话时这个字段就不出现。</li>
 * </ul>
 */
public final class EmbeddingProbe {

    private EmbeddingProbe() {}

    /**
     * 探测用的输入文本。
     *
     * <p><b>不能为空</b>：{@link EmbeddingClient#embed} 对空串直接回 {@code float[0]} 早退，
     * 那会把一个完好的后端判成「回了空向量」。也刻意用英文短句 —— 中文在某些
     * 纯英语 tokenizer 上会被切成一堆 UNK，虽然一样能出向量，但没必要给探测引入变量。
     */
    public static final String PROBE_TEXT = "wraith embedding connectivity probe";

    /** 错误原文的截断长度：有的服务端会把整页 HTML 塞进 4xx 响应体。 */
    private static final int MAX_ERROR_CHARS = 300;

    /**
     * 表单里的 key 与已存的 key 之间取实际生效的那个。
     *
     * <p><b>语义必须与 {@code embeddingSet} 的「空=保留旧 key」严格一致</b> ——
     * 测的必须正是保存会落盘的那套。面板的 API KEY 框从不回填已存 key
     * （{@code embeddingGet} 只回 {@code hasKey}），若这里不继承，云端后端的「测试连接」
     * 就永远是 401，而保存却是好的 —— 那种自相矛盾比没有这个按钮更糟。
     */
    public static String effectiveKey(String savedKey, String formKey) {
        if (formKey != null && !formKey.isBlank()) {
            return formKey.trim();
        }
        return savedKey == null ? "" : savedKey;
    }

    /**
     * @param client   已按表单值构造好的客户端
     * @param indexMeta 当前项目已有索引的元信息；{@code null} / 空模型名 = 不知道，不比较
     * @param apiKey   <b>只</b>用于把它从错误原文里抹掉（有服务端会在 401 消息里回显 key）
     */
    public static Map<String, Object> probe(EmbeddingClient client, VectorStore.IndexMeta indexMeta,
                                            String apiKey) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("provider", client.getProvider());
        out.put("model", client.getModel());
        out.put("baseUrl", client.getBaseUrl());

        long t0 = System.nanoTime();
        float[] vector;
        try {
            vector = client.embed(PROBE_TEXT);
        } catch (Exception e) {
            long ms = (System.nanoTime() - t0) / 1_000_000L;
            String raw = e.getMessage() == null || e.getMessage().isBlank()
                    ? e.getClass().getSimpleName() : e.getMessage();
            raw = SecretRedaction.redact(raw, apiKey);
            if (raw.length() > MAX_ERROR_CHARS) {
                raw = raw.substring(0, MAX_ERROR_CHARS) + "…";
            }
            out.put("ok", false);
            out.put("error", raw);
            out.put("latencyMs", ms);   // 失败也有意义:是秒级拒绝还是等到超时,方向不同
            String hint = EmbeddingErrorHint.of(client.getBaseUrl(), client.getProvider(), e);
            if (!hint.isEmpty()) {
                out.put("hint", SecretRedaction.redact(hint, apiKey));
            }
            // 没连上就不谈索引兼容性:拿不到维度,无从比较
            return out;
        }
        long ms = (System.nanoTime() - t0) / 1_000_000L;

        if (vector == null || vector.length == 0) {
            // 0 维不能算通过:那样的向量会让相关度恒为 0,而这一路不抛任何异常
            out.put("ok", false);
            out.put("latencyMs", ms);
            out.put("error", "后端回了空向量（0 维）。请求本身是成功的，但这份回包没法用于检索 ——"
                    + "多半是模型名不对（对方把它当成了别的接口）或该模型不是 embedding 模型。");
            return out;
        }

        out.put("ok", true);
        out.put("dim", vector.length);
        out.put("latencyMs", ms);
        String warning = compatibilityWarning(indexMeta, client.getModel(), vector.length);
        if (warning != null) {
            out.put("warning", warning);
        }
        return out;
    }

    /**
     * 与已有索引的兼容性。返回 {@code null} = 不必警告。
     *
     * <p><b>两种不兼容，后果不同，得分开说</b>：
     * <ul>
     *   <li><b>维度不同</b> —— {@link VectorStore#search} 会<b>抛错</b>（那个守卫是后加的）。
     *       用户会看到一条明确的失败。</li>
     *   <li><b>维度相同但模型不同</b> —— 不抛任何错。两个模型的向量空间根本不是一个，
     *       余弦相似度算出来是纯噪声，但每一步都「成功」。这种<b>更需要提前说</b>，
     *       因为用户会一直等一个永远不来的报错。</li>
     * </ul>
     *
     * <p>任一侧未知就不比较 —— 老索引没记过模型（{@code index_meta} 是后加的表），
     * 宁可漏报也不要对着一份可能没问题的索引喊「快重建」。
     */
    static String compatibilityWarning(VectorStore.IndexMeta meta, String currentModel, int currentDim) {
        if (meta == null || meta.embeddingModel() == null || meta.embeddingModel().isBlank()) {
            return null;
        }
        String indexed = meta.embeddingModel().trim();
        int indexedDim = meta.embeddingDim();
        if (indexedDim > 0 && currentDim > 0 && indexedDim != currentDim) {
            return "当前索引是用 " + indexed + "（" + indexedDim + " 维）建的，这个后端给出 "
                    + currentDim + " 维 —— 两者不兼容，直接检索会报错。请点「重建索引」。";
        }
        String current = currentModel == null ? "" : currentModel.trim();
        if (current.isEmpty() || indexed.toLowerCase(Locale.ROOT).equals(current.toLowerCase(Locale.ROOT))) {
            return null;
        }
        return "维度对得上（都是 " + currentDim + " 维），但当前索引是用 " + indexed
                + " 建的，这个后端是 " + current + "。不同模型的向量空间不通用："
                + "这种情况**不会报错**，只是相关度全无意义。要拿到正确结果请点「重建索引」。";
    }
}
