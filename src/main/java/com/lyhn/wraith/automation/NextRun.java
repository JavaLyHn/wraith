package com.lyhn.wraith.automation;

import com.cronutils.model.CronType;
import com.cronutils.model.definition.CronDefinitionBuilder;
import com.cronutils.model.time.ExecutionTime;
import com.cronutils.parser.CronParser;

import java.time.*;

/** 下次触发计算,严格对齐 desktop/src/main/automationSchedule.ts(GRACE_MS=90s;interval 单步;daily/weekly 宽限窗)。 */
public final class NextRun {
    private static final long GRACE_MS = 90_000L;
    private static final CronParser CRON =
            new CronParser(CronDefinitionBuilder.instanceDefinitionFor(CronType.UNIX));

    private NextRun() {}

    public static long computeNextRun(Schedule s, long now, Long lastFiredAt, long enabledAt) {
        switch (s.kind) {
            case INTERVAL: {
                long anchor = (lastFiredAt != null) ? lastFiredAt : enabledAt;
                return anchor + s.everyMinutes * 60_000L;
            }
            case DAILY: {
                long t = atTimeOnDate(now, /*deltaDays*/0, s.time);
                if ((lastFiredAt != null && lastFiredAt >= t) || t < now - GRACE_MS) t += 24L * 3_600_000L;
                return t;
            }
            case WEEKLY: {
                ZonedDateTime base = Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault());
                int jsDow = base.getDayOfWeek().getValue() % 7;      // Mon=1..Sat=6,Sun=0(对齐 JS getDay)
                int delta = (s.weekday - jsDow + 7) % 7;
                long t = atTimeOnDate(now, delta, s.time);
                if ((lastFiredAt != null && lastFiredAt >= t) || t < now - GRACE_MS) t += 7L * 24L * 3_600_000L;
                return t;
            }
            case CRON: {
                ZonedDateTime from = Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault());
                return ExecutionTime.forCron(CRON.parse(s.expr)).nextExecution(from)
                        .map(z -> z.toInstant().toEpochMilli()).orElse(Long.MAX_VALUE);
            }
        }
        throw new IllegalStateException("unknown ScheduleKind: " + s.kind);
    }

    public static boolean isValidCron(String expr) {
        if (expr == null || expr.isBlank()) return false;
        try { CRON.parse(expr).validate(); return true; }
        catch (RuntimeException e) { return false; }
    }

    /** now 所在日期 + deltaDays 天的 HH:mm(本机时区),秒/纳秒清零 → epoch ms。 */
    private static long atTimeOnDate(long now, int deltaDays, String hhmm) {
        String[] p = hhmm.split(":");
        int h = Integer.parseInt(p[0]), mi = Integer.parseInt(p[1]);
        ZonedDateTime base = Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault());
        ZonedDateTime at = base.toLocalDate().plusDays(deltaDays)
                .atTime(h, mi).atZone(ZoneId.systemDefault());
        return at.toInstant().toEpochMilli();
    }
}
