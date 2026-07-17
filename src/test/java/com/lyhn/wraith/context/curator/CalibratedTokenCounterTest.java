package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.memory.TokenBudget;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class CalibratedTokenCounterTest {

    @Test
    void convergesTowardRealDensity() {
        CalibratedTokenCounter c = new CalibratedTokenCounter();
        List<Message> h = List.of(Message.user("中英 mixed content 一段话"));
        long raw = TokenBudget.estimateMessagesTokens(h);
        // 真实一直是估算的 1.5 倍 → 系数应向 1.5 收敛
        for (int i = 0; i < 20; i++) c.calibrate("deepseek-chat", Math.round(raw * 1.5), raw);
        assertEquals(1.5, c.factor("deepseek-chat"), 0.1);
        assertEquals(Math.round(raw * c.factor("deepseek-chat")), c.estimate("deepseek-chat", h));
    }

    @Test
    void modelsAreIsolated() {
        CalibratedTokenCounter c = new CalibratedTokenCounter();
        for (int i = 0; i < 20; i++) c.calibrate("deepseek-chat", 300, 100);
        assertEquals(1.0, c.factor("kimi-k2"), 1e-9, "未校准模型必须保持初始系数");
    }

    @Test
    void clampsAbsurdObservations() {
        CalibratedTokenCounter c = new CalibratedTokenCounter();
        for (int i = 0; i < 50; i++) c.calibrate("m", 100_000, 1); // 观测比 10万,须被钳制
        assertTrue(c.factor("m") <= 3.0);
        c.calibrate("m2", 0, 100);   // 非法输入忽略
        c.calibrate("m3", 100, 0);
        assertEquals(1.0, c.factor("m2"), 1e-9);
        assertEquals(1.0, c.factor("m3"), 1e-9);
    }
}
