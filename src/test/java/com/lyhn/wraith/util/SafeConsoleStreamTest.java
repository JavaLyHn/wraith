package com.lyhn.wraith.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SafeConsoleStreamTest {

    private static final Charset GBK = Charset.forName("GBK");

    private record Rig(PrintStream stream, ByteArrayOutputStream sink) {
        String text() {
            return sink.toString(GBK);
        }
    }

    private static Rig gbkRig() {
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        PrintStream raw = new PrintStream(sink, true, GBK);
        return new Rig(SafeConsoleStream.wrapIfNeeded(raw, GBK), sink);
    }

    @Test
    @DisplayName("**UTF-8 下原样返回同一个流** —— mac/Linux 上必须零开销零行为变化")
    void utf8NeedsNoWrapping() {
        PrintStream raw = new PrintStream(new ByteArrayOutputStream(), true, StandardCharsets.UTF_8);
        assertSame(raw, SafeConsoleStream.wrapIfNeeded(raw, StandardCharsets.UTF_8));
        assertEquals(null, SafeConsoleStream.wrapIfNeeded(null, GBK));
    }

    @Test
    @DisplayName("println 里的 emoji 被换成 ASCII,中文完好 —— 这就是用户看到的那句 `?? 终端不支持 ANSI`")
    void printlnDowngradesEmoji() {
        Rig r = gbkRig();
        r.stream().println("⚠️ 终端不支持 ANSI，回退到 plain");
        assertTrue(r.text().startsWith("[!] 终端不支持 ANSI"), r.text());
        assertFalse(r.text().contains("?"), "不该再有 ? 占位: " + r.text());
    }

    @Test
    @DisplayName("printf / format / append 这一族都要拦到 —— 漏一个就漏一片输出")
    void allTextFamilyMethodsAreCovered() {
        Rig r = gbkRig();
        r.stream().printf("%s 完成%n", "✅");
        r.stream().format("%s 失败%n", "❌");
        r.stream().append("🔍 查找").append('\n');
        r.stream().print(new char[]{'✂', '️'});
        r.stream().println();
        r.stream().print((Object) "🧩");
        String out = r.text();
        assertTrue(out.contains("[ok] 完成"), out);
        assertTrue(out.contains("[x] 失败"), out);
        assertTrue(out.contains("[?] 查找"), out);
        assertTrue(out.contains("[cut]"), out);
        assertTrue(out.contains("[skill]"), out);
    }

    @Test
    @DisplayName("**write(byte[]) 不许改** —— 那是已编码字节/ANSI 序列,动了就是破坏")
    void rawByteWritesArePassedThrough() {
        Rig r = gbkRig();
        byte[] ansi = new byte[]{0x1b, '[', '3', '1', 'm'};   // ESC[31m 红色
        r.stream().write(ansi, 0, ansi.length);
        r.stream().flush();
        byte[] got = r.sink().toByteArray();
        assertEquals(ansi.length, got.length, "字节数必须一致");
        for (int i = 0; i < ansi.length; i++) {
            assertEquals(ansi[i], got[i], "第 " + i + " 个字节被改了");
        }
    }

    @Test
    @DisplayName("纯 ASCII 输出一字节不差 —— 绝大多数行走这条路")
    void asciiIsByteIdentical() {
        Rig r = gbkRig();
        r.stream().println("Model claude-haiku-4-5 (freellmapi-2)");
        assertEquals("Model claude-haiku-4-5 (freellmapi-2)" + System.lineSeparator(), r.text());
    }

    @Test
    @DisplayName("null 与边界值不抛")
    void nullsAreSafe() {
        Rig r = gbkRig();
        r.stream().println((String) null);
        r.stream().print((Object) null);
        r.stream().print((char[]) null);
        r.stream().append(null);
        r.stream().flush();
        assertTrue(r.text().contains("null"), r.text());
    }

    @Test
    @DisplayName("输出的每个字节都真能被 GBK 解回来 —— 降级的目的就是这个")
    void everythingWrittenIsEncodableInGbk() {
        Rig r = gbkRig();
        r.stream().println("⚠️✅❌🔍 混合 中文 and ASCII 🫠");
        r.stream().flush();
        String decoded = r.text();
        assertTrue(GBK.newEncoder().canEncode(decoded), decoded);
        assertTrue(decoded.contains("混合") && decoded.contains("中文"), decoded);
    }
}
