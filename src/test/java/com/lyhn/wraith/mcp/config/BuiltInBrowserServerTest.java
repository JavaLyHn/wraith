package com.lyhn.wraith.mcp.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 内建的 chrome-devtools 浏览器 server。
 *
 * <p><b>起因</b>：Windows 用户报「连接 MCP 特别慢，能不能把 chrome-devtools 直接做成默认的」。
 * 查下来根因不是慢，是<b>他那台机器上压根没有这个 server</b>——
 * {@code Main.ensureDefaultMcpConfig()}（往 {@code ~/.wraith/mcp.json} 里写默认模板的那段）
 * <b>只在交互式 CLI 路径被调用</b>。桌面走的是 app-server，从来不 seed。
 * 于是「只用桌面的新用户」永远等不到浏览器能力，只能自己去插件面板手填一遍表单。
 *
 * <p><b>为什么改成内建而不是让 app-server 也去写文件</b>：写文件这条路要在
 * CLI / app-server / gateway / automation 四个入口各挂一次，漏一个就复现同样的 bug；
 * 而且它会去改用户的文件（"我没动过 mcp.json，它自己多了一段"）。
 * {@code step_search} 早就用内建项解决过同一个问题，照着来即可 ——
 * 用户配置永远优先，内建只在缺位时兜底。
 */
class BuiltInBrowserServerTest {

    private static final String PROP = "wraith.mcp.builtin.browser";

    @AfterEach
    void clearOptOut() {
        System.clearProperty(PROP);
    }

    /** 空目录 + 不存在的配置文件 = 全新装机。 */
    private static McpConfigLoader freshMachine(Path tempDir) {
        return new McpConfigLoader(
                tempDir.resolve("no-user.json"), tempDir.resolve("no-project.json"), tempDir);
    }

    @Test
    @DisplayName("全新装机(没有任何 mcp.json)也有 chrome-devtools —— 这正是用户缺的那一步")
    void presentOnFreshMachine(@TempDir Path tempDir) throws Exception {
        Map<String, McpServerConfig> configs = freshMachine(tempDir).load();

        McpServerConfig cdt = configs.get("chrome-devtools");
        assertNotNull(cdt, "桌面用户从来不经过 CLI 的 seed 逻辑,内建项是他唯一的来源");
        assertEquals("npx", cdt.getCommand());
        assertEquals(java.util.List.of("-y", "chrome-devtools-mcp@latest", "--isolated=true"),
                cdt.getArgs());
        assertFalse(cdt.isDisabled(), "内建就是默认启用,否则等于没加");
    }

    @Test
    @DisplayName("用户自己配了就用用户的 —— 内建只兜底,不覆盖")
    void userConfigWins(@TempDir Path tempDir) throws Exception {
        Path user = tempDir.resolve("user.json");
        Files.writeString(user, """
                {"mcpServers":{"chrome-devtools":{
                  "command":"npx","args":["-y","chrome-devtools-mcp@0.23.0","--browser-url=http://127.0.0.1:9222"]}}}
                """);

        Map<String, McpServerConfig> configs =
                new McpConfigLoader(user, tempDir.resolve("none.json"), tempDir).load();

        assertEquals(java.util.List.of("-y", "chrome-devtools-mcp@0.23.0",
                        "--browser-url=http://127.0.0.1:9222"),
                configs.get("chrome-devtools").getArgs(),
                "钉版本 / 复用已开的 Chrome 都是用户加速启动的正当手段,不能被内建项踩掉");
    }

    @Test
    @DisplayName("用户把它停用了(disabled:true)也算「配过」,内建不得把它复活")
    void userDisableWins(@TempDir Path tempDir) throws Exception {
        Path user = tempDir.resolve("user.json");
        Files.writeString(user, """
                {"mcpServers":{"chrome-devtools":{
                  "command":"npx","args":["-y","chrome-devtools-mcp@latest"],"disabled":true}}}
                """);

        Map<String, McpServerConfig> configs =
                new McpConfigLoader(user, tempDir.resolve("none.json"), tempDir).load();

        assertTrue(configs.get("chrome-devtools").isDisabled(),
                "被内建项复活的话,用户会以为自己关不掉");
    }

    @Test
    @DisplayName("项目级配置同样优先")
    void projectConfigWins(@TempDir Path tempDir) throws Exception {
        Path project = tempDir.resolve("project.json");
        Files.writeString(project, """
                {"mcpServers":{"chrome-devtools":{"command":"pnpm","args":["dlx","chrome-devtools-mcp"]}}}
                """);

        Map<String, McpServerConfig> configs =
                new McpConfigLoader(tempDir.resolve("none.json"), project, tempDir).load();

        assertEquals("pnpm", configs.get("chrome-devtools").getCommand());
    }

    @Test
    @DisplayName("显式退订:-Dwraith.mcp.builtin.browser=off 就彻底不加")
    void optOut(@TempDir Path tempDir) throws Exception {
        // 内建项在插件面板里 scope=builtin,那一档没有「删除」按钮 ——
        // 不给一个持久的关法,不想要它的人就被锁死了。
        System.setProperty(PROP, "off");

        assertFalse(freshMachine(tempDir).load().containsKey("chrome-devtools"));
    }

    @Test
    @DisplayName("退订只认关的语义;其余值(含拼错的)一律当没说,保持默认开")
    void optOutVocabulary(@TempDir Path tempDir) throws Exception {
        for (String off : new String[]{"off", "OFF", "false", "0", "no", " off "}) {
            System.setProperty(PROP, off);
            assertFalse(freshMachine(tempDir).load().containsKey("chrome-devtools"),
                    "应视为关闭: " + off);
        }
        for (String on : new String[]{"on", "true", "1", "", "  ", "yes", "ture"}) {
            System.setProperty(PROP, on);
            assertTrue(freshMachine(tempDir).load().containsKey("chrome-devtools"),
                    "应视为保持默认(开): " + on);
        }
    }

    @Test
    @DisplayName("不影响其它 server,也不动用户文件")
    void doesNotDisturbOthers(@TempDir Path tempDir) throws Exception {
        Path user = tempDir.resolve("user.json");
        String original = """
                {"mcpServers":{"git":{"command":"uvx","args":["mcp-server-git"]}}}
                """;
        Files.writeString(user, original);

        Map<String, McpServerConfig> configs =
                new McpConfigLoader(user, tempDir.resolve("none.json"), tempDir).load();

        assertEquals("uvx", configs.get("git").getCommand());
        assertTrue(configs.containsKey("chrome-devtools"));
        assertEquals(original, Files.readString(user),
                "内建项是内存里合并出来的,绝不能顺手改写用户的 mcp.json");
    }

    @Test
    @DisplayName("配置文件不存在时不得凭空创建 —— 取代了此前 CLI 那段写模板的逻辑")
    void neverCreatesTheUserFile(@TempDir Path tempDir) throws Exception {
        // 旧行为:交互式 CLI 启动时若 ~/.wraith/mcp.json 不存在就写一份含 chrome-devtools 的模板。
        // 那段已经删掉 —— 它只覆盖四个入口里的一个,而且会在用户文件里钉死一份
        // 永不更新的参数副本(以后改默认值也到不了他)。这条测试防它被"顺手加回来"。
        Path user = tempDir.resolve("no-user.json");
        Path project = tempDir.resolve("no-project.json");

        assertTrue(new McpConfigLoader(user, project, tempDir).load()
                .containsKey("chrome-devtools"), "能力照样在");
        assertFalse(Files.exists(user), "但不该落盘");
        assertFalse(Files.exists(project), "但不该落盘");
    }

    @Test
    @DisplayName("内建项能过 prepare 的 transport 校验 —— 否则一启动就 ERROR")
    void builtInPassesValidation(@TempDir Path tempDir) throws Exception {
        McpConfigLoader loader = freshMachine(tempDir);
        McpServerConfig cdt = loader.load().get("chrome-devtools");

        assertDoesNotThrow(() -> loader.prepare(cdt));
    }
}
