package com.lyhn.wraith.cli;

import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.llm.LlmClient;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 后台任务的 LLM client 解析。
 *
 * <p><b>这是一次真实回归的防线。</b>「无模型也能启动」（首次运行死锁的修复）落地后，
 * app-server 里的后台任务管理器仍然把<b>启动那一刻</b>的 client 捕获进了 lambda：
 *
 * <pre>final LlmClient taskClient = client;   // 启动时是 null,就永远是 null
 * ... openDefault(prompt -&gt; runHeadlessTaskAt(prompt, taskClient, root))</pre>
 *
 * <p>结果：用户在 GUI 里配好 provider、对话链路已被 {@code ensureClient} 热装之后，
 * 后台任务依然抛
 * {@code Cannot invoke "LlmClient.supportsTools()" because "this.llmClient" is null}。
 *
 * <p>根因是同一个反复出现的模式：<b>把「会变的东西」当成一次性快照捕获</b>。
 * 讽刺的是紧挨着的 {@code taskRoot} 用的就是 {@code AtomicReference}——
 * 当时已经知道根目录会变，却没意识到 client 也会。
 *
 * <p><b>测试隔离要点</b>：{@code WraithConfig.getApiKey} 在配置里查不到时会
 * <b>回落到环境变量与 {@code .env}</b>。开发机上有真 key，所以「无 key」分支不能靠
 * 「构造一个空 config」来测——那样在我机器上永远走不到 throw。这里用匿名子类把
 * {@code getApiKey} 钉死成 null，判据才是确定的。
 */
class RequireTaskClientTest {

    /** 无论环境里有什么 key，这个 config 都报「没有」。 */
    private static WraithConfig noKeys() {
        return new WraithConfig() {
            @Override public String getApiKey(String provider) { return null; }
        };
    }

    /** 只有 deepseek 有 key；不受环境影响。 */
    private static WraithConfig withDeepseek() {
        WraithConfig c = new WraithConfig() {
            @Override public String getApiKey(String provider) {
                return "deepseek".equals(provider) ? "sk-test-not-real" : null;
            }
            @Override public String getModel(String provider) {
                return "deepseek".equals(provider) ? "deepseek-chat" : null;
            }
        };
        c.setDefaultProvider("deepseek");
        return c;
    }

    @Test
    @DisplayName("已有 client 时直接返回同一个实例,不重复创建")
    void reusesExistingClient() {
        LlmClient existing = com.lyhn.wraith.llm.LlmClientFactory.createFromConfig(withDeepseek());
        assertNotNull(existing, "前置条件:测试用 config 应该能造出 client");

        AtomicReference<LlmClient> ref = new AtomicReference<>(existing);
        assertSame(existing, Main.requireTaskClient(ref, noKeys()),
                "ref 里有就该直接用,连 config 都不该看");
    }

    @Test
    @DisplayName("启动时为 null、事后配好 provider → 就地装上（这正是本次修的 bug）")
    void hotInstallsAfterProviderConfigured() {
        AtomicReference<LlmClient> ref = new AtomicReference<>(null);   // 模拟「无模型启动」

        LlmClient got = Main.requireTaskClient(ref, withDeepseek());

        assertNotNull(got, "配好 provider 之后后台任务必须能拿到 client");
        assertEquals("deepseek", got.getProviderName());
    }

    @Test
    @DisplayName("装上之后写回 ref,后续任务复用同一个实例")
    void cachesIntoRef() {
        AtomicReference<LlmClient> ref = new AtomicReference<>(null);
        WraithConfig cfg = withDeepseek();

        LlmClient first = Main.requireTaskClient(ref, cfg);
        LlmClient second = Main.requireTaskClient(ref, cfg);

        assertSame(first, second, "每个任务各建一个 client 是浪费");
        assertSame(first, ref.get(), "应写回 ref");
    }

    @Test
    @DisplayName("真的没有任何模型时,抛人话而不是让 NPE 冒到面板上")
    void throwsReadableMessageWhenNoModel() {
        AtomicReference<LlmClient> ref = new AtomicReference<>(null);

        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> Main.requireTaskClient(ref, noKeys()));

        // 用户在面板上看到的就是这句,必须能照做
        assertTrue(e.getMessage().contains("尚未配置任何模型"), e.getMessage());
        assertTrue(e.getMessage().contains("Provider 配置"),
                "得指出去哪配,否则等于没说: " + e.getMessage());
        // 回归判据:绝不能再是那句谁也看不懂的 NPE
        assertFalse(e.getMessage().contains("supportsTools"), e.getMessage());
    }

    @Test
    @DisplayName("失败后不污染 ref —— 用户配好 key 再跑一次要能成功")
    void failureLeavesRefEmptySoRetryWorks() {
        AtomicReference<LlmClient> ref = new AtomicReference<>(null);

        assertThrows(IllegalStateException.class, () -> Main.requireTaskClient(ref, noKeys()));
        assertNull(ref.get(), "失败不该往 ref 里塞脏值");

        // 用户这时候去 GUI 配好了 key
        assertNotNull(Main.requireTaskClient(ref, withDeepseek()), "配完应立刻可用,不必重启后端");
    }
}
