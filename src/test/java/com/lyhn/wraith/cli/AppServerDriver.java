package com.lyhn.wraith.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 共享测试装置：fork 一个环境干净的 app-server 子进程，喂 NDJSON 请求、收齐回包。
 *
 * <p>从 {@link AppServerNoModelBootstrapTest} 抽出（原先 {@code drive()} / {@code Reply} /
 * {@code javaBin()} / {@code req()} 只在那一个类里），因为需要同一套「真正的干净机器」隔离手段的
 * 测试不止一个——{@code ProviderDefaultSelfHealWiringTest} 也要验 {@code config.setProvider} /
 * {@code config.removeProvider} 落盘的 {@code defaultProvider} 字段，不该再抄一份。
 *
 * <h2>为什么必须开子进程（详见 {@link AppServerNoModelBootstrapTest} 类注释的完整记录）</h2>
 * 同进程测不出「无 key」——API Key 还能从 {@code System.getenv} 和 {@code ~/.env} 漏进来；
 * 子进程的 CWD 也必须挪出仓库根，否则 {@code WraithConfig} 读 {@code new File(".env")} 会读到
 * 仓库根那个带真实 {@code DEEPSEEK_API_KEY} 的 {@code .env}。
 */
final class AppServerDriver {

    private static final ObjectMapper M = new ObjectMapper();

    private AppServerDriver() {}

    record Reply(List<JsonNode> lines, String stderr) {
        // 注意 filter(nonNull):回包是 error 时 get("result") 为 null,
        // 而 Stream.findFirst() 撞到 null 元素会抛 NPE —— 那会把「后端回了错误」
        // 伪装成测试自身崩溃,真正的错误信息反而看不到。
        JsonNode resultOf(long id) { return pick(id, "result"); }
        JsonNode errorOf(long id) { return pick(id, "error"); }
        private JsonNode pick(long id, String field) {
            return lines.stream()
                    .filter(n -> n.hasNonNull("id") && n.get("id").asLong() == id)
                    .map(n -> n.get(field))
                    .filter(java.util.Objects::nonNull)
                    .findFirst().orElse(null);
        }
        String raw() { return lines + "\n--- stderr ---\n" + stderr; }
    }

    static String javaBin() {
        String exe = System.getProperty("os.name", "").toLowerCase().contains("win") ? "java.exe" : "java";
        return Path.of(System.getProperty("java.home"), "bin", exe).toString();
    }

    /**
     * fork 一个环境干净的 app-server，喂请求，收齐到 lastId 的回包后收工。
     *
     * @param home 同时用作 user.home 与 wraith.config.dir —— 一个全新的「空机器」
     */
    static Reply drive(Path home, List<String> requests, long lastId) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(
                javaBin(),
                "-cp", System.getProperty("java.class.path"),
                "-Duser.home=" + home,
                "-Dwraith.config.dir=" + home.resolve(".wraith"),
                "com.lyhn.wraith.cli.Main", "app-server");
        // ⚠ 工作目录必须挪走。WraithConfig 读 `new File(".env")`(CWD)——
        //    仓库根就有一个带 DEEPSEEK_API_KEY 的 .env,不挪的话子进程照样能拿到真 key,
        //    这个用例就永远测不到「无模型」。(第二版正是栽在这:环境变量清了、user.home 换了,
        //    仍回 modelConfigured=true。)
        pb.directory(home.toFile());
        // 干净机器:任何 provider 的 key 都不该从环境漏进来
        Map<String, String> env = pb.environment();
        env.keySet().removeIf(k -> k.toUpperCase().endsWith("_API_KEY"));
        env.remove("HOME");   // 部分路径用 HOME 而非 user.home

        Process p = pb.start();
        List<JsonNode> got = new ArrayList<>();
        StringBuilder err = new StringBuilder();

        Thread errPump = new Thread(() -> {
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(p.getErrorStream(), StandardCharsets.UTF_8))) {
                for (String l; (l = r.readLine()) != null; ) err.append(l).append('\n');
            } catch (Exception ignored) { }
        });
        errPump.setDaemon(true);
        errPump.start();

        try (OutputStream in = p.getOutputStream()) {
            for (String line : requests) {
                in.write((line + "\n").getBytes(StandardCharsets.UTF_8));
                in.flush();
            }
            BufferedReader out = new BufferedReader(
                    new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8));
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
            for (String l; System.nanoTime() < deadline && (l = out.readLine()) != null; ) {
                String t = l.trim();
                if (!t.startsWith("{")) continue;
                JsonNode n;
                try { n = M.readTree(t); } catch (Exception e) { continue; }
                got.add(n);
                if (n.hasNonNull("id") && n.get("id").asLong() == lastId) break;
            }
        } finally {
            p.destroy();
            p.waitFor(10, TimeUnit.SECONDS);
            errPump.join(2000);
        }
        return new Reply(got, err.toString());
    }

    static String req(long id, String method, String params) {
        return "{\"id\":" + id + ",\"method\":\"" + method + "\",\"params\":" + params + "}";
    }
}
