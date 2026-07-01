package com.lyhn.wraith.tool;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class ToolRegistryCommandStreamingTest {

    record Chunk(String callId, String stream, String text) {}

    @Test
    void executeCommandStreamsPerLineChunksAndResultTaggedWithCallId() {
        ToolRegistry reg = new ToolRegistry();
        List<Chunk> chunks = new CopyOnWriteArrayList<>();
        AtomicReference<String> resultCallId = new AtomicReference<>();
        AtomicReference<Boolean> resultOk = new AtomicReference<>();
        AtomicReference<Integer> resultExit = new AtomicReference<>();

        reg.setCommandOutputObserver(new ToolRegistry.CommandOutputObserver() {
            public void onChunk(String callId, String stream, String text) { chunks.add(new Chunk(callId, stream, text)); }
            public void onResult(String callId, boolean ok, int exitCode) {
                resultCallId.set(callId); resultOk.set(ok); resultExit.set(exitCode);
            }
        });

        // 经 executeTools(带 callId) 走完整生产路径
        ToolRegistry.ToolInvocation inv = new ToolRegistry.ToolInvocation(
                "call-42", "execute_command",
                "{\"command\":\"printf 'line1\\\\nline2\\\\n'\"}");
        List<ToolRegistry.ToolExecutionResult> results = reg.executeTools(List.of(inv));

        assertEquals(1, results.size());
        assertTrue(results.get(0).toString().length() >= 0); // 结果照常返回给 LLM(内容不在此断言)

        // 逐行流出:两行,均打 callId=call-42
        assertTrue(chunks.stream().anyMatch(c -> c.text().contains("line1")), "应流出 line1: " + chunks);
        assertTrue(chunks.stream().anyMatch(c -> c.text().contains("line2")), "应流出 line2: " + chunks);
        assertTrue(chunks.stream().allMatch(c -> "call-42".equals(c.callId())), "所有 chunk 打 callId=call-42");
        assertTrue(chunks.stream().allMatch(c -> "stdout".equals(c.stream())), "chunk stream 字段应为 stdout");

        // 收尾:tool.result
        assertEquals("call-42", resultCallId.get());
        assertEquals(Boolean.TRUE, resultOk.get(), "printf 退出码 0");
        assertEquals(Integer.valueOf(0), resultExit.get());
    }

    @Test
    void noObserverByDefaultDoesNotStreamOrThrow() {
        ToolRegistry reg = new ToolRegistry();  // 默认无 observer
        ToolRegistry.ToolInvocation inv = new ToolRegistry.ToolInvocation(
                "c1", "execute_command", "{\"command\":\"printf 'x\\\\n'\"}");
        List<ToolRegistry.ToolExecutionResult> r = reg.executeTools(List.of(inv));
        assertEquals(1, r.size(), "无 observer 时命令照常执行,不抛异常");
    }
}
