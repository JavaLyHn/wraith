package com.lyhn.wraith.memory;

/** 待确认候选事实(不可变)。op 语义在批准时由调用方决定(ADD 或替换 nearestExistingId)。 */
public record PendingFact(
        String id,
        String fact,
        String type,
        String scope,             // "project" | "global"
        String nearestExistingId, // 最相似既有长期记忆条 id,供批准者对照;可为 null
        String sourceSessionId,
        String project,           // scope=project 时的项目 key;global 时为 null
        String createdAt          // ISO-8601 字符串
) {}
