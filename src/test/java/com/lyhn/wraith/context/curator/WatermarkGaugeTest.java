package com.lyhn.wraith.context.curator;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WatermarkGaugeTest {
    private WatermarkGauge gauge(long window) { return new WatermarkGauge(() -> window); }

    @Test
    void fallsBackToEstimateBeforeFirstRealUsage() {
        WatermarkGauge g = gauge(100_000);
        WatermarkGauge.Reading r = g.read(30_000);
        assertEquals(30_000, r.usedTokens());
        assertEquals(0, r.tier());
    }

    @Test
    void realUsageAnchorsAndEstimateTracksDelta() {
        WatermarkGauge g = gauge(100_000);
        g.onRealUsage(70_000, 40_000);          // 真实 70k,当时估算 40k(估算低估)
        WatermarkGauge.Reading r = g.read(45_000); // 又新增估算 5k
        assertEquals(75_000, r.usedTokens());      // 70k + (45k-40k)
        assertEquals(1, r.tier());                 // 75% → Tier1(≥60 <80)
    }

    @Test
    void tierBoundaries() {
        WatermarkGauge g = gauge(100_000);
        assertEquals(0, g.read(59_999).tier());
        assertEquals(1, g.read(60_000).tier());
        assertEquals(2, g.read(80_000).tier());
        assertEquals(3, g.read(95_000).tier());
    }

    @Test
    void tokensToReleaseTargetsFiftyPercent() {
        WatermarkGauge g = gauge(100_000);
        WatermarkGauge.Reading r = g.read(72_000);
        assertEquals(22_000, g.tokensToRelease(r)); // 72k − 50k
        assertEquals(0, g.tokensToRelease(g.read(40_000)));
    }
}
