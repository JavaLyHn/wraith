package com.lyhn.wraith.context.curator;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WatermarkGaugeTest {
    private WatermarkGauge gauge(long window) { return new WatermarkGauge(() -> window); }

    @Test
    void fallsBackToEstimateBeforeFirstRealUsage() {
        WatermarkGauge g = gauge(100_000);
        WatermarkGauge.Reading r = g.read("m", 30_000);
        assertEquals(30_000, r.usedTokens());
        assertEquals(0, r.tier());
    }

    @Test
    void realUsageAnchorsAndEstimateTracksDelta() {
        WatermarkGauge g = gauge(100_000);
        g.onRealUsage("m", 70_000, 40_000);          // 真实 70k,当时估算 40k(估算低估)
        WatermarkGauge.Reading r = g.read("m", 45_000); // 又新增估算 5k
        assertEquals(75_000, r.usedTokens());      // 70k + (45k-40k)
        assertEquals(1, r.tier());                 // 75% → Tier1(≥60 <80)
    }

    @Test
    void tierBoundaries() {
        WatermarkGauge g = gauge(100_000);
        assertEquals(0, g.read("m", 59_999).tier());
        assertEquals(1, g.read("m", 60_000).tier());
        assertEquals(2, g.read("m", 80_000).tier());
        assertEquals(3, g.read("m", 95_000).tier());
    }

    @Test
    void tokensToReleaseTargetsFiftyPercent() {
        WatermarkGauge g = gauge(100_000);
        WatermarkGauge.Reading r = g.read("m", 72_000);
        assertEquals(22_000, g.tokensToRelease(r)); // 72k − 50k
        assertEquals(0, g.tokensToRelease(g.read("m", 40_000)));
    }

    @Test
    void resetClearsAnchorAndFallsBackToEstimate() {
        WatermarkGauge g = gauge(100_000);
        g.onRealUsage("m", 90_000, 50_000);
        assertEquals(90_000, g.read("m", 50_000).usedTokens());   // 锚定生效
        g.reset();
        WatermarkGauge.Reading r = g.read("m", 30_000);
        assertEquals(30_000, r.usedTokens(), "reset 后应回退纯估算,不再受旧会话锚点影响");
        assertEquals(0, r.tier());
    }

    @Test
    void anchorInvalidatesOnModelSwitch() {
        WatermarkGauge g = new WatermarkGauge(() -> 100_000);
        g.onRealUsage("deepseek-chat", 90_000, 50_000);   // 旧模型锚:真实 90k
        // 切到新模型:锚点失效,只能用估算 → used=估算值而非 90k+diff
        WatermarkGauge.Reading r = g.read("kimi-k2", 30_000);
        assertEquals(30_000, r.usedTokens());
        // 切回旧模型:锚仍有效
        WatermarkGauge.Reading back = g.read("deepseek-chat", 50_000);
        assertEquals(90_000, back.usedTokens());
    }

    @Test
    void tierOfBoundaries() {
        // tier 判定单一来源(BottomStatusBar/ContextStateAggregator 均经此):边界精确
        assertEquals(0, WatermarkGauge.tierOf(0.599));
        assertEquals(1, WatermarkGauge.tierOf(0.60));   // TIER1
        assertEquals(1, WatermarkGauge.tierOf(0.799));
        assertEquals(2, WatermarkGauge.tierOf(0.80));   // TIER2
        assertEquals(2, WatermarkGauge.tierOf(0.949));
        assertEquals(3, WatermarkGauge.tierOf(0.95));   // TIER3
        assertEquals(3, WatermarkGauge.tierOf(1.5));
        // 与常量口径一致(阈值改动时此测随常量走,不写死字面量)
        assertEquals(1, WatermarkGauge.tierOf(WatermarkGauge.TIER1));
        assertEquals(2, WatermarkGauge.tierOf(WatermarkGauge.TIER2));
        assertEquals(3, WatermarkGauge.tierOf(WatermarkGauge.TIER3));
    }
}
