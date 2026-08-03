package com.lyhn.wraith.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static com.lyhn.wraith.cli.AppServerDriver.drive;
import static com.lyhn.wraith.cli.AppServerDriver.req;
import static org.junit.jupiter.api.Assertions.*;

/**
 * 验的是 {@code Main.java} 里 {@code configSetProvider} / {@code configRemoveProvider}
 * 对 {@code ProviderDefaults.healDefault(config)} 的**接线**，不是 {@link ProviderDefaultSelfHealTest}
 * 已经验过的决策逻辑本体。
 *
 * <h2>为什么这层必须单独测，纯函数层的绿灯不能替代它</h2>
 * {@code ProviderDefaultSelfHealTest} 全程直接调 {@code ProviderDefaults.healDefault(...)}，
 * 从未经过 {@code configSetProvider}/{@code configRemoveProvider} 这两个 {@code Main.java}
 * 匿名内部类方法——那两个方法有没有真的调用 {@code healDefault}，纯函数测试测不出来。
 * 这正是 brief 开篇描述的、用户在桌面上撞到的那条路径：配好 anthropic 点保存 → 界面说
 * 「无可用模型」——bug 出在接线缺失，不是决策逻辑本身错。
 *
 * <h2>为什么不能靠 {@code model.list} 或 {@code initialize} 的字段断言</h2>
 * {@code model.list}/{@code initialize} 报的是「有效默认」，来自
 * {@code ProviderResolver.candidates}（见 {@code ProviderResolver.java:113-134}）——
 * 该方法里 {@code explicit}（即 stale 的 {@code config.getDefaultProvider()}）只有在
 * <b>拿得到 key</b> 时才会被纳入候选表；stale 的初值 {@code "glm"} 恰恰没有 key，于是
 * 无论 {@code healDefault} 有没有被调用，候选表都会退化成同一件事——遍历
 * {@code config.getProviders()}，第一名不变。也就是说：<b>「有效默认」这个信号对
 * stale {@code defaultProvider} 天生免疫</b>，用它断言接线，即使接线被删掉测试也不会变红
 * ——这不是本类凑巧发现的，是 Task 2/3 刻意把 {@code createFromConfig}/{@code model.list}
 * 做成了不受这个字段摆布。
 *
 * <p>唯一真正取决于接线的可观测信号，是<b>落盘的 {@code config.json} 里那个原始
 * {@code defaultProvider} 字段本身</b>——它是否被改写，完全取决于
 * {@code Main.configSetProvider}/{@code configRemoveProvider} 有没有在 {@code save()}
 * 之前调 {@code ProviderDefaults.healDefault(config)}。所以这里读的是落盘文件，不是任何
 * RPC 回包字段。
 *
 * <p>子进程隔离装置见 {@link AppServerDriver} 与 {@link AppServerNoModelBootstrapTest} 的类注释。
 */
class ProviderDefaultSelfHealWiringTest {

    private static final ObjectMapper M = new ObjectMapper();

    private static final String INIT = req(1, "initialize", "{}");
    private static final String START = req(2, "session.start", "{}");

    private static String setProvider(long id, String providerId, String apiKey, String model) {
        return "{\"id\":" + id + ",\"method\":\"config.setProvider\",\"params\":"
                + "{\"id\":\"" + providerId + "\",\"apiKey\":\"" + apiKey + "\",\"model\":\"" + model + "\"}}";
    }

    private static String removeProvider(long id, String providerId) {
        return "{\"id\":" + id + ",\"method\":\"config.removeProvider\",\"params\":"
                + "{\"id\":\"" + providerId + "\"}}";
    }

    private static JsonNode readConfigJson(Path home) throws Exception {
        Path file = home.resolve(".wraith").resolve("config.json");
        assertTrue(Files.exists(file), "配置应落盘到 " + file);
        return M.readTree(Files.readString(file));
    }

    @Test
    void configSetProvider落盘后defaultProvider字段被治愈为新配的provider_不是硬编码初值glm(@TempDir Path home) throws Exception {
        String setAnthropic = setProvider(3, "anthropic", "sk-fake-anthropic-test", "claude-x");
        AppServerDriver.Reply r = drive(home, List.of(INIT, START, setAnthropic), 3);

        JsonNode setResult = r.resultOf(3);
        assertNotNull(setResult, "config.setProvider 应成功返回。" + r.raw());
        assertTrue(setResult.get("ok").asBoolean());

        JsonNode cfg = readConfigJson(home);
        String defaultProvider = cfg.path("defaultProvider").asText(null);
        assertEquals("anthropic", defaultProvider,
                "存完 anthropic 就该立刻可用 —— defaultProvider 若仍是硬编码初值 \"glm\","
                        + "createFromConfig 会先试无 key 的 glm 再遍历旧白名单,返回 null,"
                        + "界面就会说「无可用模型」。落盘内容: " + cfg);
    }

    @Test
    void configRemoveProvider删掉当前default后defaultProvider落到下一个有key的_不是保持不变也不是指向已删除的id(@TempDir Path home) throws Exception {
        String setDeepseek = setProvider(3, "deepseek", "sk-fake-deepseek-test", "deepseek-chat");
        String setSiliconflow = setProvider(4, "siliconflow", "sk-fake-siliconflow-test", "some-model");
        String removeDeepseek = removeProvider(5, "deepseek");
        AppServerDriver.Reply r = drive(home, List.of(INIT, START, setDeepseek, setSiliconflow, removeDeepseek), 5);

        // 前置:两次 setProvider 都要先落地成功,否则下面对 remove 的断言证明不了任何事
        assertNotNull(r.resultOf(3), "setProvider(deepseek) 应成功。" + r.raw());
        assertNotNull(r.resultOf(4), "setProvider(siliconflow) 应成功。" + r.raw());
        JsonNode removeResult = r.resultOf(5);
        assertNotNull(removeResult, "config.removeProvider 应成功返回。" + r.raw());
        assertTrue(removeResult.get("ok").asBoolean());

        JsonNode cfg = readConfigJson(home);
        String defaultProvider = cfg.path("defaultProvider").asText(null);
        assertEquals("siliconflow", defaultProvider,
                "删掉当前默认(deepseek)后,defaultProvider 应落到下一个有 key 的 provider(siliconflow)——"
                        + "不该保持 \"deepseek\" 不变(那个 id 已经被删了,指向虚空),也不该保持空/null。"
                        + "落盘内容: " + cfg);
    }
}
