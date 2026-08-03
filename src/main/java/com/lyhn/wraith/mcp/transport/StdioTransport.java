package com.lyhn.wraith.mcp.transport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

public class StdioTransport implements McpTransport {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int MAX_STDERR_LINES = 200;

    private final Process process;
    private final BufferedWriter stdin;
    private final List<Consumer<JsonNode>> listeners = new CopyOnWriteArrayList<>();
    private final ArrayDeque<String> stderrRing = new ArrayDeque<>();
    private final Object stderrLock = new Object();
    private volatile boolean closed;

    public StdioTransport(String command, List<String> args, Map<String, String> env, Path workingDir) throws IOException {
        // Windows 上 npx/pnpm 等实际是 npx.cmd,而 CreateProcess 不做 PATHEXT 补全 ——
        // 按裸名 spawn 必然 `CreateProcess error=2`。StdioCommand 负责解析成完整路径;
        // 非 Windows 原样透传(execvp 本就查 PATH)。
        List<String> commandLine = StdioCommand.build(command, args);
        ProcessBuilder builder = new ProcessBuilder(commandLine);
        if (workingDir != null) {
            builder.directory(workingDir.toFile());
        }
        if (env != null && !env.isEmpty()) {
            builder.environment().putAll(env);
        }
        this.process = builder.start();
        this.stdin = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
        startStdoutReader();
        startStderrReader();
    }

    @Override
    public synchronized void send(JsonNode message) throws IOException {
        if (closed) {
            throw new IOException("MCP stdio transport already closed");
        }
        stdin.write(MAPPER.writeValueAsString(message));
        stdin.newLine();
        stdin.flush();
    }

    @Override
    public void onReceive(Consumer<JsonNode> listener) {
        if (listener != null) {
            listeners.add(listener);
        }
    }

    @Override
    public List<String> stderrLines() {
        synchronized (stderrLock) {
            return List.copyOf(stderrRing);
        }
    }

    @Override
    public Long processId() {
        return process.pid();
    }

    @Override
    public String transportName() {
        return "stdio";
    }

    @Override
    public void close() {
        closed = true;
        // 关 stdin 让子进程读到 EOF，给一次优雅退出窗口（1 秒）。
        // shutdown 通知由 McpClient.close 在调本方法之前发出，子进程拿到 EOF 后通常会立即退出。
        try {
            stdin.close();
        } catch (IOException ignored) {
        }
        try {
            if (process.waitFor(1, TimeUnit.SECONDS)) {
                return;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
            return;
        }
        // 优雅窗口超时，发 SIGTERM
        process.destroy();
        try {
            if (!process.waitFor(2, TimeUnit.SECONDS)) {
                process.destroyForcibly();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
        }
    }

    private void startStdoutReader() {
        Thread thread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.isBlank()) {
                        continue;
                    }
                    JsonNode message = MAPPER.readTree(line);
                    for (Consumer<JsonNode> listener : listeners) {
                        listener.accept(message);
                    }
                }
            } catch (Exception e) {
                appendStderr("[wraith] stdout reader stopped: " + e.getMessage());
            }
        }, "wraith-mcp-stdio-stdout");
        thread.setDaemon(true);
        thread.start();
    }

    /**
     * stderr 读取。<b>刻意不用 UTF-8 的 Reader</b>，与上面 stdout 的读法不同。
     *
     * <p>MCP 规范只要求 <b>JSON-RPC 通道</b>（stdin/stdout）是 UTF-8，那两处必须保持 UTF-8。
     * 但 stderr 不是协议的一部分，它是<b>人读的诊断文本</b>，走的是操作系统的码页：
     * 中文 Windows 上 cmd.exe 报的「系统找不到指定的文件。」是 GBK，按 UTF-8 读会变成
     * 一串 {@code ���}，用户在测试结果行里看到的就是那个。
     *
     * <p>而<b>同一条 stderr 上两种编码会并存</b>——OS/cmd 报的是系统码页，node 自己抛的错
     * 是 UTF-8。所以不能整条流固定一种编码，只能<b>逐行判定</b>：按字节切行，先严格按
     * UTF-8 解，非法字节才退回系统码页。合法 UTF-8 极少同时是合法的多字节 GBK 文本，
     * 反过来也一样，所以这个判定实践上很稳。
     */
    private void startStderrReader() {
        Thread thread = new Thread(() -> {
            Charset fallback = nativeCharset();
            try (java.io.InputStream in = new java.io.BufferedInputStream(process.getErrorStream())) {
                java.io.ByteArrayOutputStream line = new java.io.ByteArrayOutputStream();
                int b;
                while ((b = in.read()) != -1) {
                    if (b == '\n') {
                        flushStderrLine(line, fallback);
                    } else if (b != '\r') {
                        line.write(b);
                    }
                }
                flushStderrLine(line, fallback); // 进程退出时最后一行可能没有换行符
            } catch (IOException e) {
                appendStderr("[wraith] stderr reader stopped: " + e.getMessage());
            }
        }, "wraith-mcp-stdio-stderr");
        thread.setDaemon(true);
        thread.start();
    }

    private void flushStderrLine(java.io.ByteArrayOutputStream buf, Charset fallback) {
        if (buf.size() == 0) {
            return;
        }
        byte[] bytes = buf.toByteArray();
        buf.reset();
        appendStderr(decodeDiagnosticLine(bytes, bytes.length, fallback));
    }

    /**
     * 一行诊断文本的解码：先严格 UTF-8，非法字节退回 {@code fallback}。
     *
     * <p>{@code fallback} 也解不动时不抛——退化成替换字符即可。stderr 泵是守护线程，
     * 让它抛异常等于此后再也读不到任何诊断信息，而诊断信息正是用户此刻唯一的线索。
     */
    static String decodeDiagnosticLine(byte[] bytes, int length, Charset fallback) {
        if (length <= 0) {
            return "";
        }
        CharsetDecoder strict = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        try {
            return strict.decode(ByteBuffer.wrap(bytes, 0, length)).toString();
        } catch (CharacterCodingException e) {
            return new String(bytes, 0, length, fallback);
        }
    }

    /**
     * 子进程 stderr 的实际编码。
     *
     * <p>取 {@code native.encoding}（JDK 17 起提供，报的是 <b>OS 默认</b>）而<b>不是</b>
     * {@code file.encoding}——后者自 JEP 400 起在所有平台恒为 UTF-8，用它永远拿不到 GBK，
     * 这个修复就等于没做。
     */
    static Charset nativeCharset() {
        String name = System.getProperty("native.encoding");
        if (name != null && !name.isBlank()) {
            try {
                return Charset.forName(name.trim());
            } catch (Exception ignored) {
                // 属性值非法(理论上不该发生) → 落到平台默认，别因为一个属性把 stderr 读崩
            }
        }
        return Charset.defaultCharset();
    }

    private void appendStderr(String line) {
        synchronized (stderrLock) {
            while (stderrRing.size() >= MAX_STDERR_LINES) {
                stderrRing.removeFirst();
            }
            stderrRing.addLast(line);
        }
    }
}
