package com.lyhn.wraith.mcp.transport;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * MCP 子进程的 stderr 在 Windows 上不是 UTF-8，按 UTF-8 读会得到一串 U+FFFD。
 *
 * <p><b>症状</b>（用户 Windows 截图）：添加 filesystem server 点「测试」，结果行显示
 * <pre>
 * ❌ 连接失败:java.util.concurrent.TimeoutException: JSON-RPC request timed out: initialize
 * ���������]��
 * </pre>
 * 第一行是我们自己的 Java 异常（正常），第二行是捕获到的子进程 stderr —— 那句原文是
 * cmd.exe 的「系统找不到指定的文件。」，GBK 字节按 UTF-8 解就成了这样。
 *
 * <p><b>为什么只能改 stderr</b>：MCP 规范要求 JSON-RPC 通道（stdin/stdout）是 UTF-8，
 * 那两处<b>必须</b>保持 UTF-8，动了就破协议。stderr 不是协议的一部分，它是人读的诊断文本，
 * 走的是操作系统的码页。
 *
 * <p><b>为什么要逐行判定而不是整条流换成 GBK</b>：同一条 stderr 上两种编码会并存 ——
 * cmd.exe / OS 报的错是系统码页，而 node 自己抛的错是 UTF-8。固定成 GBK 会把 node 的
 * 中文错误反过来搞坏。
 */
class StdioStderrDecodeTest {

    private static final String CMD_NOT_FOUND = "系统找不到指定的文件。";

    @Test
    @DisplayName("GBK 字节能解回中文原文，而不是一串替换字符")
    void decodesGbkBytesFromWindowsShell() {
        assumeTrue(Charset.isSupported("GBK"), "此 JVM 没有 GBK 字符集");
        Charset gbk = Charset.forName("GBK");
        byte[] bytes = CMD_NOT_FOUND.getBytes(gbk);

        String decoded = StdioTransport.decodeDiagnosticLine(bytes, bytes.length, gbk);

        assertEquals(CMD_NOT_FOUND, decoded);
        assertFalse(decoded.contains("�"),
                "出现 U+FFFD 就说明还在按 UTF-8 解 GBK: " + decoded);
    }

    @Test
    @DisplayName("UTF-8 字节优先按 UTF-8 解 —— node 自己的报错不能被 fallback 搞坏")
    void prefersUtf8WhenBytesAreValidUtf8() {
        assumeTrue(Charset.isSupported("GBK"), "此 JVM 没有 GBK 字符集");
        Charset gbk = Charset.forName("GBK");
        String nodeError = "错误：找不到模块 '@modelcontextprotocol/server-filesystem'";
        byte[] bytes = nodeError.getBytes(StandardCharsets.UTF_8);

        // fallback 给 GBK,但这串是合法 UTF-8,所以不该走 fallback
        assertEquals(nodeError, StdioTransport.decodeDiagnosticLine(bytes, bytes.length, gbk));
    }

    @Test
    @DisplayName("纯 ASCII 两条路结果一致，不受影响")
    void asciiIsUnaffected() {
        String ascii = "npm ERR! code ENOENT";
        byte[] bytes = ascii.getBytes(StandardCharsets.US_ASCII);

        assertEquals(ascii, StdioTransport.decodeDiagnosticLine(bytes, bytes.length,
                StandardCharsets.ISO_8859_1));
    }

    @Test
    @DisplayName("空行与 length=0 不炸")
    void emptyInputIsSafe() {
        assertEquals("", StdioTransport.decodeDiagnosticLine(new byte[0], 0, StandardCharsets.UTF_8));
        assertEquals("", StdioTransport.decodeDiagnosticLine(new byte[]{1, 2, 3}, 0, StandardCharsets.UTF_8));
    }

    @Test
    @DisplayName("fallback 也解不动时退化成替换字符，不抛异常把 stderr 泵搞死")
    void undecodableBytesDegradeInsteadOfThrowing() {
        // 0xFF 0xFE 在 UTF-8 里非法;用 US_ASCII 作 fallback 时也非法 → 只能替换
        byte[] bytes = {(byte) 0xFF, (byte) 0xFE};

        String decoded = StdioTransport.decodeDiagnosticLine(bytes, bytes.length,
                StandardCharsets.US_ASCII);

        // 关键是「有返回值、没抛」——stderr 泵是守护线程,抛了就再也读不到诊断信息
        org.junit.jupiter.api.Assertions.assertNotNull(decoded);
    }

    @Test
    @DisplayName("nativeCharset() 不该是 UTF-8 硬编码 —— file.encoding 自 JEP 400 起恒为 UTF-8,用它永远拿不到 GBK")
    void nativeCharsetComesFromNativeEncodingProperty() {
        String previous = System.getProperty("native.encoding");
        assumeTrue(Charset.isSupported("GBK"), "此 JVM 没有 GBK 字符集");
        System.setProperty("native.encoding", "GBK");
        try {
            assertEquals(Charset.forName("GBK"), StdioTransport.nativeCharset());
        } finally {
            if (previous == null) {
                System.clearProperty("native.encoding");
            } else {
                System.setProperty("native.encoding", previous);
            }
        }
    }

    @Test
    @DisplayName("native.encoding 缺失或非法时退回平台默认，不抛")
    void nativeCharsetFallsBackWhenPropertyIsUnusable() {
        String previous = System.getProperty("native.encoding");
        System.setProperty("native.encoding", "no-such-charset-xyz");
        try {
            assertEquals(Charset.defaultCharset(), StdioTransport.nativeCharset());
        } finally {
            if (previous == null) {
                System.clearProperty("native.encoding");
            } else {
                System.setProperty("native.encoding", previous);
            }
        }
    }
}
