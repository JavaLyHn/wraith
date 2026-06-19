package com.lyhn.wraith.tool.todo;

import java.util.Locale;

/** 任务状态:待办 / 进行中 / 已完成。 */
public enum TodoStatus {
    PENDING,
    IN_PROGRESS,
    COMPLETED;

    /** 容错解析 LLM 传来的状态串;无法识别时按待办处理。 */
    public static TodoStatus fromWire(String s) {
        if (s == null) {
            return PENDING;
        }
        return switch (s.trim().toLowerCase(Locale.ROOT)) {
            case "in_progress", "in-progress", "inprogress", "doing", "active", "running" -> IN_PROGRESS;
            case "completed", "complete", "done", "finished" -> COMPLETED;
            default -> PENDING;
        };
    }
}
