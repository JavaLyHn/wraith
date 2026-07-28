package com.lyhn.wraith.memory;

import java.util.regex.Pattern;

/** 敏感/凭证判定:所有写入长期记忆的路径共用的咽喉点检查。 */
public final class MemorySafety {
    // 与原 MemoryExtractionService 的 SENSITIVE 一致:凭证前缀 + 中文"密码/密钥/口令/令牌 值赋值"。
    private static final Pattern SENSITIVE = Pattern.compile(
            "(?i)(sk-[a-z0-9]{6,}|password\\s*=|passwd\\s*=|api[\\s_-]?key|secret|token\\s*[:=]|-----BEGIN|(密码|密钥|口令|令牌)\\s*(是|为|[:：=]))");

    private MemorySafety() {}

    public static boolean isSensitive(String text) {
        return text != null && SENSITIVE.matcher(text).find();
    }
}
