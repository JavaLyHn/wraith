package com.lyhn.wraith.cli;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static com.lyhn.wraith.cli.AppServerDriver.drive;
import static com.lyhn.wraith.cli.AppServerDriver.req;
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
 *
 * <p>fork/隔离机制本身（{@code drive()}、环境剔除、CWD 挪走）已抽到 {@link AppServerDriver}，
 * 与 {@code ProviderDefaultSelfHealWiringTest} 共用 —— 那边验的是 {@code config.setProvider} /
 * {@code config.removeProvider} 落盘后 {@code defaultProvider} 字段是否被自愈，用的是同一套
 * 「真正的干净机器」装置，没道理各抄一份。
 */
class AppServerNoModelBootstrapTest {

    /** 配置类 RPC 挂在 SessionRunner 上,必须先 session.start(桌面端启动时本就会开会话)。 */
    private static final String INIT = req(1, "initialize", "{}");
    private static final String START = req(2, "session.start", "{}");
    private static final String SET_DEEPSEEK =
            "{\"id\":3,\"method\":\"config.setProvider\",\"params\":"
            + "{\"id\":\"deepseek\",\"apiKey\":\"sk-not-a-real-key-for-test\",\"model\":\"deepseek-chat\"}}";

    @Test
    void 零配置也能起来并完成initialize_而不是退出(@TempDir Path home) throws Exception {
        AppServerDriver.Reply r = drive(home, List.of(req(1, "initialize", "{}")), 1);

        JsonNode res = r.resultOf(1);
        assertNotNull(res, "initialize 应有 result —— 为空说明后端又在无 key 时 System.exit 了。" + r.raw());
        assertEquals("", res.get("model").asText(),
                "无模型时 model 应为空串。若不为空,说明环境隔离没做干净(key 从 env/.env 漏进来了)");
        assertFalse(res.get("capabilities").get("modelConfigured").asBoolean(),
                "capabilities.modelConfigured 必须如实报 false —— 前端据此提示用户去配置");
    }

    @Test
    void 无模型时配置类RPC可用_这正是死锁的破口(@TempDir Path home) throws Exception {
        AppServerDriver.Reply r = drive(home, List.of(INIT, START, SET_DEEPSEEK), 3);

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
        AppServerDriver.Reply r = drive(home, List.of(INIT, START, SET_DEEPSEEK, req(4, "model.list", "{}")), 4);

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
        AppServerDriver.Reply r = drive(home, List.of(INIT, START, req(3, "turn.submit", "{\"input\":\"你好\"}")), 3);

        String all = r.raw();
        assertFalse(all.contains("NullPointerException"),
                "无模型发起对话不该 NPE(此前 Agent 构造 / SessionStore.open 都会解引用 client)。" + all);
        assertTrue(all.contains("尚未配置任何模型") || all.contains("Provider 配置"),
                "应给出一句照着做就能解决的提示。" + all);
    }
}
