package com.lyhn.wraith.automation;

import org.junit.jupiter.api.Test;
import java.time.*;
import static org.junit.jupiter.api.Assertions.*;

class NextRunTest {
    private static long epoch(int y,int mo,int d,int h,int mi) {
        return ZonedDateTime.of(y,mo,d,h,mi,0,0, ZoneId.systemDefault()).toInstant().toEpochMilli();
    }
    private static Schedule interval(int m){ Schedule s=new Schedule(); s.kind=ScheduleKind.INTERVAL; s.everyMinutes=m; return s; }
    private static Schedule daily(String t){ Schedule s=new Schedule(); s.kind=ScheduleKind.DAILY; s.time=t; return s; }
    private static Schedule weekly(int wd,String t){ Schedule s=new Schedule(); s.kind=ScheduleKind.WEEKLY; s.weekday=wd; s.time=t; return s; }
    private static Schedule cron(String e){ Schedule s=new Schedule(); s.kind=ScheduleKind.CRON; s.expr=e; return s; }

    @Test void intervalIsSingleStepFromAnchor() {
        long now = epoch(2026,7,5,12,0);
        assertEquals(now + 5*60_000L, NextRun.computeNextRun(interval(5), now, now, now));   // lastFired 锚点
        assertEquals(now + 5*60_000L, NextRun.computeNextRun(interval(5), now, null, now));  // 无 lastFired → enabledAt
    }

    @Test void dailyWithinGraceReturnsToday_elsePushesTomorrow() {
        long today9 = epoch(2026,7,5,9,0);
        long now = today9 + 30_000;                              // 9:00:30,宽限窗内
        assertEquals(today9, NextRun.computeNextRun(daily("09:00"), now, null, today9-1));
        long late = today9 + 120_000;                            // 9:02,超 90s 宽限 → 明天
        assertEquals(today9 + 24*3_600_000L, NextRun.computeNextRun(daily("09:00"), late, null, today9-1));
        // 本时刻已触发过 → 明天
        assertEquals(today9 + 24*3_600_000L, NextRun.computeNextRun(daily("09:00"), today9+10_000, today9, today9-1));
    }

    @Test void weeklyPicksNextWeekdayOccurrence() {
        // 2026-07-05 是周日(getDay=0)。目标 weekday=3(周三)→ 本周三 7-08。
        long sundayNoon = epoch(2026,7,5,12,0);
        long wed10 = epoch(2026,7,8,10,0);
        assertEquals(wed10, NextRun.computeNextRun(weekly(3,"10:00"), sundayNoon, null, sundayNoon));
    }

    @Test void weeklyAlreadyFiredPushesSevenDays() {
        // 2026-07-08 周三 10:00 目标时间，lastFiredAt >= 该时间 → 推至次周三 7-15
        long wed10 = epoch(2026,7,8,10,0);
        long wed11 = epoch(2026,7,8,11,0);      // 11分钟后
        long nextWed10 = epoch(2026,7,15,10,0);
        assertEquals(nextWed10, NextRun.computeNextRun(weekly(3,"10:00"), wed11, wed10, wed10));
    }

    @Test void weeklyOverdueByondGracePushesSevenDays() {
        // 周三 10:00 目标，当前时间已超过 90s 宽限 → 推至次周三
        long wed10 = epoch(2026,7,8,10,0);
        long wed1035 = wed10 + 120_000;         // 10:02,超宽限
        long nextWed10 = epoch(2026,7,15,10,0);
        assertEquals(nextWed10, NextRun.computeNextRun(weekly(3,"10:00"), wed1035, null, wed10-1));
    }

    @Test void isValidCronNullAndBlank() {
        assertFalse(NextRun.isValidCron(null));
        assertFalse(NextRun.isValidCron("   "));
    }

    @Test void cronNextAfterNow() {
        long now = epoch(2026,7,6,8,0);       // 周一 08:00
        long expect = epoch(2026,7,6,9,0);    // 0 9 * * 1-5 → 当天 09:00
        assertEquals(expect, NextRun.computeNextRun(cron("0 9 * * 1-5"), now, null, now));
    }

    @Test void cronValidation() {
        assertTrue(NextRun.isValidCron("0 9 * * 1-5"));
        assertTrue(NextRun.isValidCron("*/5 * * * *"));
        assertFalse(NextRun.isValidCron("not a cron"));
        assertFalse(NextRun.isValidCron("0 9 * *"));   // 段数不足
    }
}
