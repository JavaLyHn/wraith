package com.lyhn.wraith.automation;

public class Schedule {
    public ScheduleKind kind;
    public Integer everyMinutes;   // INTERVAL
    public String time;            // DAILY/WEEKLY 'HH:mm'
    public Integer weekday;        // WEEKLY 0-6,周日=0
    public String expr;            // CRON 标准 5 段
}
