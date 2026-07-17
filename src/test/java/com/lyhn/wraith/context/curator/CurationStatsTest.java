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
        stats.recordUsage(1000, 200, 300, new WatermarkGauge.Reading(1000, 10_000, 0.10, 0));
        stats.recordCompaction(1, 9000, 6000, 3, 0, false, 12);

        assertEquals(2, lines.size());
        assertTrue(lines.get(0).contains("\"inputTokens\":1000"));
        assertTrue(lines.get(0).contains("\"cachedInputTokens\":300"));
        assertTrue(lines.get(1).contains("\"tier\":1"));
        assertEquals(3000, stats.totalSavedEst());
        assertEquals(3, stats.totalSnipped());
        assertEquals(1, stats.compactions());
    }
}
