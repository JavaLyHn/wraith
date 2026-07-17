package com.lyhn.wraith.session;

import com.lyhn.wraith.context.curator.CurationSink;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

/** 会话作用域的治理落地:日志/metrics 都写进当前会话的 -artifacts 目录;一切失败静默降级。 */
public final class SessionCurationSink implements CurationSink {
    private final SessionStore store;
    private final AtomicLong seq = new AtomicLong();

    public SessionCurationSink(SessionStore store) { this.store = store; }

    @Override
    public Optional<Path> writeToolLog(String tool, CharSequence content) {
        try {
            Optional<Path> dir = store.artifactDir();
            if (dir.isEmpty()) return Optional.empty();
            String safeTool = tool == null ? "tool" : tool.replaceAll("[^a-zA-Z0-9_-]", "_");
            Path p = dir.get().resolve(seq.incrementAndGet() + "-" + safeTool + ".log");
            Files.writeString(p, content);
            return Optional.of(p);
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    @Override
    public void appendMetrics(String jsonLine) {
        try {
            Optional<Path> dir = store.artifactDir();
            if (dir.isEmpty()) return;
            Files.writeString(dir.get().resolve("context-metrics.jsonl"), jsonLine + "\n",
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (Exception ignored) {
        }
    }
}
