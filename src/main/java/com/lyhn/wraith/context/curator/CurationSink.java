package com.lyhn.wraith.context.curator;

import java.nio.file.Path;
import java.util.Optional;

/** 治理产物的落地通道:工具全量日志 + metrics JSONL。实现须自行吞异常(治理不许拖垮主循环)。 */
public interface CurationSink {
    Optional<Path> writeToolLog(String tool, CharSequence content);
    void appendMetrics(String jsonLine);

    CurationSink NOOP = new CurationSink() {
        @Override public Optional<Path> writeToolLog(String tool, CharSequence content) { return Optional.empty(); }
        @Override public void appendMetrics(String jsonLine) {}
    };
}
