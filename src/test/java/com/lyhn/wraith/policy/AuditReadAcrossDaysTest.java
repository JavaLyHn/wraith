package com.lyhn.wraith.policy;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 审计按天一个 audit-YYYY-MM-DD.jsonl,而 readRecent 原来只打开**今天**那一个 ——
 * 昨天的记录就在隔壁文件里却永远看不到,且一过午夜面板就空了,看起来像"从来没发生过任何事"。
 * 审计的用途正是"回头查什么危险操作跑过",按自然日切断没有道理:昨晚跑的 rm -rf 恰恰是
 * 今天最想看见的。面板行里的时间本来就带 MM-DD 前缀(formatAuditTime),说明显示端一直是按跨天设计的。
 */
class AuditReadAcrossDaysTest {

    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT);

    /** 直接往某一天的文件里塞记录 —— record() 只会写今天,造不出历史。 */
    private static void seed(Path dir, LocalDate day, String... tools) throws Exception {
        Files.createDirectories(dir);
        StringBuilder sb = new StringBuilder();
        for (String t : tools) {
            sb.append("{\"timestamp\":\"").append(day).append("T10:00:00Z\",\"tool\":\"").append(t)
              .append("\",\"args\":\"{}\",\"outcome\":\"allow\",\"reason\":null,\"approver\":\"none\",\"durationMs\":1}")
              .append(System.lineSeparator());
        }
        Files.writeString(dir.resolve("audit-" + day.format(FMT) + ".jsonl"), sb.toString());
    }

    private static List<String> tools(List<AuditLog.AuditEntry> entries) {
        return entries.stream().map(AuditLog.AuditEntry::tool).toList();
    }

    @Test
    void readsYesterdayWhenTodayHasNothing(@TempDir Path dir) throws Exception {
        Path audit = dir.resolve("audit");
        seed(audit, LocalDate.now().minusDays(1), "execute_command");

        List<AuditLog.AuditEntry> got = new AuditLog(audit).readRecent(20);
        assertFalse(got.isEmpty(), "今天没记录就返回空 —— 昨天的记录被无视了(过了午夜面板即清零)");
        assertEquals(List.of("execute_command"), tools(got));
    }

    @Test
    void fillsUpToNAcrossDaysNewestDayFirst(@TempDir Path dir) throws Exception {
        Path audit = dir.resolve("audit");
        seed(audit, LocalDate.now().minusDays(2), "d2a", "d2b");
        seed(audit, LocalDate.now().minusDays(1), "d1a", "d1b");
        seed(audit, LocalDate.now(), "d0a");

        // 要 4 条:今天 1 条 + 昨天 2 条 + 前天最后 1 条
        List<String> got = tools(new AuditLog(audit).readRecent(4));
        assertEquals(4, got.size(), "没凑够 n 条:" + got);
        // 顺序保持时间升序(与原实现一致,面板按返回顺序渲染,不改它的阅读方向)
        assertEquals(List.of("d2b", "d1a", "d1b", "d0a"), got, "跨天拼接的顺序错了:" + got);
    }

    @Test
    void staysWithinTodayWhenTodayAlreadyHasEnough(@TempDir Path dir) throws Exception {
        Path audit = dir.resolve("audit");
        seed(audit, LocalDate.now().minusDays(1), "old1", "old2");
        seed(audit, LocalDate.now(), "new1", "new2", "new3");

        assertEquals(List.of("new2", "new3"), tools(new AuditLog(audit).readRecent(2)),
                "今天就够 n 条时不该再往回翻");
    }

    @Test
    void skipsMissingDaysInTheMiddle(@TempDir Path dir) throws Exception {
        Path audit = dir.resolve("audit");
        seed(audit, LocalDate.now().minusDays(5), "old");   // 中间隔了 4 个没有文件的日子
        assertEquals(List.of("old"), tools(new AuditLog(audit).readRecent(20)),
                "中间断档就停下了 —— 不该把缺文件当成回溯终点");
    }

    @Test
    void doesNotScanForever(@TempDir Path dir) throws Exception {
        Path audit = dir.resolve("audit");
        Files.createDirectories(audit);
        // 回溯窗口之外的记录不返回:否则一个跑了两年的目录每次都要 stat 七百多个文件
        seed(audit, LocalDate.now().minusDays(400), "ancient");
        assertTrue(new AuditLog(audit).readRecent(20).isEmpty(), "回溯没有上限");
    }

    @Test
    void emptyDirIsEmptyNotAnError(@TempDir Path dir) {
        assertTrue(new AuditLog(dir.resolve("nope")).readRecent(20).isEmpty());
    }
}
