package com.lyhn.wraith.context.curator;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;

class SpillingTruncatorTest {

    static CurationSink dirSink(Path dir) {
        return new CurationSink() {
            @Override public Optional<Path> writeToolLog(String tool, CharSequence content) {
                try {
                    Path p = dir.resolve(tool + "-" + System.nanoTime() + ".log");
                    Files.writeString(p, content);
                    return Optional.of(p);
                } catch (Exception e) { return Optional.empty(); }
            }
            @Override public void appendMetrics(String jsonLine) {}
        };
    }

    @Test
    void underLimitPassesThrough(@TempDir Path dir) {
        assertEquals("short", SpillingTruncator.truncateWithSpill(dirSink(dir), "grep_code", "short", 100));
    }

    @Test
    void overLimitSpillsFullAndAppendsPointer(@TempDir Path dir) throws Exception {
        String full = "x".repeat(500);
        String out = SpillingTruncator.truncateWithSpill(dirSink(dir), "grep_code", full, 100);
        assertTrue(out.startsWith("x".repeat(100)));
        assertTrue(out.contains(CurationMarks.LOG_POINTER_PREFIX));
        // 指针指向的文件内容 = 全量
        String path = out.substring(out.indexOf(CurationMarks.LOG_POINTER_PREFIX)
                + CurationMarks.LOG_POINTER_PREFIX.length(), out.lastIndexOf(']'));
        assertEquals(full, Files.readString(Path.of(path)));
    }

    @Test
    void spillFailureDegradesToPlainTruncation(@TempDir Path dir) {
        CurationSink broken = new CurationSink() {
            @Override public Optional<Path> writeToolLog(String t, CharSequence c) { return Optional.empty(); }
            @Override public void appendMetrics(String j) {}
        };
        String out = SpillingTruncator.truncateWithSpill(broken, "grep_code", "x".repeat(500), 100);
        assertFalse(out.contains(CurationMarks.LOG_POINTER_PREFIX));
        assertTrue(out.contains("(输出已截断)"));
    }
}
