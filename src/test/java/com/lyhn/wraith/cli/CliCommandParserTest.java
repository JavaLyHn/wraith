package com.lyhn.wraith.cli;

import com.lyhn.wraith.config.WraithConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CliCommandParserTest {

    /** 空 config —— resolveModelSelection 的大多数用例不依赖已配置的 provider。 */
    private static WraithConfig noConfig() {
        return new WraithConfig();
    }

    @Test
    void parsesPlanSlashCommandWithoutPayload() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/plan");

        assertEquals(CliCommandParser.CommandType.SWITCH_PLAN, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesPlanSlashCommandWithPayload() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/plan 创建一个 demo 项目");

        assertEquals(CliCommandParser.CommandType.SWITCH_PLAN, command.type());
        assertEquals("创建一个 demo 项目", command.payload());
    }

    @Test
    void parsesInitProjectMemoryCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/init");

        assertEquals(CliCommandParser.CommandType.INIT_PROJECT_MEMORY, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesInitProjectMemoryForceCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/init --force");

        assertEquals(CliCommandParser.CommandType.INIT_PROJECT_MEMORY, command.type());
        assertEquals("--force", command.payload());
    }

    @Test
    void parsesConcreteModelNameAsSwitchModelPayload() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/model step-custom-model");

        assertEquals(CliCommandParser.CommandType.SWITCH_MODEL, command.type());
        assertEquals("step-custom-model", command.payload());
    }

    @Test
    void resolvesConcreteModelNameToProviderAndModel() {
        Main.ModelSelection step = Main.resolveModelSelection("step-custom-model", noConfig());
        assertEquals("step", step.provider());
        assertEquals("step-custom-model", step.model());
        assertEquals(true, step.explicitModel());

        Main.ModelSelection glm = Main.resolveModelSelection("glm-4v-plus", noConfig());
        assertEquals("glm", glm.provider());
        assertEquals("glm-4v-plus", glm.model());

        Main.ModelSelection provider = Main.resolveModelSelection("step", noConfig());
        assertEquals("step", provider.provider());
        assertNull(provider.model());
        assertEquals(false, provider.explicitModel());

        Main.ModelSelection defaultGlm = Main.resolveModelSelection("glm", noConfig());
        assertEquals("glm", defaultGlm.provider());
        assertNull(defaultGlm.model());
        assertEquals(false, defaultGlm.explicitModel());

        Main.ModelSelection explicitGlm = Main.resolveModelSelection("glm-5.1", noConfig());
        assertEquals("glm", explicitGlm.provider());
        assertEquals("glm-5.1", explicitGlm.model());
        assertEquals(true, explicitGlm.explicitModel());

        Main.ModelSelection kimi = Main.resolveModelSelection("kimi-k2.6", noConfig());
        assertEquals("kimi", kimi.provider());
        assertEquals("kimi-k2.6", kimi.model());
        assertEquals(true, kimi.explicitModel());

        Main.ModelSelection moonshot = Main.resolveModelSelection("moonshot", noConfig());
        assertEquals("kimi", moonshot.provider());
        assertNull(moonshot.model());
        assertEquals(false, moonshot.explicitModel());

        Main.ModelSelection freeLlmApi = Main.resolveModelSelection("free-llm-api", noConfig());
        assertEquals("freellmapi", freeLlmApi.provider());
        assertNull(freeLlmApi.model());
        assertEquals(false, freeLlmApi.explicitModel());

        Main.ModelSelection xfyun = Main.resolveModelSelection("maas", noConfig());
        assertEquals("xfyun", xfyun.provider());
        assertNull(xfyun.model());
        assertEquals(false, xfyun.explicitModel());
    }

    @Test
    void parsesConfigProviderPayload() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse(
                "/config provider freellmapi --base-url http://localhost:5173/v1 --model auto");

        assertEquals(CliCommandParser.CommandType.CONFIG, command.type());
        assertEquals("provider freellmapi --base-url http://localhost:5173/v1 --model auto", command.payload());
    }

    @Test
    void parsesResumeWithoutId() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/resume");
        assertEquals(CliCommandParser.CommandType.RESUME, command.type());
        assertEquals("", command.payload());
    }

    @Test
    void parsesResumeWithId() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/resume 20260619-185500-test");
        assertEquals(CliCommandParser.CommandType.RESUME, command.type());
        assertEquals("20260619-185500-test", command.payload());
    }

    @Test
    void parsesProviderConfigUpdate() {
        Main.ProviderConfigUpdate update = Main.parseProviderConfigUpdate(
                "provider free-llm-api --base-url http://localhost:5173/v1 --api-key sk-test --model auto --default");

        assertNull(update.error());
        assertEquals("freellmapi", update.provider());
        assertEquals("http://localhost:5173/v1", update.baseUrl());
        assertEquals("sk-test", update.apiKey());
        assertEquals("auto", update.model());
        assertEquals(true, update.setDefault());
    }

    @Test
    void parsesXfyunProviderConfigUpdate() {
        Main.ProviderConfigUpdate update = Main.parseProviderConfigUpdate(
                "provider xfyun --base-url https://maas-api.cn-huabei-1.xf-yun.com/v2 --api-key sk-test --model Qwen3.6-35B-A3B --lora-id 0 --default");

        assertNull(update.error());
        assertEquals("xfyun", update.provider());
        assertEquals("https://maas-api.cn-huabei-1.xf-yun.com/v2", update.baseUrl());
        assertEquals("sk-test", update.apiKey());
        assertEquals("Qwen3.6-35B-A3B", update.model());
        assertEquals("0", update.loraId());
        assertEquals(true, update.setDefault());
    }

    @Test
    void redactsApiKeyInSubmittedInput() {
        String redacted = Main.redactSensitiveInput(
                "/config provider freellmapi --api-key sk-secret --model auto");

        assertEquals("/config provider freellmapi --api-key *** --model auto", redacted);
    }

    @Test
    void parsesClearSlashCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/clear");

        assertEquals(CliCommandParser.CommandType.CLEAR, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesCompactSlashCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/compact");

        assertEquals(CliCommandParser.CommandType.COMPACT, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesExportSlashCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/export");

        assertEquals(CliCommandParser.CommandType.EXPORT, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesWechatSlashCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/wechat");

        assertEquals(CliCommandParser.CommandType.WECHAT, command.type());
        assertEquals("start", command.payload());
    }

    @Test
    void parsesWechatSlashCommandWithPayload() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/wechat status");

        assertEquals(CliCommandParser.CommandType.WECHAT, command.type());
        assertEquals("status", command.payload());
    }

    @Test
    void exportSlashCommandDoesNotAcceptIgnoredArguments() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/export ./session.md");

        assertEquals(CliCommandParser.CommandType.UNKNOWN_COMMAND, command.type());
        assertEquals("/export ./session.md", command.payload());
    }

    @Test
    void parsesHistoryClearSlashCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/history clear");

        assertEquals(CliCommandParser.CommandType.HISTORY_CLEAR, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesExitSlashCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/exit");

        assertEquals(CliCommandParser.CommandType.EXIT, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesMemorySlashCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/memory");

        assertEquals(CliCommandParser.CommandType.MEMORY_STATUS, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesMemoryClearSlashCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/memory clear");

        assertEquals(CliCommandParser.CommandType.MEMORY_CLEAR, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesMemoryListSlashCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/memory list");

        assertEquals(CliCommandParser.CommandType.MEMORY_LIST, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesMemorySearchSlashCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/memory search Chrome 登录态");

        assertEquals(CliCommandParser.CommandType.MEMORY_SEARCH, command.type());
        assertEquals("Chrome 登录态", command.payload());
    }

    @Test
    void parsesMemoryDeleteSlashCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/memory delete fact-abcd1234");

        assertEquals(CliCommandParser.CommandType.MEMORY_DELETE, command.type());
        assertEquals("fact-abcd1234", command.payload());
    }

    @Test
    void parsesSaveSlashCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/save 记住这个事实");

        assertEquals(CliCommandParser.CommandType.MEMORY_SAVE, command.type());
        assertEquals("记住这个事实", command.payload());
    }

    @Test
    void parsesSaveWithoutPayload() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/save");

        assertEquals(CliCommandParser.CommandType.MEMORY_SAVE, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesSearchWithoutPayload() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/search");

        assertEquals(CliCommandParser.CommandType.SEARCH_CODE, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesGraphWithoutPayload() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/graph");

        assertEquals(CliCommandParser.CommandType.GRAPH_QUERY, command.type());
        assertNull(command.payload());
    }

    @Test
    void keepsNormalInputAsNone() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("帮我读取 pom.xml");

        assertEquals(CliCommandParser.CommandType.NONE, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesUnknownSlashCommandAsUnknownCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/unknown");

        assertEquals(CliCommandParser.CommandType.UNKNOWN_COMMAND, command.type());
        assertEquals("/unknown", command.payload());
    }

    @Test
    void parsesTeamSlashCommandWithoutPayload() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/team");

        assertEquals(CliCommandParser.CommandType.SWITCH_TEAM, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesTeamSlashCommandWithPayload() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/team 创建并验证一个 Java 项目");

        assertEquals(CliCommandParser.CommandType.SWITCH_TEAM, command.type());
        assertEquals("创建并验证一个 Java 项目", command.payload());
    }

    @Test
    void parsesHitlOnCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/hitl on");

        assertEquals(CliCommandParser.CommandType.SWITCH_HITL, command.type());
        assertEquals("on", command.payload());
    }

    @Test
    void parsesHitlOffCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/hitl off");

        assertEquals(CliCommandParser.CommandType.SWITCH_HITL, command.type());
        assertEquals("off", command.payload());
    }

    @Test
    void parsesHitlStatusCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/hitl");

        assertEquals(CliCommandParser.CommandType.SWITCH_HITL, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesPolicyStatusCommand() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/policy");

        assertEquals(CliCommandParser.CommandType.POLICY_STATUS, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesAuditTailWithoutPayload() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/audit");

        assertEquals(CliCommandParser.CommandType.AUDIT_TAIL, command.type());
        assertNull(command.payload());
    }

    @Test
    void parsesAuditTailWithPayload() {
        CliCommandParser.ParsedCommand command = CliCommandParser.parse("/audit 20");

        assertEquals(CliCommandParser.CommandType.AUDIT_TAIL, command.type());
        assertEquals("20", command.payload());
    }

    @Test
    void parsesSnapshotCommands() {
        assertEquals(CliCommandParser.CommandType.SNAPSHOT, CliCommandParser.parse("/snapshot").type());
        assertEquals("list", CliCommandParser.parse("/snapshot").payload());
        assertEquals(CliCommandParser.CommandType.SNAPSHOT, CliCommandParser.parse("/snapshot status").type());
        assertEquals("status", CliCommandParser.parse("/snapshot status").payload());
        assertEquals(CliCommandParser.CommandType.RESTORE_SNAPSHOT, CliCommandParser.parse("/restore 2").type());
        assertEquals("2", CliCommandParser.parse("/restore 2").payload());
    }

    @Test
    void parsesMcpCommands() {
        assertEquals(CliCommandParser.CommandType.MCP_LIST, CliCommandParser.parse("/mcp").type());
        assertEquals(CliCommandParser.CommandType.MCP_RESTART, CliCommandParser.parse("/mcp restart filesystem").type());
        assertEquals("filesystem", CliCommandParser.parse("/mcp restart filesystem").payload());
        assertEquals(CliCommandParser.CommandType.MCP_LOGS, CliCommandParser.parse("/mcp logs filesystem").type());
        assertEquals(CliCommandParser.CommandType.MCP_DISABLE, CliCommandParser.parse("/mcp disable filesystem").type());
        assertEquals(CliCommandParser.CommandType.MCP_ENABLE, CliCommandParser.parse("/mcp enable filesystem").type());
        assertEquals(CliCommandParser.CommandType.MCP_RESOURCES, CliCommandParser.parse("/mcp resources filesystem").type());
        assertEquals("filesystem", CliCommandParser.parse("/mcp resources filesystem").payload());
        assertEquals(CliCommandParser.CommandType.MCP_PROMPTS, CliCommandParser.parse("/mcp prompts filesystem").type());
        assertEquals("filesystem", CliCommandParser.parse("/mcp prompts filesystem").payload());
    }

    @Test
    void parsesBrowserCommands() {
        assertEquals(CliCommandParser.CommandType.BROWSER, CliCommandParser.parse("/browser").type());
        assertEquals("status", CliCommandParser.parse("/browser").payload());
        assertEquals(CliCommandParser.CommandType.BROWSER, CliCommandParser.parse("/browser status").type());
        assertEquals("status", CliCommandParser.parse("/browser status").payload());
        assertEquals("connect", CliCommandParser.parse("/browser connect").payload());
        assertEquals("connect 9333", CliCommandParser.parse("/browser connect 9333").payload());
        assertEquals("disconnect", CliCommandParser.parse("/browser disconnect").payload());
        assertEquals("tabs", CliCommandParser.parse("/browser tabs").payload());
    }

    @Test
    void parsesTaskCommands() {
        assertEquals(CliCommandParser.CommandType.TASK, CliCommandParser.parse("/task").type());
        assertEquals("list", CliCommandParser.parse("/task").payload());
        assertEquals("add 重构模块", CliCommandParser.parse("/task add 重构模块").payload());
        assertEquals("cancel task_123", CliCommandParser.parse("/task cancel task_123").payload());
        assertEquals("log task_123", CliCommandParser.parse("/task log task_123").payload());
    }

    @Test
    void parsesCancelCommand() {
        assertEquals(CliCommandParser.CommandType.CANCEL, CliCommandParser.parse("/cancel").type());
        assertEquals(CliCommandParser.CommandType.CANCEL, CliCommandParser.parse("cancel").type());
    }

    @Test
    void parsesSkillListCommand() {
        assertEquals(CliCommandParser.CommandType.SKILL_LIST, CliCommandParser.parse("/skill").type());
        assertEquals(CliCommandParser.CommandType.SKILL_LIST, CliCommandParser.parse("/skill list").type());
    }

    @Test
    void parsesSkillReloadCommand() {
        assertEquals(CliCommandParser.CommandType.SKILL_RELOAD, CliCommandParser.parse("/skill reload").type());
    }

    @Test
    void parsesSkillShowCommand() {
        CliCommandParser.ParsedCommand cmd = CliCommandParser.parse("/skill show web-access");
        assertEquals(CliCommandParser.CommandType.SKILL_SHOW, cmd.type());
        assertEquals("web-access", cmd.payload());
    }

    @Test
    void parsesSkillOnOffCommands() {
        CliCommandParser.ParsedCommand on = CliCommandParser.parse("/skill on web-access");
        assertEquals(CliCommandParser.CommandType.SKILL_ON, on.type());
        assertEquals("web-access", on.payload());

        CliCommandParser.ParsedCommand off = CliCommandParser.parse("/skill off verbose-debug");
        assertEquals(CliCommandParser.CommandType.SKILL_OFF, off.type());
        assertEquals("verbose-debug", off.payload());
    }

    @Test
    void parsesMemoryPendingCommands() {
        assertEquals(CliCommandParser.CommandType.MEMORY_PENDING, CliCommandParser.parse("/memory pending").type());
        assertEquals(CliCommandParser.CommandType.MEMORY_PENDING_CLEAR, CliCommandParser.parse("/memory pending clear").type());

        CliCommandParser.ParsedCommand approve = CliCommandParser.parse("/memory approve cand-abc123");
        assertEquals(CliCommandParser.CommandType.MEMORY_APPROVE, approve.type());
        assertEquals("cand-abc123", approve.payload());

        CliCommandParser.ParsedCommand replace = CliCommandParser.parse("/memory approve cand-abc123 replace fact-old99");
        assertEquals(CliCommandParser.CommandType.MEMORY_APPROVE, replace.type());
        assertEquals("cand-abc123 replace fact-old99", replace.payload());

        CliCommandParser.ParsedCommand reject = CliCommandParser.parse("/memory reject cand-abc123");
        assertEquals(CliCommandParser.CommandType.MEMORY_REJECT, reject.type());
        assertEquals("cand-abc123", reject.payload());
    }

    // ── provider 白名单不该存在(Task 5c) ─────────────────────────────────────
    //
    // /config provider anthropic 此前被 isSupportedProvider 硬拒:「暂不支持 provider: anthropic」。
    // 桌面走 config.setProvider RPC 没有这道闸,所以桌面能配、CLI 不能 —— 同一个产品两套能力。
    // 这条闸此前没有任何测试覆盖(全仓 rg '暂不支持' 只命中生产代码一处)。

    @Test
    @DisplayName("/config provider anthropic 必须被接受 —— 白名单外的 provider 不该被 CLI 拒绝")
    void acceptsAnthropicProvider() {
        Main.ProviderConfigUpdate u =
                Main.parseProviderConfigUpdate("provider anthropic --api-key sk-test");

        assertNull(u.error(), "实际错误: " + u.error());
        assertEquals("anthropic", u.provider());
    }

    @Test
    @DisplayName("其它白名单外 provider 同样接受(siliconflow / openrouter / 多实例 id)")
    void acceptsOtherUnlistedProviders() {
        for (String id : java.util.List.of("siliconflow", "openrouter", "freellmapi-5", "my-gateway")) {
            Main.ProviderConfigUpdate u =
                    Main.parseProviderConfigUpdate("provider " + id + " --api-key sk-test");
            assertNull(u.error(), id + " 被拒了: " + u.error());
            assertEquals(id, u.provider(), "provider 名不该被改写");
        }
    }

    @Test
    @DisplayName("别名仍然归一,且归一只有一份实现(ProviderNames)")
    void aliasesStillNormalize() {
        assertEquals("kimi",
                Main.parseProviderConfigUpdate("provider moonshot --api-key k").provider());
        assertEquals("xfyun",
                Main.parseProviderConfigUpdate("provider iflytek --api-key k").provider());
        assertEquals("step",
                Main.parseProviderConfigUpdate("provider stepfun --api-key k").provider());
    }

    // ── C1(2)/I2: CLI 补上 --protocol,补 CLI↔桌面对等 ────────────────────────
    //
    // 桌面 ProvidersPanel 有 protocol 字段('openai'|'anthropic'),CLI 此前没有任何选项能设它。
    // 后果见 C1:env-only 或纯 CLI 配置的 anthropic 会静默落进 GenericOpenAiClient,把
    // Anthropic key 发给 api.openai.com。

    @Test
    @DisplayName("--protocol anthropic 被正确解析并透传")
    void parsesProtocolOption() {
        Main.ProviderConfigUpdate u =
                Main.parseProviderConfigUpdate("provider anthropic --protocol anthropic --api-key sk-test");

        assertNull(u.error(), "实际错误: " + u.error());
        assertEquals("anthropic", u.provider());
        assertEquals("anthropic", u.protocol());
    }

    @Test
    @DisplayName("--protocol openai 同样被接受(桌面默认值)")
    void parsesOpenaiProtocolOption() {
        Main.ProviderConfigUpdate u =
                Main.parseProviderConfigUpdate("provider my-gateway --protocol openai --api-key sk-test");

        assertNull(u.error(), "实际错误: " + u.error());
        assertEquals("openai", u.protocol());
    }

    @Test
    @DisplayName("--protocol 非法取值要给人话报错,不能静默吞掉")
    void rejectsInvalidProtocolOptionWithHumanReadableError() {
        Main.ProviderConfigUpdate u =
                Main.parseProviderConfigUpdate("provider anthropic --protocol foo --api-key sk-test");

        assertTrue(u.error() != null && u.error().contains("openai") && u.error().contains("anthropic"),
                "错误信息应指出合法取值,实际: " + u.error());
    }

    @Test
    @DisplayName("未指定 --protocol 时该字段为 null(不覆盖已有配置)")
    void protocolIsNullWhenNotSpecified() {
        Main.ProviderConfigUpdate u =
                Main.parseProviderConfigUpdate("provider deepseek --api-key sk-test");

        assertNull(u.error(), "实际错误: " + u.error());
        assertNull(u.protocol());
    }

    @Test
    @DisplayName("handleConfigCommand 把 --protocol 写进 ProviderConfig(接线,不只是解析)")
    void handleConfigCommandWiresProtocolIntoProviderConfig(@org.junit.jupiter.api.io.TempDir java.nio.file.Path tempDir) {
        // config.save() 会真的落盘;绝不碰开发机真实的 ~/.wraith,重定向到 @TempDir(既有做法,
        // 见 EmbeddingConfigWiringTest/AppServerDriver)。
        String previous = System.getProperty("wraith.config.dir");
        System.setProperty("wraith.config.dir", tempDir.toString());
        try {
            WraithConfig config = new WraithConfig();
            Main.handleConfigCommand(config, "provider anthropic --protocol anthropic --api-key sk-test");

            assertEquals("anthropic", config.getProviders().get("anthropic").getProtocol(),
                    "--protocol 必须真的写进 ProviderConfig,不能停在解析这一层");
        } finally {
            if (previous == null) {
                System.clearProperty("wraith.config.dir");
            } else {
                System.setProperty("wraith.config.dir", previous);
            }
        }
    }

    // ── X1: /config 回显不能让人以为「baseUrl 留空 == 一切正常」 ──────────────────
    //
    // 此前 baseUrl 留空时回显直接打「(默认)」,而实际会发去哪家完全取决于 provider 名有没有
    // 拼对——拼错(claude/anthropi/antropic/anthropics 等未登记别名)时请求会静默落进
    // GenericOpenAiClient,发去 api.openai.com,回显却和拼对时一模一样。这里锁住:只要
    // baseUrl 留空,回显必须带上警示,不能让人以为一切正常。

    @Test
    @DisplayName("baseUrl 留空时回显要给出警示,不能让人以为一切正常(X1)")
    void configEchoWarnsWhenBaseUrlIsDefaulted(@org.junit.jupiter.api.io.TempDir java.nio.file.Path tempDir) {
        String previous = System.getProperty("wraith.config.dir");
        System.setProperty("wraith.config.dir", tempDir.toString());
        try {
            WraithConfig config = new WraithConfig();
            String out = Main.handleConfigCommand(config, "provider claude --api-key sk-ant-FAKE-PROBE");

            assertFalse(out.contains("baseUrl: (默认)\n"),
                    "旧文案「(默认)」听起来一切正常,不该再出现: " + out);
            assertTrue(out.contains("⚠"), "baseUrl 留空必须带警示符号: " + out);
            assertTrue(out.contains("--base-url"), "警示应指出可以用 --base-url 明确指定: " + out);
        } finally {
            if (previous == null) {
                System.clearProperty("wraith.config.dir");
            } else {
                System.setProperty("wraith.config.dir", previous);
            }
        }
    }

    @Test
    @DisplayName("显式指定 --base-url 时不该出现警示(只在真的留空时才警示)")
    void configEchoDoesNotWarnWhenBaseUrlIsExplicit(@org.junit.jupiter.api.io.TempDir java.nio.file.Path tempDir) {
        String previous = System.getProperty("wraith.config.dir");
        System.setProperty("wraith.config.dir", tempDir.toString());
        try {
            WraithConfig config = new WraithConfig();
            String out = Main.handleConfigCommand(config,
                    "provider anthropic --api-key sk-ant-FAKE-PROBE --base-url https://api.anthropic.com");

            assertFalse(out.contains("⚠"), "显式给了 baseUrl,不该出现「留空」警示: " + out);
            assertTrue(out.contains("baseUrl: https://api.anthropic.com"), "实际输出: " + out);
        } finally {
            if (previous == null) {
                System.clearProperty("wraith.config.dir");
            } else {
                System.setProperty("wraith.config.dir", previous);
            }
        }
    }

    @Test
    @DisplayName("裸 /model glm 与其它 provider 一样读配置里的模型 —— 不再是唯一被强制指定的那个")
    void bareGlmSelectionNoLongerForcesAModel() {
        Main.ModelSelection glm = Main.resolveModelSelection("glm", noConfig());
        Main.ModelSelection ds = Main.resolveModelSelection("deepseek", noConfig());

        assertNull(glm.model(), "裸 /model glm 不该硬塞 glm-5.1");
        assertNull(ds.model());
        assertEquals("glm", glm.provider());
    }

    @Test
    @DisplayName("显式模型名仍然生效(/model glm-5v-turbo)")
    void explicitModelNameStillWorks() {
        Main.ModelSelection s = Main.resolveModelSelection("glm-5v-turbo", noConfig());

        assertEquals("glm", s.provider());
        assertEquals("glm-5v-turbo", s.model());
    }

    @Test
    @DisplayName("白名单外的 provider 也能被 /model 选中")
    void unlistedProviderCanBeSelected() {
        Main.ModelSelection s = Main.resolveModelSelection("anthropic", noConfig());

        assertEquals("anthropic", s.provider());
        assertNull(s.model());
    }

    // ── I4: /model <具体模型名> 不再靠第十份硬编码前缀名单 ──────────────────────
    //
    // Main.resolveModelSelection 的 default 分支此前只认 glm-/deepseek/step/kimi-|moonshot-
    // 四个硬编码前缀,于是 /model claude-sonnet-4-5、/model gpt-4o、/model qwen-max 全部失败
    // (报「未配置 xxx 的 API Key」,xxx 是整段模型名被误当成了 provider id)。
    // 通用做法:查已配置的 provider —— 前缀匹配覆盖 provider id 恰好是模型名前缀的情况
    // (如 "qwen" ⇒ "qwen-max"),model 字段完全相等覆盖前缀对不上的情况
    // (如 provider "anthropic" 的模型是 "claude-sonnet-4-5")。

    @Test
    @DisplayName("模型名前缀匹配已配置的 provider id(I4)")
    void resolvesModelNameByConfiguredProviderPrefix() {
        WraithConfig config = new WraithConfig();
        config.getProviders().put("qwen", new WraithConfig.ProviderConfig("sk-qwen", null, null));

        Main.ModelSelection s = Main.resolveModelSelection("qwen-max", config);

        assertEquals("qwen", s.provider());
        assertEquals("qwen-max", s.model());
        assertEquals(true, s.explicitModel());
    }

    @Test
    @DisplayName("模型名与已配置 provider 的 model 字段完全相等时也能归位(覆盖前缀对不上的 claude/gpt,I4)")
    void resolvesModelNameByExactConfiguredModelMatch() {
        WraithConfig config = new WraithConfig();
        config.getProviders().put("anthropic",
                new WraithConfig.ProviderConfig("sk-ant", null, "claude-sonnet-4-5"));

        Main.ModelSelection s = Main.resolveModelSelection("claude-sonnet-4-5", config);

        assertEquals("anthropic", s.provider());
        assertEquals("claude-sonnet-4-5", s.model());
        assertEquals(true, s.explicitModel());
    }

    @Test
    @DisplayName("裸 provider id 不该被误当成显式模型名(前缀匹配须排除完全相等)")
    void bareConfiguredProviderIdIsNotMistakenForExplicitModel() {
        WraithConfig config = new WraithConfig();
        config.getProviders().put("qwen", new WraithConfig.ProviderConfig("sk-qwen", null, "qwen-max"));

        Main.ModelSelection s = Main.resolveModelSelection("qwen", config);

        assertEquals("qwen", s.provider());
        assertNull(s.model(), "裸 /model qwen 应读配置里的模型,不该把 model 字段硬塞成字面量 \"qwen\"");
        assertEquals(false, s.explicitModel());
    }

    @Test
    @DisplayName("未配置的 provider 前缀/模型名仍然拿不到归位 —— 不是本次修法负责的场景")
    void unmatchedModelNameFallsThroughUnchanged() {
        Main.ModelSelection s = Main.resolveModelSelection("totally-unknown-model-xyz", noConfig());

        assertEquals("totally-unknown-model-xyz", s.provider());
        assertNull(s.model());
        assertEquals(false, s.explicitModel());
    }

    // ── X2: 多实例 provider id 本身不该被误当成另一个 provider 的显式模型名 ─────────
    //
    // I4 加的前缀匹配把「另一个已配置 provider 的 id」当成了模型名: providers = [freellmapi,
    // freellmapi-2] 时 /model freellmapi-2 命中前缀匹配的 "freellmapi"(因为
    // "freellmapi-2".startsWith("freellmapi")),产出 provider=freellmapi、
    // model="freellmapi-2"、explicitModel=true。调用方据此执行
    // ensureProviderConfig("freellmapi").setModel("freellmapi-2") 并 config.save(),
    // 静默把 freellmapi 的可用模型覆盖成垃圾字符串并落盘,然后切到错的 provider。
    // 多实例 id 是本仓库明确支持的概念(见 LlmClientFactory 类 Javadoc 里的 freellmapi-2 例子),
    // 改动前这条路是正确的(provider=freellmapi-2, explicitModel=false)。
    // bareConfiguredProviderIdIsNotMistakenForExplicitModel 只覆盖「裸 id 等于被匹配的那个
    // id」这一种情况,漏掉了「裸 id 恰好是另一个已配置 id 的前缀延伸」这个盲区。

    @Test
    @DisplayName("多实例 id 本身不该被误当成另一实例的显式模型名(X2 回归: freellmapi/freellmapi-2)")
    void configuredMultiInstanceProviderIdIsNotMistakenForModelName() {
        WraithConfig config = new WraithConfig();
        config.getProviders().put("freellmapi", new WraithConfig.ProviderConfig("sk-a", null, null));
        config.getProviders().put("freellmapi-2", new WraithConfig.ProviderConfig("sk-b", null, null));

        Main.ModelSelection s = Main.resolveModelSelection("freellmapi-2", config);

        assertEquals("freellmapi-2", s.provider(),
                "不该被前缀匹配抢成 freellmapi —— freellmapi-2 本身就是一个已配置的 provider id");
        assertNull(s.model(), "不该把 freellmapi 的 model 字段硬塞成字面量 \"freellmapi-2\"");
        assertEquals(false, s.explicitModel());
    }

    @Test
    @DisplayName("同型用例: openai/openai-azure(X2 回归)")
    void configuredOpenAiAzureProviderIdIsNotMistakenForModelName() {
        WraithConfig config = new WraithConfig();
        config.getProviders().put("openai", new WraithConfig.ProviderConfig("sk-a", null, null));
        config.getProviders().put("openai-azure", new WraithConfig.ProviderConfig("sk-b", null, null));

        Main.ModelSelection s = Main.resolveModelSelection("openai-azure", config);

        assertEquals("openai-azure", s.provider());
        assertNull(s.model());
        assertEquals(false, s.explicitModel());
    }

    // ── N4: 四条老前缀不该抢在「查已配置 provider」之前 ────────────────────────
    //
    // I4 加的 matchConfiguredProvider 排在 glm-/deepseek/step/kimi-|moonshot- 四条老前缀
    // *之后*,于是永远轮不到它处理这四个前缀覆盖的模型名。那四条建立在一个巧合上:官方
    // provider 的 id 恰好是它模型名的前缀。中转站用户身上巧合不成立 —— 他的 glm-4.7 挂在
    // freellmapi-4 上,却被 startsWith("glm-") 硬派给一个他根本没配的 glm。
    // 实测(用户 6 个中转站 provider): DeepSeek-V4-Flash / deepseek-v4-pro / glm-4.7 三个
    // 模型名全部按名字切不动,只有 Qwen/Qwen3-8B 与 Doubao-Seed-1.6-vision 能走到
    // matchConfiguredProvider。修法是调序,四条老前缀留在后面当兜底(见
    // legacyOfficialPrefixStillAppliesWhenNothingConfiguredMatches)。

    @Test
    @DisplayName("中转站上的 glm-4.7 归位到承载它的 provider,不再被 startsWith(\"glm-\") 抢给没配的 glm(N4)")
    void configuredRelayModelNameBeatsLegacyOfficialPrefix() {
        WraithConfig config = new WraithConfig();
        config.getProviders().put("freellmapi", new WraithConfig.ProviderConfig("sk-a", null, "DeepSeek-V4-Flash"));
        config.getProviders().put("freellmapi-2", new WraithConfig.ProviderConfig("sk-b", null, "deepseek-v4-pro"));
        config.getProviders().put("freellmapi-4", new WraithConfig.ProviderConfig("sk-d", null, "glm-4.7"));

        Main.ModelSelection glm = Main.resolveModelSelection("glm-4.7", config);
        assertEquals("freellmapi-4", glm.provider(), "glm-4.7 存在 freellmapi-4 上,不该派给未配置的 glm");
        assertEquals("glm-4.7", glm.model());
        assertEquals(true, glm.explicitModel());

        Main.ModelSelection flash = Main.resolveModelSelection("DeepSeek-V4-Flash", config);
        assertEquals("freellmapi", flash.provider(), "不该被 startsWith(\"deepseek\") 派给未配置的 deepseek");
        assertEquals("DeepSeek-V4-Flash", flash.model(), "原样保留大小写 —— 归位只用小写比对,落盘用原串");

        Main.ModelSelection pro = Main.resolveModelSelection("deepseek-v4-pro", config);
        assertEquals("freellmapi-2", pro.provider());
        assertEquals("deepseek-v4-pro", pro.model());
    }

    @Test
    @DisplayName("已配置 provider 都对不上时,四条老前缀仍然兜底(不是把它们删掉,N4)")
    void legacyOfficialPrefixStillAppliesWhenNothingConfiguredMatches() {
        WraithConfig config = new WraithConfig();
        config.getProviders().put("freellmapi-4", new WraithConfig.ProviderConfig("sk-d", null, "glm-4.7"));

        // glm-4v-plus 既不等于任何已记录的 model,也不是 "freellmapi-4" 的前缀延伸
        Main.ModelSelection s = Main.resolveModelSelection("glm-4v-plus", config);
        assertEquals("glm", s.provider(), "对不上已配置的就该回落老前缀,而不是把整段当 provider id");
        assertEquals("glm-4v-plus", s.model());

        // moonshot- 这条前缀是老前缀真正在挣工资的地方:provider id 是 kimi,模型名却以 moonshot- 开头,
        // 前缀匹配("moonshot-v1".startsWith("kimi") 为假)覆盖不到它
        WraithConfig withKimi = new WraithConfig();
        withKimi.getProviders().put("kimi", new WraithConfig.ProviderConfig("sk-k", null, null));
        Main.ModelSelection moonshot = Main.resolveModelSelection("moonshot-v1-8k", withKimi);
        assertEquals("kimi", moonshot.provider());
        assertEquals("moonshot-v1-8k", moonshot.model());
    }

    @Test
    @DisplayName("配了官方 provider 的人不受调序影响 —— id 本身就是模型名前缀(N4 回归)")
    void officialProviderUsersAreUnaffectedByTheReorder() {
        WraithConfig config = new WraithConfig();
        config.getProviders().put("glm", new WraithConfig.ProviderConfig("sk-glm", null, "glm-5.1"));
        config.getProviders().put("deepseek", new WraithConfig.ProviderConfig("sk-ds", null, null));

        // 走 matchConfiguredProvider 的前缀匹配("glm-4.7".startsWith("glm")),落点与老前缀一致
        Main.ModelSelection glm = Main.resolveModelSelection("glm-4.7", config);
        assertEquals("glm", glm.provider());
        assertEquals("glm-4.7", glm.model());
        assertEquals(true, glm.explicitModel());

        Main.ModelSelection ds = Main.resolveModelSelection("deepseek-v4-pro", config);
        assertEquals("deepseek", ds.provider());
        assertEquals("deepseek-v4-pro", ds.model());
    }

    @Test
    @DisplayName("裸 provider id 撞上老前缀时不该被当成模型名落盘(X2 守卫必须压过老前缀,N4)")
    void bareConfiguredProviderIdOutranksLegacyPrefixes() {
        // 用户给中转站起名 glm-relay / deepseek-cn / step-proxy —— 都撞上那四条老前缀。
        // X2 守卫认出「这是裸 id,不是模型名」后若只是 return null,老前缀就会接手,产出
        // provider=glm、model="glm-relay"、explicitModel=true,调用方据此
        // ensureProviderConfig("glm").setModel("glm-relay") 并 save() —— 正是 N3 那个
        // 「把另一个 provider 的 id 当模型名写进配置」的回归,只是触发串换成了老前缀。
        WraithConfig config = new WraithConfig();
        config.getProviders().put("glm-relay", new WraithConfig.ProviderConfig("sk-a", null, "glm-4.7"));
        config.getProviders().put("deepseek-cn", new WraithConfig.ProviderConfig("sk-b", null, null));
        config.getProviders().put("step-proxy", new WraithConfig.ProviderConfig("sk-c", null, null));

        Main.ModelSelection relay = Main.resolveModelSelection("glm-relay", config);
        assertEquals("glm-relay", relay.provider(), "这是一个已配置的 provider id,不是 glm 的模型名");
        assertNull(relay.model(), "不该把 \"glm-relay\" 当模型名塞给 glm 并落盘");
        assertEquals(false, relay.explicitModel());

        Main.ModelSelection cn = Main.resolveModelSelection("deepseek-cn", config);
        assertEquals("deepseek-cn", cn.provider());
        assertNull(cn.model());

        Main.ModelSelection proxy = Main.resolveModelSelection("step-proxy", config);
        assertEquals("step-proxy", proxy.provider());
        assertNull(proxy.model());
    }

    // ── I3: /model 空参与补全的 provider 列表须并入 env 发现的候选 ───────────────
    //
    // Main.knownProviderIds 是 /model 空参帮助与 WraithCompleter 补全共用的合并逻辑。
    // 只用 config.getProviders().keySet() 会让「.env 只写了 <NAME>_API_KEY、没跑过 /config」
    // 的用户看到自相矛盾的两行:状态行报着已发现的模型,下一行却说「还没有配置任何 provider」。
    //
    // 这里测的是**合并决策本身**(通过二参注入重载,不扫真实环境变量),不是
    // ProviderResolver.candidates 有没有正确扫到真实 env(那部分由 ProviderResolverTest 覆盖)。

    @Test
    @DisplayName("config 为空但 discovered 非空时,合并结果不能是空表(I3)")
    void knownProviderIdsMergesConfigAndDiscoveredWithoutRealEnvScan() {
        WraithConfig config = new WraithConfig(); // 模拟只写了 .env、没跑过 /config 的用户

        List<String> ids = Main.knownProviderIds(config, List.of("deepseek"));

        assertFalse(ids.isEmpty(),
                "config 为空但 env 有发现时,不能报告「还没有配置任何 provider」");
        assertEquals(List.of("deepseek"), ids);
    }

    @Test
    @DisplayName("config 项在前、与 discovered 重复的去重(I3 的保序要求)")
    void knownProviderIdsKeepsConfigFirstAndDedupes() {
        WraithConfig config = new WraithConfig();
        config.getProviders().put("glm", new WraithConfig.ProviderConfig("sk-glm", null, "m"));

        List<String> ids = Main.knownProviderIds(config, List.of("glm", "deepseek"));

        assertEquals(List.of("glm", "deepseek"), ids, "config 项应在前,且与 discovered 重复的要去重");
    }
}
