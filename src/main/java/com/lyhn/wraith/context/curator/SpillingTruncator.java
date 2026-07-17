package com.lyhn.wraith.context.curator;

import java.nio.file.Path;
import java.util.Optional;

/** 入口截断 + 全量落盘:被截 ≠ 丢——截断版尾部附完整日志指针(spec §3)。 */
public final class SpillingTruncator {
    /** spill 内容上限 2MB 字符,防内存/磁盘失控。 */
    public static final int SPILL_MAX_CHARS = 2_097_152;

    private SpillingTruncator() {}

    public static String truncateWithSpill(CurationSink sink, String tool, String full, int maxChars) {
        if (full == null || full.length() <= maxChars) return full;
        String toSpill = full.length() > SPILL_MAX_CHARS
                ? full.substring(0, SPILL_MAX_CHARS) + "\n...(spill 上限 2MB,其余丢弃)"
                : full;
        Optional<Path> logged = sink.writeToolLog(tool, toSpill);
        String base = full.substring(0, maxChars) + "\n...(输出已截断)";
        return logged.map(p -> base + "\n" + CurationMarks.LOG_POINTER_PREFIX + p + "]").orElse(base);
    }
}
