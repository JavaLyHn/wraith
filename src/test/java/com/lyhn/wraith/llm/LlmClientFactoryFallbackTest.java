package com.lyhn.wraith.llm;

import com.lyhn.wraith.config.ProviderResolver;
import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;

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
 * <p>这些测试都显式建 config 对象、不读真实文件；provider 的 key 直接写在 ProviderConfig 里，
 * 所以不依赖机器上的环境变量。
 *
 * <p><b>本类分两层职责</b>：「候选表给定后 {@code createFrom} 能不能正确落地」这一层由本类的
 * 前三条直测覆盖（候选表手写，不经 {@link ProviderResolver}）；「stale
 * {@code defaultProvider} 该不该被跳过」是 {@link ProviderResolver} 自己的职责，已经在
 * {@code ProviderResolverTest.staleDefaultIsSkipped} 里测过，不在本类重复。本类另外单独覆盖
 * 公开生产入口 {@code createFromConfig} 本身（见
 * {@code publicCreateFromConfigFindsUnlistedProviderRegardlessOfEnv}）。
 */
class LlmClientFactoryFallbackTest {

    /** 一个「只配了某个 provider」的 config；{@code defaultProvider} 固定是 stale 的 "glm"。 */
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

    @Test
    @DisplayName("候选表里有 anthropic → createFrom 拿得到 AnthropicClient(这条此前是红的)")
    void anthropicOnlyIsFound() {
        // 候选表手写、直调包可见的 createFrom——测的是"给定候选表,createFrom 能否正确
        // 造出 anthropic 的 client",与 defaultProvider/ProviderResolver 的候选计算无关
        // (下面复用 staleDefaultWith 只是图方便拿一个带 key 的 config,defaultProvider
        // 的值在这条测试里从未被读取)。
        WraithConfig c = staleDefaultWith("anthropic", "anthropic", "https://api.anthropic.com");
        LlmClient client = LlmClientFactory.createFrom(c, List.of("anthropic"));

        assertNotNull(client, "配好 anthropic 却拿不到 client —— 就是这个 bug");
        assertInstanceOf(AnthropicClient.class, client);
    }

    @Test
    @DisplayName("候选表里有 siliconflow(白名单外的 openai-compatible)→ createFrom 拿得到 GenericOpenAiClient")
    void unlistedOpenAiCompatibleIsFound() {
        // 同上:候选表手写,测的是 createFrom + create() 的派发逻辑,不测候选计算。
        WraithConfig c = staleDefaultWith("siliconflow", "openai", "https://api.siliconflow.cn/v1");
        LlmClient client = LlmClientFactory.createFrom(c, List.of("siliconflow"));

        assertNotNull(client);
        assertInstanceOf(GenericOpenAiClient.class, client);
        assertEquals("siliconflow", client.getProviderName());
    }

    @Test
    @DisplayName("候选表里有 freellmapi-5 这种多实例 id → createFrom 拿得到该实例自己的 client(旧白名单只有裸 freellmapi)")
    void repeatableInstanceIdIsFound() {
        // 同上:候选表手写。只断言非 null 对这个 bug 没有判别力——必须钉死"拿到的是
        // freellmapi-5 这个实例自己的 GenericOpenAiClient",不是随便哪个非 null 的东西。
        WraithConfig c = staleDefaultWith("freellmapi-5", "openai", "http://localhost:5173/v1");
        LlmClient client = LlmClientFactory.createFrom(c, List.of("freellmapi-5"));

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
        assertNull(LlmClientFactory.createFrom(c, List.of()));
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
    @DisplayName("公开入口 createFromConfig 找得到白名单外的 provider(defaultProvider=null,与本机 env 无关)")
    void publicCreateFromConfigFindsUnlistedProviderRegardlessOfEnv() {
        WraithConfig c = new WraithConfig();
        c.setDefaultProvider(null);
        c.setProviders(new LinkedHashMap<>());
        WraithConfig.ProviderConfig ant =
                new WraithConfig.ProviderConfig("sk-test", "https://api.anthropic.com", "m");
        ant.setProtocol("anthropic");
        c.getProviders().put("anthropic", ant);

        // 直调公开生产入口——defaultProvider=null 且 config 只放 anthropic,
        // candidates() 的顺序保证 config 项永远排在 env 发现项之前,
        // 所以结果不受本机是否设了 GLM_API_KEY/DEEPSEEK_API_KEY 影响。
        LlmClient client = LlmClientFactory.createFromConfig(c);

        assertInstanceOf(AnthropicClient.class, client);
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
        //
        // 局限:等式两侧共用的是同一份生产 candidates(config),所以这条测试只能抓
        // "createFromConfig 不再委托给 ProviderResolver.candidates"这一种回归;
        // 抓不了"委托目标本身算错了"(比如 candidates() 内部吞掉异常、或用错查询函数)——
        // 那种回归由 publicCreateFromConfigFindsUnlistedProviderRegardlessOfEnv 覆盖,
        // 它直接断言 createFromConfig 的返回类型,不跟任何"同款生产路径"比较。
        WraithConfig c = staleDefaultWith("anthropic", "anthropic", "https://api.anthropic.com");

        LlmClient viaConfig = LlmClientFactory.createFromConfig(c);
        LlmClient viaCandidates = LlmClientFactory.createFrom(c, ProviderResolver.candidates(c));

        assertEquals(viaConfig == null, viaCandidates == null, "两条路径必须同时为 null 或同时非 null");
        if (viaConfig != null) {
            assertEquals(viaConfig.getClass(), viaCandidates.getClass());
        }
    }
}
