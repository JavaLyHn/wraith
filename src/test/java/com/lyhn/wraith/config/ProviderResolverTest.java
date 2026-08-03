package com.lyhn.wraith.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 「谁是可用 provider」的唯一答案。
 *
 * <p><b>起因</b>：用户说「最开始面向 glm 只是因为我只有 glm 的，现在不应该出现只能用 glm
 * 才能完成的事情」。查下来 {@code {glm,deepseek,step,kimi,freellmapi,xfyun}} 这个列表在仓库里
 * 硬编码了四份，其中 {@code LlmClientFactory} 那份是可达真 bug：桌面里配好 anthropic 点保存，
 * {@code createFromConfig} 先试硬编码的 default "glm"（无 key）、再遍历那 6 家（anthropic 不在内），
 * 返回 null，用户看到「无可用模型」。
 *
 * <p><b>为什么三个查询全注入</b>：{@code WraithConfig.getApiKey} 会回落读真实环境变量。
 * 现有 {@code LlmClientFactoryRoutingTest.unknownProviderWithoutKeyReturnsNull} 断言
 * {@code create("openai", new WraithConfig())} 为 null —— 那条测试是靠「跑它的机器恰好没设
 * OPENAI_API_KEY」才绿的。这里不继承那个缺陷：本测试全部走注入入口，在任何机器上结果一致。
 */
class ProviderResolverTest {

    // ── 测试替身 ────────────────────────────────────────────────────────────

    /** 只认给定 map 的 key 查询;其余返回 null。 */
    private static Function<String, String> keys(Map<String, String> m) {
        return m::get;
    }

    private static Function<String, String> noBaseUrls() {
        return p -> null;
    }

    private static WraithConfig cfg(String defaultProvider, String... providerIdsWithKey) {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(defaultProvider);
        c.setProviders(new LinkedHashMap<>());
        for (String id : providerIdsWithKey) {
            c.getProviders().put(id, new WraithConfig.ProviderConfig("sk-" + id, null, "m"));
        }
        return c;
    }

    // ── 顺序 ────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("defaultProvider 有 key 时排第一")
    void defaultGoesFirst() {
        WraithConfig c = cfg("siliconflow", "anthropic", "siliconflow");
        List<String> got = ProviderResolver.candidates(c, Set.of(),
                keys(Map.of("anthropic", "sk-a", "siliconflow", "sk-s")), noBaseUrls());

        assertEquals("siliconflow", got.get(0), "显式默认必须优先: " + got);
        assertTrue(got.contains("anthropic"));
    }

    @Test
    @DisplayName("defaultProvider 无 key 时被跳过 —— 这就是 stale \"glm\" 的情形")
    void staleDefaultIsSkipped() {
        // 用户的老 config.json 里写着 defaultProvider:"glm"(硬编码初值落盘的),但 glm 没 key
        WraithConfig c = cfg("glm", "anthropic");
        List<String> got = ProviderResolver.candidates(c, Set.of(),
                keys(Map.of("anthropic", "sk-a")), noBaseUrls());

        assertEquals(List.of("anthropic"), got, "无 key 的 stale 默认不该占位: " + got);
    }

    @Test
    @DisplayName("config 内其余 provider 保持插入序(＝用户添加序)")
    void configOrderIsInsertionOrder() {
        WraithConfig c = cfg(null, "zeta", "alpha", "mid");
        List<String> got = ProviderResolver.candidates(c, Set.of(),
                keys(Map.of("zeta", "k", "alpha", "k", "mid", "k")), noBaseUrls());

        assertEquals(List.of("zeta", "alpha", "mid"), got, "不许按字母排序: " + got);
    }

    @Test
    @DisplayName("config 里有条目但没 key(只填了 model)→ 不是候选")
    void configEntryWithoutKeyIsNotCandidate() {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(null);
        c.setProviders(new LinkedHashMap<>());
        c.getProviders().put("openai", new WraithConfig.ProviderConfig(null, null, "gpt-4.1"));

        assertEquals(List.of(), ProviderResolver.candidates(
                c, Set.of(), keys(Map.of()), noBaseUrls()));
    }

    @Test
    @DisplayName("什么都没有 → 空表,不抛")
    void nothingConfiguredIsEmpty() {
        WraithConfig c = cfg(null);
        assertEquals(List.of(), ProviderResolver.candidates(
                c, Set.of(), keys(Map.of()), noBaseUrls()));
    }

    @Test
    @DisplayName("defaultProvider 为 null/空白都不能 NPE")
    void blankDefaultIsSafe() {
        assertDoesNotThrow(() -> ProviderResolver.candidates(
                cfg(null, "glm"), Set.of(), keys(Map.of("glm", "k")), noBaseUrls()));
        assertDoesNotThrow(() -> ProviderResolver.candidates(
                cfg("   ", "glm"), Set.of(), keys(Map.of("glm", "k")), noBaseUrls()));
    }

    // ── env-only 发现(D3) ───────────────────────────────────────────────────

    @Test
    @DisplayName("env 里的 ANTHROPIC_API_KEY 能被发现 —— 从没打开过桌面面板的用户也能起来")
    void discoversEnvOnlyProvider() {
        WraithConfig c = cfg(null);   // config 里一个 provider 都没有
        List<String> got = ProviderResolver.candidates(c,
                Set.of("ANTHROPIC_API_KEY"),
                keys(Map.of("anthropic", "sk-ant")),
                noBaseUrls());

        assertEquals(List.of("anthropic"), got);
    }

    @Test
    @DisplayName("config 与 env 同名只出现一次")
    void dedupesConfigAndEnv() {
        WraithConfig c = cfg(null, "anthropic");
        List<String> got = ProviderResolver.candidates(c,
                Set.of("ANTHROPIC_API_KEY"),
                keys(Map.of("anthropic", "sk-a")),
                noBaseUrls());

        assertEquals(List.of("anthropic"), got, "去重失败: " + got);
    }

    @Test
    @DisplayName("env 候选排在 config 候选之后 —— 显式配置优先于环境残留")
    void envComesAfterConfig() {
        WraithConfig c = cfg(null, "siliconflow");
        List<String> got = ProviderResolver.candidates(c,
                Set.of("ANTHROPIC_API_KEY"),
                keys(Map.of("siliconflow", "sk-s", "anthropic", "sk-a")),
                noBaseUrls());

        assertEquals(List.of("siliconflow", "anthropic"), got);
    }

    // ── env 发现的护栏 ───────────────────────────────────────────────────────

    @Test
    @DisplayName("端点定不了的 env 候选被挡 —— 否则会静默指向 api.openai.com")
    void envCandidateWithoutResolvableEndpointIsBlocked() {
        // GenericOpenAiClient 在 baseUrl 为空时兜底 https://api.openai.com/v1,
        // 所以一个无关的 MY_SERVICE_API_KEY 不是「连不上」,而是把 key 发给 OpenAI。
        WraithConfig c = cfg(null);
        List<String> got = ProviderResolver.candidates(c,
                Set.of("MY_SERVICE_API_KEY"),
                keys(Map.of("my_service", "sk-x")),
                noBaseUrls());

        assertEquals(List.of(), got, "端点未知的 env 候选必须被挡: " + got);
    }

    @Test
    @DisplayName("给了 <NAME>_BASE_URL 就放行 —— 自建服务的正当用法")
    void envCandidateWithExplicitBaseUrlPasses() {
        WraithConfig c = cfg(null);
        List<String> got = ProviderResolver.candidates(c,
                Set.of("MY_SERVICE_API_KEY", "MY_SERVICE_BASE_URL"),
                keys(Map.of("my_service", "sk-x")),
                p -> "my_service".equals(p) ? "https://llm.internal/v1" : null);

        assertEquals(List.of("my_service"), got);
    }

    // 最终评审 C1: anthropic 这一档此前只验证了「进护栏白名单」这一步,却没验证护栏放行后
    // 那个候选真的会被造成 AnthropicClient(而不是落进 GenericOpenAiClient 把 key 发给 OpenAI)——
    // 也就是把这个曾经的回归行为钉成了绿灯。C1 修复(LlmClientFactory 显式 case "anthropic")后
    // 这条断言本身是对的,真正要锁住的那件事由
    // LlmClientFactoryRoutingTest.envOnlyAnthropicDoesNotLeakToOpenAi 补上。
    @Test
    @DisplayName("端点可确定的 8 家不需要 BASE_URL 也放行")
    void builtinEndpointProvidersPassWithoutBaseUrl() {
        for (String p : List.of("glm", "deepseek", "step", "kimi",
                                "freellmapi", "xfyun", "anthropic", "openai")) {
            WraithConfig c = cfg(null);
            List<String> got = ProviderResolver.candidates(c,
                    Set.of(p.toUpperCase() + "_API_KEY"),
                    keys(Map.of(p, "sk-k")),
                    noBaseUrls());
            assertEquals(List.of(p), got, p + " 应有内置端点,不该被护栏挡下");
        }
    }

    // ── env 发现的排除项 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("EMBEDDING_API_KEY 不是 provider —— 那是 RAG 的 embedding 后端")
    void embeddingKeyIsNotAProvider() {
        List<String> got = ProviderResolver.candidates(cfg(null),
                Set.of("EMBEDDING_API_KEY"), keys(Map.of("embedding", "sk-e")), noBaseUrls());
        assertEquals(List.of(), got);
    }

    @Test
    @DisplayName("任意 WRAITH_* 都被挡 —— 验的是前缀规则,不是硬编码两个名字")
    void wraithOwnNamespaceIsExcluded() {
        // WRAITH_RUNTIME_API_KEY 是 wraith 自己的 Runtime HTTP API 认证 key(见 docs/phase-20)。
        // 用一个不存在的名字一起验,确保实现写的是前缀规则而非枚举 —— 将来新增自动被挡。
        for (String v : List.of("WRAITH_RUNTIME_API_KEY", "WRAITH_FUTURE_THING_API_KEY")) {
            List<String> got = ProviderResolver.candidates(cfg(null),
                    Set.of(v), k -> "sk-anything", p -> "https://x/v1");
            assertEquals(List.of(), got, v + " 不该成为 provider 候选");
        }
    }

    @Test
    @DisplayName("不匹配 <NAME>_API_KEY 的变量天然不参与")
    void unrelatedEnvVarsAreIgnored() {
        List<String> got = ProviderResolver.candidates(cfg(null),
                Set.of("SERPAPI_KEY", "SEARXNG_URL", "SEARCH_PROVIDER", "REMOTE_TOKEN", "PATH"),
                k -> "sk-anything", p -> "https://x/v1");
        assertEquals(List.of(), got);
    }

    // ── 原始名不可预先 normalize ──────────────────────────────────────────────

    @Test
    @DisplayName("MOONSHOT_API_KEY 产出 moonshot 而非 kimi —— 预先 normalize 会掐断双查")
    void keepsRawDiscoveredName() {
        // normalizeProvider("moonshot")→"kimi",而 getApiKey("kimi") 读的是 KIMI_API_KEY(不存在)。
        // MOONSHOT_API_KEY 之所以能用,靠的是 LlmClientFactory:20-23 用原始名再查一次。
        // resolver 若吐 "kimi",这条双查就失去输入。
        List<String> got = ProviderResolver.candidates(cfg(null),
                Set.of("MOONSHOT_API_KEY"), keys(Map.of("moonshot", "sk-m")), noBaseUrls());

        assertEquals(List.of("moonshot"), got);
    }

    @Test
    @DisplayName("XFYUN_MAAS_API_KEY 这个不规则名映射到 xfyun")
    void irregularAliasMapsToProvider() {
        List<String> got = ProviderResolver.candidates(cfg(null),
                Set.of("XFYUN_MAAS_API_KEY"), keys(Map.of("xfyun", "sk-x")), noBaseUrls());

        assertEquals(List.of("xfyun"), got);
    }

    @Test
    @DisplayName("别名的端点护栏要按**规范名**判 —— 否则 14 个别名会被全部误挡")
    void aliasesPassTheEndpointGuardByNormalizedName() {
        // ENDPOINT_KNOWN 装的是规范名。若拿原始名直接查表,moonshot/stepfun/iflytek…
        // 都会被挡下 —— 而它们规范化后是 kimi/step/xfyun,端点都由 bespoke client 烧死了。
        // 每对里前者是发现到的原始名(候选必须保留它),后者是它规范化后的名字。
        record Alias(String envName, String rawProvider) {}
        for (Alias a : List.of(
                new Alias("MOONSHOT_API_KEY", "moonshot"),
                new Alias("STEPFUN_API_KEY", "stepfun"),
                new Alias("IFLYTEK_API_KEY", "iflytek"),
                new Alias("FREELLM_API_KEY", "freellm"))) {
            List<String> got = ProviderResolver.candidates(cfg(null),
                    Set.of(a.envName()), keys(Map.of(a.rawProvider(), "sk-k")), noBaseUrls());

            assertEquals(List.of(a.rawProvider()), got,
                    a.envName() + " 应产出原始名 " + a.rawProvider() + " 且不被端点护栏挡下");
        }
    }

    // ── effectiveDefault ────────────────────────────────────────────────────

    @Test
    @DisplayName("effectiveDefault = 候选首项;一个都没有时返回空串(不是 null)")
    void effectiveDefaultIsFirstCandidate() {
        WraithConfig withOne = cfg("glm", "anthropic");   // stale default
        assertEquals("anthropic", ProviderResolver.effectiveDefault(withOne, Set.of(),
                keys(Map.of("anthropic", "sk-a")), noBaseUrls()));

        assertEquals("", ProviderResolver.effectiveDefault(cfg(null), Set.of(),
                keys(Map.of()), noBaseUrls()), "空串便于直接进 JSON,不必在调用方判 null");
    }

    // ── 健壮性 ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("key 查询抛异常不能把启动带崩")
    void lookupFailureIsNotFatal() {
        WraithConfig c = cfg(null, "anthropic");
        assertDoesNotThrow(() -> ProviderResolver.candidates(c, Set.of(),
                k -> { throw new IllegalStateException("配置文件坏了"); }, noBaseUrls()));
    }
}
