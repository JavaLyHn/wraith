package com.lyhn.wraith.util;

import java.io.PrintStream;
import java.nio.charset.Charset;
import java.util.Locale;

/**
 * 把写进 {@code System.out} / {@code System.err} 的<b>文本</b>按控制台编码降级。
 *
 * <p>解决的是 Windows GBK 控制台上「所有 emoji 都变成 {@code ?}」——
 * 用户看到的第一行就是 {@code ?? 终端不支持 ANSI…}。全仓有上百处
 * {@code System.out.println("✅ …")}，逐个改不现实，也挡不住以后新写的；
 * 在流的入口拦一次是唯一一处就能全覆盖的地方。
 *
 * <p><b>只拦文本方法，不拦 {@code write(byte[])}</b>：后者是已经编码好的字节
 * （或二进制），动它就是破坏。所以 ANSI 转义序列、renderer 自己算好的字节流都不受影响。
 *
 * <p><b>诚实的边界</b>：{@code PrintStream} 内部有些路径（如 {@code write(String)}
 * 这个 private 方法）拦不到，走那条路的输出仍会出现 {@code ?}。覆盖到的是
 * {@code print*} / {@code println*} / {@code printf} / {@code format} / {@code append}
 * 这一整族，也就是实际代码里用的全部形式。
 *
 * <p><b>绝不能装在 app-server / gateway 路径上</b>：那些是 stdio 上的 NDJSON 协议，
 * 改一个字符就破协议。安装点只在交互式 CLI 分支里（见 {@code Main.main} 的子命令分发之后）。
 */
public final class SafeConsoleStream extends PrintStream {

    private final Charset target;

    private SafeConsoleStream(PrintStream delegate, Charset target) {
        super(delegate, true);
        this.target = target;
    }

    /**
     * 需要时才包一层；不需要就把原流还回去（{@code mac}/{@code Linux} 上零开销、零行为变化）。
     */
    public static PrintStream wrapIfNeeded(PrintStream delegate, Charset consoleEncoding) {
        if (delegate == null || !ConsoleSafeText.needsFallback(consoleEncoding)) {
            return delegate;
        }
        return new SafeConsoleStream(delegate, consoleEncoding);
    }

    private String safe(String s) {
        return ConsoleSafeText.render(s, target);
    }

    @Override
    public void print(String s) {
        super.print(safe(s));
    }

    @Override
    public void println(String s) {
        super.println(safe(s));
    }

    @Override
    public void print(Object obj) {
        print(String.valueOf(obj));
    }

    @Override
    public void println(Object obj) {
        println(String.valueOf(obj));
    }

    @Override
    public void print(char[] s) {
        print(s == null ? "null" : new String(s));
    }

    @Override
    public void println(char[] s) {
        println(s == null ? "null" : new String(s));
    }

    @Override
    public void print(char c) {
        print(String.valueOf(c));
    }

    @Override
    public void println(char c) {
        println(String.valueOf(c));
    }

    @Override
    public PrintStream printf(String format, Object... args) {
        return format(format, args);
    }

    @Override
    public PrintStream printf(Locale l, String format, Object... args) {
        return format(l, format, args);
    }

    @Override
    public PrintStream format(String format, Object... args) {
        print(String.format(format, args));
        return this;
    }

    @Override
    public PrintStream format(Locale l, String format, Object... args) {
        print(String.format(l, format, args));
        return this;
    }

    @Override
    public PrintStream append(CharSequence csq) {
        print(String.valueOf(csq));
        return this;
    }

    @Override
    public PrintStream append(CharSequence csq, int start, int end) {
        CharSequence s = csq == null ? "null" : csq;
        print(s.subSequence(start, end).toString());
        return this;
    }

    @Override
    public PrintStream append(char c) {
        print(c);
        return this;
    }
}
