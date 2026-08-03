package com.lyhn.wraith.llm;

import com.lyhn.wraith.config.ProviderResolver;
import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@code createFromConfig} 的回落：配了 key 的 provider 必须能被找到，无论它是谁。
 *
 * <p><b>修的是什么 bug</b>：此前回落遍历的是硬编码数组
 * {@code {glm,deepseek,step,kimi,freellmapi,xfyun}}。链路：
 * {@code WraithConfig.defaultProvider} 硬编码初值 {@code "glm"} → {@code save()} 整对象落盘，
 * 全新安装就把它写进 config.json → {@code configSetProvider} 存 provider 时从不设默认 →
 * {@code createFromConfig} 先试 glm（无 key，null）→ 再遍历那 6 家 → anthropic 不在内 → null
 * → 用户在桌面里配好 anthropic 点保存，看到「无可用模型」。
 *
 * <p>用户自己的 config 就中了：6 个 provider（freellmapi、freellmapi-2..5、siliconflow），
 * 白名单只覆盖裸 freellmapi 一个 —— 连自家的多实例命名都覆盖不到。
 *
 * <p>这些测试都显式建 config 对象、不读真实文件；provider 的 key 直接写在 ProviderConfig 里。
 * 但 stale-default（{@code defaultProvider="glm"}）场景走的是{@code createDeterministically}
 * 而非公开的 {@code createFromConfig}：本仓库 checkout 里有 {@code ./.env} 落着真实
 * {@code DEEPSEEK_API_KEY}，且任何设了 {@code GLM_API_KEY} 的开发机都会让公开入口在 glm
 * 这一步就短路成功——那种测试对目标 bug 没有判别力（详见评审 Important 2）。
 */
class LlmClientFactoryFallbackTest {

    /** 一个「只配了某个 provider + defaultProvider 是 stale glm」的 config。 */
    private static WraithConfig staleDefaultWith(String id, String protocol, String baseUrl) {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider("glm");            // 老 config.json 里落盘的硬编码初值
        c.setProviders(new LinkedHashMap<>());
        WraithConfig.ProviderConfig pc = new WraithConfig.ProviderConfig("sk-test", baseUrl, "m");
        if (protocol != null) {
            pc.setProtocol(protocol);
        }
        c.getProviders().put(id, pc);
        return c;
    }

    /**
     * 只认 {@code config.getProviders()} 里写下的 key，完全不看真实环境变量。
     *
     * <p>喂给 {@link ProviderResolver#candidates(WraithConfig, Set, Function, Function)}
     * 的 {@code envVarNames} 传空集合，即可跳过 env 发现那一步；{@code keyLookup} 只查
     * config 自己的 map，不像 {@code config::getApiKey} 那样在 config 没写时回落读
     * {@code System.getenv()} / {@code .env}。
     */
    private static Function<String, String> configOnlyKeys(WraithConfig c) {
        return p -> {
            WraithConfig.ProviderConfig pc = c.getProviders().get(p);
            return pc == null ? null : pc.getApiKey();
        };
    }

    /**
     * 等价于 {@code createFromConfig}，但候选表只由 config 决定，与本机真实环境变量无关。
     * 专用于验证 stale-default 场景——不能让「这台机器设了 GLM_API_KEY」左右测试结果。
     */
    private static LlmClient createDeterministically(WraithConfig c) {
        List<String> candidates = ProviderResolver.candidates(c, Set.of(), configOnlyKeys(c), p -> null);
        return LlmClientFactory.createFrom(c, candidates);
    }

    @Test
    @DisplayName("只配 anthropic + stale glm 默认 → 拿得到 AnthropicClient(这条此前是红的)")
    void anthropicOnlyIsFound() {
        LlmClient client = createDeterministically(
                staleDefaultWith("anthropic", "anthropic", "https://api.anthropic.com"));

        assertNotNull(client, "配好 anthropic 却拿不到 client —— 就是这个 bug");
        assertInstanceOf(AnthropicClient.class, client);
    }

    @Test
    @DisplayName("只配 siliconflow(白名单外的 openai-compatible)→ 拿得到 GenericOpenAiClient")
    void unlistedOpenAiCompatibleIsFound() {
        LlmClient client = createDeterministically(
                staleDefaultWith("siliconflow", "openai", "https://api.siliconflow.cn/v1"));

        assertNotNull(client);
        assertInstanceOf(GenericOpenAiClient.class, client);
        assertEquals("siliconflow", client.getProviderName());
    }

    @Test
    @DisplayName("只配 freellmapi-5 这种多实例 id → 拿得到该实例自己的 client(旧白名单只有裸 freellmapi)")
    void repeatableInstanceIdIsFound() {
        LlmClient client = createDeterministically(
                staleDefaultWith("freellmapi-5", "openai", "http://localhost:5173/v1"));

        // 只断言非 null 对这个 bug 没有判别力:老逻辑遍历硬编码数组时,只要数组里
        // 随便哪一家(如 deepseek)在真实环境里凑巧有 key,也会返回非 null —— 只是给错了
        // client。必须钉死"拿到的是 freellmapi-5 这个实例自己的 GenericOpenAiClient"。
        assertInstanceOf(GenericOpenAiClient.class, client, "多实例 id 不该因为不在白名单里就被跳过");
        assertEquals("freellmapi-5", client.getProviderName());
    }

    @Test
    @DisplayName("显式 defaultProvider 有 key 时优先它,不被回落抢走")
    void explicitDefaultWins() {
        WraithConfig c = new WraithConfig();
        c.setProviders(new LinkedHashMap<>());
        // anthropic 排在前面,但 default 指向 deepseek —— 显式选择必须赢
        WraithConfig.ProviderConfig ant =
                new WraithConfig.ProviderConfig("sk-a", "https://api.anthropic.com", "m");
        ant.setProtocol("anthropic");
        c.getProviders().put("anthropic", ant);
        c.getProviders().put("deepseek", new WraithConfig.ProviderConfig("sk-d", null, "m"));
        c.setDefaultProvider("deepseek");

        assertInstanceOf(DeepSeekClient.class, LlmClientFactory.createFromConfig(c));
    }

    @Test
    @DisplayName("一个 provider 都没配 → null(交由调用方给人话,不是 NPE)")
    void nothingConfiguredIsNull() {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(null);
        c.setProviders(new LinkedHashMap<>());

        // 走注入重载:public 入口会扫真实环境变量,这条断言在设了 ANTHROPIC_API_KEY 的
        // 开发机上会拿到一个 client 而失败、在干净 CI 上通过 —— 那种测试没有判别力。
        assertNull(LlmClientFactory.createFrom(c, java.util.List.of()));
    }

    @Test
    @DisplayName("多个都有 key 时按插入序取第一个 —— 结果可预期,不随 Map 实现变")
    void firstConfiguredWinsWhenNoDefault() {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(null);
        c.setProviders(new LinkedHashMap<>());
        c.getProviders().put("deepseek", new WraithConfig.ProviderConfig("sk-d", null, "m"));
        c.getProviders().put("step", new WraithConfig.ProviderConfig("sk-s", null, "m"));

        assertInstanceOf(DeepSeekClient.class, LlmClientFactory.createFromConfig(c));
    }

    @Test
    @DisplayName("createFromConfig 就是 createFrom(config, ProviderResolver.candidates(config)) 的委托")
    void createFromConfigDelegatesToResolverCandidates() {
        // 两条路径都调用同一个真实扫环境的 ProviderResolver.candidates(config) 单参入口,
        // 所以在"当前实现"下,不管这台机器实际设了哪些 *_API_KEY,两侧算出来的候选表
        // 必然一致 —— 这条断言因此天然环境无关,不需要硬编码期望值。
        //
        // 复用 anthropicOnlyIsFound 同款的 stale-glm-default-only-anthropic config 而不是
        // 随便找一个 provider:这样如果 createFromConfig 退回老的硬编码数组(而不是委托
        // ProviderResolver.candidates),两条路径就会分道 —— anthropic 不在老数组里,
        // viaConfig 会落到数组里某个凑巧有真实 env key 的项(比如本仓库 ./.env 里的
        // DEEPSEEK_API_KEY)甚至是 null,viaCandidates 则始终稳定给出 AnthropicClient。
        // 这就是 createFromConfig 这一层委托本身此前没有被直接验证过的缺口。
        WraithConfig c = staleDefaultWith("anthropic", "anthropic", "https://api.anthropic.com");

        LlmClient viaConfig = LlmClientFactory.createFromConfig(c);
        LlmClient viaCandidates = LlmClientFactory.createFrom(c, ProviderResolver.candidates(c));

        assertEquals(viaConfig == null, viaCandidates == null, "两条路径必须同时为 null 或同时非 null");
        if (viaConfig != null) {
            assertEquals(viaConfig.getClass(), viaCandidates.getClass());
        }
    }
}
