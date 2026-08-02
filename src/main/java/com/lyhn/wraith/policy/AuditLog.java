package com.lyhn.wraith.policy;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.browser.BrowserAuditMetadata;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Locale;

/**
 * 危险工具调用的结构化审计日志。
 *
 * 落盘策略：
 * - 一行一条 JSON（JSONL 格式），按天分文件 audit-YYYY-MM-DD.jsonl
 * - 默认目录 ~/.wraith/audit，可通过 -Dwraith.audit.dir 或 WRAITH_AUDIT_DIR 覆盖
 * - 写入失败只在 stderr 提示，不抛出，避免审计故障影响主流程
 *
 * 设计意图：
 * - 把 Agent 的"实际副作用"变成可回放的事实流
 * - 行为评估、差错复盘、监控告警的统一数据源
 *
 * 接入点：
 * - {@code allow}：危险工具执行成功
 * - {@code deny}：被 HITL 拒绝 / 跳过，或被策略层拦截
 * - {@code error}：工具执行抛异常或超时
 */
public class AuditLog {

    public static final String APPROVER_HITL = "hitl";
    public static final String APPROVER_POLICY = "policy";
    public static final String APPROVER_NONE = "none";
    public static final String APPROVER_MENTION = "mention";

    public static final String OUTCOME_ALLOW = "allow";
    public static final String OUTCOME_DENY = "deny";
    public static final String OUTCOME_ERROR = "error";

    private static final ObjectMapper mapper = new ObjectMapper();
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT);
    private static final int MAX_FIELD_CHARS = 1000;

    private final Path auditDir;
    private final Object writeLock = new Object();

    public AuditLog() {
        this(defaultAuditDir());
    }

    public AuditLog(Path auditDir) {
        this.auditDir = auditDir;
    }

    public Path getAuditDir() {
        return auditDir;
    }

    public void record(AuditEntry entry) {
        if (entry == null) return;
        try {
            synchronized (writeLock) {
                Files.createDirectories(auditDir);
                Path file = todayFile();
                String json = mapper.writeValueAsString(entry);
                Files.writeString(file, json + System.lineSeparator(),
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            }
        } catch (IOException e) {
            // 审计失败不能影响主流程
            System.err.println("⚠️ 审计日志写入失败: " + e.getMessage());
        }
    }

    /**
     * 最近 n 条审计记录，按时间升序（最旧在前，与面板的渲染顺序一致）。
     *
     * <p>**跨天读**:审计按天一个文件，早先这里只打开今天那一个 —— 昨天的记录就在隔壁却永远看不到，
     * 且一过午夜面板就空了，看起来像"从来没发生过任何事"。而审计的用途正是"回头查什么危险操作跑过"，
     * 按自然日切断没有道理。故从今天往回逐日翻，凑够 n 条即停。
     *
     * <p>回溯有上限({@code -Dwraith.audit.lookbackDays}，默认 30):没有上限的话，一个跑了两年的
     * 目录每次刷新都要 stat 七百多个文件；而中间某天没文件只是那天没危险调用，不能当作终点。
     */
    public List<AuditEntry> readRecent(int n) {
        if (n <= 0) return List.of();
        Deque<AuditEntry> newestFirst = new ArrayDeque<>();
        LocalDate day = LocalDate.now();
        for (int back = 0; back < lookbackDays() && newestFirst.size() < n; back++, day = day.minusDays(1)) {
            readDayInto(fileFor(day), n, newestFirst);
        }
        return new ArrayList<>(newestFirst);
    }

    /** 把某一天的记录从后往前塞进 acc 的头部，凑够 limit 即停。文件不存在/读坏都当成"这天没有"。 */
    private void readDayInto(Path file, int limit, Deque<AuditEntry> acc) {
        if (!Files.exists(file)) return;
        List<String> lines;
        try {
            lines = Files.readAllLines(file);
        } catch (IOException e) {
            return;
        }
        for (int i = lines.size() - 1; i >= 0 && acc.size() < limit; i--) {
            String line = lines.get(i);
            if (line.isBlank()) continue;
            try {
                acc.addFirst(mapper.readValue(line, new TypeReference<AuditEntry>() {}));
            } catch (Exception ignored) {
                // 单行格式错误跳过，不影响其他记录
            }
        }
    }

    private static int lookbackDays() {
        return Math.max(1, Integer.getInteger("wraith.audit.lookbackDays", 30));
    }

    private Path fileFor(LocalDate day) {
        return auditDir.resolve("audit-" + day.format(DATE_FMT) + ".jsonl");
    }

    private Path todayFile() {
        return fileFor(LocalDate.now());
    }

    private static Path defaultAuditDir() {
        String prop = System.getProperty("wraith.audit.dir");
        if (prop != null && !prop.isBlank()) {
            return Path.of(prop);
        }
        String env = System.getenv("WRAITH_AUDIT_DIR");
        if (env != null && !env.isBlank()) {
            return Path.of(env);
        }
        return Path.of(System.getProperty("user.home"), ".wraith", "audit");
    }

    private static String truncate(String s) {
        if (s == null) return null;
        String sanitized = sanitize(s);
        return sanitized.length() <= MAX_FIELD_CHARS ? sanitized : sanitized.substring(0, MAX_FIELD_CHARS) + "...(truncated)";
    }

    static String sanitize(String s) {
        if (s == null) return null;
        String sanitized = s.replaceAll("(?i)Bearer\\s+[^\\s\"'}]+", "Bearer ***");
        sanitized = sanitized.replaceAll(
                "(?i)(\"?(?:token|key|password|secret|authorization)\"?\\s*[:=]\\s*\")([^\"]+)(\")",
                "$1***$3");
        sanitized = sanitized.replaceAll(
                "(?i)(\\b(?:token|key|password|secret|authorization)\\b\\s*[:=]\\s*)([^\\s,}]+)",
                "$1***");
        return sanitized;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record AuditEntry(
            String timestamp,
            String tool,
            String args,
            String outcome,
            String reason,
            String approver,
            long durationMs,
            BrowserAuditMetadata metadata
    ) {
        public static AuditEntry allow(String tool, String args, long durationMs) {
            return new AuditEntry(Instant.now().toString(), tool, truncate(args),
                    OUTCOME_ALLOW, null, APPROVER_NONE, durationMs, null);
        }

        public static AuditEntry allow(String tool, String args, long durationMs, BrowserAuditMetadata metadata) {
            return new AuditEntry(Instant.now().toString(), tool, truncate(args),
                    OUTCOME_ALLOW, null, APPROVER_NONE, durationMs, metadata);
        }

        public static AuditEntry allowByMention(String tool, String args, long durationMs) {
            return new AuditEntry(Instant.now().toString(), tool, truncate(args),
                    OUTCOME_ALLOW, null, APPROVER_MENTION, durationMs, null);
        }

        public static AuditEntry denyByHitl(String tool, String args, String reason, long durationMs) {
            return new AuditEntry(Instant.now().toString(), tool, truncate(args),
                    OUTCOME_DENY, reason, APPROVER_HITL, durationMs, null);
        }

        public static AuditEntry denyByPolicy(String tool, String args, String reason, long durationMs) {
            return new AuditEntry(Instant.now().toString(), tool, truncate(args),
                    OUTCOME_DENY, reason, APPROVER_POLICY, durationMs, null);
        }

        public static AuditEntry denyByPolicy(String tool, String args, String reason, long durationMs,
                                              BrowserAuditMetadata metadata) {
            return new AuditEntry(Instant.now().toString(), tool, truncate(args),
                    OUTCOME_DENY, reason, APPROVER_POLICY, durationMs, metadata);
        }

        public static AuditEntry error(String tool, String args, String reason, long durationMs) {
            return new AuditEntry(Instant.now().toString(), tool, truncate(args),
                    OUTCOME_ERROR, reason, APPROVER_NONE, durationMs, null);
        }

        public static AuditEntry error(String tool, String args, String reason, long durationMs,
                                       BrowserAuditMetadata metadata) {
            return new AuditEntry(Instant.now().toString(), tool, truncate(args),
                    OUTCOME_ERROR, reason, APPROVER_NONE, durationMs, metadata);
        }
    }
}
