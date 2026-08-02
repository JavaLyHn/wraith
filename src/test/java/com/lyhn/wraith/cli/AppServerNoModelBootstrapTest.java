package com.lyhn.wraith.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * **首次运行死锁的回归防线。**
 *
 * <p>此前 {@code startAppServer()} 在 {@code LlmClientFactory.createFromConfig} 返回 null 时
 * 直接 {@code System.exit(1)}。而桌面端「Provider 配置」面板是走 {@code config.setProvider}
 * RPC 存密钥的 —— 后端一死，面板就存不了。于是：
 *
 * <pre>没有 key → 后端退出 → GUI 配不了 key → 永远没有 key</pre>
 *
 * <p>全新装机的用户在应用内**无路可走**，界面上只显示 "Backend not connected"。
 * 与平台无关，mac 全新装机同样会撞。
 *
 * <h2>为什么必须开子进程</h2>
 *
 * 第一版在**同进程**里用 {@code -Dwraith.config.dir} 指向临时目录跑，结果
 * {@code modelConfigured} 回了 {@code true} —— 因为 API Key 还能从
 * {@code System.getenv}（{@code WraithConfig:274}）和 {@code ~/.env} 进来，
 * 本机有真 key 就永远测不到「无模型」。同进程还改不了 {@code System.getenv}，
 * 且 {@code SessionStore} 直接用 {@code user.home}，测试会往真实 {@code ~/.wraith} 写东西。
 *
 * <p>所以这里 fork 一个 JVM：环境变量里所有 {@code *_API_KEY} 全部剔除，
 * {@code user.home} 与 {@code wraith.config.dir} 双双指向 @TempDir。
 * 既真正复现了「干净机器」，也不碰开发机的任何状态。
 */
class AppServerNoModelBootstrapTest {

    private static final ObjectMapper M = new ObjectMapper();

    private record Reply(List<JsonNode> lines, String stderr) {
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

    private static String javaBin() {
        String exe = System.getProperty("os.name", "").toLowerCase().contains("win") ? "java.exe" : "java";
        return Path.of(System.getProperty("java.home"), "bin", exe).toString();
    }

    /**
     * fork 一个环境干净的 app-server，喂请求，收齐到 lastId 的回包后收工。
     *
     * @param home 同时用作 user.home 与 wraith.config.dir —— 一个全新的「空机器」
     */
    private Reply drive(Path home, List<String> requests, long lastId) throws Exception {
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

    private static String req(long id, String method, String params) {
        return "{\"id\":" + id + ",\"method\":\"" + method + "\",\"params\":" + params + "}";
    }

    /** 配置类 RPC 挂在 SessionRunner 上,必须先 session.start(桌面端启动时本就会开会话)。 */
    private static final String INIT = req(1, "initialize", "{}");
    private static final String START = req(2, "session.start", "{}");
    private static final String SET_DEEPSEEK =
            "{\"id\":3,\"method\":\"config.setProvider\",\"params\":"
            + "{\"id\":\"deepseek\",\"apiKey\":\"sk-not-a-real-key-for-test\",\"model\":\"deepseek-chat\"}}";

    @Test
    void 零配置也能起来并完成initialize_而不是退出(@TempDir Path home) throws Exception {
        Reply r = drive(home, List.of(req(1, "initialize", "{}")), 1);

        JsonNode res = r.resultOf(1);
        assertNotNull(res, "initialize 应有 result —— 为空说明后端又在无 key 时 System.exit 了。" + r.raw());
        assertEquals("", res.get("model").asText(),
                "无模型时 model 应为空串。若不为空,说明环境隔离没做干净(key 从 env/.env 漏进来了)");
        assertFalse(res.get("capabilities").get("modelConfigured").asBoolean(),
                "capabilities.modelConfigured 必须如实报 false —— 前端据此提示用户去配置");
    }

    @Test
    void 无模型时配置类RPC可用_这正是死锁的破口(@TempDir Path home) throws Exception {
        Reply r = drive(home, List.of(INIT, START, SET_DEEPSEEK), 3);

        assertNotNull(r.resultOf(2), "无模型时 session.start 也必须成功,否则面板连打开都做不到。" + r.raw());
        JsonNode res = r.resultOf(3);
        assertNotNull(res, "config.setProvider 在无模型时必须可用 —— 这是用户配第一个 key 的唯一入口。" + r.raw());
        assertTrue(res.get("ok").asBoolean());

        Path file = home.resolve(".wraith").resolve("config.json");
        assertTrue(Files.exists(file), "配置应落盘到 " + file);
        assertTrue(Files.readString(file).contains("deepseek"), "写入的 provider 应在配置里");
    }

    @Test
    void 配完provider后就地热装_不必重启后端(@TempDir Path home) throws Exception {
        Reply r = drive(home, List.of(INIT, START, SET_DEEPSEEK, req(4, "model.list", "{}")), 4);

        // 前置:这一轮开局确实是无模型(否则下面的断言证明不了任何事)
        assertFalse(r.resultOf(1).get("capabilities").get("modelConfigured").asBoolean(),
                "前置失败:开局就有模型,本用例测不到热装。" + r.raw());

        JsonNode res = r.resultOf(4);
        assertNotNull(res, "model.list 应有回包。" + r.raw());
        // current 是对象 {provider, model},不是字符串 —— 对 ObjectNode 调 asText() 恒得空串,
        // 那样这条断言会永远红,看着像产品坏了,其实是断言写错。
        JsonNode cur = res.get("current");
        assertNotNull(cur, "model.list 应带 current。实到: " + res);
        assertEquals("deepseek", cur.path("provider").asText(),
                "配完 provider 后 current.provider 应已切到新配的那家 —— 若为空说明 ensureClient "
                        + "没在 config.setProvider 后触发,用户仍得重启后端。实到: " + res);
        assertEquals("deepseek-chat", cur.path("model").asText(), "实到: " + res);
    }

    @Test
    void 无模型时发起对话给的是人话不是NPE(@TempDir Path home) throws Exception {
        Reply r = drive(home, List.of(INIT, START, req(3, "turn.submit", "{\"input\":\"你好\"}")), 3);

        String all = r.raw();
        assertFalse(all.contains("NullPointerException"),
                "无模型发起对话不该 NPE(此前 Agent 构造 / SessionStore.open 都会解引用 client)。" + all);
        assertTrue(all.contains("尚未配置任何模型") || all.contains("Provider 配置"),
                "应给出一句照着做就能解决的提示。" + all);
    }
}
