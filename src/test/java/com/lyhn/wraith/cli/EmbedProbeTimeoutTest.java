package com.lyhn.wraith.cli;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * embedding「测试连接」的超时上限，<b>刻意与 LLM 那个不同</b>。
 *
 * <p>LLM 探测是 20 秒（{@link ProviderProbeTimeoutTest}）。embedding 不能照抄，因为
 * <b>ollama 首次请求要把模型载进内存</b>：
 * <pre>
 * 本机实测(M 系列 + NVMe):
 *   nomic-embed-text:latest  冷 0.6s / 热 0.06s
 *   bge-m3:latest            冷 2.2s / 热 0.16s
 * </pre>
 * 这机器上 20 秒绰绰有余，但那正是不该按它定的理由 —— 用户跑的是 Windows，大模型
 * （qwen3-embedding:8b 有 4.7GB）落在机械盘上，冷加载几十秒是常态。
 *
 * <p><b>取舍摆明</b>：宁可让人多等，也不要对一个<b>好的</b>后端报「没有响应」——
 * 后者会让人去改一份本来没错的配置。等待期间按钮有转圈，等是看得见的；误报不是。
 */
class EmbedProbeTimeoutTest {

    private static final String PROP = "wraith.embed.probe.timeout.seconds";

    @Test
    @DisplayName("默认 60 秒 —— 比 LLM 探测宽,因为 ollama 冷加载模型要时间")
    void defaultIsSixtySecondsAndLongerThanTheLlmProbe() {
        String previous = System.getProperty(PROP);
        System.clearProperty(PROP);
        try {
            assertEquals(60L, Main.embedProbeTimeoutSeconds());
            assertTrue(Main.embedProbeTimeoutSeconds() > Main.probeTimeoutSeconds(),
                    "embedding 探测该比 LLM 探测宽 —— 冷加载模型是 LLM ping 没有的成本");
        } finally {
            restore(previous);
        }
    }

    @Test
    @DisplayName("可用系统属性覆盖,非法值退回默认而不是让整条路挂掉")
    void overridableAndForgivingOfGarbage() {
        String previous = System.getProperty(PROP);
        try {
            System.setProperty(PROP, "120");
            assertEquals(120L, Main.embedProbeTimeoutSeconds());

            System.setProperty(PROP, "abc");
            assertEquals(60L, Main.embedProbeTimeoutSeconds());

            System.setProperty(PROP, "0");
            assertEquals(60L, Main.embedProbeTimeoutSeconds(), "0 不是合法上限");

            System.setProperty(PROP, "-5");
            assertEquals(60L, Main.embedProbeTimeoutSeconds());
        } finally {
            restore(previous);
        }
    }

    @Test
    @DisplayName("与 LLM 那个属性各走各的 —— 调宽一个不该顺手把另一个也调宽")
    void theTwoPropertiesAreIndependent() {
        String prevEmbed = System.getProperty(PROP);
        String prevLlm = System.getProperty("wraith.llm.probe.timeout.seconds");
        try {
            System.setProperty(PROP, "300");
            System.clearProperty("wraith.llm.probe.timeout.seconds");
            assertEquals(300L, Main.embedProbeTimeoutSeconds());
            assertEquals(20L, Main.probeTimeoutSeconds(), "LLM 那个不该被带着变");
        } finally {
            restore(prevEmbed);
            if (prevLlm == null) System.clearProperty("wraith.llm.probe.timeout.seconds");
            else System.setProperty("wraith.llm.probe.timeout.seconds", prevLlm);
        }
    }

    private static void restore(String previous) {
        if (previous == null) System.clearProperty(PROP);
        else System.setProperty(PROP, previous);
    }
}
