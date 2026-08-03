package com.lyhn.wraith.agent;

import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.tool.ToolRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 第六次 snapshot-vs-live：setPricingTable 只在构造 Agent 时被注入
 * （Main.java:348 交互 CLI / :1326 app-server 会话），于是用户写完 pricing 后
 * <b>本次会话的状态栏依然不显示费用，必须重启</b>。
 * 前五次：沙箱护盾、动作卡、pet 窗口、补全、web_search 的 provider 缓存。
 *
 * <p>观察面用 {@code contextStateCore().get("estimatedCost")}：
 * 未知模型时 {@code TokenUsageFormatter.estimatedCost} 返回 null（宁缺勿虚），
 * 有价时返回带币种符号的字符串。0 token 也会给出 "¥0.0000"，所以不需要跑真实对话。
 */
class PricingReloadTest {

    private static WraithConfig.PricingEntry entry(String prefix, double out) {
        WraithConfig.PricingEntry e = new WraithConfig.PricingEntry();
        e.setModelPrefix(prefix);
        e.setCacheHitPerM(1);
        e.setCacheMissPerM(1);
        e.setOutputPerM(out);
        e.setCurrency("CNY");
        return e;
    }

    @Test
    @DisplayName("reloadPricingTable 之后本次会话就能算出成本 —— 不必重启")
    void reloadMakesNewPricingEffectiveInTheSameSession(@TempDir Path tempDir) {
        ToolRegistry registry = new ToolRegistry();
        registry.setProjectPath(tempDir.toString());
        Agent agent = new Agent(new FakeClient(), registry);

        // 起点:fake-model 在种子表里没有价 ⇒ 成本缺席
        assertNull(agent.contextStateCore().get("estimatedCost"),
                "起点该是「未知模型不算成本」");

        WraithConfig config = new WraithConfig();
        config.setPricing(List.of(entry("fake-model", 42)));
        agent.reloadPricingTable(config);

        // 判别力自证:把 reloadPricingTable 的方法体注释掉,这一行变红。
        Object cost = agent.contextStateCore().get("estimatedCost");
        assertNotNull(cost, "写完 pricing 后本次会话就该能算成本 —— 第六次 snapshot-vs-live");
        assertTrue(cost.toString().startsWith("¥"), "CNY 该渲染成 ¥: " + cost);
    }

    @Test
    @DisplayName("传 null pricing 不炸,退回「无价」而不是抛异常")
    void nullPricingFallsBackToEmptyTable(@TempDir Path tempDir) {
        ToolRegistry registry = new ToolRegistry();
        registry.setProjectPath(tempDir.toString());
        Agent agent = new Agent(new FakeClient(), registry);

        WraithConfig config = new WraithConfig();
        config.setPricing(null);   // setPricing(null) 会落成空 ArrayList
        agent.reloadPricingTable(config);

        assertNull(agent.contextStateCore().get("estimatedCost"));
    }

    /** 只提供 getModelName/getProviderName 等元信息，不做真实 chat 调用。 */
    private static final class FakeClient implements LlmClient {
        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools) throws IOException {
            throw new UnsupportedOperationException("FakeClient does not perform real chat calls");
        }

        @Override
        public ChatResponse chat(List<Message> messages, List<Tool> tools, StreamListener listener)
                throws IOException {
            throw new UnsupportedOperationException("FakeClient does not perform real chat calls");
        }

        @Override
        public String getModelName() {
            return "fake-model";
        }

        @Override
        public String getProviderName() {
            return "fake";
        }

        @Override
        public int maxContextWindow() {
            return 64_000;
        }

        @Override
        public boolean supportsTools() {
            return false;
        }
    }
}
