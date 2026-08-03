package com.lyhn.wraith.llm;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;

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

    @Test
    @DisplayName("只配 anthropic + stale glm 默认 → 拿得到 AnthropicClient(这条此前是红的)")
    void anthropicOnlyIsFound() {
        LlmClient client = LlmClientFactory.createFromConfig(
                staleDefaultWith("anthropic", "anthropic", "https://api.anthropic.com"));

        assertNotNull(client, "配好 anthropic 却拿不到 client —— 就是这个 bug");
        assertInstanceOf(AnthropicClient.class, client);
    }

    @Test
    @DisplayName("只配 siliconflow(白名单外的 openai-compatible)→ 拿得到 GenericOpenAiClient")
    void unlistedOpenAiCompatibleIsFound() {
        LlmClient client = LlmClientFactory.createFromConfig(
                staleDefaultWith("siliconflow", "openai", "https://api.siliconflow.cn/v1"));

        assertNotNull(client);
        assertInstanceOf(GenericOpenAiClient.class, client);
        assertEquals("siliconflow", client.getProviderName());
    }

    @Test
    @DisplayName("只配 freellmapi-5 这种多实例 id → 拿得到 client(旧白名单只有裸 freellmapi)")
    void repeatableInstanceIdIsFound() {
        LlmClient client = LlmClientFactory.createFromConfig(
                staleDefaultWith("freellmapi-5", "openai", "http://localhost:5173/v1"));

        assertNotNull(client, "多实例 id 不该因为不在白名单里就被跳过");
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
}
