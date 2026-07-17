package com.lyhn.wraith.session;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;

class SessionCurationSinkTest {

    @Test
    void writesLogAndMetricsUnderArtifactDir(@TempDir Path home) throws Exception {
        // SessionStore.open(home, projectPath, provider, model) 是实际工厂签名
        SessionStore store = SessionStore.open(home, "/tmp/proj", "", "");
        // beginTurn 产生 currentId(startNew 只清空);传入任意非空用户消息
        store.beginTurn("x");
        SessionCurationSink sink = new SessionCurationSink(store);
        Path log = sink.writeToolLog("grep_code", "FULL").orElseThrow();
        assertEquals("FULL", Files.readString(log));
        sink.appendMetrics("{\"a\":1}");
        Path metrics = log.getParent().resolve("context-metrics.jsonl");
        assertTrue(Files.readString(metrics).contains("{\"a\":1}"));
    }

    @Test
    void noSessionMeansNoop(@TempDir Path home) {
        // SessionStore.open + 不调用 beginTurn/persist → currentId 为 null
        SessionStore store = SessionStore.open(home, "/tmp/proj", "", "");
        SessionCurationSink sink = new SessionCurationSink(store);
        assertTrue(sink.writeToolLog("t", "x").isEmpty());  // 无 currentId → empty,不抛
    }
}
