package com.lyhn.wraith.context.curator;

import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class CurationStatsTest {

    @Test
    void writesUsageAndCompactionLinesAndAccumulates() {
        List<String> lines = new ArrayList<>();
        CurationSink sink = new CurationSink() {
            @Override public Optional<Path> writeToolLog(String t, CharSequence c) { return Optional.empty(); }
            @Override public void appendMetrics(String j) { lines.add(j); }
        };
        CurationStats stats = new CurationStats(sink);
        stats.recordUsage(1000, 200, 300, new WatermarkGauge.Reading(1000, 10_000, 0.10, 0), null, null);
        stats.recordCompaction(1, 9000, 6000, 3, 0, false, 12);

        assertEquals(2, lines.size());
        assertTrue(lines.get(0).contains("\"inputTokens\":1000"));
        assertTrue(lines.get(0).contains("\"cachedInputTokens\":300"));
        assertTrue(lines.get(1).contains("\"tier\":1"));
        assertEquals(3000, stats.totalSavedEst());
        assertEquals(3, stats.totalSnipped());
        assertEquals(1, stats.compactions());
    }

    @Test
    void usageLineCarriesCostOnlyWhenKnown() {
        List<String> lines = new ArrayList<>();
        CurationSink sink = new CurationSink() {
            @Override public Optional<Path> writeToolLog(String t, CharSequence c) { return Optional.empty(); }
            @Override public void appendMetrics(String j) { lines.add(j); }
        };
        CurationStats s = new CurationStats(sink);
        WatermarkGauge.Reading r = new WatermarkGauge.Reading(100, 1000, 0.1, 0);
        s.recordUsage(100, 50, 20, r, 0.1234, "CNY");
        s.recordUsage(100, 50, 20, r, null, null);
        assertTrue(lines.get(0).contains("\"cost\":0.123400") && lines.get(0).contains("\"currency\":\"CNY\""));
        assertFalse(lines.get(1).contains("cost"), "未知价格的行绝不写 cost 键");
        assertEquals(200, s.totalInput());
        assertEquals(100, s.totalOutput());
        assertEquals(40, s.totalCached());
    }
}
