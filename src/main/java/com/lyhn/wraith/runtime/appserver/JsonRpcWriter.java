package com.lyhn.wraith.runtime.appserver;

import java.io.IOException;
import java.io.OutputStream;
import java.util.LinkedHashMap;
import java.util.Map;

/** 串行写出 JSON-RPC 通知/响应/错误（一行一个 JSON）。线程安全。 */
public final class JsonRpcWriter {
    private final OutputStream out;
    private final Object lock = new Object();

    public JsonRpcWriter(OutputStream out) { this.out = out; }

    public void notify(String method, Object params) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("jsonrpc", "2.0");
        m.put("method", method);
        m.put("params", params);
        writeLine(m);
    }

    public void result(Object id, Object result) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("jsonrpc", "2.0");
        m.put("id", id);
        m.put("result", result);
        writeLine(m);
    }

    public void error(Object id, int code, String message) {
        Map<String, Object> err = new LinkedHashMap<>();
        err.put("code", code);
        err.put("message", message == null ? "" : message);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("jsonrpc", "2.0");
        m.put("id", id);
        m.put("error", err);
        writeLine(m);
    }

    private void writeLine(Object msg) {
        try {
            byte[] bytes = JsonRpc.MAPPER.writeValueAsBytes(msg);
            synchronized (lock) {
                out.write(bytes);
                out.write('\n');
                out.flush();
            }
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("failed to serialize JSON-RPC message", e);
        } catch (IOException ignored) {
            // 连接断开：吞掉，主循环会因 stdin EOF 退出
        }
    }
}
