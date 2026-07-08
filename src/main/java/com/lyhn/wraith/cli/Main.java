package com.lyhn.wraith.cli;

import com.lyhn.wraith.agent.Agent;
import com.lyhn.wraith.agent.AgentOrchestrator;
import com.lyhn.wraith.agent.PlanExecuteAgent;
import com.lyhn.wraith.browser.BrowserAuditMetadata;
import com.lyhn.wraith.browser.BrowserConnectivityCheck;
import com.lyhn.wraith.browser.BrowserGuard;
import com.lyhn.wraith.browser.BrowserMode;
import com.lyhn.wraith.browser.BrowserSession;
import com.lyhn.wraith.browser.SensitivePagePolicy;
import com.lyhn.wraith.config.WraithConfig;
import com.lyhn.wraith.hitl.HitlHandler;
import com.lyhn.wraith.hitl.HitlToolRegistry;
import com.lyhn.wraith.hitl.SwitchableHitlHandler;
import com.lyhn.wraith.hitl.RendererHitlHandler;
import com.lyhn.wraith.hitl.TerminalHitlHandler;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.session.SessionMeta;
import com.lyhn.wraith.session.SessionStore;
import com.lyhn.wraith.llm.LlmClientFactory;
import com.lyhn.wraith.memory.LongTermMemory;
import com.lyhn.wraith.memory.MemoryEntry;
import com.lyhn.wraith.render.Renderer;
import com.lyhn.wraith.render.RendererFactory;
import com.lyhn.wraith.render.StatusInfo;
import com.lyhn.wraith.render.inline.InlineRenderer;
import com.lyhn.wraith.render.WraithWordmark;
import com.lyhn.wraith.render.intro.IntroAnimation;
import com.lyhn.wraith.render.intro.IntroGate;
import com.lyhn.wraith.image.ClipboardImage;
import com.lyhn.wraith.mcp.McpServer;
import com.lyhn.wraith.mcp.McpServerManager;
import com.lyhn.wraith.mcp.McpServerStatus;
import com.lyhn.wraith.mcp.mention.AtMentionExpander;
import com.lyhn.wraith.plan.ExecutionPlan;
import com.lyhn.wraith.rag.CodeIndex;
import com.lyhn.wraith.hitl.ApprovalPolicy;
import com.lyhn.wraith.policy.AuditLog;
import com.lyhn.wraith.rag.CodeRetriever;
import com.lyhn.wraith.rag.CodeRelation;
import com.lyhn.wraith.rag.SearchResultFormatter;
import com.lyhn.wraith.runtime.CancellationContext;
import com.lyhn.wraith.runtime.CancellationToken;
import com.lyhn.wraith.runtime.api.RuntimeApiServer;
import com.lyhn.wraith.runtime.api.RuntimeThreadStore;
import com.lyhn.wraith.runtime.task.DurableTaskManager;
import com.lyhn.wraith.runtime.task.TaskCommandFormatter;
import com.lyhn.wraith.snapshot.RestoreResult;
import com.lyhn.wraith.snapshot.SnapshotService;
import com.lyhn.wraith.snapshot.TurnSnapshot;
import com.lyhn.wraith.skill.SkillRegistry;
import com.lyhn.wraith.tool.ToolRegistry;
import com.lyhn.wraith.util.AnsiStyle;
import com.lyhn.wraith.util.TerminalMarkdownRenderer;
import com.lyhn.wraith.wechat.IlinkClient;
import com.lyhn.wraith.wechat.WechatAccount;
import com.lyhn.wraith.wechat.WechatAccountStore;
import com.lyhn.wraith.wechat.WechatCommandMain;
import com.lyhn.wraith.wechat.WechatLoginResult;
import com.lyhn.wraith.wechat.WechatMessageLoop;
import com.lyhn.wraith.wechat.WechatQrLogin;
import org.jline.terminal.Terminal;
import org.jline.terminal.TerminalBuilder;
import org.jline.terminal.Attributes;
import org.jline.reader.Buffer;
import org.jline.reader.LineReader;
import org.jline.reader.LineReaderBuilder;
import org.jline.reader.MaskingCallback;
import org.jline.reader.EndOfFileException;
import org.jline.reader.History;
import org.jline.reader.UserInterruptException;
import org.jline.reader.Reference;
import org.jline.utils.NonBlockingReader;
import org.jline.utils.AttributedString;
import org.jline.widget.AutosuggestionWidgets;
import org.jline.widget.AutopairWidgets;
import org.jline.console.CmdDesc;
import org.jline.keymap.KeyMap;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Optional;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

/**
 * Wraith CLI v16.1.0 - Terminal-First Agent IDE
 * 支持 ReAct、Plan-and-Execute、Memory、RAG、Multi-Agent、HITL、并行工具调用、多模型切换、MCP、CDP 会话复用
 * 第 15 期新增：Skill 系统（三层加载 + load_skill 工具 + SkillContextBuffer 注入）、内置 web-access skill
 * 第 16 期新增：TUI 界面（Lanterna 3）、文件树浏览、代码高亮、对话历史可视化、配置管理面板
 * 第 16.1 期形态修正：抽出 Renderer 接口 + 三个实现（inline/lanterna/plain），默认形态切换为 inline 流式 TUI（Claude Code 风格）
 *   - inline 流式：prompt 下方 inline 状态区、行内可折叠工具块、行内 git diff、单字符 HITL 提示、命令 palette
 *   - lanterna：保留 phase-16 全屏窗口（向后兼容 WRAITH_TUI=true）
 *   - plain：纯 println 兜底
 * HITL 增强：路径围栏（PathGuard）、命令快速拒绝（CommandGuard）、操作审计链（AuditLog）—— 见 com.lyhn.wraith.policy
 */
public class Main {
    private static final String VERSION = "16.1.0";
    private static final String ENV_FILE = ".env";
    private static final String LOG_DIR_PROPERTY = "wraith.log.dir";
    private static final String LOG_LEVEL_PROPERTY = "wraith.log.level";
    private static final String LOG_MAX_HISTORY_PROPERTY = "wraith.log.maxHistory";
    private static final String LOG_MAX_FILE_SIZE_PROPERTY = "wraith.log.maxFileSize";
    private static final String LOG_TOTAL_SIZE_CAP_PROPERTY = "wraith.log.totalSizeCap";
    private static final String HISTORY_FILE_PROPERTY = "wraith.history.file";
    private static final String HISTORY_SIZE_PROPERTY = "wraith.history.size";
    private static final String HISTORY_FILE_SIZE_PROPERTY = "wraith.history.fileSize";
    private static final String DEFAULT_HISTORY_FILE_NAME = "input.history";
    private static final String BRACKETED_PASTE_BEGIN = "[200~";
    private static final String BRACKETED_PASTE_END = "\u001b[201~";
    private static final String ARROW_UP = "[A";
    private static final String ARROW_DOWN = "[B";
    private static final String APP_ARROW_UP = "OA";
    private static final String APP_ARROW_DOWN = "OB";
    private static final Pattern SENSITIVE_FLAG_VALUE = Pattern.compile(
            "(?i)(--?(?:api[_-]?key|authorization|password|passwd|secret|token)\\s+)(\\S+)");
    private static final Pattern SENSITIVE_ASSIGNMENT = Pattern.compile(
            "(?i)((?:api[_-]?key|authorization|password|passwd|secret|token)\\s*[=:]\\s*)(\\S+)");
    private static final int CTRL_O = 15;
    private static final String DEFAULT_CHROME_DEVTOOLS_MCP_JSON = """
            {
              "mcpServers": {
                "chrome-devtools": {
                  "command": "npx",
                  "args": ["-y", "chrome-devtools-mcp@latest", "--isolated=true"]
                }
              }
            }
            """;

    enum EscapeSequenceType {
        STANDALONE_ESC,
        BRACKETED_PASTE,
        CONTROL_SEQUENCE,
        OTHER
    }

    private record PromptInput(String text, boolean canceled) {
        static PromptInput submitted(String text) {
            return new PromptInput(text, false);
        }

        static PromptInput canceledInput() {
            return new PromptInput("", true);
        }
    }

    private record PrefillResult(String seedBuffer, boolean canceled, boolean submitted) {
        static PrefillResult canceledInput() {
            return new PrefillResult("", true, false);
        }

        static PrefillResult submittedInput() {
            return new PrefillResult("", false, true);
        }

        static PrefillResult seed(String seedBuffer) {
            return new PrefillResult(seedBuffer, false, false);
        }
    }

    private record KeyReadResult(Integer key, boolean ignoredControlSequence) {
        static KeyReadResult keyPressed(int key) {
            return new KeyReadResult(key, false);
        }

        static KeyReadResult ignoredSequence() {
            return new KeyReadResult(null, true);
        }

        static KeyReadResult unavailable() {
            return new KeyReadResult(null, false);
        }
    }

    private record StartupScreenInfo(
            String model,
            String provider,
            long mcpReady,
            int mcpTotal,
            int mcpTools,
            int skillsEnabled,
            int skillsTotal,
            String note
    ) {
    }

    public static void main(String[] args) {
        configureAwtForCli();
        if (WechatCommandMain.isWechatCommand(args)) {
            configureLogging();
            int code = WechatCommandMain.run(args);
            if (code != 0) {
                System.exit(code);
            }
            return;
        }
        if (isRuntimeServeCommand(args)) {
            configureLogging();
            startRuntimeApiAndBlock(args);
            return;
        }
        if (isAppServerCommand(args)) {
            startAppServer();
            return;
        }
        if (isGatewayCommand(args)) {
            configureLogging();
            com.lyhn.wraith.gateway.bind.BindCommand.dispatch(args);
            return;
        }

        configureLogging();

        WraithConfig config = WraithConfig.load();
        LlmClient llmClient = LlmClientFactory.createFromConfig(config);
        if (llmClient == null) {
            System.err.println("❌ 错误: 未找到可用的 API Key");
            System.err.println("请在 .env 文件中添加 GLM_API_KEY、DEEPSEEK_API_KEY、STEP_API_KEY、KIMI_API_KEY、FREELLMAPI_API_KEY 或 XFYUN_MAAS_API_KEY");
            System.exit(1);
        }
        AtomicReference<LlmClient> llmClientRef = new AtomicReference<>(llmClient);
        ResumeIntent resumeIntent = ResumeIntent.from(args); // --continue / --resume [id]

        // graphemeCluster(false): 禁掉 JLine 启动时的 mode 2027(grapheme cluster)探测。
        // 该探测会写 ESC[?2027$p(DECRQM 查询),不支持此查询的终端(如 Apple Terminal)
        // 会把序列尾字符 'p' 直接打印出来——表现为启动后左上角冒出一个 'p'。探测对这类终端
        // 本就返回 false(100ms 超时无应答),关掉它不丢任何能力,只是不再写那串探测字节。
        try (Terminal terminal = TerminalBuilder.builder().system(true).dumb(true).graphemeCluster(false).build()) {
            refreshTerminalColumns(terminal);
            TerminalHitlHandler terminalHitlHandler = new TerminalHitlHandler(false);
            SwitchableHitlHandler hitlHandler = new SwitchableHitlHandler(terminalHitlHandler);
            HitlToolRegistry hitlToolRegistry = new HitlToolRegistry(hitlHandler);
            BrowserSession browserSession = new BrowserSession();
            BrowserConnectivityCheck browserConnectivityCheck = new BrowserConnectivityCheck();
            hitlToolRegistry.setBrowserGuard(new BrowserGuard(browserSession, new SensitivePagePolicy()));
            McpServerManager mcpServerManager = new McpServerManager(hitlToolRegistry, Path.of("."));
            AtomicReference<SkillRegistry> skillRegistryRef = new AtomicReference<>();
            hitlToolRegistry.setBrowserConnector(new com.lyhn.wraith.browser.BrowserConnector() {
                @Override
                public String status() {
                    return handleBrowserCommand("status", browserSession, browserConnectivityCheck,
                            mcpServerManager, hitlToolRegistry, hitlHandler);
                }

                @Override
                public String connectDefault() {
                    return handleBrowserCommand("connect", browserSession, browserConnectivityCheck,
                            mcpServerManager, hitlToolRegistry, hitlHandler);
                }

                @Override
                public String disconnect() {
                    return handleBrowserCommand("disconnect", browserSession, browserConnectivityCheck,
                            mcpServerManager, hitlToolRegistry, hitlHandler);
                }
            });

            LineReader lineReader = LineReaderBuilder.builder()
                    .terminal(terminal)
                    .history(new WraithHistory())
                    .completer(new WraithCompleter(mcpServerManager::resourceCandidates,
                            () -> skillRegistryRef.get() == null ? List.of() : skillRegistryRef.get().allSkills()))
                    .highlighter(new WraithHighlighter())
                    .build();
            lineReader.option(LineReader.Option.BRACKETED_PASTE, true);
            lineReader.option(LineReader.Option.AUTO_LIST, true);
            lineReader.option(LineReader.Option.AUTO_MENU, true);
            configureHistory(lineReader, Path.of(System.getProperty("user.home")));
            configureSlashCommandHint(lineReader);
            configureJLineInteractiveWidgets(lineReader);

            // JLine-first：启动输出、命令输出、Agent 流式内容都走同一条 Renderer.stream() 通道。
            // inline 首屏要挂到 LineReader 首次初始化回调里，避免在 readLine 接管屏幕前用裸输出抢光标。
            Renderer renderer = RendererFactory.create(RendererFactory.resolveMode(), terminal);
            RendererHitlHandler rendererHitl = new RendererHitlHandler(renderer, hitlHandler.isEnabled());
            hitlHandler.setDelegate(rendererHitl);
            if (renderer instanceof InlineRenderer inline) {
                inline.bindLineReader(lineReader);
            }
            PrintStream ui = renderer.stream();
            clearTerminalScreen(terminal); // 启动先清屏(含回滚缓冲),再播开场动画 / 装常驻 banner
            playIntroIfEnabled(terminal, renderer);
            renderer.start();
            renderer.updateStatus(statusInfo(llmClient, hitlHandler, "idle", mcpServerManager, null));

            String startupNote = "";
            try {
                McpConfigBootstrapResult bootstrapResult = ensureDefaultMcpConfig(Path.of(System.getProperty("user.home")));
                if (!bootstrapResult.message().isBlank()) {
                    startupNote = bootstrapResult.message();
                }
                mcpServerManager.loadConfiguredServers();
                mcpServerManager.startAll(ui, mcpStartupWait());
                Runtime.getRuntime().addShutdownHook(new Thread(mcpServerManager::close, "wraith-mcp-shutdown"));
            } catch (Exception e) {
                startupNote = "MCP 初始化失败: " + e.getMessage();
            }
            AtMentionExpander mentionExpander = new AtMentionExpander(mcpServerManager);
            LocalPathMentionExpander localPathMentionExpander = new LocalPathMentionExpander(Path.of("."));

            // === Skill 系统初始化 ===
            Path home = Path.of(System.getProperty("user.home"));
            Path skillsCacheDir = home.resolve(".wraith/skills-cache");
            Path userSkillsDir = home.resolve(".wraith/skills");
            Path projectSkillsDir = Path.of(".wraith/skills").toAbsolutePath();
            try {
                new com.lyhn.wraith.skill.SkillBuiltinExtractor(skillsCacheDir).extractAll();
            } catch (Exception e) {
                startupNote = appendStartupNote(startupNote, "内置 skill 解压失败: " + e.getMessage());
            }
            com.lyhn.wraith.skill.SkillStateStore skillStateStore = new com.lyhn.wraith.skill.SkillStateStore(home.resolve(".wraith/skills.json"));
            com.lyhn.wraith.skill.SkillRegistry skillRegistry = new com.lyhn.wraith.skill.SkillRegistry(
                    skillsCacheDir, userSkillsDir, projectSkillsDir, skillStateStore);
            skillRegistry.reload();
            skillRegistryRef.set(skillRegistry);
            com.lyhn.wraith.skill.SkillContextBuffer skillContextBuffer = new com.lyhn.wraith.skill.SkillContextBuffer();
            hitlToolRegistry.setSkillRegistry(skillRegistry);
            hitlToolRegistry.setSkillContextBuffer(skillContextBuffer);

            Agent reactAgent = new Agent(llmClient, hitlToolRegistry);
            reactAgent.setExternalContextSupplier(mcpServerManager::resourceIndexForPrompt);
            reactAgent.setSkillRegistry(skillRegistry);
            reactAgent.setSkillContextBuffer(skillContextBuffer);
            DurableTaskManager taskManager = openTaskManager(llmClientRef);
            taskManager.start();
            Runtime.getRuntime().addShutdownHook(new Thread(taskManager::close, "wraith-task-shutdown"));
            WechatRuntimeController wechatRuntime = new WechatRuntimeController(renderer);
            Runtime.getRuntime().addShutdownHook(new Thread(wechatRuntime::stop, "wraith-wechat-shutdown"));
            renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
            StartupScreenInfo startupScreenInfo = startupScreenInfo(llmClient, mcpServerManager, skillRegistry, startupNote);
            if (renderer instanceof InlineRenderer inline) {
                // WRAITH 字标 + 信息行常驻冻结在左上角;Tips 走 printAbove 进滚动区,随对话滚走
                //(留住滚动区非空,避免 resize 后输入误锚顶部)。终端太矮/不支持则整块降级到滚动历史。
                boolean pinned = inline.installPinnedBanner(pinnedBannerContentLines(startupScreenInfo));
                inline.installStartupScreen(pinned
                        ? startupTipsLines(startupScreenInfo)
                        : startupScreenLines(startupScreenInfo));
            } else {
                printStartupScreen(ui, startupScreenInfo);
            }

            SessionStore sessionStore = SessionStore.open(home,
                    reactAgent.getToolRegistry().getProjectPath(),
                    llmClient.getProviderName(), llmClient.getModelName());
            applyResumeAtLaunch(resumeIntent, sessionStore, reactAgent, renderer, ui);
            reactAgent.getToolRegistry().setTodoSink(renderer::renderTodos); // 实时 TODO 面板(todo_write)

            boolean nextTaskUsePlanMode = false;
            boolean nextTaskUseTeamMode = false;

            // === TUI / CLI 分支判断 ===
            // 旧 WRAITH_TUI=true 路径仍走 Lanterna 全屏 TUI（Day 5 后由 LanternaRenderer 接管）。
            if (com.lyhn.wraith.tui.TuiBootstrap.shouldUseTui(terminal)) {
                try {
                    com.lyhn.wraith.tui.TuiBootstrap.launch(config, llmClient, reactAgent, hitlHandler);
                    return;  // TUI 启动成功，不进入 CLI 循环
                } catch (Exception e) {
                    hitlHandler.setDelegate(terminalHitlHandler);
                    System.err.println("❌ TUI 启动失败，降级到 CLI: " + e.getMessage());
                    e.printStackTrace();
                    // 降级到 CLI 继续执行
                }
            }

            reactAgent.setRenderer(renderer);
            reactAgent.setHitlEnabledSupplier(hitlHandler::isEnabled);
            reactAgent.getToolRegistry().setWriteFileObserver(
                    (path, ba) -> renderer.appendDiff(path, ba[0], ba[1]));

            // Day 3：inline 模式绑 Ctrl+O 到 BlockRegistry.toggleLast 实现折叠块展开/收起
            boolean spaciousPrompt = false;
            if (renderer instanceof InlineRenderer inline) {
                bindCtrlOToFoldableBlocks(lineReader, inline);
            }
            spaciousPrompt = defaultSpaciousPrompt(spaciousPrompt);
            bindCtrlVToClipboardImage(lineReader);
            bindEscToClearInput(lineReader);
            configureMultilineInput(lineReader, renderer);
            enableMouseIfAvailable(terminal, lineReader);

            while (true) {
                refreshTerminalColumns(terminal);
                PromptInput promptInput;
                try {
                    promptInput = readPromptInput(terminal, lineReader, renderer,
                            nextTaskUsePlanMode || nextTaskUseTeamMode, spaciousPrompt);
                } catch (UserInterruptException e) {
                    continue;  // Ctrl+C 跳过
                } catch (EndOfFileException e) {
                    break;  // Ctrl+D 退出
                }
                if (renderer instanceof InlineRenderer inline) {
                    inline.clearAcceptedInput(promptInput.text());
                }

                if (promptInput.canceled()) {
                    if (nextTaskUsePlanMode) {
                        nextTaskUsePlanMode = false;
                        ui.println("↩️ 已取消待执行的 Plan-and-Execute，回到默认 ReAct。\n");
                    }
                    if (nextTaskUseTeamMode) {
                        nextTaskUseTeamMode = false;
                        ui.println("↩️ 已取消待执行的 Multi-Agent，回到默认 ReAct。\n");
                    }
                    continue;
                }

                String input = promptInput.text().trim();

                if (input.isEmpty()) {
                    continue;
                }

                CliCommandParser.ParsedCommand command = CliCommandParser.parse(input);
                boolean submittedInputRendered = false;
                if (command.type() != CliCommandParser.CommandType.NONE) {
                    renderer.beginTurn();
                    printSubmittedInput(renderer, ui, input);
                    submittedInputRendered = true;
                }
                switch (command.type()) {
                    case UNKNOWN_COMMAND -> {
                        ui.println("❌ 未知命令: " + command.payload());
                        printSlashCommandHelp(ui);
                        continue;
                    }
                    case EXIT -> {
                        ui.println("\n👋 再见!");
                        wechatRuntime.stop();
                        renderer.close();
                        clearTerminalScreen(terminal); // 退出清屏:不留 TUI 内容,回到干净提示符
                        return;
                    }
                    case CANCEL -> {
                        ui.println("当前没有正在运行的任务。\n");
                        continue;
                    }
                    case CLEAR -> {
                        reactAgent.clearHistory();
                        hitlHandler.clearApprovedAll();
                        sessionStore.startNew(); // /clear 开新会话文件,旧会话留存
                        renderer.renderTodos(List.of()); // 清空实时 TODO 面板
                        renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                        ui.println("🗑️ 当前对话历史已清空，长期记忆保持不变\n");
                        continue;
                    }
                    case RESUME -> {
                        handleResumeCommand(command.payload(), sessionStore, reactAgent, renderer, ui);
                        continue;
                    }
                    case COMPACT -> {
                        renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "compacting"));
                        boolean activityPanel = renderer.supportsActivityPanel();
                        if (activityPanel) {
                            renderer.beginActivity("Compacting conversation", "正在整理早期对话并生成摘要");
                        } else {
                            ui.println("⏳ 压缩中，等一下下哦...\n");
                        }
                        Agent.CompactionResult result;
                        try {
                            result = reactAgent.compactHistoryNow();
                        } finally {
                            if (activityPanel) {
                                renderer.endActivity();
                            }
                            renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                        }
                        if (result.error() != null && !result.error().isBlank()) {
                            ui.println("❌ 手动压缩失败: " + result.error() + "\n");
                        } else if (result.compacted()) {
                            ui.printf("📦 已手动压缩历史上下文: %,d -> %,d tokens%n%n",
                                    result.beforeTokens(), result.afterTokens());
                        } else {
                            ui.println("📭 当前没有需要压缩的历史上下文\n");
                        }
                        continue;
                    }
                    case HISTORY_CLEAR -> {
                        clearLineReaderHistory(lineReader);
                        ui.println("🧹 输入历史已清空\n");
                        continue;
                    }
                    case INIT_PROJECT_MEMORY -> {
                        String payload = command.payload();
                        boolean force = payload != null && payload.trim().equalsIgnoreCase("--force");
                        if (payload != null && !payload.isBlank() && !force) {
                            ui.println("❌ 未知 /init 参数: " + payload);
                            ui.println("   用法: /init 或 /init --force\n");
                            continue;
                        }
                        try {
                            ProjectMemoryInitializer.InitResult result = ProjectMemoryInitializer.initialize(
                                    Path.of(reactAgent.getToolRegistry().getProjectPath()), force);
                            if (result.written()) {
                                ui.println("✅ " + result.message());
                                ui.println("   路径: " + result.path());
                                ui.println("   这份 WRAITH.md 会在后续 system prompt 的 Project Context 中注入。\n");
                            } else {
                                ui.println("ℹ️ " + result.message());
                                ui.println("   路径: " + result.path() + "\n");
                            }
                        } catch (IOException e) {
                            ui.println("❌ 生成 WRAITH.md 失败: " + e.getMessage() + "\n");
                        }
                        continue;
                    }
                    case CONTEXT_STATUS -> {
                        ui.println("📋 上下文状态：");
                        ui.println(reactAgent.getContextStatus());
                        ui.println();
                        continue;
                    }
                    case MEMORY_STATUS -> {
                        ui.println("📋 记忆系统状态：");
                        ui.println(reactAgent.getMemoryManager().getSystemStatus());
                        ui.println("   当前项目作用域: " + reactAgent.getMemoryManager().getCurrentProject());
                        ui.println("   /memory list - 查看长期记忆");
                        ui.println("   /memory search <关键词> - 搜索当前项目可见长期记忆");
                        ui.println("   /memory delete <id> - 删除单条长期记忆");
                        ui.println("   /memory clear - 清空长期记忆");
                        ui.println("   /save <事实> - 保存项目级长期记忆；/save --global <事实> 保存全局记忆");
                        ui.println();
                        continue;
                    }
                    case MEMORY_LIST -> {
                        List<MemoryEntry> entries = reactAgent.getMemoryManager().listLongTerm();
                        ui.println(formatMemoryEntries("📋 长期记忆列表", entries));
                        ui.println();
                        continue;
                    }
                    case MEMORY_SEARCH -> {
                        String query = command.payload();
                        if (query == null || query.isBlank()) {
                            ui.println("❌ 请提供搜索关键词，例如 /memory search Chrome 登录态\n");
                        } else {
                            List<MemoryEntry> entries = reactAgent.getMemoryManager().searchLongTerm(query, 20);
                            ui.println(formatMemoryEntries("🔎 长期记忆搜索: " + query, entries));
                            ui.println();
                        }
                        continue;
                    }
                    case MEMORY_DELETE -> {
                        String id = command.payload();
                        if (id == null || id.isBlank()) {
                            ui.println("❌ 请提供要删除的记忆 id，例如 /memory delete fact-abcd1234\n");
                        } else if (reactAgent.getMemoryManager().deleteLongTerm(id)) {
                            ui.println("🗑️ 已删除长期记忆: " + id + "\n");
                        } else {
                            ui.println("📭 未找到长期记忆: " + id + "\n");
                        }
                        continue;
                    }
                    case MEMORY_CLEAR -> {
                        reactAgent.getMemoryManager().clearLongTerm();
                        ui.println("🧹 长期记忆已清空\n");
                        ui.println();
                        continue;
                    }
                    case MEMORY_SAVE -> {
                        MemorySaveRequest saveRequest = parseMemorySave(command.payload());
                        if (saveRequest.fact().isEmpty()) {
                            ui.println("❌ 请提供要保存的内容，例如 /save 这个项目使用Java 17，或 /save --global 默认用中文回答\n");
                        } else {
                            reactAgent.getMemoryManager().storeFact(saveRequest.fact(), saveRequest.scope());
                            ui.println("💾 已保存到长期记忆(" + saveRequest.scope() + "): " + saveRequest.fact() + "\n");
                        }
                        continue;
                    }
                    case SWITCH_PLAN -> {
                        if (command.payload() == null || command.payload().isEmpty()) {
                            nextTaskUsePlanMode = true;
                            ui.println("📋 下一条任务将使用 Plan-and-Execute 模式，输入任务前按 ESC 可取消，执行完成后自动回到默认 ReAct。\n");
                            continue;
                        }
                        input = command.payload();
                    }
                    case SWITCH_TEAM -> {
                        if (command.payload() == null || command.payload().isEmpty()) {
                            nextTaskUseTeamMode = true;
                            ui.println("👥 下一条任务将使用 Multi-Agent 协作模式（规划者 + 执行者 + 检查者），输入任务前按 ESC 可取消，执行完成后自动回到默认 ReAct。\n");
                            continue;
                        }
                        input = command.payload();
                    }
                    case SWITCH_MODEL -> {
                        String selection = command.payload();
                        if (selection == null || selection.isEmpty()) {
                            ui.println("🤖 当前模型: " + llmClient.getModelName() + " (" + llmClient.getProviderName() + ")");
                            ui.println("   GLM 明确模型：");
                            ui.println("   /model glm-5.1       - 切换到 GLM-5.1");
                            ui.println("   /model glm-5v-turbo  - 切换到 GLM-5V-Turbo 多模态");
                            ui.println("   其它 provider 使用你配置里的具体模型：");
                            ui.println("   /model deepseek      - 切换到 DeepSeek（读取配置模型）");
                            ui.println("   /model step          - 切换到 StepFun（读取配置模型）");
                            ui.println("   /model kimi          - 切换到 Kimi（读取配置模型）");
                            ui.println("   /model freellmapi    - 切换到本地 FreeLLMAPI（读取配置模型）");
                            ui.println("   /model xfyun         - 切换到讯飞星辰 MaaS（读取配置模型）\n");
                        } else {
                            ModelSelection target = resolveModelSelection(selection);
                            if (target.explicitModel()) {
                                ensureProviderConfig(config, target.provider()).setModel(target.model());
                            }
                            LlmClient newClient = LlmClientFactory.create(target.provider(), config);
                            if (newClient == null) {
                                ui.println("❌ 切换失败：未配置 " + target.provider() + " 的 API Key\n");
                            } else {
                                llmClient = newClient;
                                llmClientRef.set(newClient);
                                config.setDefaultProvider(target.provider());
                                config.save();
                                reactAgent.setLlmClient(llmClient);
                                ui.println("✅ 已切换到: " + llmClient.getModelName() + " (" + llmClient.getProviderName() + ")");
                                ui.println("   上下文策略: " + reactAgent.getMemoryManager().getContextProfile().summary());
                                ui.println("   对话上下文已保留，使用 /clear 可清空\n");
                                renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                            }
                        }
                        continue;
                    }
                    case SWITCH_HITL -> {
                        String payload = command.payload();
                        if ("on".equals(payload)) {
                            hitlHandler.setEnabled(true);
                            ui.println("🔒 HITL 审批已启用：write_file / execute_command / create_project 执行前将请求人工确认\n");
                        } else if ("off".equals(payload)) {
                            hitlHandler.setEnabled(false);
                            hitlHandler.clearApprovedAll();
                            ui.println("🔓 HITL 审批已关闭：危险操作将直接执行\n");
                        } else {
                            String status = hitlHandler.isEnabled() ? "启用" : "关闭";
                            ui.println("🔒 HITL 当前状态：" + status);
                            ui.println("   /hitl on  - 启用人工审批");
                            ui.println("   /hitl off - 关闭人工审批\n");
                        }
                        renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                        continue;
                    }
                    case POLICY_STATUS -> {
                        printPolicyStatus(ui, reactAgent);
                        continue;
                    }
                    case CONFIG -> {
                        if (command.payload() == null || command.payload().isBlank()) {
                            handleConfigPalette(renderer, config, llmClient, hitlHandler, skillRegistry);
                        } else {
                            ui.println(handleConfigCommand(config, command.payload()));
                            renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                        }
                        continue;
                    }
                    case AUDIT_TAIL -> {
                        printAuditTail(ui, reactAgent, command.payload());
                        continue;
                    }
                    case SNAPSHOT -> {
                        printSnapshotCommand(ui, reactAgent.getToolRegistry().getSnapshotService(), command.payload());
                        continue;
                    }
                    case RESTORE_SNAPSHOT -> {
                        printRestoreCommand(ui, reactAgent.getToolRegistry().getSnapshotService(), command.payload());
                        continue;
                    }
                    case MCP_LIST -> {
                        ui.println(mcpServerManager.formatStatus());
                        ui.println();
                        continue;
                    }
                    case MCP_RESTART -> {
                        printMcpCommandResult(ui, mcpServerManager.restart(command.payload()));
                        renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                        continue;
                    }
                    case MCP_LOGS -> {
                        printMcpCommandResult(ui, mcpServerManager.logs(command.payload()));
                        continue;
                    }
                    case MCP_DISABLE -> {
                        printMcpCommandResult(ui, mcpServerManager.disable(command.payload()));
                        renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                        continue;
                    }
                    case MCP_ENABLE -> {
                        printMcpCommandResult(ui, mcpServerManager.enable(command.payload()));
                        renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                        continue;
                    }
                    case MCP_RESOURCES -> {
                        printMcpCommandResult(ui, mcpServerManager.resources(command.payload()));
                        continue;
                    }
                    case MCP_PROMPTS -> {
                        printMcpCommandResult(ui, mcpServerManager.prompts(command.payload()));
                        continue;
                    }
                    case BROWSER -> {
                        printMcpCommandResult(ui, handleBrowserCommand(
                                command.payload(),
                                browserSession,
                                browserConnectivityCheck,
                                mcpServerManager,
                                hitlToolRegistry,
                                hitlHandler));
                        continue;
                    }
                    case WECHAT -> {
                        ui.println(handleWechatCommand(command.payload(), lineReader, renderer, ui, wechatRuntime));
                        continue;
                    }
                    case TASK -> {
                        printMcpCommandResult(ui, TaskCommandFormatter.handle(taskManager, command.payload()));
                        continue;
                    }
                    case SKILL_LIST -> {
                        ui.println(SkillCommandHandler.list(skillRegistry));
                        continue;
                    }
                    case SKILL_SHOW -> {
                        ui.println(SkillCommandHandler.show(skillRegistry, command.payload()));
                        continue;
                    }
                    case SKILL_ON -> {
                        ui.println(SkillCommandHandler.enable(skillRegistry, skillStateStore, command.payload()));
                        renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                        continue;
                    }
                    case SKILL_OFF -> {
                        ui.println(SkillCommandHandler.disable(skillRegistry, skillStateStore, command.payload()));
                        renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                        continue;
                    }
                    case SKILL_RELOAD -> {
                        skillRegistry.reload();
                        ui.println("🔄 已重新扫描 skill 目录");
                        ui.println(SkillCommandHandler.startupSummary(skillRegistry));
                        ui.println("✅ 下一轮 LLM 调用生效");
                        renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                        continue;
                    }
                    case EXPORT -> {
                        handleExportCommand(ui, reactAgent);
                        continue;
                    }
                    case INDEX_CODE -> {
                        String indexPath = command.payload() != null ? command.payload() : ".";
                        CodeIndex indexer = new CodeIndex(ui::println);
                        indexer.index(indexPath);
                        ui.println();

                        // 同步项目路径到 ToolRegistry，让 search_code 工具可以正常工作
                        String absPath = new File(indexPath).getAbsolutePath();
                        reactAgent.getToolRegistry().setProjectPath(absPath);
                        reactAgent.getMemoryManager().setProjectPath(absPath);
                        continue;
                    }
                    case SEARCH_CODE -> {
                        String query = command.payload();
                        if (query == null || query.isEmpty()) {
                            ui.println("❌ 请提供检索关键词，例如 /search 用户登录实现\n");
                            continue;
                        }
                        ui.println("🔍 检索: " + query);
                        try (CodeRetriever retriever = new CodeRetriever(".")) {
                            var stats = retriever.getStats();
                            if (stats.chunkCount() == 0) {
                                ui.println("⚠️ 代码库尚未索引，请先使用 /index 命令\n");
                                continue;
                            }
                            List<com.lyhn.wraith.rag.VectorStore.SearchResult> results = retriever.hybridSearch(query, 5);
                            if (results.isEmpty()) {
                                ui.println("📭 未找到相关代码\n");
                            } else {
                                ui.println(SearchResultFormatter.formatForCli(query, results) + "\n");
                            }
                        } catch (Exception e) {
                            ui.println("❌ 检索失败: " + e.getMessage() + "\n");
                        }
                        continue;
                    }
                    case GRAPH_QUERY -> {
                        String className = command.payload();
                        if (className == null || className.isEmpty()) {
                            ui.println("❌ 请提供类名，例如 /graph Main\n");
                            continue;
                        }
                        ui.println("🕸️ 查询类关系图谱: " + className);
                        try (CodeRetriever retriever = new CodeRetriever(".")) {
                            var stats = retriever.getStats();
                            if (stats.chunkCount() == 0) {
                                ui.println("⚠️ 代码库尚未索引，请先使用 /index 命令\n");
                                continue;
                            }
                            List<CodeRelation> relations = retriever.getRelationGraph(className);
                            if (relations.isEmpty()) {
                                ui.println("📭 未找到相关关系\n");
                            } else {
                                ui.println("📋 找到 " + relations.size() + " 条关系:\n");
                                for (CodeRelation rel : relations) {
                                    String arrow = rel.relationType().equals("contains") ? "├── contains -->"
                                            : rel.relationType().equals("extends") ? "└── extends -->"
                                            : rel.relationType().equals("implements") ? "└── implements -->"
                                            : rel.relationType().equals("calls") ? "├── calls -->"
                                            : "├── " + rel.relationType() + " -->";
                                    ui.printf("   %s %s [%s]%n", rel.fromName(), arrow,
                                            rel.toName() != null ? rel.toName() : "unknown");
                                }
                                ui.println();
                            }
                        } catch (Exception e) {
                            ui.println("❌ 查询失败: " + e.getMessage() + "\n");
                        }
                        continue;
                    }
                    case NONE -> {
                    }
                }

                // 运行 Agent
                String submittedInput = input;
                input = mentionExpander.expand(input);
                input = localPathMentionExpander.expand(input);
                if (!(renderer instanceof InlineRenderer)) {
                    ui.println();
                }
                if (!submittedInputRendered) {
                    renderer.beginTurn();
                    printSubmittedInput(renderer, ui, submittedInput);
                }
                final String taskInput = input;
                Callable<String> runTask;
                String snapshotMode;
                if (nextTaskUsePlanMode || command.type() == CliCommandParser.CommandType.SWITCH_PLAN) {
                    snapshotMode = "plan";
                    LlmClient activeClient = llmClient;
                    runTask = () -> {
                        PlanExecuteAgent planAgent = createPlanAgent(activeClient, reactAgent, terminal, lineReader, ui);
                        planAgent.setExternalContextSupplier(mcpServerManager::resourceIndexForPrompt);
                        planAgent.setSkillRegistry(skillRegistry);
                        planAgent.setSkillContextBuffer(skillContextBuffer);
                        return planAgent.run(taskInput);
                    };
                } else if (nextTaskUseTeamMode || command.type() == CliCommandParser.CommandType.SWITCH_TEAM) {
                    snapshotMode = "team";
                    LlmClient activeClient = llmClient;
                    runTask = () -> {
                        AgentOrchestrator orchestrator = createTeamAgent(activeClient, reactAgent, ui);
                        orchestrator.setExternalContextSupplier(mcpServerManager::resourceIndexForPrompt);
                        orchestrator.setSkillSystem(skillRegistry, skillContextBuffer);
                        return orchestrator.run(taskInput);
                    };
                } else {
                    snapshotMode = "react";
                    runTask = () -> reactAgent.run(taskInput);
                }
                SnapshotService snapshotService = reactAgent.getToolRegistry().getSnapshotService();
                renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, snapshotMode));
                String response = runWithCancelSupport(terminal,
                        ui,
                        () -> snapshotService.runTurn(snapshotMode, taskInput, runTask::call));
                if (!"react".equals(snapshotMode)) {
                    renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                }
                nextTaskUsePlanMode = false;
                nextTaskUseTeamMode = false;
                if (response != null && !response.isBlank()) {
                    ui.println(response);
                    ui.println();
                }
                sessionStore.persist(reactAgent.getConversationHistory()); // 每轮落盘,供续接
            }
            ui.println("\n👋 再见!");
            wechatRuntime.stop();
            renderer.close();
            clearTerminalScreen(terminal); // 退出清屏(Ctrl+D 路径):不留 TUI 内容

        } catch (IOException e) {
            System.err.println("❌ 终端初始化失败: " + e.getMessage());
            System.exit(1);
        }
    }

    /** 启动参数里的会话续接意图:--continue / --resume [id]。 */
    private record ResumeIntent(Mode mode, String id) {
        enum Mode { NONE, CONTINUE, PICK, ID }

        static ResumeIntent from(String[] args) {
            if (args == null) {
                return new ResumeIntent(Mode.NONE, null);
            }
            for (int i = 0; i < args.length; i++) {
                String a = args[i];
                if ("--continue".equalsIgnoreCase(a) || "-c".equalsIgnoreCase(a)) {
                    return new ResumeIntent(Mode.CONTINUE, null);
                }
                if ("--resume".equalsIgnoreCase(a) || "-r".equalsIgnoreCase(a)) {
                    String next = i + 1 < args.length ? args[i + 1] : null;
                    if (next != null && !next.startsWith("-")) {
                        return new ResumeIntent(Mode.ID, next.trim());
                    }
                    return new ResumeIntent(Mode.PICK, null);
                }
            }
            return new ResumeIntent(Mode.NONE, null);
        }
    }

    /** 启动时按意图续接(--continue 接最近 / --resume id 直接接 / --resume 弹面板)。 */
    private static void applyResumeAtLaunch(ResumeIntent intent, SessionStore store, Agent agent,
                                            Renderer renderer, PrintStream ui) {
        if (intent == null) {
            return;
        }
        switch (intent.mode()) {
            case CONTINUE -> {
                Optional<SessionMeta> latest = store.latest();
                if (latest.isPresent()) {
                    restoreSessionById(store, agent, renderer, ui, latest.get().id(), latest.get().title());
                } else {
                    ui.println("ℹ️ 本项目无可续接会话,开新会话\n");
                }
            }
            case ID -> {
                if (!restoreSessionById(store, agent, renderer, ui, intent.id(), null)) {
                    ui.println("⚠️ 未找到会话 " + intent.id() + ",开新会话\n");
                }
            }
            case PICK -> pickAndRestoreSession(store, agent, renderer, ui);
            default -> {
            }
        }
    }

    /** 会话内 /resume:带 id 直接接,否则弹面板选。 */
    private static void handleResumeCommand(String payload, SessionStore store, Agent agent,
                                            Renderer renderer, PrintStream ui) {
        if (payload != null && !payload.isBlank()) {
            if (!restoreSessionById(store, agent, renderer, ui, payload.trim(), null)) {
                ui.println("⚠️ 未找到会话 " + payload.trim() + "\n");
            }
            return;
        }
        pickAndRestoreSession(store, agent, renderer, ui);
    }

    private static void pickAndRestoreSession(SessionStore store, Agent agent, Renderer renderer, PrintStream ui) {
        List<SessionMeta> metas = store.list(20);
        if (metas.isEmpty()) {
            ui.println("📭 本项目暂无历史会话\n");
            return;
        }
        List<String> items = new ArrayList<>();
        for (SessionMeta m : metas) {
            items.add(formatSessionItem(m));
        }
        int idx = renderer.openPalette("续接会话", items);
        if (idx < 0 || idx >= metas.size()) {
            ui.println("已取消\n");
            return;
        }
        SessionMeta chosen = metas.get(idx);
        restoreSessionById(store, agent, renderer, ui, chosen.id(), chosen.title());
    }

    private static boolean restoreSessionById(SessionStore store, Agent agent, Renderer renderer, PrintStream ui,
                                              String id, String titleHint) {
        List<LlmClient.Message> msgs = store.resume(id);
        if (msgs.isEmpty()) {
            return false;
        }
        agent.restoreHistory(msgs);
        String title = titleHint != null && !titleHint.isBlank() ? titleHint : id;
        // beginTurn 释放冻结 banner(启动续接时)并清理流式状态,随后把历史对话整段回放到
        // transcript —— 否则用户只看到一行摘要,看不到“完整内容”。
        renderer.beginTurn();
        ui.println("🔄 已恢复会话「" + title + "」· " + msgs.size() + " 条上下文");
        ui.println(AnsiStyle.subtle("──────── 以下为历史对话 ────────"));
        ui.println();
        replayConversation(renderer, ui, msgs);
        ui.println(AnsiStyle.subtle("──────── 历史结束,可继续对话 ────────"));
        ui.println();
        return true;
    }

    /**
     * 续接会话后把历史对话回放到 transcript,让用户看到完整上下文。
     * 渲染方式对齐实时输出:user → 用户块、assistant 正文 → Markdown、assistant 工具调用 → 折叠块。
     * 跳过 system(在 system prompt 内)与 tool 结果(模型内部上下文,已由折叠的工具调用块代表)。
     */
    static void replayConversation(Renderer renderer, PrintStream ui, List<LlmClient.Message> msgs) {
        if (msgs == null || msgs.isEmpty()) {
            return;
        }
        int cols = Math.max(20, renderer.terminalColumns());
        for (LlmClient.Message m : msgs) {
            if (m == null) {
                continue;
            }
            String role = m.role();
            String content = m.content();
            if ("user".equals(role)) {
                if (content != null && !content.isBlank()) {
                    printSubmittedInput(renderer, ui, content);
                }
            } else if ("assistant".equals(role)) {
                if (content != null && !content.isBlank()) {
                    String rendered = TerminalMarkdownRenderer.render(content, cols);
                    ui.print(rendered);
                    if (!rendered.endsWith("\n")) {
                        ui.println();
                    }
                }
                if (m.toolCalls() != null && !m.toolCalls().isEmpty()) {
                    renderer.appendToolCalls(m.toolCalls());
                }
            }
        }
    }

    private static String formatSessionItem(SessionMeta m) {
        String title = m.title() == null || m.title().isBlank() ? "(无标题)" : m.title();
        return title + "   ·   " + relativeTime(m.updatedAt()) + "   ·   " + m.turns() + " 轮   ·   " + m.model();
    }

    private static String relativeTime(String iso) {
        if (iso == null) {
            return "?";
        }
        try {
            long sec = Math.max(0, Duration.between(Instant.parse(iso), Instant.now()).getSeconds());
            if (sec < 60) {
                return sec + " 秒前";
            }
            if (sec < 3600) {
                return (sec / 60) + " 分钟前";
            }
            if (sec < 86400) {
                return (sec / 3600) + " 小时前";
            }
            return (sec / 86400) + " 天前";
        } catch (Exception e) {
            return iso;
        }
    }

    private static boolean isRuntimeServeCommand(String[] args) {
        return args != null
                && args.length >= 1
                && "serve".equalsIgnoreCase(args[0])
                && java.util.Arrays.stream(args).anyMatch("--http"::equalsIgnoreCase);
    }

    private static void startRuntimeApiAndBlock(String[] args) {
        WraithConfig config = WraithConfig.load();
        LlmClient client = LlmClientFactory.createFromConfig(config);
        if (client == null) {
            System.err.println("❌ 错误: 未找到可用的 API Key");
            System.exit(1);
        }
        int port = parseServePort(args, 8080);
        try {
            RuntimeThreadStore store = new RuntimeThreadStore(RuntimeThreadStore.defaultDbPath());
            RuntimeApiServer server = new RuntimeApiServer(
                    store,
                    prompt -> runHeadlessTask(prompt, client),
                    port,
                    RuntimeApiServer.configuredApiKey());
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                server.close();
                store.close();
            }, "wraith-runtime-api-shutdown"));
            server.start();
            System.out.println("✅ Wraith CLI Runtime API 已启动: http://127.0.0.1:" + server.port());
            System.out.println("   认证: Authorization: Bearer <WRAITH_RUNTIME_API_KEY>");
            new CountDownLatch(1).await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            System.err.println("❌ Runtime API 启动失败: " + e.getMessage());
            System.exit(1);
        }
    }

    static boolean isAppServerCommand(String[] args) {
        return args != null && args.length >= 1 && "app-server".equalsIgnoreCase(args[0]);
    }

    static boolean isGatewayCommand(String[] args) {
        return args != null && args.length >= 1 && "gateway".equalsIgnoreCase(args[0]);
    }

    private static void startAppServer() {
        // stdout 纯净：真 stdout 留给 JSON-RPC，其它一切打到 stderr
        java.io.PrintStream realOut = System.out;
        System.setOut(System.err);
        configureLogging(); // logback 写文件，不污染 stdout

        com.lyhn.wraith.config.WraithConfig config = com.lyhn.wraith.config.WraithConfig.load();
        com.lyhn.wraith.llm.LlmClient client = com.lyhn.wraith.llm.LlmClientFactory.createFromConfig(config);
        if (client == null) {
            System.err.println("app-server: 未找到可用 API Key");
            System.exit(1);
        }

        com.lyhn.wraith.runtime.appserver.AppServerMcp appServerMcp =
                new com.lyhn.wraith.runtime.appserver.AppServerMcp();

        com.lyhn.wraith.runtime.appserver.AppServer server =
            new com.lyhn.wraith.runtime.appserver.AppServer(System.in, realOut, (writer, sessionId, workspaceDir) -> {
                com.lyhn.wraith.runtime.appserver.EventStreamRenderer renderer =
                        new com.lyhn.wraith.runtime.appserver.EventStreamRenderer(writer, sessionId);

                com.lyhn.wraith.hitl.TerminalHitlHandler terminal =
                        new com.lyhn.wraith.hitl.TerminalHitlHandler(false);
                com.lyhn.wraith.hitl.SwitchableHitlHandler hitl =
                        new com.lyhn.wraith.hitl.SwitchableHitlHandler(terminal);
                hitl.setEnabled(true); // 开 HITL，审批走 EventStreamRenderer
                com.lyhn.wraith.hitl.HitlToolRegistry registry =
                        new com.lyhn.wraith.hitl.HitlToolRegistry(hitl);
                String root = (workspaceDir != null && !workspaceDir.isBlank())
                        ? workspaceDir
                        : java.nio.file.Path.of(".").toAbsolutePath().normalize().toString();
                appServerMcp.ensureFor(root, registry, renderer);
                registry.setProjectPath(root);
                registry.setWriteFileObserver((path, ba) -> renderer.appendDiff(path, ba[0], ba[1]));
                registry.setCommandSandbox(buildAppServerSandbox()); // ← 新增:命令走 Seatbelt 沙箱
                registry.setCommandOutputObserver(new com.lyhn.wraith.tool.ToolRegistry.CommandOutputObserver() {
                    public void onChunk(String callId, String stream, String chunk) {
                        renderer.appendToolOutputDelta(callId, stream, chunk);
                    }
                    public void onResult(String callId, boolean ok, int exitCode) {
                        renderer.appendToolResult(callId, ok, exitCode);
                    }
                });

                // 可变 client 持有(会话级 provider 切换用)
                com.lyhn.wraith.llm.LlmClient[] currentClient = { client };

                com.lyhn.wraith.agent.Agent agent = new com.lyhn.wraith.agent.Agent(currentClient[0], registry);
                agent.setRenderer(renderer);

                // ── Skill 系统接线(复刻交互路径:让 load_skill 可用 + 技能索引进系统提示)──
                java.nio.file.Path skHome = java.nio.file.Path.of(System.getProperty("user.home"));
                java.nio.file.Path skCacheDir = skHome.resolve(".wraith/skills-cache");
                java.nio.file.Path skUserDir = skHome.resolve(".wraith/skills");
                java.nio.file.Path skProjectDir = java.nio.file.Path.of(root).resolve(".wraith/skills");
                try {
                    new com.lyhn.wraith.skill.SkillBuiltinExtractor(skCacheDir).extractAll();
                } catch (Exception ex) {
                    System.err.println("内置 skill 解压失败: " + ex.getMessage());
                }
                com.lyhn.wraith.skill.SkillStateStore skillStateStore =
                        new com.lyhn.wraith.skill.SkillStateStore(skHome.resolve(".wraith/skills.json"));
                com.lyhn.wraith.skill.SkillRegistry skillRegistry = new com.lyhn.wraith.skill.SkillRegistry(
                        skCacheDir, skUserDir, skProjectDir, skillStateStore);
                skillRegistry.reload();
                com.lyhn.wraith.skill.SkillStore skillStore =
                        new com.lyhn.wraith.skill.SkillStore(skUserDir, skProjectDir);
                com.lyhn.wraith.skill.SkillContextBuffer skillContextBuffer =
                        new com.lyhn.wraith.skill.SkillContextBuffer();
                registry.setSkillRegistry(skillRegistry);
                registry.setSkillContextBuffer(skillContextBuffer);
                agent.setSkillRegistry(skillRegistry);
                agent.setSkillContextBuffer(skillContextBuffer);

                com.lyhn.wraith.session.SessionStore sessionStore =
                        com.lyhn.wraith.session.SessionStore.open(
                                java.nio.file.Path.of(System.getProperty("user.home")),
                                root, currentClient[0].getProviderName(), currentClient[0].getModelName());
                sessionStore.startNew();

                com.lyhn.wraith.hitl.RendererHitlHandler rendererHitl =
                        new com.lyhn.wraith.hitl.RendererHitlHandler(renderer, hitl.isEnabled());
                hitl.setDelegate(rendererHitl);

                // resume 后若 provider 恢复失败,置此标志供 modelList 回传 modelFallback
                boolean[] resumeFallback = { false };

                return new com.lyhn.wraith.runtime.appserver.AppServer.SessionRunner() {
                    public com.lyhn.wraith.runtime.appserver.EventStreamRenderer renderer() { return renderer; }
                    public String runTurn(String input) throws Exception {
                        String expanded = input;
                        com.lyhn.wraith.mcp.McpServerManager m = appServerMcp.manager();
                        if (m != null) {
                            // @server:uri 展开(失败注入 <resource_error>,永不失败整轮)
                            expanded = new com.lyhn.wraith.mcp.mention.AtMentionExpander(m).expand(input);
                        }
                        return agent.run(expanded);
                    }
                    public String runTurn(String input, java.util.List<com.lyhn.wraith.llm.LlmClient.ContentPart> imageParts,
                                         java.util.List<String> imageNames) throws Exception {
                        String expanded = input;
                        com.lyhn.wraith.mcp.McpServerManager m = appServerMcp.manager();
                        if (m != null) expanded = new com.lyhn.wraith.mcp.mention.AtMentionExpander(m).expand(input);
                        return imageParts == null || imageParts.isEmpty()
                                ? agent.run(expanded) : agent.run(expanded, imageParts, imageNames);
                    }
                    public com.lyhn.wraith.runtime.appserver.McpOps mcp() { return appServerMcp; }
                    public void setApprovalMode(boolean auto) { hitl.setEnabled(!auto); }
                    public java.util.List<com.lyhn.wraith.session.SessionMeta> listSessions() {
                        return sessionStore.list(50);
                    }
                    public java.util.List<com.lyhn.wraith.llm.LlmClient.Message> resume(String id) {
                        java.util.List<com.lyhn.wraith.llm.LlmClient.Message> msgs = sessionStore.resume(id);
                        agent.restoreHistory(msgs);
                        resumeFallback[0] = false; // 每次 resume 复位
                        // 按 meta.provider 尝试恢复 client(会话级;失败保持当前+标记 fallback)
                        com.lyhn.wraith.session.SessionMeta meta = sessionStore.meta(id);
                        if (meta != null && meta.provider() != null && !meta.provider().isBlank()) {
                            com.lyhn.wraith.llm.LlmClient restored =
                                    com.lyhn.wraith.llm.LlmClientFactory.create(meta.provider(), config);
                            if (restored != null) {
                                currentClient[0] = restored;
                                agent.setLlmClient(restored);
                                sessionStore.setProviderModel(restored.getProviderName(), restored.getModelName());
                            } else {
                                // 无 key → 保持当前 client,标记 fallback
                                resumeFallback[0] = true;
                            }
                        }
                        return msgs;
                    }
                    public String persistTurn() {
                        sessionStore.persist(agent.getConversationHistory());
                        return sessionStore.currentId();
                    }
                    public boolean rewind(int userOrdinal) {
                        java.util.List<com.lyhn.wraith.llm.LlmClient.Message> kept =
                                truncateAtUserOrdinal(agent.getConversationHistory(), userOrdinal);
                        if (kept == null) return false;
                        agent.restoreHistory(kept);
                        boolean hasUser = kept.stream().anyMatch(m -> "user".equals(m.role()));
                        if (hasUser) {
                            sessionStore.persist(kept);
                        } else {
                            // 裁到只剩 system = 会话清空:persist 对空对话不写盘,直接删文件防旧内容残留
                            sessionStore.deleteCurrent();
                        }
                        return true;
                    }
                    public java.util.Map<String, Object> modelList() {
                        return com.lyhn.wraith.runtime.appserver.ModelCatalog.result(
                                config,
                                currentClient[0].getProviderName(),
                                currentClient[0].getModelName(),
                                resumeFallback[0]);
                    }
                    public java.util.Map<String, Object> sessionSetModel(String provider) {
                        com.lyhn.wraith.llm.LlmClient newClient =
                                com.lyhn.wraith.llm.LlmClientFactory.create(provider, config);
                        if (newClient == null) {
                            throw new IllegalArgumentException("未配置 " + provider + " 的 API Key");
                        }
                        currentClient[0] = newClient;
                        agent.setLlmClient(newClient);
                        sessionStore.setProviderModel(newClient.getProviderName(), newClient.getModelName());
                        return java.util.Map.of(
                                "provider", newClient.getProviderName(),
                                "model", newClient.getModelName());
                    }
                    public java.util.Map<String, Object> configSetDefaultProvider(String provider) {
                        com.lyhn.wraith.llm.LlmClient check =
                                com.lyhn.wraith.llm.LlmClientFactory.create(provider, config);
                        if (check == null) {
                            throw new IllegalArgumentException("未配置 " + provider + " 的 API Key");
                        }
                        config.setDefaultProvider(provider);
                        config.save();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String, Object> configSetProvider(String id, String apiKey, String model, String baseUrl, String protocol, String label) {
                        com.lyhn.wraith.config.WraithConfig.ProviderConfig pc =
                            config.getProviders().getOrDefault(id, new com.lyhn.wraith.config.WraithConfig.ProviderConfig());
                        if (apiKey != null && !apiKey.isBlank()) pc.setApiKey(apiKey);   // 空=不改现有 key
                        if (model != null) pc.setModel(model);
                        if (baseUrl != null) pc.setBaseUrl(baseUrl);
                        if (protocol != null) pc.setProtocol(protocol);
                        if (label != null) pc.setLabel(label);
                        config.getProviders().put(id, pc);
                        config.save();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String, Object> configRemoveProvider(String id) {
                        config.getProviders().remove(id);
                        if (id.equals(config.getDefaultProvider())) {
                            // 回落到下一个有 key 的 provider(否则保留原值)
                            for (java.util.Map.Entry<String, com.lyhn.wraith.config.WraithConfig.ProviderConfig> e : config.getProviders().entrySet())
                                if (e.getValue() != null && e.getValue().getApiKey() != null && !e.getValue().getApiKey().isBlank()) {
                                    config.setDefaultProvider(e.getKey()); break;
                                }
                        }
                        config.save();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String, Object> configTestProvider(String id, String apiKey, String model, String baseUrl, String protocol) {
                        // 用表单值构造临时 config:先继承已存条目,再按传入非空值覆写(apiKey 空=沿用已存)
                        com.lyhn.wraith.config.WraithConfig tmp = new com.lyhn.wraith.config.WraithConfig();
                        com.lyhn.wraith.config.WraithConfig.ProviderConfig existing = config.getProviders().get(id);
                        com.lyhn.wraith.config.WraithConfig.ProviderConfig pc =
                            new com.lyhn.wraith.config.WraithConfig.ProviderConfig();
                        if (existing != null) {
                            pc.setApiKey(existing.getApiKey());
                            pc.setModel(existing.getModel());
                            pc.setBaseUrl(existing.getBaseUrl());
                            pc.setProtocol(existing.getProtocol());
                            pc.setLoraId(existing.getLoraId());
                        }
                        if (apiKey != null && !apiKey.isBlank()) pc.setApiKey(apiKey);
                        if (model != null && !model.isBlank()) pc.setModel(model);
                        if (baseUrl != null && !baseUrl.isBlank()) pc.setBaseUrl(baseUrl);
                        if (protocol != null && !protocol.isBlank()) pc.setProtocol(protocol);
                        tmp.getProviders().put(id, pc);
                        com.lyhn.wraith.llm.LlmClient probe =
                            com.lyhn.wraith.llm.LlmClientFactory.create(id, tmp);
                        if (probe == null) return java.util.Map.of("ok", false, "error", "缺少 API Key");
                        long t0 = System.nanoTime();
                        try {
                            probe.chat(java.util.List.of(com.lyhn.wraith.llm.LlmClient.Message.user("ping")),
                                       java.util.List.of());
                            long ms = (System.nanoTime() - t0) / 1_000_000L;
                            return java.util.Map.of("ok", true, "model", probe.getModelName(), "latencyMs", ms);
                        } catch (Exception e) {
                            String em = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                            em = redactKey(em, tmp.getApiKey(id));
                            if (em.length() > 300) em = em.substring(0, 300);
                            return java.util.Map.of("ok", false, "error", em);
                        }
                    }
                    public boolean setSessionStarred(String id, boolean starred) {
                        return sessionStore.setStarred(id, starred);
                    }
                    public boolean renameSession(String id, String name) {
                        return sessionStore.rename(id, name);
                    }
                    public boolean deleteSession(String id) {
                        return sessionStore.deleteById(id);
                    }
                    public java.util.Map<String, Object> skillsList() {
                        java.util.List<java.util.Map<String, Object>> list = new java.util.ArrayList<>();
                        java.util.Set<String> disabled = skillRegistry.stateStore().disabled();
                        for (com.lyhn.wraith.skill.Skill s : skillRegistry.allSkills()) {
                            java.util.Map<String, Object> v = new java.util.LinkedHashMap<>();
                            v.put("name", s.name());
                            v.put("description", s.description());
                            v.put("version", s.version() != null ? s.version() : "");
                            v.put("author", s.author() != null ? s.author() : "");
                            v.put("tags", s.tags());
                            v.put("source", s.displaySource());
                            v.put("enabled", !disabled.contains(s.name()));
                            list.add(v);
                        }
                        return java.util.Map.of("skills", list);
                    }
                    public java.util.Map<String, Object> skillsSetEnabled(String name, boolean enabled) {
                        if (enabled) skillRegistry.stateStore().enable(name);
                        else skillRegistry.stateStore().disable(name);
                        skillRegistry.reload();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String,Object> skillsGet(String name) {
                        com.lyhn.wraith.skill.Skill s = skillRegistry.findAnySkill(name);
                        if (s == null) throw new IllegalArgumentException("技能不存在: " + name);
                        java.util.Map<String,Object> v = new java.util.LinkedHashMap<>();
                        v.put("name", s.name());
                        v.put("description", s.description());
                        v.put("version", s.version() != null ? s.version() : "");
                        v.put("author", s.author() != null ? s.author() : "");
                        v.put("tags", s.tags());
                        v.put("source", s.displaySource());
                        v.put("enabled", !skillRegistry.stateStore().disabled().contains(s.name()));
                        v.put("body", s.body());
                        return v;
                    }
                    public java.util.Map<String,Object> skillsUpsert(String scope, String name, String description,
                            String version, String author, java.util.List<String> tags, String body) {
                        try { skillStore.upsert(scope, name, description, version, author, tags, body); }
                        catch (java.io.IOException e) { throw new RuntimeException("写入技能失败: " + e.getMessage(), e); }
                        skillRegistry.reload();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String,Object> skillsDelete(String scope, String name) {
                        try { skillStore.delete(scope, name); }
                        catch (java.io.IOException e) { throw new RuntimeException("删除技能失败: " + e.getMessage(), e); }
                        skillRegistry.reload();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String,Object> skillsExistsInScope(String scope, String name) {
                        return java.util.Map.of("exists", skillStore.existsInScope(scope, name));
                    }
                    public java.util.Map<String,Object> skillsFork(String name) {
                        com.lyhn.wraith.skill.Skill s = skillRegistry.findAnySkill(name);
                        if (s == null) throw new IllegalArgumentException("技能不存在: " + name);
                        try { skillStore.upsert("user", s.name(), s.description(), s.version(), s.author(), s.tags(), s.body()); }
                        catch (java.io.IOException e) { throw new RuntimeException("复制技能失败: " + e.getMessage(), e); }
                        skillRegistry.reload();
                        return java.util.Map.of("ok", true, "name", s.name());
                    }
                    public java.util.Map<String, Object> sttTranscribe(String audioBase64, String mime) {
                        String pid = config.getSttProviderId();
                        String apiKey = config.getApiKey(pid);
                        if (apiKey == null || apiKey.isBlank())
                            throw new IllegalArgumentException("STT 未配置:请先在 Provider 配置里为 " + pid + " 填好 API Key");
                        String baseUrl = config.getBaseUrl(pid);
                        if (baseUrl == null || baseUrl.isBlank()) baseUrl = "https://api.siliconflow.cn/v1";
                        String model = config.getSttModel();
                        byte[] audio = java.util.Base64.getDecoder().decode(audioBase64);
                        try {
                            String text = new com.lyhn.wraith.stt.SttClient()
                                    .transcribe(audio, mime, apiKey, baseUrl, model);
                            return java.util.Map.of("text", text);
                        } catch (IllegalArgumentException e) {
                            throw e;
                        } catch (Exception e) {
                            String em = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                            em = redactKey(em, apiKey);
                            if (em.length() > 300) em = em.substring(0, 300);
                            throw new RuntimeException(em);
                        }
                    }
                    // ── mode=plan 覆写：组装 PlanExecuteAgent 并路由到桌面事件流 ──────────────
                    @Override
                    public String runTurn(String input,
                                         java.util.List<com.lyhn.wraith.llm.LlmClient.ContentPart> imageParts,
                                         java.util.List<String> imageNames,
                                         String mode) throws Exception {
                        if (!"plan".equals(mode)) {
                            // ReAct 原路径：委托三参重载
                            return runTurn(input, imageParts, imageNames);
                        }
                        // @-mention 展开(与 ReAct 路径保持一致)
                        String expanded = input;
                        com.lyhn.wraith.mcp.McpServerManager m = appServerMcp.manager();
                        if (m != null) expanded = new com.lyhn.wraith.mcp.mention.AtMentionExpander(m).expand(input);
                        final String goal = expanded;

                        // 本轮合成 planId(禁用 Date/random，用 identityHashCode)
                        String planId = "plan_" + java.lang.System.identityHashCode(goal);

                        // 复审桥：计划生成 → 路由到 UI → 映射回 PlanReviewDecision
                        com.lyhn.wraith.agent.PlanExecuteAgent.PlanReviewHandler reviewHandler = (g, plan) -> {
                            java.util.List<java.util.Map<String, Object>> steps =
                                    com.lyhn.wraith.runtime.appserver.EventStreamPlanListener.stepsOf(plan);
                            com.lyhn.wraith.runtime.appserver.EventStreamRenderer.PlanReviewOutcome outcome =
                                    renderer.requestPlanReview(planId, g, steps);
                            return switch (outcome.decision()) {
                                case "supplement" ->
                                        com.lyhn.wraith.agent.PlanExecuteAgent.PlanReviewDecision.supplement(outcome.feedback());
                                case "cancel" ->
                                        com.lyhn.wraith.agent.PlanExecuteAgent.PlanReviewDecision.cancel();
                                default ->
                                        com.lyhn.wraith.agent.PlanExecuteAgent.PlanReviewDecision.execute();
                            };
                        };

                        // out=discard：桌面 stdout 是 JSON-RPC 管道，绝不写
                        java.io.PrintStream discard = new java.io.PrintStream(java.io.OutputStream.nullOutputStream());

                        // 装配 PlanExecuteAgent（7 参公开构造，planner=null 则内部 new Planner(llmClient)）
                        com.lyhn.wraith.agent.PlanExecuteAgent planAgent =
                                new com.lyhn.wraith.agent.PlanExecuteAgent(
                                        currentClient[0],
                                        agent.getToolRegistry(),
                                        null,  // planner=null → 内部 new Planner(llmClient)
                                        agent.getMemoryManager(),
                                        reviewHandler,
                                        discard,
                                        new com.lyhn.wraith.runtime.appserver.EventStreamPlanListener(renderer, planId));

                        // 步骤流 → plan.step.output（嵌套在清单步骤行下，不浮动为独立 message）
                        planAgent.setStepStreamFactory(
                                (id, ss) -> new com.lyhn.wraith.runtime.appserver.EventStreamStepListener(renderer, planId, id));

                        // 外部上下文（MCP 资源索引）
                        planAgent.setExternalContextSupplier(() -> {
                            com.lyhn.wraith.mcp.McpServerManager mgr = appServerMcp.manager();
                            return mgr != null ? mgr.resourceIndexForPrompt() : "";
                        });

                        // skill 装配（桌面 runner 已持有 skillRegistry/skillContextBuffer，一并注入）
                        planAgent.setSkillRegistry(skillRegistry);
                        planAgent.setSkillContextBuffer(skillContextBuffer);

                        // 快照封装（与 CLI plan 路径对齐）
                        com.lyhn.wraith.snapshot.SnapshotService snap = agent.getToolRegistry().getSnapshotService();
                        String result = snap.runTurn("plan", goal, () -> planAgent.run(goal));
                        // 计划汇总结果作为单条干净底部消息发出（各步正文已嵌套在清单行下）
                        if (result != null && !result.isBlank()) {
                            renderer.appendAssistantContentDelta(result);
                            renderer.finishAssistantContent();
                        }
                        return result;
                    }
                };
            }, buildInitializeResult(client.getModelName(), com.lyhn.wraith.policy.sandbox.CommandSandbox.available()));

        try {
            server.serve();
        } catch (Exception e) {
            System.err.println("app-server error: " + e.getMessage());
        }
    }

    /** session.rewind 的历史截断:丢弃从第 userOrdinal 条 user 消息(1-based,含)起的全部消息;无效/超界 → null。 */
    static java.util.List<com.lyhn.wraith.llm.LlmClient.Message> truncateAtUserOrdinal(
            java.util.List<com.lyhn.wraith.llm.LlmClient.Message> history, int userOrdinal) {
        if (history == null || userOrdinal < 1) {
            return null;
        }
        int seen = 0;
        for (int i = 0; i < history.size(); i++) {
            if ("user".equals(history.get(i).role())) {
                seen++;
                if (seen == userOrdinal) {
                    return new java.util.ArrayList<>(history.subList(0, i));
                }
            }
        }
        return null;
    }

    /** app-server 沙箱工厂:默认断网,-Dwraith.sandbox.network=on 全局放行网络。 */
    static com.lyhn.wraith.policy.sandbox.CommandSandbox buildAppServerSandbox() {
        boolean networkAllowed =
                "on".equalsIgnoreCase(System.getProperty("wraith.sandbox.network", "off"));
        return new com.lyhn.wraith.policy.sandbox.CommandSandbox(networkAllowed);
    }

    /** app-server initialize 响应:serverInfo/protocol/model/capabilities(spec §5.1)。 */
    static java.util.Map<String, Object> buildInitializeResult(String model, boolean sandboxAvailable) {
        java.util.Map<String, Object> caps = new java.util.LinkedHashMap<>();
        caps.put("streaming", true);
        caps.put("approvals", true);
        caps.put("toolOutputStreaming", true);
        caps.put("diff", true);
        caps.put("sandbox", sandboxAvailable ? "macos-seatbelt" : "none");
        java.util.Map<String, Object> res = new java.util.LinkedHashMap<>();
        res.put("serverInfo", "wraith-app-server");
        res.put("protocol", "1");
        res.put("model", model == null ? "" : model);
        res.put("capabilities", caps);
        return res;
    }

    private static int parseServePort(String[] args, int defaultPort) {
        if (args == null) {
            return defaultPort;
        }
        for (int i = 0; i < args.length - 1; i++) {
            if ("--port".equalsIgnoreCase(args[i])) {
                try {
                    return Integer.parseInt(args[i + 1]);
                } catch (NumberFormatException ignored) {
                    return defaultPort;
                }
            }
        }
        return defaultPort;
    }

    private static String runHeadlessTask(String prompt, LlmClient llmClient) {
        ToolRegistry registry = new ToolRegistry();
        registry.setProjectPath(Path.of(".").toAbsolutePath().normalize().toString());
        Agent agent = new Agent(llmClient, registry);
        return agent.run(prompt);
    }

    private static DurableTaskManager openTaskManager(AtomicReference<LlmClient> llmClientRef) {
        try {
            return DurableTaskManager.openDefault(prompt -> runHeadlessTask(prompt, llmClientRef.get()));
        } catch (Exception e) {
            throw new IllegalStateException("后台任务管理器初始化失败: " + e.getMessage(), e);
        }
    }

    private static String handleWechatCommand(String payload,
                                              LineReader lineReader,
                                              Renderer renderer,
                                              PrintStream out,
                                              WechatRuntimeController runtime) {
        String action = payload == null || payload.isBlank() ? "start" : payload.trim().toLowerCase(Locale.ROOT);
        try {
            return switch (action) {
                case "start", "on" -> {
                    WechatAccount account = WechatAccountStore.createDefault()
                            .loadLatest()
                            .orElseGet(() -> setupWechatAccount(lineReader, renderer, out));
                    yield runtime.start(account);
                }
                case "setup", "bind" -> {
                    WechatAccount account = setupWechatAccount(lineReader, renderer, out);
                    yield runtime.start(account);
                }
                case "status" -> runtime.status();
                case "stop", "off" -> {
                    runtime.stop();
                    yield "微信通道已停止。";
                }
                case "restart" -> {
                    runtime.stop();
                    WechatAccount account = WechatAccountStore.createDefault()
                            .loadLatest()
                            .orElseGet(() -> setupWechatAccount(lineReader, renderer, out));
                    yield runtime.start(account);
                }
                default -> """
                        未知 /wechat 子命令: %s
                        用法:
                          /wechat          绑定并启动；已绑定时直接启动
                          /wechat setup    重新扫码绑定并启动
                          /wechat status   查看当前进程内微信通道状态
                          /wechat stop     停止当前进程内微信通道
                        """.formatted(action).trim();
            };
        } catch (UserInterruptException e) {
            return "已取消微信通道操作。";
        } catch (Exception e) {
            return "微信通道操作失败: " + e.getMessage();
        }
    }

    private static WechatAccount setupWechatAccount(LineReader lineReader, Renderer renderer, PrintStream out) {
        try {
            IlinkClient client = new IlinkClient();
            WechatAccountStore store = WechatAccountStore.createDefault();
            Path defaultWorkspace = Path.of(".").toAbsolutePath().normalize();
            String workspace;
            renderer.beforeInput();
            try {
                workspace = lineReader.readLine("请输入微信通道工作区 [" + defaultWorkspace + "]: ");
            } finally {
                renderer.afterInput();
            }
            if (workspace == null || workspace.isBlank()) {
                workspace = defaultWorkspace.toString();
            }

            WechatQrLogin qr = client.startQrLogin("3");
            out.println("请用目标微信扫描二维码：");
            com.lyhn.wraith.wechat.TerminalQrRenderer.print(out, qr.qrcodeUrl());
            out.println("扫码失败时可打开链接：" + qr.qrcodeUrl());
            out.println("等待扫码确认...");

            WechatLoginResult login = waitWechatLogin(client, qr.qrcodeId(), Duration.ofMinutes(5));
            if (!login.connected()) {
                throw new IllegalStateException("扫码绑定未完成: " + login.message());
            }
            WechatAccount account = store.createAccount(
                    login.token(),
                    login.accountId(),
                    login.baseUrl(),
                    login.userId(),
                    workspace);
            store.save(account);
            out.println("微信通道绑定完成");
            out.println("账号: " + login.accountId());
            out.println("工作区: " + workspace);
            return account;
        } catch (UserInterruptException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    private static WechatLoginResult waitWechatLogin(IlinkClient client, String qrcodeId, Duration timeout) throws Exception {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            WechatLoginResult result = client.pollQrStatus(qrcodeId);
            if (result.connected() || result.expired()) {
                return result;
            }
            Thread.sleep(3_000);
        }
        throw new IllegalStateException("等待扫码超时");
    }

    private static final class WechatRuntimeController {
        private final Renderer renderer;
        private WechatMessageLoop loop;
        private Thread thread;
        private WechatAccount account;

        private WechatRuntimeController(Renderer renderer) {
            this.renderer = renderer;
        }

        synchronized String start(WechatAccount account) {
            if (isRunning()) {
                return "微信通道已在运行，账号: " + this.account.accountId();
            }
            this.account = account;
            this.loop = new WechatMessageLoop(new IlinkClient(), WechatAccountStore.createDefault(), account, renderer);
            this.thread = new Thread(() -> {
                try {
                    loop.run();
                } catch (Exception e) {
                    System.err.println("微信通道已退出: " + e.getMessage());
                }
            }, "wraith-wechat-channel");
            this.thread.setDaemon(true);
            this.thread.start();
            return "微信通道已启动，账号: " + account.accountId();
        }

        synchronized void stop() {
            if (loop != null) {
                loop.stop();
            }
            if (thread != null) {
                thread.interrupt();
            }
            loop = null;
            thread = null;
        }

        synchronized String status() {
            if (isRunning()) {
                return "微信通道运行中，账号: " + account.accountId()
                        + "\n工作区: " + account.workspace();
            }
            return "微信通道未运行。输入 /wechat 启动。";
        }

        private boolean isRunning() {
            return thread != null && thread.isAlive();
        }
    }

    static PlanExecuteAgent createPlanAgent(LlmClient llmClient, Agent reactAgent,
                                            PlanExecuteAgent.PlanReviewHandler reviewHandler) {
        return new PlanExecuteAgent(
                llmClient,
                reactAgent.getToolRegistry(),
                reactAgent.getMemoryManager(),
                reviewHandler,
                System.out
        );
    }

    private static PlanExecuteAgent createPlanAgent(LlmClient llmClient, Agent reactAgent,
                                                    Terminal terminal, LineReader lineReader, PrintStream out) {
        out.println("📋 使用 Plan-and-Execute 模式\n");
        return new PlanExecuteAgent(
                llmClient,
                reactAgent.getToolRegistry(),
                reactAgent.getMemoryManager(),
                createPlanReviewHandler(terminal, lineReader, out),
                out
        );
    }

    private static AgentOrchestrator createTeamAgent(LlmClient llmClient, Agent reactAgent, PrintStream out) {
        out.println("👥 使用 Multi-Agent 协作模式\n");
        return new AgentOrchestrator(llmClient, reactAgent.getToolRegistry(), reactAgent.getMemoryManager(), out);
    }

    private static String runWithCancelSupport(Terminal terminal, PrintStream out, Callable<String> task) {
        CancellationToken token = CancellationContext.startRun();
        ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
            Thread thread = new Thread(r, "wraith-agent-runner");
            thread.setDaemon(true);
            return thread;
        });
        Future<String> future = executor.submit(task);
        // 进入 raw mode 监听 ESC：raw mode 关 ICANON / ECHO / IEXTEN 但保留 ISIG，所以 Ctrl+C 仍能终止 Wraith CLI。
        Attributes original = null;
        try {
            if (terminal != null) {
                try {
                    original = terminal.enterRawMode();
                } catch (Exception ignored) {
                    // raw mode 进入失败（非交互终端等），降级为不监听 ESC，靠 Ctrl+C 退出。
                }
            }
            while (!future.isDone()) {
                if (original != null && readEscCancel(terminal)) {
                    token.cancel();
                    future.cancel(true);
                    executor.shutdownNow();
                    return "⏹️ 已请求取消当前任务。";
                }
                try {
                    return future.get(150, TimeUnit.MILLISECONDS);
                } catch (java.util.concurrent.TimeoutException ignored) {
                    // 继续监听 ESC
                }
            }
            return future.get();
        } catch (CancellationException e) {
            return "⏹️ 已取消当前任务。";
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            token.cancel();
            future.cancel(true);
            return "⏹️ 已取消当前任务。";
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            String message = cause == null || cause.getMessage() == null ? "未知错误" : cause.getMessage();
            return "❌ 执行失败: " + message;
        } finally {
            if (terminal != null && original != null) {
                try {
                    terminal.setAttributes(original);
                } catch (Exception ignored) {
                }
            }
            CancellationContext.clear(token);
            executor.shutdownNow();
        }
    }

    /**
     * 任务运行期间监听 ESC 按键。raw mode 下 ESC 字节是 0x1b（27）。
     *
     * 关键陷阱：方向键 / Home / End 等由 ESC + 控制序列组成（如 ESC[A），不能误判为单 ESC 取消。
     * 复用 {@link #readInputBurst} + {@link #classifyEscapeSequence}：
     * - STANDALONE_ESC（孤立的 ESC）→ 用户取消
     * - CONTROL_SEQUENCE / BRACKETED_PASTE / OTHER → 丢弃，不取消
     */
    static boolean readEscCancel(Terminal terminal) {
        if (terminal == null) {
            return false;
        }
        try {
            NonBlockingReader reader = terminal.reader();
            int next = reader.read(50);
            if (next == NonBlockingReader.READ_EXPIRED || next < 0) {
                return false;
            }
            String escTail = next == 27 ? readInputBurst(terminal, 80, 20, 120) : null;
            if (next != 27) {
                // 非 ESC 输入，drain 这一轮残余字节避免堆积，但不触发取消。
                while (true) {
                    int more = reader.read(1);
                    if (more == NonBlockingReader.READ_EXPIRED || more < 0) {
                        break;
                    }
                }
            }
            return decideEscCancel(next, escTail);
        } catch (Exception ignored) {
            // 监听是 best-effort；失败不能影响任务执行。
            return false;
        }
    }

    /**
     * ESC 取消判断的纯函数版（不依赖终端 IO，便于单测）。
     *
     * @param firstByte ESC=27 触发判断；其他字节直接返回 false
     * @param escTail  紧跟 ESC 之后的字节序列（不含 ESC 本身）；null / 空 → 单 ESC 取消
     */
    static boolean decideEscCancel(int firstByte, String escTail) {
        if (firstByte != 27) {
            return false;
        }
        return classifyEscapeSequence(escTail) == EscapeSequenceType.STANDALONE_ESC;
    }

    private static PromptInput readPromptInput(Terminal terminal,
                                               LineReader lineReader,
                                               Renderer renderer,
                                               boolean allowEscCancel,
                                               boolean spaciousPrompt)
            throws UserInterruptException, EndOfFileException {
        if (spaciousPrompt) {
            renderer.stream().println();
        }
        renderer.beforeInput();
        try {
            String prompt = renderer.inputPrompt();
            String rightPrompt = renderer.inputRightPrompt();
            if (!allowEscCancel) {
                return PromptInput.submitted(lineReader.readLine(prompt, rightPrompt, (MaskingCallback) null, null));
            }

            if (terminal != null && terminal.writer() != null) {
                terminal.writer().print(prompt);
                terminal.writer().flush();
            } else {
                renderer.stream().print(prompt);
                renderer.stream().flush();
            }

            PrefillResult prefill = readPrefillInputFromTerminal(terminal, lineReader);
            if (prefill == null) {
                return PromptInput.submitted(lineReader.readLine("", rightPrompt, (MaskingCallback) null, null));
            }

            if (prefill.canceled()) {
                return PromptInput.canceledInput();
            }

            if (prefill.submitted()) {
                return PromptInput.submitted("");
            }

            return PromptInput.submitted(lineReader.readLine("", rightPrompt, (MaskingCallback) null, prefill.seedBuffer()));
        } finally {
            renderer.afterInput();
        }
    }

    static boolean defaultSpaciousPrompt(boolean statusBarAvailable) {
        return false;
    }

    static void printSubmittedPrompt(PrintStream out, String input) {
        String visible = input == null ? "" : input.strip();
        if (visible.isEmpty()) {
            return;
        }
        out.println(AnsiStyle.userMessageBlock(visible, terminalColumns()));
    }

    static void printSubmittedInput(Renderer renderer, PrintStream out, String input) {
        String visible = redactSensitiveInput(input);
        if (renderer instanceof InlineRenderer inline) {
            inline.printSubmittedPrompt(visible);
        } else {
            printSubmittedPrompt(out, visible);
        }
    }

    static String redactSensitiveInput(String input) {
        if (input == null || input.isBlank()) {
            return input;
        }
        String redacted = SENSITIVE_FLAG_VALUE.matcher(input).replaceAll("$1***");
        return SENSITIVE_ASSIGNMENT.matcher(redacted).replaceAll("$1***");
    }

    /** 从异常消息里抹掉可能被底层客户端带进来的 apiKey(防御性;红线:回包绝不含 key)。null 安全。 */
    static String redactKey(String message, String apiKey) {
        if (message == null) return null;
        if (apiKey == null || apiKey.isBlank()) return message;
        return message.contains(apiKey) ? message.replace(apiKey, "[redacted]") : message;
    }

    private static int terminalColumns() {
        String configured = System.getProperty("wraith.render.columns");
        if (configured != null && !configured.isBlank()) {
            try {
                return Math.max(40, Integer.parseInt(configured.trim()));
            } catch (NumberFormatException ignored) {
            }
        }
        String columns = System.getenv("COLUMNS");
        if (columns != null && !columns.isBlank()) {
            try {
                return Math.max(40, Integer.parseInt(columns.trim()));
            } catch (NumberFormatException ignored) {
            }
        }
        return 120;
    }

    private static void refreshTerminalColumns(Terminal terminal) {
        if (terminal == null || terminal.getSize() == null || terminal.getSize().getColumns() <= 0) {
            return;
        }
        System.setProperty("wraith.render.columns", String.valueOf(Math.max(40, terminal.getSize().getColumns())));
    }

    static void configureAwtForCli() {
        if (!isMacOs()) {
            return;
        }
        System.setProperty("java.awt.headless", "true");
    }

    static boolean isMacOs() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("mac");
    }

    private static PlanExecuteAgent.PlanReviewHandler createPlanReviewHandler(Terminal terminal,
                                                                              LineReader lineReader,
                                                                              PrintStream out) {
        return (String goal, ExecutionPlan plan) -> {
            boolean expanded = false;
            out.println(plan.summarize());
            out.println("📝 计划已生成。");
            out.println("   - 回车：按当前计划执行");
            out.println("   - Ctrl+O：展开完整计划");
            out.println("   - ESC：折叠或取消本次计划");
            out.println("   - I：输入补充要求后重新规划\n");

            while (true) {
                KeyReadResult keyReadResult = readSingleKeyFromTerminal(terminal);
                if (keyReadResult.ignoredControlSequence()) {
                    continue;
                }

                Integer key = keyReadResult.key();
                if (key != null) {
                    // Enter
                    if (key == '\n' || key == '\r') {
                        out.println();
                        return PlanExecuteAgent.PlanReviewDecision.execute();
                    }

                    // ESC (27)
                    if (key == 27) {
                        out.println();
                        if (expanded) {
                            expanded = false;
                            out.println(plan.summarize());
                            out.println("📁 已退出完整计划视图，继续按 Enter / Ctrl+O / ESC / I。\n");
                            continue;
                        }
                        return PlanExecuteAgent.PlanReviewDecision.cancel();
                    }

                    // I 或 i
                    if (key == 'i' || key == 'I') {
                        out.println();
                        String supplementInput = lineReader.readLine("补充> ").trim();
                        PlanReviewInputParser.Decision supplementDecision =
                                PlanReviewInputParser.parse(supplementInput);
                        return mapReviewDecision(supplementDecision);
                    }

                    // Ctrl+O
                    if (key == CTRL_O) {
                        out.println();
                        out.println(plan.visualize());
                        expanded = true;
                        out.println("👆 已展开完整计划，继续按 Enter / Ctrl+O / ESC / I。\n");
                        continue;
                    }

                    out.println();
                    out.println("未识别按键，请按 Enter / Ctrl+O / ESC / I。\n");
                    continue;
                }

                // 如果无法读取单键，回退到行输入模式
                String decisionInput = lineReader.readLine("操作/补充> ").trim();
                if (decisionInput.equalsIgnoreCase("/view")) {
                    out.println();
                    out.println(plan.visualize());
                    expanded = true;
                    out.println("👆 已展开完整计划，继续输入 Enter / /cancel / 补充要求。\n");
                    continue;
                }
                PlanReviewInputParser.Decision decision = PlanReviewInputParser.parse(decisionInput);
                return mapReviewDecision(decision);
            }
        };
    }

    private static KeyReadResult readSingleKeyFromTerminal(Terminal terminal) {
        try {
            terminal.flush();
            Attributes originalAttributes = terminal.enterRawMode();
            try {
                int key = terminal.reader().read();
                if (key < 0) {
                    return KeyReadResult.unavailable();
                }

                if (key == 27) {
                    String escapeSequence = readInputBurst(terminal, 80, 20, 120);
                    EscapeSequenceType escapeSequenceType = classifyEscapeSequence(escapeSequence);
                    if (escapeSequenceType == EscapeSequenceType.STANDALONE_ESC) {
                        return KeyReadResult.keyPressed(27);
                    }
                    if (escapeSequenceType == EscapeSequenceType.CONTROL_SEQUENCE
                            || escapeSequenceType == EscapeSequenceType.BRACKETED_PASTE) {
                        return KeyReadResult.ignoredSequence();
                    }
                }

                return KeyReadResult.keyPressed(key);
            } finally {
                terminal.setAttributes(originalAttributes);
            }
        } catch (Exception e) {
            return KeyReadResult.unavailable();
        }
    }

    private static PrefillResult readPrefillInputFromTerminal(Terminal terminal, LineReader lineReader) {
        try {
            terminal.flush();
            Attributes originalAttributes = terminal.enterRawMode();
            try {
                int key = terminal.reader().read();
                if (key < 0) {
                    return null;
                }

                if (key == 27) {
                    return readEscapeInput(terminal, lineReader);
                }

                if (isSubmitKey(key)) {
                    return PrefillResult.submittedInput();
                }

                String rawInput = switch (key) {
                    case 8, 127 -> "";
                    default -> Character.toString((char) key);
                };

                rawInput += readInputBurst(terminal, 20, 25, 250);
                return PrefillResult.seed(prepareSeedBuffer(rawInput));
            } finally {
                terminal.setAttributes(originalAttributes);
            }
        } catch (Exception e) {
            return null;
        }
    }

    private static PrefillResult readEscapeInput(Terminal terminal, LineReader lineReader)
            throws IOException, InterruptedException {
        String sequence = readInputBurst(terminal, 80, 20, 300);
        EscapeSequenceType escapeSequenceType = classifyEscapeSequence(sequence);
        if (escapeSequenceType == EscapeSequenceType.STANDALONE_ESC) {
            return PrefillResult.canceledInput();
        }

        if (escapeSequenceType == EscapeSequenceType.BRACKETED_PASTE) {
            String pastedText = sequence.substring(BRACKETED_PASTE_BEGIN.length());
            while (!pastedText.contains(BRACKETED_PASTE_END)) {
                String burst = readInputBurst(terminal, 30, 25, 500);
                if (burst.isEmpty()) {
                    break;
                }
                pastedText += burst;
            }

            return PrefillResult.seed(prepareSeedBuffer(stripBracketedPasteEndMarker(pastedText)));
        }

        if (escapeSequenceType == EscapeSequenceType.CONTROL_SEQUENCE) {
            return PrefillResult.seed(seedBufferForHistoryNavigation(lineReader, sequence));
        }

        return PrefillResult.canceledInput();
    }

    private static String readInputBurst(Terminal terminal, long firstWaitMs, long idleWaitMs, long maxWaitMs)
            throws IOException, InterruptedException {
        NonBlockingReader reader = terminal.reader();
        StringBuilder buffer = new StringBuilder();
        long start = System.currentTimeMillis();
        long waitMs = firstWaitMs;

        while (System.currentTimeMillis() - start < maxWaitMs) {
            int next = reader.read(waitMs);
            if (next == NonBlockingReader.READ_EXPIRED || next < 0) {
                break;
            }
            buffer.append((char) next);
            waitMs = idleWaitMs;
        }

        return buffer.toString();
    }

    static String prepareSeedBuffer(String rawInput) {
        if (rawInput == null || rawInput.isEmpty()) {
            return "";
        }
        return normalizeLineEndings(rawInput);
    }

    static List<String> startupHints() {
        return List.of(
                "输入你的问题或任务",
                "输入 '/' 后按 Tab 补全命令",
                "输入 '@server:protocol://path' 可显式引用 MCP resource",
                "任务运行中按 ESC 取消当前任务",
                "默认模式是 ReAct"
        );
    }

    record SlashCommandHint(String insertText, String display, String description) {
    }

    static List<SlashCommandHint> slashCommandHints() {
        return List.of(
                new SlashCommandHint("/model", "/model", "查看当前模型"),
                new SlashCommandHint("/model glm-5.1", "/model glm-5.1", "切换到 GLM-5.1"),
                new SlashCommandHint("/model glm-5v-turbo", "/model glm-5v-turbo", "切换到 GLM-5V-Turbo 多模态"),
                new SlashCommandHint("/model deepseek", "/model deepseek", "切换到 DeepSeek（读取配置模型）"),
                new SlashCommandHint("/model step", "/model step", "切换到 StepFun（读取配置模型）"),
                new SlashCommandHint("/model kimi", "/model kimi", "切换到 Kimi（读取配置模型）"),
                new SlashCommandHint("/model freellmapi", "/model freellmapi", "切换到本地 FreeLLMAPI（读取配置模型）"),
                new SlashCommandHint("/model xfyun", "/model xfyun", "切换到讯飞星辰 MaaS（读取配置模型）"),
                new SlashCommandHint("/config provider freellmapi ", "/config provider freellmapi <选项>", "配置本地 FreeLLMAPI provider"),
                new SlashCommandHint("/config provider xfyun ", "/config provider xfyun <选项>", "配置讯飞星辰 MaaS provider"),
                new SlashCommandHint("/plan", "/plan", "下一条任务使用 Plan-and-Execute 模式"),
                new SlashCommandHint("/plan ", "/plan <任务内容>", "直接用计划模式执行这条任务"),
                new SlashCommandHint("/team", "/team", "下一条任务使用 Multi-Agent 协作模式"),
                new SlashCommandHint("/team ", "/team <任务内容>", "直接用多 Agent 协作执行这条任务"),
                new SlashCommandHint("/hitl", "/hitl", "查看 HITL 状态"),
                new SlashCommandHint("/hitl on", "/hitl on", "启用危险操作人工审批"),
                new SlashCommandHint("/hitl off", "/hitl off", "关闭 HITL 审批"),
                new SlashCommandHint("/browser", "/browser", "查看浏览器会话状态"),
                new SlashCommandHint("/browser connect", "/browser connect", "复用已允许远程调试的登录态 Chrome"),
                new SlashCommandHint("/browser connect ", "/browser connect <port>", "旧式 CDP 端口连接"),
                new SlashCommandHint("/browser status", "/browser status", "查看浏览器会话状态"),
                new SlashCommandHint("/browser tabs", "/browser tabs", "查看 shared 模式真实 Chrome tab"),
                new SlashCommandHint("/browser disconnect", "/browser disconnect", "切回 isolated 浏览器模式"),
                new SlashCommandHint("/wechat", "/wechat", "扫码绑定并启动微信 iLink 通道"),
                new SlashCommandHint("/wechat setup", "/wechat setup", "重新扫码绑定并启动微信通道"),
                new SlashCommandHint("/wechat status", "/wechat status", "查看微信通道状态"),
                new SlashCommandHint("/wechat stop", "/wechat stop", "停止当前进程内微信通道"),
                new SlashCommandHint("/task", "/task", "查看后台任务列表"),
                new SlashCommandHint("/task add ", "/task add <任务内容>", "提交后台任务"),
                new SlashCommandHint("/task cancel ", "/task cancel <task_id>", "取消后台任务"),
                new SlashCommandHint("/task log ", "/task log <task_id>", "查看后台任务结果"),
                new SlashCommandHint("/mcp", "/mcp", "查看 MCP server 状态"),
                new SlashCommandHint("/mcp restart ", "/mcp restart <name>", "重启 MCP server"),
                new SlashCommandHint("/mcp logs ", "/mcp logs <name>", "查看 MCP server 日志"),
                new SlashCommandHint("/mcp disable ", "/mcp disable <name>", "禁用 MCP server"),
                new SlashCommandHint("/mcp enable ", "/mcp enable <name>", "启用 MCP server"),
                new SlashCommandHint("/mcp resources ", "/mcp resources <name>", "查看 MCP resources"),
                new SlashCommandHint("/mcp prompts ", "/mcp prompts <name>", "查看 MCP prompts"),
                new SlashCommandHint("/policy", "/policy", "查看安全策略状态"),
                new SlashCommandHint("/config", "/config", "打开配置 palette（只读视图 + 切换提示）"),
                new SlashCommandHint("/audit", "/audit", "查看今日最近 10 条危险工具审计"),
                new SlashCommandHint("/audit ", "/audit [N]", "查看今日最近 N 条危险工具审计"),
                new SlashCommandHint("/snapshot", "/snapshot", "查看最近 Side-Git 快照"),
                new SlashCommandHint("/snapshot status", "/snapshot status", "查看 Side-Git 快照状态"),
                new SlashCommandHint("/snapshot clean", "/snapshot clean", "清理当前项目 Side-Git 快照"),
                new SlashCommandHint("/restore ", "/restore <N>", "恢复到最近第 N 个 pre-turn 快照"),
                new SlashCommandHint("/index", "/index", "索引当前代码库"),
                new SlashCommandHint("/index ", "/index [路径]", "索引指定路径代码库"),
                new SlashCommandHint("/search ", "/search <查询>", "语义检索代码（RAG 辅助）"),
                new SlashCommandHint("/graph ", "/graph <类名>", "查看代码关系图谱"),
                new SlashCommandHint("/clear", "/clear", "清空当前对话历史"),
                new SlashCommandHint("/resume", "/resume", "续接本项目历史会话"),
                new SlashCommandHint("/compact", "/compact", "手动压缩当前对话历史"),
                new SlashCommandHint("/init", "/init", "生成项目级记忆 WRAITH.md"),
                new SlashCommandHint("/init --force", "/init --force", "重写项目级记忆 WRAITH.md"),
                new SlashCommandHint("/history clear", "/history clear", "清空本机输入历史"),
                new SlashCommandHint("/context", "/context", "查看上下文和记忆状态"),
                new SlashCommandHint("/memory", "/memory", "查看记忆状态"),
                new SlashCommandHint("/memory list", "/memory list", "查看长期记忆列表"),
                new SlashCommandHint("/memory search ", "/memory search <关键词>", "搜索当前项目可见长期记忆"),
                new SlashCommandHint("/memory delete ", "/memory delete <id>", "删除单条长期记忆"),
                new SlashCommandHint("/memory clear", "/memory clear", "清空长期记忆"),
                new SlashCommandHint("/save ", "/save [--global] <事实内容>", "手动保存项目级或全局长期记忆"),
                new SlashCommandHint("/skill", "/skill", "查看 skill 列表"),
                new SlashCommandHint("/skill list", "/skill list", "查看 skill 列表"),
                new SlashCommandHint("/skill show ", "/skill show <name>", "查看 SKILL.md 全文"),
                new SlashCommandHint("/skill on ", "/skill on <name>", "启用 skill"),
                new SlashCommandHint("/skill off ", "/skill off <name>", "禁用 skill"),
                new SlashCommandHint("/skill reload", "/skill reload", "重新扫描 skill 目录"),
                new SlashCommandHint("/export", "/export", "导出当前会话对话记录为 Markdown"),
                new SlashCommandHint("/exit", "/exit", "退出 Wraith CLI"),
                new SlashCommandHint("/quit", "/quit", "退出 Wraith CLI")
        );
    }

    private static void printSlashCommandHelp() {
        printSlashCommandHelp(System.out);
    }

    private static void printSlashCommandHelp(PrintStream out) {
        out.println("可用命令：");
        for (SlashCommandHint hint : slashCommandHints()) {
            out.println("   " + hint.display() + " - " + hint.description());
        }
        out.println();
    }

    static void configureSlashCommandHint(LineReader lineReader) {
        if (lineReader == null) {
            return;
        }
        lineReader.getWidgets().put("wraith-slash-command-hint", () -> {
            lineReader.getBuffer().write("/");
            return true;
        });
        Reference slashHint = new Reference("wraith-slash-command-hint");
        bindSlashWidget(lineReader, LineReader.MAIN, slashHint);
        bindSlashWidget(lineReader, LineReader.EMACS, slashHint);
        bindSlashWidget(lineReader, LineReader.VIINS, slashHint);
    }

    static void configureJLineInteractiveWidgets(LineReader lineReader) {
        if (lineReader == null) {
            return;
        }
        new AutosuggestionWidgets(lineReader).enable();
        new AutopairWidgets(lineReader).enable();
        // Smart Tab：光标在行尾、且正显示历史预测(灰色 autosuggestion)时，Tab 一键整段补全；
        // 否则(以 / 开头的命令、或无预测)回退到原有的命令补全 expand-or-complete。
        lineReader.getWidgets().put("wraith-smart-tab", () -> acceptSuggestionOrComplete(lineReader));
        Reference smartTab = new Reference("wraith-smart-tab");
        bindKeyToWidget(lineReader, LineReader.MAIN, smartTab, "\t");
        bindKeyToWidget(lineReader, LineReader.EMACS, smartTab, "\t");
        bindKeyToWidget(lineReader, LineReader.VIINS, smartTab, "\t");
        // JLine TailTipWidgets 会通过 Status 预留多行底部区域；如果在首屏前 enable，
        // banner 前会出现大段空白，输入行下方也会长期空出一块。命令说明后续用
        // 不预留布局的方式展示，避免破坏 Claude Code / Qoder 风格的 inline 体验。
    }

    /** Smart Tab：行尾有历史预测时整段补全，否则回退到命令补全。 */
    private static boolean acceptSuggestionOrComplete(LineReader lineReader) {
        var buffer = lineReader.getBuffer();
        if (buffer.cursor() == buffer.length()) {
            String text = buffer.upToCursor();
            if (!text.isEmpty() && !text.startsWith("/")) {
                String tail = historySuggestionTail(lineReader, text);
                if (tail != null && !tail.isEmpty()) {
                    buffer.write(tail);
                    return true;
                }
            }
        }
        lineReader.callWidget(LineReader.EXPAND_OR_COMPLETE);
        return true;
    }

    private static String historySuggestionTail(LineReader lineReader, String prefix) {
        History history = lineReader.getHistory();
        if (history == null) {
            return null;
        }
        List<String> lines = new ArrayList<>();
        for (History.Entry entry : history) {
            lines.add(entry.line());
        }
        return suggestionTail(lines, prefix);
    }

    /** 取最近一条以 prefix 开头的历史(historyLines 按旧→新)，返回其剩余部分；无则 null。 */
    static String suggestionTail(List<String> historyLines, String prefix) {
        if (prefix == null || prefix.isEmpty() || historyLines == null) {
            return null;
        }
        String match = null;
        for (String line : historyLines) {
            if (line != null && line.length() > prefix.length() && line.startsWith(prefix)) {
                match = line;
            }
        }
        return match == null ? null : match.substring(prefix.length());
    }

    private static void bindKeyToWidget(LineReader lineReader, String keyMapName, Reference ref, String keySeq) {
        KeyMap<org.jline.reader.Binding> keyMap = lineReader.getKeyMaps().get(keyMapName);
        if (keyMap != null) {
            keyMap.bind(ref, keySeq);
        }
    }

    static LinkedHashMap<String, CmdDesc> slashCommandTailTips() {
        LinkedHashMap<String, CmdDesc> tips = new LinkedHashMap<>();
        for (SlashCommandHint hint : slashCommandHints()) {
            tips.computeIfAbsent(hint.insertText(), key ->
                    new CmdDesc().mainDesc(List.of(new AttributedString(hint.description()))));
            tips.computeIfAbsent(hint.display(), key ->
                    new CmdDesc().mainDesc(List.of(new AttributedString(hint.description()))));
        }
        return tips;
    }

    private static void bindSlashWidget(LineReader lineReader, String keyMapName, Reference slashHint) {
        KeyMap<org.jline.reader.Binding> keyMap = lineReader.getKeyMaps().get(keyMapName);
        if (keyMap != null) {
            keyMap.bind(slashHint, "/");
        }
    }

    static String formatSlashCommandChoices(int terminalWidth) {
        List<String> commands = slashCommandHints().stream()
                .map(SlashCommandHint::display)
                .distinct()
                .toList();
        int maxLen = commands.stream().mapToInt(String::length).max().orElse(12);
        int colWidth = Math.min(Math.max(maxLen + 4, 18), Math.max(18, terminalWidth));
        int columns = Math.max(1, Math.min(4, terminalWidth / colWidth));
        int rows = (int) Math.ceil(commands.size() / (double) columns);

        StringBuilder sb = new StringBuilder();
        sb.append("可用命令（Tab 补全，Enter 执行）：\n");
        for (int row = 0; row < rows; row++) {
            for (int col = 0; col < columns; col++) {
                int index = col * rows + row;
                if (index >= commands.size()) {
                    continue;
                }
                String command = commands.get(index);
                sb.append(command);
                if (col < columns - 1) {
                    sb.append(" ".repeat(Math.max(2, colWidth - command.length())));
                }
            }
            sb.append('\n');
        }
        return sb.toString();
    }

    /**
     * /config 命令处理：用 renderer.openPalette 展示当前配置项列表。
     * 当前是只读视图——选中一项后提示对应的 CLI 命令，由用户自己执行。
     */
    private static void handleConfigPalette(Renderer renderer,
                                            WraithConfig config,
                                            LlmClient llmClient,
                                            SwitchableHitlHandler hitlHandler,
                                            com.lyhn.wraith.skill.SkillRegistry skillRegistry) {
        var items = java.util.List.of(
                "模型: " + (llmClient == null ? "(none)" : llmClient.getModelName() + " / " + llmClient.getProviderName()),
                "默认 Provider: " + (config == null ? "(none)" : config.getDefaultProvider()),
                "HITL: " + (hitlHandler.isEnabled() ? "ON" : "OFF"),
                "Skill 启用数: " + (skillRegistry == null ? 0 : skillRegistry.enabledSkills().size()),
                "渲染器: " + renderer.getClass().getSimpleName(),
                "配置文件: ~/.wraith/config.json (只读视图，编辑请用编辑器)"
        );
        int selected = renderer.openPalette("配置 / config", items);
        if (selected < 0) {
            renderer.stream().println("(已关闭)");
            return;
        }
        String hint = switch (selected) {
            case 0, 1 -> "💡 GLM: /model glm-5.1 / /model glm-5v-turbo；其它: /model deepseek|step|kimi|freellmapi|xfyun 读取配置模型";
            case 2 -> "💡 切换 HITL: /hitl on / /hitl off";
            case 3 -> "💡 管理 Skill: /skill list / /skill on <name> / /skill off <name>";
            case 4 -> "💡 切换渲染器（重启后生效）: WRAITH_RENDERER=inline|lanterna|plain";
            case 5 -> "💡 当前不在 TUI 内编辑 config.json，建议在编辑器里改完重启";
            default -> "(unknown)";
        };
        renderer.stream().println(hint);
    }

    static String handleConfigCommand(WraithConfig config, String payload) {
        ProviderConfigUpdate update = parseProviderConfigUpdate(payload);
        if (update.error() != null) {
            return "❌ " + update.error() + "\n" + providerConfigUsage();
        }

        WraithConfig.ProviderConfig providerConfig = ensureProviderConfig(config, update.provider());
        if (update.apiKey() != null) {
            providerConfig.setApiKey(update.apiKey());
        }
        if (update.baseUrl() != null) {
            providerConfig.setBaseUrl(update.baseUrl());
        }
        if (update.model() != null) {
            providerConfig.setModel(update.model());
        }
        if (update.loraId() != null) {
            providerConfig.setLoraId(update.loraId());
        }
        if (update.setDefault()) {
            config.setDefaultProvider(update.provider());
        }
        config.save();

        StringBuilder out = new StringBuilder();
        out.append("✅ 已保存 provider 配置: ").append(update.provider()).append('\n');
        out.append("   model: ").append(providerConfig.getModel() == null || providerConfig.getModel().isBlank()
                ? "(默认)" : providerConfig.getModel()).append('\n');
        out.append("   baseUrl: ").append(providerConfig.getBaseUrl() == null || providerConfig.getBaseUrl().isBlank()
                ? "(默认)" : providerConfig.getBaseUrl()).append('\n');
        out.append("   apiKey: ").append(maskSecret(providerConfig.getApiKey())).append('\n');
        if ("xfyun".equals(update.provider())) {
            out.append("   loraId: ").append(providerConfig.getLoraId() == null || providerConfig.getLoraId().isBlank()
                    ? "(未配置)" : providerConfig.getLoraId()).append('\n');
        }
        if (update.setDefault()) {
            out.append("   默认 provider 已设为 ").append(update.provider()).append('\n');
        }
        out.append("   立即切换: /model ").append(update.provider());
        return out.toString();
    }

    static ProviderConfigUpdate parseProviderConfigUpdate(String payload) {
        List<String> args = splitArgs(payload);
        if (args.size() < 2 || !"provider".equalsIgnoreCase(args.get(0))) {
            return ProviderConfigUpdate.error("用法不正确");
        }

        String provider = normalizeProviderName(args.get(1));
        if (!isSupportedProvider(provider)) {
            return ProviderConfigUpdate.error("暂不支持 provider: " + args.get(1));
        }

        String apiKey = null;
        String baseUrl = null;
        String model = null;
        String loraId = null;
        boolean setDefault = false;
        for (int i = 2; i < args.size(); i++) {
            String token = args.get(i);
            if ("--default".equalsIgnoreCase(token) || "--set-default".equalsIgnoreCase(token)) {
                setDefault = true;
                continue;
            }

            String key;
            String value;
            int equals = token.indexOf('=');
            if (equals > 0) {
                key = token.substring(0, equals);
                value = token.substring(equals + 1);
            } else {
                key = token;
                if (i + 1 >= args.size()) {
                    return ProviderConfigUpdate.error("缺少 " + key + " 的值");
                }
                value = args.get(++i);
            }

            switch (normalizeConfigKey(key)) {
                case "api-key" -> apiKey = value;
                case "base-url" -> baseUrl = value;
                case "model" -> model = value;
                case "lora-id" -> loraId = value;
                default -> {
                    return ProviderConfigUpdate.error("未知配置项: " + key);
                }
            }
        }

        if (loraId != null && !"xfyun".equals(provider)) {
            return ProviderConfigUpdate.error("--lora-id 仅支持 xfyun provider");
        }

        if (apiKey == null && baseUrl == null && model == null && loraId == null && !setDefault) {
            return ProviderConfigUpdate.error("至少提供一个配置项");
        }
        return new ProviderConfigUpdate(provider, apiKey, baseUrl, model, loraId, setDefault, null);
    }

    private static String providerConfigUsage() {
        return """
                用法:
                  /config provider freellmapi --base-url http://localhost:5173/v1 --api-key <key> --model auto
                  /config provider freellmapi --model qwen/qwen3-coder:free --default
                  /config provider xfyun --base-url https://maas-api.cn-huabei-1.xf-yun.com/v2 --api-key <key> --model Qwen3.6-35B-A3B --default
                  /config provider xfyun --lora-id <resourceId>
                  /model freellmapi
                  /model xfyun
                """.stripTrailing();
    }

    private static List<String> splitArgs(String value) {
        if (value == null || value.isBlank()) {
            return List.of();
        }
        List<String> args = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        char quote = 0;
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            if (quote != 0) {
                if (ch == quote) {
                    quote = 0;
                } else {
                    current.append(ch);
                }
                continue;
            }
            if (ch == '\'' || ch == '"') {
                quote = ch;
                continue;
            }
            if (Character.isWhitespace(ch)) {
                if (!current.isEmpty()) {
                    args.add(current.toString());
                    current.setLength(0);
                }
                continue;
            }
            current.append(ch);
        }
        if (!current.isEmpty()) {
            args.add(current.toString());
        }
        return args;
    }

    private static String normalizeConfigKey(String raw) {
        String key = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        while (key.startsWith("-")) {
            key = key.substring(1);
        }
        return switch (key) {
            case "apikey", "api_key", "key" -> "api-key";
            case "baseurl", "base_url", "url" -> "base-url";
            case "loraid", "lora_id", "resourceid", "resource_id" -> "lora-id";
            default -> key;
        };
    }

    private static String normalizeProviderName(String raw) {
        String provider = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        return switch (provider) {
            case "stepfun", "step-fun" -> "step";
            case "moonshot", "moonshotai", "moonshot-ai" -> "kimi";
            case "free-llm-api", "free_llm_api", "freellm", "free-llm" -> "freellmapi";
            case "xfyun-maas", "xfyun_maas", "iflytek", "iflytek-maas", "iflytek_maas", "maas" -> "xfyun";
            default -> provider;
        };
    }

    private static boolean isSupportedProvider(String provider) {
        return List.of("glm", "deepseek", "step", "kimi", "freellmapi", "xfyun").contains(provider);
    }

    private static String maskSecret(String value) {
        if (value == null || value.isBlank()) {
            return "(未配置)";
        }
        String trimmed = value.trim();
        if (trimmed.length() <= 8) {
            return "****";
        }
        return trimmed.substring(0, 4) + "..." + trimmed.substring(trimmed.length() - 4);
    }

    static void bindCtrlOToFoldableBlocks(LineReader lineReader, InlineRenderer inline) {
        if (lineReader == null || inline == null) {
            return;
        }
        lineReader.getWidgets().put("wraith-toggle-foldable", () -> {
            inline.toggleLastBlock();
            lineReader.callWidget(LineReader.REDISPLAY);
            return true;
        });
        Reference ref = new Reference("wraith-toggle-foldable");
        String ctrlO = String.valueOf((char) 15);  // Ctrl+O
        for (String mapName : new String[]{LineReader.MAIN, LineReader.EMACS, LineReader.VIINS}) {
            KeyMap<org.jline.reader.Binding> map = lineReader.getKeyMaps().get(mapName);
            if (map != null) {
                map.bind(ref, ctrlO);
            }
        }
    }

    // Ctrl+V 抓系统剪贴板里的图片到 ~/.wraith/cache/ 并把 @image:<path> 注入当前输入行。
    // 失败（无图 / headless / IO 错误）时只打提示，不破坏现有 buffer，覆盖掉 JLine 默认的
    // quoted-insert 没有交互价值。注意 macOS Cmd+V 通常被终端劫持成本地粘贴文本，所以这里
    // 绑的是 Ctrl+V（ASCII 22 / SYN），iTerm / Terminal.app 默认不会拦截。
    //
    // 输入层不按模型名拦截图片：与 Claude Code 类似，先把图片读成附件收进
    // prompt；模型是否接受 image block 由 provider API 自己处理。
    static void bindCtrlVToClipboardImage(LineReader lineReader) {
        if (lineReader == null) {
            return;
        }
        lineReader.getWidgets().put("wraith-paste-clipboard-image", () -> {
            ClipboardImage.GrabResult grab = ClipboardImage.grab();
            if (!grab.ok()) {
                lineReader.printAbove("⚠️ Ctrl+V 抓图失败: " + grab.error());
                lineReader.callWidget(LineReader.REDISPLAY);
                return true;
            }
            String token = "@image:<" + grab.path().toAbsolutePath() + "> ";
            lineReader.getBuffer().write(token);
            lineReader.callWidget(LineReader.REDISPLAY);
            return true;
        });
        Reference ref = new Reference("wraith-paste-clipboard-image");
        String ctrlV = String.valueOf((char) 22);  // Ctrl+V (SYN)
        for (String mapName : new String[]{LineReader.MAIN, LineReader.EMACS, LineReader.VIINS}) {
            KeyMap<org.jline.reader.Binding> map = lineReader.getKeyMaps().get(mapName);
            if (map != null) {
                map.bind(ref, ctrlV);
            }
        }
    }

    static void bindEscToClearInput(LineReader lineReader) {
        if (lineReader == null) {
            return;
        }
        lineReader.getWidgets().put("wraith-clear-input", () -> {
            clearInputBuffer(lineReader);
            lineReader.callWidget(LineReader.REDISPLAY);
            return true;
        });
        Reference clearInput = new Reference("wraith-clear-input");
        String esc = KeyMap.esc();
        for (String mapName : new String[]{LineReader.MAIN, LineReader.EMACS, LineReader.VIINS}) {
            KeyMap<org.jline.reader.Binding> map = lineReader.getKeyMaps().get(mapName);
            if (map != null) {
                map.bind(clearInput, esc);
            }
        }
    }

    static void clearInputBuffer(LineReader lineReader) {
        if (lineReader == null || lineReader.getBuffer() == null) {
            return;
        }
        lineReader.getBuffer().clear();
    }

    /**
     * 多行输入:{@code \}+Enter 续行、Ctrl+J(及尽力 Alt+Enter)插入换行、Enter 提交。
     * 见 docs/specs/2026-06-19-multiline-input-and-mouse.md。
     *
     * <p>不改 parser、不做提交后归一化:粘贴走 BRACKETED_PASTE 不经 accept-line widget,
     * 故粘贴内容里的 {@code \}+换行原样保留(编码 agent 会贴 C 宏 / shell 续行)。
     * 只有用户亲手按 Enter 且光标前是 {@code \} 时,才消费该反斜杠并插入真换行。
     */
    static void configureMultilineInput(LineReader lineReader, Renderer renderer) {
        if (lineReader == null) {
            return;
        }
        // 续行提示符(secondary prompt):保持左侧 │ 竖线在多行间连续。
        if (renderer != null) {
            String continuation = renderer.continuationPrompt();
            if (continuation != null) {
                lineReader.setVariable(LineReader.SECONDARY_PROMPT_PATTERN, continuation);
            }
        }

        // 自定义 Enter:光标前是 \ → 删掉它并插入换行(续行,不提交);否则正常 ACCEPT_LINE 提交。
        lineReader.getWidgets().put("wraith-accept-or-continue", () -> {
            Buffer buf = lineReader.getBuffer();
            if (buf != null && buf.prevChar() == '\\') {
                buf.backspace();
                buf.write('\n');
                lineReader.callWidget(LineReader.REDISPLAY);
                return true;
            }
            lineReader.callWidget(LineReader.ACCEPT_LINE);
            return true;
        });

        // Ctrl+J(LF)/ Alt+Enter:在光标处插入真换行,不提交。
        lineReader.getWidgets().put("wraith-insert-newline", () -> {
            Buffer buf = lineReader.getBuffer();
            if (buf != null) {
                buf.write('\n');
            }
            lineReader.callWidget(LineReader.REDISPLAY);
            return true;
        });

        Reference accept = new Reference("wraith-accept-or-continue");
        Reference newline = new Reference("wraith-insert-newline");
        String enter = "\r";              // CR(Enter / Ctrl+M)
        String ctrlJ = KeyMap.ctrl('J');  // LF(0x0A)
        for (String mapName : new String[]{LineReader.MAIN, LineReader.EMACS, LineReader.VIINS}) {
            KeyMap<org.jline.reader.Binding> map = lineReader.getKeyMaps().get(mapName);
            if (map == null) {
                continue;
            }
            map.bind(accept, enter);
            map.bind(newline, ctrlJ);
            // Alt+Enter 尽力支持:ReAct 默认路径可用;Plan/Team 的 Esc-prefill 会先吃掉 Esc。
            map.bind(newline, KeyMap.alt('\r'));
            map.bind(newline, KeyMap.alt('\n'));
        }
    }

    /**
     * 鼠标点击定位:启用 JLine 内建 {@code mouse()} widget(多行/换行/续行提示符感知)。
     * 默认开,{@code WRAITH_MOUSE=off/0/false/no} 关闭;终端不支持鼠标时静默跳过。
     * JLine 仅在 readLine 期间 trackMouse,输出/回看期间原生鼠标选区照常。
     */
    static void enableMouseIfAvailable(Terminal terminal, LineReader lineReader) {
        if (terminal == null || lineReader == null) {
            return;
        }
        if (!mouseEnabled(System.getenv("WRAITH_MOUSE"))) {
            return;
        }
        if (!terminal.hasMouseSupport()) {
            return;
        }
        lineReader.option(LineReader.Option.MOUSE, true);
    }

    /** WRAITH_MOUSE 解析:null / 其它 = 开;off / 0 / false / no(大小写不敏感)= 关。 */
    static boolean mouseEnabled(String env) {
        if (env == null) {
            return true;
        }
        String v = env.trim().toLowerCase(java.util.Locale.ROOT);
        return !(v.equals("off") || v.equals("0") || v.equals("false") || v.equals("no"));
    }

    private static void handleExportCommand(PrintStream out, Agent reactAgent) {
        List<LlmClient.Message> history = reactAgent.getConversationHistory();
        if (!hasExportableMessages(history)) {
            out.println("📭 当前没有对话记录可导出\n");
            return;
        }

        Path exportsDir = Path.of(System.getProperty("user.home"), ".wraith", "exports");
        try {
            Files.createDirectories(exportsDir);
        } catch (IOException e) {
            out.println("❌ 创建导出目录失败: " + e.getMessage() + "\n");
            return;
        }

        String timestamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss"));
        Path exportFile = exportsDir.resolve("session-" + timestamp + ".md");

        String markdown = renderConversationExport(history, LocalDateTime.now());

        try {
            Files.writeString(exportFile, markdown);
            out.println("✅ 对话记录已导出: " + exportFile.toAbsolutePath());
            out.println("   共 " + countExportedMessages(history) + " 条消息\n");
        } catch (IOException e) {
            out.println("❌ 写入导出文件失败: " + e.getMessage() + "\n");
        }
    }

    static boolean hasExportableMessages(List<LlmClient.Message> history) {
        return history != null && history.stream()
                .anyMatch(msg -> msg != null);
    }

    static long countExportedMessages(List<LlmClient.Message> history) {
        if (history == null) {
            return 0;
        }
        return history.stream()
                .filter(msg -> msg != null)
                .count();
    }

    static String renderConversationExport(List<LlmClient.Message> history, LocalDateTime exportedAt) {
        StringBuilder md = new StringBuilder();
        md.append("# Wraith CLI 会话导出\n\n");
        md.append("**导出时间**: ").append(exportedAt.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))).append("\n\n");
        md.append("---\n\n");

        for (int i = 0; i < history.size(); i++) {
            LlmClient.Message msg = history.get(i);
            if (msg == null) {
                continue;
            }
            String role = msg.role();

            md.append("## ").append(capitalizeRole(role)).append("\n\n");

            // reasoning content
            if (msg.reasoningContent() != null && !msg.reasoningContent().isBlank()) {
                md.append("> **思考过程**:\n> \n");
                for (String line : msg.reasoningContent().replace("\r\n", "\n").split("\n")) {
                    md.append("> ").append(line).append("\n");
                }
                md.append("\n");
            }

            // tool calls
            if (msg.toolCalls() != null && !msg.toolCalls().isEmpty()) {
                md.append("**工具调用**:\n\n");
                for (LlmClient.ToolCall tc : msg.toolCalls()) {
                    String toolName = tc.function() != null ? tc.function().name() : "unknown";
                    String toolArgs = tc.function() != null ? tc.function().arguments() : "{}";
                    md.append("- **").append(toolName).append("**:\n");
                    appendFencedBlock(md, formatJsonArg(toolArgs), "json", "  ");
                    md.append("\n");
                }
            }

            // content
            if (msg.content() != null && !msg.content().isBlank()) {
                if ("tool".equals(role)) {
                    String content = msg.content();
                    if (content.length() > 8000) {
                        content = content.substring(0, 8000) + "\n... (已截断，原始长度 " + msg.content().length() + " 字符)";
                    }
                    appendFencedBlock(md, content, "", "");
                    md.append("\n");
                } else {
                    md.append(msg.content()).append("\n\n");
                }
            }
        }
        return md.toString();
    }

    private static void appendFencedBlock(StringBuilder md, String content, String info, String indent) {
        String fence = markdownFenceFor(content);
        md.append(indent).append(fence);
        if (info != null && !info.isBlank()) {
            md.append(info);
        }
        md.append('\n');
        String normalized = content == null ? "" : content.replace("\r\n", "\n").replace('\r', '\n');
        for (String line : normalized.split("\n", -1)) {
            md.append(indent).append(line).append('\n');
        }
        md.append(indent).append(fence).append("\n");
    }

    static String markdownFenceFor(String content) {
        int longest = 0;
        int current = 0;
        String text = content == null ? "" : content;
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) == '`') {
                current++;
                longest = Math.max(longest, current);
            } else {
                current = 0;
            }
        }
        return "`".repeat(Math.max(3, longest + 1));
    }

    private static String capitalizeRole(String role) {
        return switch (role) {
            case "user" -> "User";
            case "assistant" -> "Assistant";
            case "tool" -> "Tool Result";
            case "system" -> "System";
            default -> role.substring(0, 1).toUpperCase() + role.substring(1);
        };
    }

    private static String formatJsonArg(String json) {
        if (json == null || json.isBlank()) {
            return "{}";
        }
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                    .writerWithDefaultPrettyPrinter()
                    .writeValueAsString(
                            new com.fasterxml.jackson.databind.ObjectMapper().readTree(json));
        } catch (Exception e) {
            return json;
        }
    }

    private static void printPolicyStatus(PrintStream out, Agent reactAgent) {
        out.println("🛡️ 安全策略状态：");
        out.println("   项目根: " + reactAgent.getToolRegistry().getProjectPath());
        out.println("   危险工具: " + String.join(", ", ApprovalPolicy.getDangerousTools()) + "，以及所有 mcp__ 前缀工具");
        out.println("   路径围栏: 强制限定在项目根之内（read_file / write_file / list_dir / create_project）");
        out.println("   命令黑名单: sudo / rm -rf 全盘 / mkfs / dd of=/dev / fork bomb / curl|sh / find / / chmod 777 / / shutdown");
        out.println("   写入文件上限: 5MB");
        out.println("   命令执行上限: 60 秒，输出 8KB（截断）");
        out.println("   审计目录: " + reactAgent.getToolRegistry().getAuditLog().getAuditDir());
        out.println();
    }

    static String handleBrowserCommand(String payload,
                                       BrowserSession browserSession,
                                       BrowserConnectivityCheck connectivityCheck,
                                       McpServerManager mcpServerManager,
                                       HitlToolRegistry registry,
                                       HitlHandler hitlHandler) {
        String normalized = payload == null || payload.isBlank() ? "status" : payload.trim();
        String[] parts = normalized.split("\\s+");
        String subCommand = parts[0].toLowerCase();
        return switch (subCommand) {
            case "status" -> browserStatus(browserSession, connectivityCheck, mcpServerManager);
            case "connect" -> {
                if (parts.length >= 2) {
                    int port = parseBrowserPort(parts[1]);
                    yield browserConnectByPort(port, browserSession, connectivityCheck, mcpServerManager, hitlHandler);
                }
                yield browserAutoConnect(browserSession, mcpServerManager, hitlHandler);
            }
            case "disconnect" -> browserDisconnect(browserSession, mcpServerManager, hitlHandler);
            case "tabs" -> browserTabs(browserSession, registry);
            default -> """
                    ❌ 未知 /browser 子命令: %s
                    可用命令：
                      /browser status
                      /browser connect [port]
                      /browser disconnect
                      /browser tabs
                    """.formatted(normalized).trim();
        };
    }

    private static String browserStatus(BrowserSession browserSession,
                                        BrowserConnectivityCheck connectivityCheck,
                                        McpServerManager mcpServerManager) {
        BrowserConnectivityCheck.ProbeResult probe = connectivityCheck.probe(9222);
        McpServer server = mcpServerManager.server("chrome-devtools");
        String serverStatus = server == null
                ? "未配置"
                : server.status() == McpServerStatus.READY
                ? "● ready (" + server.tools().size() + " tools)"
                : server.status().name().toLowerCase() + (server.errorMessage() == null ? "" : " - " + server.errorMessage());
        String mode = browserSession.mode() == BrowserMode.SHARED
                ? "shared（复用 " + browserSession.browserUrl() + "）"
                : "isolated（临时 user-data-dir，无登录态）";
        return """
                🌐 浏览器会话
                  当前模式: %s
                  chrome-devtools server: %s
                  旧式 /json/version 探活: %s
                  自动连接: Chrome 144+ 可在 chrome://inspect/#remote-debugging 勾选 Allow remote debugging 后使用 /browser connect
                """.formatted(mode, serverStatus, probe.ok() ? "✅ " + probe.browserUrl() : "⚠️ " + probe.message()).trim();
    }

    private static String browserAutoConnect(BrowserSession browserSession,
                                             McpServerManager mcpServerManager,
                                             HitlHandler hitlHandler) {
        McpServer server = mcpServerManager.server("chrome-devtools");
        if (server == null) {
            return "❌ 未配置 chrome-devtools MCP server，请先检查 ~/.wraith/mcp.json";
        }
        List<String> oldArgs = List.copyOf(server.config().getArgs());
        List<String> autoConnectArgs = List.of("-y", "chrome-devtools-mcp@latest", "--autoConnect");
        String result = mcpServerManager.restartWithArgs("chrome-devtools", autoConnectArgs);
        McpServer restarted = mcpServerManager.server("chrome-devtools");
        if (restarted != null && restarted.status() == McpServerStatus.READY) {
            browserSession.switchToShared("autoConnect");
            hitlHandler.clearApprovedAllForServer("chrome-devtools");
            return "🔄 已用 --autoConnect 连接 Chrome（需已在 chrome://inspect/#remote-debugging 允许远程调试）\n" + result;
        }
        mcpServerManager.restartWithArgs("chrome-devtools", oldArgs);
        return "❌ autoConnect 连接失败，已回滚 chrome-devtools 启动参数：\n" + result
                + "\n\n请确认 Chrome 144+ 已打开 chrome://inspect/#remote-debugging，并勾选 Allow remote debugging for this browser instance。";
    }

    private static String browserConnectByPort(int port,
                                               BrowserSession browserSession,
                                               BrowserConnectivityCheck connectivityCheck,
                                               McpServerManager mcpServerManager,
                                               HitlHandler hitlHandler) {
        if (port < 1024 || port > 65535) {
            return "❌ /browser connect 端口必须在 1024-65535 之间。默认 /browser connect 使用 --autoConnect；旧式 CDP 端口连接可用 /browser connect 9222。";
        }
        BrowserConnectivityCheck.ProbeResult probe = connectivityCheck.probe(port);
        if (!probe.ok()) {
            return "❌ 未检测到 Chrome 调试端口 127.0.0.1:" + port + "：" + probe.message() + "\n\n"
                    + chromeLaunchHelp(port);
        }

        McpServer server = mcpServerManager.server("chrome-devtools");
        if (server == null) {
            return "❌ 未配置 chrome-devtools MCP server，请先检查 ~/.wraith/mcp.json";
        }
        List<String> oldArgs = List.copyOf(server.config().getArgs());
        List<String> sharedArgs = List.of("-y", "chrome-devtools-mcp@latest", "--browser-url=" + probe.browserUrl());
        String result = mcpServerManager.restartWithArgs("chrome-devtools", sharedArgs);
        McpServer restarted = mcpServerManager.server("chrome-devtools");
        if (restarted != null && restarted.status() == McpServerStatus.READY) {
            browserSession.switchToShared(probe.browserUrl());
            hitlHandler.clearApprovedAllForServer("chrome-devtools");
            return "🔄 切换 chrome-devtools server 到 shared 模式 (" + probe.browserUrl() + ")\n" + result;
        }
        mcpServerManager.restartWithArgs("chrome-devtools", oldArgs);
        return "❌ shared 模式切换失败，已回滚 chrome-devtools 启动参数：\n" + result;
    }

    private static String browserDisconnect(BrowserSession browserSession,
                                            McpServerManager mcpServerManager,
                                            HitlHandler hitlHandler) {
        McpServer server = mcpServerManager.server("chrome-devtools");
        if (server == null) {
            browserSession.switchToIsolated();
            return "❌ 未配置 chrome-devtools MCP server，已清理本地浏览器会话状态";
        }
        String result = mcpServerManager.restartWithArgs(
                "chrome-devtools",
                List.of("-y", "chrome-devtools-mcp@latest", "--isolated=true"));
        browserSession.switchToIsolated();
        hitlHandler.clearApprovedAllForServer("chrome-devtools");
        return "🔄 已切回 isolated 浏览器模式\n" + result;
    }

    private static String browserTabs(BrowserSession browserSession, HitlToolRegistry registry) {
        if (browserSession.mode() != BrowserMode.SHARED) {
            return "当前为 isolated 模式，没有真实 Chrome tab 可复用。可用 /browser connect 切到 shared 模式。";
        }
        return registry.executeTool("mcp__chrome-devtools__list_pages", "{}");
    }

    private static int parseBrowserPort(String value) {
        if (value == null || value.isBlank()) {
            return 9222;
        }
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static String chromeLaunchHelp(int port) {
        return """
                请先用调试端口启动 Chrome：
                  macOS: open -na "Google Chrome" --args --remote-debugging-port=%d --user-data-dir=/tmp/wraith-chrome-profile
                  Windows: start chrome.exe --remote-debugging-port=%d --user-data-dir=%%TEMP%%\\wraith-chrome-profile
                  Linux: google-chrome --remote-debugging-port=%d --user-data-dir=/tmp/wraith-chrome-profile
                然后重新执行 /browser connect %d
                """.formatted(port, port, port, port).trim();
    }

    private static void printMcpCommandResult(PrintStream out, String result) {
        out.println(result);
        out.println();
    }

    private static void printAuditTail(PrintStream out, Agent reactAgent, String payload) {
        int requested = parseAuditCount(payload, 10);
        List<AuditLog.AuditEntry> entries = reactAgent.getToolRegistry().getAuditLog().readRecent(requested);
        if (entries.isEmpty()) {
            out.println("📭 今日尚无审计记录\n");
            return;
        }
        out.println("📋 最近 " + entries.size() + " 条危险工具审计：");
        for (AuditLog.AuditEntry entry : entries) {
            out.printf("   [%s] %s %s (%dms, approver=%s)%n",
                    entry.outcome().toUpperCase(),
                    entry.timestamp(),
                    entry.tool(),
                    entry.durationMs(),
                    entry.approver());
            if (entry.reason() != null && !entry.reason().isBlank()) {
                out.println("        原因: " + entry.reason());
            }
            BrowserAuditMetadata metadata = entry.metadata();
            if (metadata != null) {
                out.println("        浏览器: mode=" + metadata.browserMode()
                        + ", sensitive=" + metadata.sensitive()
                        + (metadata.targetUrl() == null ? "" : ", url=" + metadata.targetUrl()));
            }
        }
        out.println();
    }

    private static void printSnapshotCommand(PrintStream out, SnapshotService snapshotService, String payload) {
        String normalized = payload == null || payload.isBlank() ? "list" : payload.trim().toLowerCase();
        if ("status".equals(normalized)) {
            out.println(snapshotService.status());
            out.println();
            return;
        }
        if ("clean".equals(normalized)) {
            out.println(snapshotService.clean());
            out.println();
            return;
        }
        if (!"list".equals(normalized)) {
            out.println("""
                    ❌ 未知 /snapshot 子命令: %s
                    可用命令：
                      /snapshot
                      /snapshot status
                      /snapshot clean
                      /restore <N>
                    """.formatted(payload).trim());
            out.println();
            return;
        }
        try {
            List<TurnSnapshot> snapshots = snapshotService.listSnapshots(20);
            if (snapshots.isEmpty()) {
                out.println("📭 暂无 Side-Git 快照\n");
                return;
            }
            out.println("📸 最近 " + snapshots.size() + " 条 Side-Git 快照：");
            int preTurnIndex = 0;
            for (TurnSnapshot snapshot : snapshots) {
                String restoreHint = "";
                if ("pre-turn".equals(snapshot.phase().label())) {
                    preTurnIndex++;
                    restoreHint = "  /restore " + preTurnIndex;
                }
                out.printf("   %s %-11s %-18s %s%s%n",
                        snapshot.shortCommitId(),
                        snapshot.phase().label(),
                        snapshot.turnId(),
                        snapshot.createdAt(),
                        restoreHint);
            }
            out.println();
        } catch (Exception e) {
            out.println("❌ 读取快照失败: " + e.getMessage() + "\n");
        }
    }

    private static void printRestoreCommand(PrintStream out, SnapshotService snapshotService, String payload) {
        int offset = parseAuditCount(payload, 1);
        try {
            RestoreResult result = snapshotService.restorePreTurn(offset);
            out.println(result.formatForCli());
            out.println();
        } catch (Exception e) {
            out.println("❌ 恢复快照失败: " + e.getMessage() + "\n");
        }
    }

    private static int parseAuditCount(String payload, int defaultN) {
        if (payload == null || payload.isBlank()) return defaultN;
        try {
            int n = Integer.parseInt(payload.trim());
            return Math.max(1, Math.min(n, 100));
        } catch (NumberFormatException e) {
            return defaultN;
        }
    }

    private static void printStartupHints(PrintStream out) {
        out.println("💡 提示:");
        for (String hint : startupHints()) {
            out.println("   - " + hint);
        }
        out.println();
    }

    private static StartupScreenInfo startupScreenInfo(LlmClient llmClient,
                                                       McpServerManager mcpServerManager,
                                                       SkillRegistry skillRegistry,
                                                       String note) {
        long ready = mcpServerManager.servers().stream()
                .filter(server -> server.status() == McpServerStatus.READY)
                .count();
        int total = mcpServerManager.servers().size();
        int tools = mcpServerManager.servers().stream()
                .mapToInt(server -> server.tools().size())
                .sum();
        int skillTotal = skillRegistry.allSkills().size();
        int skillEnabled = skillRegistry.enabledSkills().size();
        return new StartupScreenInfo(
                llmClient.getModelName(),
                llmClient.getProviderName(),
                ready,
                total,
                tools,
                skillEnabled,
                skillTotal,
                note == null ? "" : note.trim()
        );
    }

    private static StatusInfo statusInfo(LlmClient llmClient,
                                         SwitchableHitlHandler hitlHandler,
                                         String phase,
                                         McpServerManager mcpServerManager,
                                         SkillRegistry skillRegistry) {
        String normalizedPhase = phase == null || phase.isBlank() ? "idle" : phase;
        StatusInfo base = "idle".equals(normalizedPhase)
                ? StatusInfo.idle(llmClient.getModelName(), llmClient.maxContextWindow(), hitlHandler.isEnabled())
                : StatusInfo.active(llmClient.getModelName(), llmClient.maxContextWindow(),
                hitlHandler.isEnabled(), normalizedPhase);
        return base.withEnvironment(mcpStatusSummary(mcpServerManager), skillStatusSummary(skillRegistry));
    }

    private static StatusInfo statusInfo(Agent reactAgent,
                                         McpServerManager mcpServerManager,
                                         SkillRegistry skillRegistry,
                                         String phase) {
        StatusInfo base = reactAgent.currentStatus(phase);
        return base.withEnvironment(mcpStatusSummary(mcpServerManager), skillStatusSummary(skillRegistry));
    }

    private static String mcpStatusSummary(McpServerManager mcpServerManager) {
        if (mcpServerManager == null || mcpServerManager.servers().isEmpty()) {
            return "MCP 0";
        }
        long ready = mcpServerManager.servers().stream()
                .filter(server -> server.status() == McpServerStatus.READY)
                .count();
        return "MCP " + ready + "/" + mcpServerManager.servers().size();
    }

    private static String skillStatusSummary(SkillRegistry skillRegistry) {
        if (skillRegistry == null || skillRegistry.allSkills().isEmpty()) {
            return "Skill 0";
        }
        return "Skill " + skillRegistry.enabledSkills().size() + "/" + skillRegistry.allSkills().size();
    }

    private static String appendStartupNote(String current, String next) {
        if (next == null || next.isBlank()) {
            return current == null ? "" : current;
        }
        if (current == null || current.isBlank()) {
            return next;
        }
        return current + "\n" + next;
    }

    static Duration mcpStartupWait() {
        String configured = System.getProperty("wraith.mcp.startup.wait.seconds");
        if (configured == null || configured.isBlank()) {
            configured = System.getenv("WRAITH_MCP_STARTUP_WAIT_SECONDS");
        }
        if (configured == null || configured.isBlank()) {
            return Duration.ofSeconds(8);
        }
        try {
            long seconds = Long.parseLong(configured.trim());
            return seconds > 0 ? Duration.ofSeconds(seconds) : Duration.ofSeconds(8);
        } catch (NumberFormatException ignored) {
            return Duration.ofSeconds(8);
        }
    }

    static String normalizeLineEndings(String rawInput) {
        return rawInput
                .replace("\r\n", "\n")
                .replace('\r', '\n');
    }

    private static String stripBracketedPasteEndMarker(String rawInput) {
        int endMarkerIndex = rawInput.indexOf(BRACKETED_PASTE_END);
        if (endMarkerIndex >= 0) {
            return rawInput.substring(0, endMarkerIndex);
        }
        return rawInput;
    }

    private static boolean isSubmitKey(int key) {
        return key == '\n' || key == '\r';
    }

    static EscapeSequenceType classifyEscapeSequence(String sequence) {
        if (sequence == null || sequence.isEmpty()) {
            return EscapeSequenceType.STANDALONE_ESC;
        }
        if (sequence.startsWith(BRACKETED_PASTE_BEGIN)) {
            return EscapeSequenceType.BRACKETED_PASTE;
        }
        if (sequence.startsWith("[") || sequence.startsWith("O")) {
            return EscapeSequenceType.CONTROL_SEQUENCE;
        }
        return EscapeSequenceType.OTHER;
    }

    static String seedBufferForHistoryNavigation(LineReader lineReader, String sequence) {
        if (lineReader == null || sequence == null || sequence.isEmpty()) {
            return "";
        }

        if (isUpArrowSequence(sequence)) {
            return latestHistoryEntry(lineReader.getHistory());
        }

        if (isDownArrowSequence(sequence)) {
            return "";
        }

        return "";
    }

    private static boolean isUpArrowSequence(String sequence) {
        return ARROW_UP.equals(sequence) || APP_ARROW_UP.equals(sequence);
    }

    private static boolean isDownArrowSequence(String sequence) {
        return ARROW_DOWN.equals(sequence) || APP_ARROW_DOWN.equals(sequence);
    }

    private static String latestHistoryEntry(History history) {
        if (history == null || history.isEmpty()) {
            return "";
        }

        int lastIndex = history.last();
        if (lastIndex < 0) {
            return "";
        }

        String entry = history.get(lastIndex);
        return entry == null ? "" : entry;
    }

    static void configureHistory(LineReader lineReader, Path homeDir) {
        if (lineReader == null) {
            return;
        }
        Path historyFile = resolveHistoryFile(homeDir);
        try {
            Files.createDirectories(historyFile.getParent());
            lineReader.setVariable(LineReader.HISTORY_FILE, historyFile);
            lineReader.setVariable(LineReader.HISTORY_SIZE, historySize());
            lineReader.setVariable(LineReader.HISTORY_FILE_SIZE, historyFileSize());
            lineReader.setOpt(LineReader.Option.HISTORY_IGNORE_SPACE);
            lineReader.setOpt(LineReader.Option.HISTORY_IGNORE_DUPS);
            lineReader.setOpt(LineReader.Option.HISTORY_REDUCE_BLANKS);
            lineReader.setOpt(LineReader.Option.DISABLE_EVENT_EXPANSION);
            lineReader.getHistory().load();
        } catch (IOException ignored) {
            // History is a convenience feature; failed persistence must not block the CLI.
        }
    }

    static Path resolveHistoryFile(Path homeDir) {
        String configured = firstNonBlank(System.getProperty(HISTORY_FILE_PROPERTY), System.getenv("WRAITH_HISTORY_FILE"));
        if (configured != null) {
            return normalizeHistoryFile(Path.of(configured));
        }
        Path base = homeDir == null ? Path.of(System.getProperty("user.home")) : homeDir;
        return base.resolve(".wraith").resolve("history").resolve(DEFAULT_HISTORY_FILE_NAME)
                .toAbsolutePath().normalize();
    }

    static Path normalizeHistoryFile(Path configured) {
        Path path = configured.toAbsolutePath().normalize();
        if (Files.isDirectory(path)) {
            return path.resolve(DEFAULT_HISTORY_FILE_NAME).toAbsolutePath().normalize();
        }
        return path;
    }

    static void clearLineReaderHistory(LineReader lineReader) {
        if (lineReader == null || lineReader.getHistory() == null) {
            return;
        }
        try {
            lineReader.getHistory().purge();
        } catch (IOException ignored) {
            // Keep command behavior simple: in-memory history may still be reset by JLine.
        }
    }

    private static int historySize() {
        return configuredPositiveInt(HISTORY_SIZE_PROPERTY, "WRAITH_HISTORY_SIZE", 2_000);
    }

    private static int historyFileSize() {
        return configuredPositiveInt(HISTORY_FILE_SIZE_PROPERTY, "WRAITH_HISTORY_FILE_SIZE", 10_000);
    }

    private static int configuredPositiveInt(String property, String env, int fallback) {
        String raw = firstNonBlank(System.getProperty(property), System.getenv(env));
        if (raw == null) {
            return fallback;
        }
        try {
            int value = Integer.parseInt(raw.trim());
            return value > 0 ? value : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static String firstNonBlank(String first, String second) {
        if (first != null && !first.isBlank()) {
            return first;
        }
        if (second != null && !second.isBlank()) {
            return second;
        }
        return null;
    }

    private static PlanExecuteAgent.PlanReviewDecision mapReviewDecision(PlanReviewInputParser.Decision decision) {
        return switch (decision.type()) {
            case EXECUTE -> PlanExecuteAgent.PlanReviewDecision.execute();
            case CANCEL -> PlanExecuteAgent.PlanReviewDecision.cancel();
            case SUPPLEMENT -> PlanExecuteAgent.PlanReviewDecision.supplement(decision.feedback());
        };
    }

    /**
     * 从 .env 文件加载 API Key
     */
    private static String loadApiKey() {
        return loadConfigValue("GLM_API_KEY", null);
    }

    private static void configureLogging() {
        configureLogProperty(LOG_DIR_PROPERTY, "WRAITH_LOG_DIR",
                Path.of(System.getProperty("user.home"), ".wraith", "logs").toString());
        configureLogProperty(LOG_LEVEL_PROPERTY, "WRAITH_LOG_LEVEL", "INFO");
        configureLogProperty(LOG_MAX_HISTORY_PROPERTY, "WRAITH_LOG_MAX_HISTORY", "7");
        configureLogProperty(LOG_MAX_FILE_SIZE_PROPERTY, "WRAITH_LOG_MAX_FILE_SIZE", "10MB");
        configureLogProperty(LOG_TOTAL_SIZE_CAP_PROPERTY, "WRAITH_LOG_TOTAL_SIZE_CAP", "100MB");

        try {
            Files.createDirectories(Path.of(System.getProperty(LOG_DIR_PROPERTY)));
        } catch (IOException e) {
            System.err.println("⚠️ 创建日志目录失败: " + e.getMessage());
        }
    }

    private static void configureLogProperty(String propertyName, String envKey, String defaultValue) {
        String configuredValue = System.getProperty(propertyName);
        if (configuredValue == null || configuredValue.isBlank()) {
            configuredValue = loadConfigValue(envKey, defaultValue);
        }
        if (configuredValue != null && !configuredValue.isBlank()) {
            if (LOG_DIR_PROPERTY.equals(propertyName)) {
                configuredValue = expandHome(configuredValue.trim());
            }
            System.setProperty(propertyName, configuredValue.trim());
        }
    }

    private static String expandHome(String value) {
        if (value == null || value.isBlank()) {
            return value;
        }
        if (value.equals("~")) {
            return System.getProperty("user.home");
        }
        if (value.startsWith("~/")) {
            return Path.of(System.getProperty("user.home"), value.substring(2)).toString();
        }
        return value;
    }

    private static String loadConfigValue(String key, String defaultValue) {
        String sysValue = System.getProperty(key);
        if (sysValue != null && !sysValue.isBlank()) {
            return sysValue.trim();
        }

        String envValue = System.getenv(key);
        if (envValue != null && !envValue.isBlank()) {
            return envValue.trim();
        }

        File currentEnv = new File(ENV_FILE);
        if (currentEnv.exists()) {
            String value = readValueFromFile(currentEnv, key);
            if (value != null && !value.isBlank()) {
                return value.trim();
            }
        }

        File homeEnv = new File(System.getProperty("user.home"), ENV_FILE);
        if (homeEnv.exists()) {
            String value = readValueFromFile(homeEnv, key);
            if (value != null && !value.isBlank()) {
                return value.trim();
            }
        }

        return defaultValue;
    }

    private static String readValueFromFile(File file, String key) {
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) {
                    continue;
                }
                if (line.startsWith(key + "=")) {
                    return line.substring((key + "=").length()).trim();
                }
            }
        } catch (IOException e) {
            System.err.println("读取 .env 文件失败: " + e.getMessage());
        }
        return null;
    }

    static ModelSelection resolveModelSelection(String raw) {
        String value = raw == null ? "" : raw.trim();
        String normalized = value.toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "glm" -> new ModelSelection("glm", "glm-5.1", true);
            case "deepseek" -> new ModelSelection("deepseek", null, false);
            case "step", "stepfun", "step-fun" -> new ModelSelection("step", null, false);
            case "kimi", "moonshot", "moonshotai", "moonshot-ai" -> new ModelSelection("kimi", null, false);
            case "freellmapi", "free-llm-api", "free_llm_api", "freellm", "free-llm" ->
                    new ModelSelection("freellmapi", null, false);
            case "xfyun", "xfyun-maas", "xfyun_maas", "iflytek", "iflytek-maas", "iflytek_maas", "maas" ->
                    new ModelSelection("xfyun", null, false);
            default -> {
                if (normalized.startsWith("glm-")) {
                    yield new ModelSelection("glm", value, true);
                }
                if (normalized.startsWith("deepseek")) {
                    yield new ModelSelection("deepseek", value, true);
                }
                if (normalized.startsWith("step")) {
                    yield new ModelSelection("step", value, true);
                }
                if (normalized.startsWith("kimi-") || normalized.startsWith("moonshot-")) {
                    yield new ModelSelection("kimi", value, true);
                }
                yield new ModelSelection(normalized, null, false);
            }
        };
    }

    private static WraithConfig.ProviderConfig ensureProviderConfig(WraithConfig config, String provider) {
        if (config.getProviders() == null) {
            config.setProviders(new LinkedHashMap<>());
        }
        return config.getProviders().computeIfAbsent(provider, ignored -> new WraithConfig.ProviderConfig());
    }

    private static void printStartupScreen(PrintStream out, StartupScreenInfo info) {
        for (String line : startupScreenLines(info)) {
            out.println(line);
        }
    }

    static List<String> startupScreenLines(StartupScreenInfo info) {
        List<String> lines = new ArrayList<>(startupBannerLines(info));
        lines.add("");
        return lines;
    }

    /**
     * 常驻固定区内容:字标(6 行)+ 信息行(Wraith CLI / Model / 状态 / 能力,4 行),不含 Tips、不含分隔线。
     * 从 {@link #startupBannerLines} 切片:art=[0..5]、空行=[6]、info=[7..10]、空行=[11]、Tips=[12..]。
     */
    static List<String> pinnedBannerContentLines(StartupScreenInfo info) {
        List<String> all = startupBannerLines(info);
        if (all.size() < 11) {
            return List.of(); // 结构异常 → 让调用方降级
        }
        List<String> out = new ArrayList<>();
        out.addAll(all.subList(0, 6));   // WRAITH 字标
        out.addAll(all.subList(7, 11));  // 信息行(跳过 [6] 空行)
        return out;
    }

    /** 固定 banner 启用时,滚动历史里打 Tips 区块(+ 可能的启动提示):从 [11] 起(空行 + Tips + note)。 */
    static List<String> startupTipsLines(StartupScreenInfo info) {
        List<String> all = startupBannerLines(info);
        int from = Math.min(11, all.size());
        List<String> out = new ArrayList<>(all.subList(from, all.size()));
        out.add("");
        return out;
    }


    /**
     * 启动即清屏:抹掉运行 wraith 前终端里的残留内容,给开场动画 / 常驻 banner 一块干净画布。
     * ESC[3J 清回滚缓冲(scrollback)、ESC[H 光标归位左上、ESC[2J 清可见屏——顺序同 ncurses
     * 的 {@code clear}(E3 + clear_screen),确保连向上滚也看不到旧内容。
     *
     * <p>仅在真实交互终端执行:避免把清屏序列写进被管道 / 重定向的输出里。
     */
    private static void clearTerminalScreen(Terminal terminal) {
        if (terminal == null) {
            return;
        }
        boolean realTty = System.console() != null
                && terminal.getType() != null
                && !"dumb".equalsIgnoreCase(terminal.getType());
        if (!realTty) {
            return;
        }
        try {
            var writer = terminal.writer();
            if (writer != null) {
                writer.print("[r[3J[H[2J");
                writer.flush();
            }
        } catch (Exception ignored) {
            // 清屏失败不致命,继续启动
        }
    }

    private static void playIntroIfEnabled(Terminal terminal, Renderer renderer) {
        try {
            boolean inline = renderer instanceof InlineRenderer;
            boolean realTty = System.console() != null
                    && terminal.getType() != null
                    && !"dumb".equalsIgnoreCase(terminal.getType());
            if (IntroGate.shouldPlay(inline, AnsiStyle.isEnabled(), realTty,
                    terminal.getWidth(), System.getenv("WRAITH_INTRO"))) {
                IntroAnimation.play(terminal);
            }
        } catch (Exception ignored) {
            // 开场动画不是关键路径,任何异常都不能挡住启动
        }
    }

    static List<String> startupBannerLines() {
        return startupBannerLines(new StartupScreenInfo(
                "auto",
                "model",
                0,
                0,
                0,
                0,
                0,
                ""));
    }

    static List<String> startupBannerLines(StartupScreenInfo info) {
        String model = info.model() == null || info.model().isBlank() ? "auto" : info.model();
        String provider = info.provider() == null || info.provider().isBlank() ? "model" : info.provider();
        String mcp = info.mcpTotal() <= 0
                ? "MCP not configured"
                : "MCP " + info.mcpReady() + "/" + info.mcpTotal() + " · " + info.mcpTools() + " tools";
        String skills = info.skillsTotal() <= 0
                ? "0 skills"
                : info.skillsEnabled() + "/" + info.skillsTotal() + " skills";
        String ready = "Model " + model + " (" + provider + ")";
        String capabilities = "ReAct · Plan · MCP · Browser · Image · Tools · Memory · RAG";
        String state = mcp + " · " + skills + " · ReAct";
        List<String> lines = new ArrayList<>(List.of(
                "   " + AnsiStyle.wordmark(WraithWordmark.LINES.get(0)),
                "   " + AnsiStyle.wordmark(WraithWordmark.LINES.get(1)),
                "   " + AnsiStyle.wordmark(WraithWordmark.LINES.get(2)),
                "   " + AnsiStyle.wordmark(WraithWordmark.LINES.get(3)),
                "   " + AnsiStyle.wordmark(WraithWordmark.LINES.get(4)),
                "   " + AnsiStyle.wordmark(WraithWordmark.LINES.get(5)),
                "",
                "   " + AnsiStyle.wordmark("Wraith") + "  " + AnsiStyle.heading("v" + VERSION),
                "   " + AnsiStyle.heading(ready),
                "   " + AnsiStyle.heading(state),
                "   " + AnsiStyle.heading(capabilities),
                "",
                "Tips for getting started:",
                "1. Type " + AnsiStyle.emphasis("/") + " for commands and Tab completion",
                "2. Ask coding questions, edit code or run commands",
                "3. Attach context with " + AnsiStyle.emphasis("@path") + " or " + AnsiStyle.emphasis("@image:")
        ));
        if (info.note() != null && !info.note().isBlank()) {
            lines.add("");
            lines.add(AnsiStyle.subtle(info.note().replace('\n', ' ')));
        }
        return lines;
    }

    static McpConfigBootstrapResult ensureDefaultMcpConfig(Path userHome) throws IOException {
        Path configFile = userHome.resolve(".wraith").resolve("mcp.json");
        if (Files.notExists(configFile)) {
            Files.createDirectories(configFile.getParent());
            Files.writeString(configFile, DEFAULT_CHROME_DEVTOOLS_MCP_JSON);
            return new McpConfigBootstrapResult(true,
                    "✅ 已创建默认 MCP 配置: " + configFile
                            + "\n   默认启用 chrome-devtools（isolated 模式）。");
        }
        String content = Files.readString(configFile);
        if (!content.contains("\"chrome-devtools\"")) {
            return new McpConfigBootstrapResult(false,
                    "ℹ️ 检测到 ~/.wraith/mcp.json 未配置 chrome-devtools，建议参考 README 添加浏览器 MCP server。");
        }
        return new McpConfigBootstrapResult(false, "");
    }

    private static MemorySaveRequest parseMemorySave(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.regionMatches(true, 0, "--global ", 0, 9)) {
            return new MemorySaveRequest(value.substring(9).trim(), "global");
        }
        if (value.equalsIgnoreCase("--global")) {
            return new MemorySaveRequest("", "global");
        }
        if (value.regionMatches(true, 0, "--project ", 0, 10)) {
            return new MemorySaveRequest(value.substring(10).trim(), "project");
        }
        if (value.equalsIgnoreCase("--project")) {
            return new MemorySaveRequest("", "project");
        }
        return new MemorySaveRequest(value, "project");
    }

    private static String formatMemoryEntries(String title, List<MemoryEntry> entries) {
        StringBuilder sb = new StringBuilder(title).append("：\n");
        if (entries == null || entries.isEmpty()) {
            return sb.append("📭 没有匹配的长期记忆。").toString();
        }
        for (MemoryEntry entry : entries) {
            String scope = LongTermMemory.scopeOf(entry);
            String project = entry.getMetadata().get("project");
            sb.append("- ")
                    .append(entry.getId())
                    .append(" [").append(scope).append("]");
            if ("project".equals(scope) && project != null && !project.isBlank()) {
                sb.append(" ").append(shortenPath(project));
            }
            sb.append(" · ").append(entry.getTimestamp()).append("\n")
                    .append("  ").append(entry.getContent()).append("\n");
        }
        return sb.toString().trim();
    }

    private static String shortenPath(String path) {
        if (path == null || path.isBlank()) {
            return "";
        }
        try {
            Path p = Path.of(path);
            int count = p.getNameCount();
            if (count <= 3) {
                return path;
            }
            return "..." + File.separator + p.subpath(count - 3, count);
        } catch (Exception e) {
            return path;
        }
    }

    record McpConfigBootstrapResult(boolean created, String message) {
    }

    record ModelSelection(String provider, String model, boolean explicitModel) {
    }

    record ProviderConfigUpdate(String provider, String apiKey, String baseUrl, String model, String loraId,
                                boolean setDefault, String error) {
        static ProviderConfigUpdate error(String error) {
            return new ProviderConfigUpdate(null, null, null, null, null, false, error);
        }
    }

    private record MemorySaveRequest(String fact, String scope) {
    }
}
