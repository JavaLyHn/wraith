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
import com.lyhn.wraith.memory.PendingFact;
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
 * Wraith v16.1.0 - Terminal-First Agent IDE
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

    /** {@code --no-snapshot} / {@code --no-snapshots} 的两种写法都认。 */
    static final java.util.Set<String> NO_SNAPSHOT_FLAGS =
            java.util.Set.of("--no-snapshot", "--no-snapshots");

    /**
     * 本次运行不存快照。
     *
     * <p><b>只做一件事</b>：把 {@code wraith.snapshot.enabled} 系统属性设成 {@code false}，
     * 然后把这个参数从 {@code args} 里摘掉。{@link com.lyhn.wraith.snapshot.SnapshotConfig}
     * 本来就在读那个属性 —— 所以这是「一行解析 + 零新增管道」，
     * 而且天然对所有子命令生效（{@code app-server} / {@code gateway} / {@code serve} 同一个 main）。
     *
     * <p><b>不写盘</b>：它是「这一次别存」。要持久化用 {@code /snapshot off} 或桌面按钮 ——
     * 一个命令行参数偷偷改了配置文件，比不生效更糟。
     *
     * <p>必须<b>摘掉</b>而不是留在 args 里：下游 {@code isWechatCommand} 之类按位置读
     * {@code args[0]}，多一个参数会让 {@code wraith --no-snapshot wechat} 认不出子命令。
     */
    static String[] applyNoSnapshotFlag(String[] args) {
        if (args == null || args.length == 0) {
            return args == null ? new String[0] : args;
        }
        java.util.List<String> kept = new ArrayList<>(args.length);
        boolean found = false;
        for (String arg : args) {
            if (arg != null && NO_SNAPSHOT_FLAGS.contains(arg.trim().toLowerCase(Locale.ROOT))) {
                found = true;
                continue;
            }
            kept.add(arg);
        }
        if (!found) {
            return args;
        }
        // 已经显式设过就不覆盖:用户同时给了 -Dwraith.snapshot.enabled=true 和 --no-snapshot
        // 是自相矛盾的输入,而参数在命令行上更靠后、意图更明确,所以参数赢。
        System.setProperty("wraith.snapshot.enabled", "false");
        return kept.toArray(new String[0]);
    }

    public static void main(String[] args) {
        configureAwtForCli();
        args = applyNoSnapshotFlag(args);
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
        if (com.lyhn.wraith.policy.sandbox.SandboxDoctor.isCommand(args)) {
            configureLogging();
            int code = com.lyhn.wraith.policy.sandbox.SandboxDoctor.run(args);
            if (code != 0) {
                System.exit(code);
            }
            return;
        }
        if (com.lyhn.wraith.render.TerminalDoctor.isCommand(args)) {
            configureLogging();
            int code = com.lyhn.wraith.render.TerminalDoctor.run(args);
            if (code != 0) {
                System.exit(code);
            }
            return;
        }

        configureLogging();
        // 只在交互式 CLI 分支装:GBK 控制台上把 emoji 降级成 ASCII,否则满屏 `?`。
        // **必须在所有子命令分发之后** —— app-server / gateway 走 stdio 上的 NDJSON,
        // 改一个字符就破协议。
        installConsoleSafety();

        WraithConfig config = WraithConfig.load();
        LlmClient llmClient = LlmClientFactory.createFromConfig(config);
        if (llmClient == null) {
            System.err.println("❌ 错误: 未找到可用的 API Key");
            // 不点名具体 provider:此前这里列了六家(不含 ANTHROPIC_API_KEY),而这正是
            // 只有 anthropic key 的用户最需要正确指引的时刻 —— 照旧文案做会去申请 GLM key。
            System.err.println("请在 .env 或环境变量里设 <NAME>_API_KEY(小写 NAME 即 provider 名),");
            System.err.println("例如 ANTHROPIC_API_KEY / OPENAI_API_KEY / GLM_API_KEY；");
            System.err.println("自建服务或代理网关需同时设 <NAME>_BASE_URL。详见 .env.example。");
            System.exit(1);
        }
        AtomicReference<LlmClient> llmClientRef = new AtomicReference<>(llmClient);
        ResumeIntent resumeIntent = ResumeIntent.from(args); // --continue / --resume [id]

        // 终端创建收口到 TerminalBootstrap:它在构建期间临时接住 org.jline 的日志,
        // 于是「JLine 为什么降级成 dumb」不再是个黑洞 —— 那正是 Windows 上
        // 「输入命令也不管用」的根子(dumb 没有 raw mode ⇒ 行编辑/补全/历史全失灵)。
        // 顺带在 JDK<22 时跳过注定失败的 ffm provider。诊断详见 wraith terminal doctor。
        java.util.concurrent.atomic.AtomicReference<com.lyhn.wraith.render.TerminalBootstrap.Diagnosis>
                terminalDiagnosis = new java.util.concurrent.atomic.AtomicReference<>();
        try (Terminal terminal = com.lyhn.wraith.render.TerminalBootstrap.open(terminalDiagnosis::set)) {
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
                            () -> skillRegistryRef.get() == null ? List.of() : skillRegistryRef.get().allSkills(),
                            () -> config))
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
            // 终端降级要**主动告知**,否则用户按 Tab 没反应会以为是自己的问题。
            // 一行摘要进启动屏,完整诊断走 wraith terminal doctor。
            startupNote = appendStartupNote(startupNote,
                    com.lyhn.wraith.render.TerminalBootstrap.shortNote(terminalDiagnosis.get()));
            try {
                // chrome-devtools 现在是 McpConfigLoader 里的内建项(缺位才补,用户配置优先)。
                // 此前这里会往 ~/.wraith/mcp.json 写一份默认模板 —— 那条路只挂在交互式 CLI 上,
                // 桌面 / gateway / automation 三个入口都不经过,于是「只用桌面的人永远没有浏览器工具」。
                // 内建项四个入口自动一致,也不再动用户的文件。
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
            // 快照失败提示必须走渲染器:活动面板有自己的重绘线程,直接 println 会被挤进
            // 「▰▱▱… 1%」那一行,连「怎么关掉」都读不全(用户 Windows 实测)。
            hitlToolRegistry.setSnapshotNoticeSink(renderer::printNotice);
            // 退出时给排队中的 post-turn 快照几秒写完。否则 daemon 写入线程被 JVM 直接带走,
            // index.lock 留在 Side-Git 里 —— 那正是这把锁最初的来处。
            Runtime.getRuntime().addShutdownHook(new Thread(
                    () -> hitlToolRegistry.getSnapshotService().close(), "wraith-snapshot-shutdown"));
            reactAgent.setPricingTable(new com.lyhn.wraith.context.PricingTable(config.getPricing()));
            reactAgent.setExternalContextSupplier(mcpServerManager::resourceIndexForPrompt);
            reactAgent.setSkillRegistry(skillRegistry);
            reactAgent.setSkillContextBuffer(skillContextBuffer);
            DurableTaskManager taskManager = openTaskManager(llmClientRef);
            taskManager.start();
            Runtime.getRuntime().addShutdownHook(new Thread(taskManager::close, "wraith-task-shutdown"));
            hitlToolRegistry.setTaskManager(taskManager); // ← 补:交互式 CLI 也要与 /task、app-server 共用同一 DurableTaskManager,
                                                           //    否则聊天里的 task_* 工具在 CLI 下永远诚实失败(面板/CLI /task 能做、聊天做不到)。
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
            reactAgent.setCurationSink(new com.lyhn.wraith.session.SessionCurationSink(sessionStore));
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

            // /archive clear 的二次确认:第一次打印警告置 true,紧接着再输一次才真清
            boolean[] archiveClearPending = { false };

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
                // 非 /archive clear 的任何输入都复位二次确认态:
                // 否则「clear → 别的命令 → clear」会被误当成连续两次
                if (command.type() != CliCommandParser.CommandType.ARCHIVE_CLEAR) {
                    archiveClearPending[0] = false;
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
                        ui.println("   /memory pending - 查看待确认候选;/memory approve|reject <id> - 批准/驳回");
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
                            boolean saveOk = reactAgent.getMemoryManager().storeFact(saveRequest.fact(), saveRequest.scope());
                            ui.println(saveOk
                                    ? "💾 已保存到长期记忆(" + saveRequest.scope() + "): " + saveRequest.fact() + "\n"
                                    : "🚫 拒绝保存:疑似凭证,未写入长期记忆\n");
                        }
                        continue;
                    }
                    case MEMORY_PENDING -> {
                        ui.println(formatPendingFacts(reactAgent.getMemoryManager().listPending()));
                        ui.println();
                        continue;
                    }
                    case MEMORY_APPROVE -> {
                        String payload = command.payload();
                        if (payload == null || payload.isBlank()) {
                            ui.println("❌ 请提供候选 id,例如 /memory approve cand-abc123\n");
                            continue;
                        }
                        String[] parts = payload.trim().split("\\s+");
                        boolean ok;
                        String verb;
                        if (parts.length >= 3 && "replace".equalsIgnoreCase(parts[1])) {
                            ok = reactAgent.getMemoryManager().approvePendingReplacing(parts[0], parts[2]);
                            verb = "批准并替换 " + parts[2];
                        } else {
                            ok = reactAgent.getMemoryManager().approvePending(parts[0]);
                            verb = "批准";
                        }
                        ui.println(ok ? ("✅ 已" + verb + ": " + parts[0] + "\n")
                                      : ("📭 未找到或不可批准(可能已处理/非当前项目): " + parts[0] + "\n"));
                        continue;
                    }
                    case MEMORY_REJECT -> {
                        String id = command.payload();
                        if (id == null || id.isBlank()) {
                            ui.println("❌ 请提供候选 id,例如 /memory reject cand-abc123\n");
                        } else {
                            ui.println(reactAgent.getMemoryManager().rejectPending(id)
                                    ? ("🗑️ 已驳回候选: " + id + "\n") : ("📭 未找到候选: " + id + "\n"));
                        }
                        continue;
                    }
                    case MEMORY_PENDING_CLEAR -> {
                        reactAgent.getMemoryManager().clearPending();
                        ui.println("🧹 待确认候选已清空\n");
                        ui.println();
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
                            // config 项 ∪ env 发现的候选 —— 只用 config.getProviders().keySet()
                            // 会让 .env 只写了 <NAME>_API_KEY、没跑过 /config 的用户看到自相矛盾的
                            // 两行:状态行报着 deepseek,下一行却说「还没有配置任何 provider」(I3)。
                            List<String> configuredIds = knownProviderIds(config);
                            if (configuredIds.isEmpty()) {
                                ui.println("   还没有配置任何 provider。");
                                ui.println("   添加: /config provider <name> --api-key <key>\n");
                            } else {
                                ui.println("   已配置的 provider（/model <name> 切换）：");
                                for (String id : configuredIds) {
                                    String m = config.getModel(id);
                                    ui.println("   /model " + id
                                            + (m == null || m.isBlank() ? "" : "   →  " + m));
                                }
                                ui.println("");
                            }
                        } else {
                            ModelSelection target = resolveModelSelection(selection, config);
                            // LlmClientFactory.create(provider, config) 是从 config 里读模型的,
                            // 所以显式模型必须先写进去才能生效 —— 顺序不能反。代价是切换失败时
                            // config 已经被改脏了,故先留好回滚料。两参形式(/model <p> <m>)让打错
                            // provider 名变得很容易,这个回滚从「洁癖」变成了必要。
                            boolean providerExisted = config.getProviders() != null
                                    && config.getProviders().containsKey(target.provider());
                            String previousModel = providerExisted
                                    ? config.getProviders().get(target.provider()).getModel()
                                    : null;
                            if (target.explicitModel()) {
                                ensureProviderConfig(config, target.provider()).setModel(target.model());
                            }
                            LlmClient newClient = LlmClientFactory.create(target.provider(), config);
                            if (newClient == null) {
                                if (target.explicitModel()) {
                                    rollbackModelWrite(config, target.provider(), providerExisted, previousModel);
                                }
                                ui.println("❌ 切换失败：未配置 " + target.provider() + " 的 API Key");
                                ui.println("   两参形式是 /model <provider> <model>，第一段须是 provider 名"
                                        + "（/model 空参可列出已配置的）\n");
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
                            ui.println(handleConfigCommand(config, command.payload(), cfg -> {
                                // 两件事一起做:失效搜索缓存(第五次) + 重载计价表(第六次 snapshot-vs-live)
                                hitlToolRegistry.invalidateSearchProvider();
                                reactAgent.reloadPricingTable(cfg);
                            }));
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
                    case ARCHIVE -> {
                        handleArchiveCurrent(command.payload(), sessionStore, reactAgent, renderer, ui);
                        continue;
                    }
                    case ARCHIVE_LIST -> {
                        handleArchiveList(sessionStore, ui);
                        continue;
                    }
                    case ARCHIVE_SHOW -> {
                        handleArchiveShow(command.payload(), sessionStore, ui);
                        continue;
                    }
                    case ARCHIVE_RESTORE -> {
                        handleArchiveRestore(command.payload(), sessionStore, reactAgent, ui);
                        continue;
                    }
                    case ARCHIVE_DELETE -> {
                        handleArchiveDelete(command.payload(), sessionStore, ui);
                        continue;
                    }
                    case ARCHIVE_CLEAR -> {
                        archiveClearPending[0] = handleArchiveClear(sessionStore, ui, archiveClearPending[0]);
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
                // 本轮"干净答案"暂存(与桌面 cleanTeamAnswer/cleanAnswer 同款约定):
                // plan/team 的 run() 返回值供终端打印(保留 chrome),真正记入 reactAgent 历史/落盘的
                // 应是 getLastCleanResult() 的干净版,故在 lambda 内旁路存一份,每轮重新声明避免跨轮泄漏。
                final String[] cleanHolder = {null};
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
                        planAgent.setConversationContext(
                                com.lyhn.wraith.agent.ConversationDigest.of(reactAgent.getConversationHistory()));
                        String planResult = planAgent.run(taskInput);
                        cleanHolder[0] = planAgent.getLastCleanResult();
                        return planResult;
                    };
                } else if (nextTaskUseTeamMode || command.type() == CliCommandParser.CommandType.SWITCH_TEAM) {
                    snapshotMode = "team";
                    LlmClient activeClient = llmClient;
                    runTask = () -> {
                        AgentOrchestrator orchestrator = createTeamAgent(activeClient, reactAgent, ui);
                        orchestrator.setExternalContextSupplier(mcpServerManager::resourceIndexForPrompt);
                        orchestrator.setSkillSystem(skillRegistry, skillContextBuffer);
                        orchestrator.setConversationContext(
                                com.lyhn.wraith.agent.ConversationDigest.of(reactAgent.getConversationHistory()));
                        String teamResult = orchestrator.run(taskInput);
                        cleanHolder[0] = orchestrator.getLastCleanResult();
                        return teamResult;
                    };
                } else {
                    snapshotMode = "react";
                    runTask = () -> reactAgent.run(taskInput);
                }
                SnapshotService snapshotService = reactAgent.getToolRegistry().getSnapshotService();
                renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, snapshotMode));
                // 提交后到模型开口之间有一段**同步**准备期:SnapshotService.runTurn 先做
                // pre-turn 快照(post-turn 才是异步的),大仓库要好几秒。pty 实测这段是
                // 8.26 秒完全静止,用户读作「发消息无响应」——所以先把活动面板点起来,
                // Agent 的 beginThinking 随后平滑接管。详见 TurnPreparationNotice。
                Runnable endPreparation = com.lyhn.wraith.render.TurnPreparationNotice.begin(renderer, ui);
                String response;
                try {
                    response = runWithCancelSupport(terminal,
                            ui,
                            () -> snapshotService.runTurn(snapshotMode, taskInput, runTask::call));
                } finally {
                    endPreparation.run();
                }
                if (!"react".equals(snapshotMode)) {
                    renderer.updateStatus(statusInfo(reactAgent, mcpServerManager, skillRegistry, "idle"));
                }
                nextTaskUsePlanMode = false;
                nextTaskUseTeamMode = false;
                if (response != null && !response.isBlank()) {
                    ui.println(response);
                    ui.println();
                }
                // 把 plan/team 本轮补进 reactAgent 会话历史(与桌面 agent.recordExternalTurn 对称),
                // 使下一轮切回 react 时能看到本轮上下文;react 模式自身已在 run() 内记录,不重复。
                // 记录用干净版(与桌面 cleanTeamAnswer/cleanAnswer 一致),response 仍保留 chrome 仅供终端打印。
                String toRecord = (cleanHolder[0] != null && !cleanHolder[0].isBlank()) ? cleanHolder[0] : response;
                if (!"react".equals(snapshotMode) && toRecord != null && !toRecord.isBlank()) {
                    reactAgent.recordExternalTurn(taskInput, toRecord);
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

    /** 用户 home。会话与归档存储的根,与 SessionStore.open 的第一参一致。 */
    private static java.nio.file.Path userHome() {
        return java.nio.file.Path.of(System.getProperty("user.home"));
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
            System.out.println("✅ Wraith Runtime API 已启动: http://127.0.0.1:" + server.port());
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
            // **不退出。** 此前这里 System.exit(1),造成首次运行死锁:
            // 桌面端「Provider 配置」面板是走 config.setProvider RPC 存密钥的,后端一死,
            // 面板就存不了 → 想配 key 必须先有 key,全新装机在应用内无路可走。
            // 现在无模型也照常起,配置类 RPC 全部可用;发起对话时才报错;
            // 配好 provider 后由 ensureClient() 就地热装,不需要重启。
            System.err.println("app-server: 尚未配置任何模型,已以「无模型」状态启动 "
                    + "—— 配置类 RPC 可用,发起对话会被拒绝。请在桌面端「Provider 配置」里填一个 API Key。");
        }

        // 后台任务管理器:与 CLI 复用同一 ~/.wraith/tasks/tasks.db(互通);
        // task runner 在「活跃会话根」跑(taskRoot 由会话工厂 set),独立 headless agent。
        final java.util.concurrent.atomic.AtomicReference<String> taskRoot =
                new java.util.concurrent.atomic.AtomicReference<>(
                        java.nio.file.Path.of(".").toAbsolutePath().normalize().toString());
        // ⚠ 这里**不能**捕获启动那一刻的 client。后端现在允许「无模型」启动(首次运行死锁的修复),
        //   此时 client 为 null;lambda 一旦把 null 捕获进去就永久是 null ——
        //   用户在 GUI 里配好 provider、对话链路已被 ensureClient 热装之后,
        //   后台任务仍会抛 `LlmClient.supportsTools() because "this.llmClient" is null`。
        //   与紧邻的 taskRoot 一样,client 也是**会变的东西**,必须用活的持有者。
        //   (交互式 CLI 那条路径本来就是对的:openTaskManager(AtomicReference)。)
        final java.util.concurrent.atomic.AtomicReference<com.lyhn.wraith.llm.LlmClient> appClientRef =
                new java.util.concurrent.atomic.AtomicReference<>(client);
        com.lyhn.wraith.runtime.task.DurableTaskManager taskManagerTmp;
        try {
            taskManagerTmp = com.lyhn.wraith.runtime.task.DurableTaskManager.openDefault(
                    prompt -> runHeadlessTaskAt(
                            prompt, requireTaskClient(appClientRef, config), taskRoot.get()));
            taskManagerTmp.start();
            Runtime.getRuntime().addShutdownHook(
                    new Thread(taskManagerTmp::close, "wraith-appserver-task-shutdown"));
        } catch (Exception e) {
            System.err.println("app-server: 后台任务管理器初始化失败: " + e.getClass().getSimpleName());
            taskManagerTmp = null;
        }
        final com.lyhn.wraith.runtime.task.DurableTaskManager taskManager = taskManagerTmp;

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
                taskRoot.set(root); // 后台任务在当前活跃会话根跑
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
                registry.setTaskManager(taskManager); // ← 新增:后台任务工具与面板共用同一 DurableTaskManager

                // 可变 client 持有(会话级 provider 切换用)。**允许为 null** —— 见 startAppServer 顶部说明。
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
                                userHome(),
                                root,
                                currentClient[0] == null ? "" : currentClient[0].getProviderName(),
                                currentClient[0] == null ? "" : currentClient[0].getModelName());
                sessionStore.startNew();
                // 会话治理落地(修:app-server 工厂此前漏接这两行,交互 CLI 在 setup 处已接)。
                // 缺 curationSink → CurationStats.appendMetrics 走 NOOP → 会话 -artifacts/context-metrics.jsonl
                // 永不落盘(内存 curator.stats 累计仍增,故 context.state.get 有数、掩盖了该盲点);
                // 缺 pricingTable → usage 行/快照无 cost。桌面后端与 CLI 至此对齐。
                agent.setCurationSink(new com.lyhn.wraith.session.SessionCurationSink(sessionStore));
                agent.setPricingTable(new com.lyhn.wraith.context.PricingTable(config.getPricing()));

                // ── 无模型启动的两个把手 ─────────────────────────────────────────────
                // ensureClient:currentClient 为空时,按**当前**配置就地热装一个 client。
                //   用户在 GUI 里配好第一个 provider 后立刻可用,不需要重启后端。
                //   createFromConfig 会按 ProviderResolver 的候选顺序逐个试,所以 config 或 env 里
                //   任意一个有 key 的 provider 都能装上(此前是硬编码的 6 家白名单,anthropic /
                //   openai / siliconflow 乃至 freellmapi-2 这种多实例 id 全都装不上)。
                // requireClient:需要真实模型的路径(发起对话/plan/team)用它,拿不到就抛出
                //   一句人能看懂的话 —— 而不是 NPE,也不是让整个后端不启动。
                final java.util.function.Supplier<com.lyhn.wraith.llm.LlmClient> ensureClient = () -> {
                    if (currentClient[0] != null) return currentClient[0];
                    com.lyhn.wraith.llm.LlmClient fresh =
                            com.lyhn.wraith.llm.LlmClientFactory.createFromConfig(config);
                    if (fresh != null) {
                        currentClient[0] = fresh;
                        agent.setLlmClient(fresh);
                        sessionStore.setProviderModel(fresh.getProviderName(), fresh.getModelName());
                        // 同步给后台任务:否则对话能用了、后台任务还要自己再装一个
                        appClientRef.compareAndSet(null, fresh);
                        System.err.println("app-server: 已装载模型 "
                                + fresh.getProviderName() + " / " + fresh.getModelName());
                    }
                    return fresh;
                };
                final java.util.function.Supplier<com.lyhn.wraith.llm.LlmClient> requireClient = () -> {
                    com.lyhn.wraith.llm.LlmClient c = ensureClient.get();
                    if (c == null) {
                        throw new IllegalStateException(
                                "尚未配置任何模型。请打开左侧「配置 → Provider 配置」，"
                                + "填入一个 API Key 并保存后重试。");
                    }
                    return c;
                };

                com.lyhn.wraith.hitl.RendererHitlHandler rendererHitl =
                        new com.lyhn.wraith.hitl.RendererHitlHandler(renderer, hitl.isEnabled());
                hitl.setDelegate(rendererHitl);

                // resume 后若 provider 恢复失败,置此标志供 modelList 回传 modelFallback
                boolean[] resumeFallback = { false };

                // 旁车暂存：team/plan 录制完后暂存，persistTurn 落盘时消费（AtomicReference 作 effectively-final 持有者）
                final java.util.concurrent.atomic.AtomicReference<int[]> pendingCardOrdinal = new java.util.concurrent.atomic.AtomicReference<>();
                final java.util.concurrent.atomic.AtomicReference<String> pendingCardEventsJson = new java.util.concurrent.atomic.AtomicReference<>();

                // 浏览器子系统装配(复刻交互路径):让 agent 的 browser_* 工具生效 + 供 browser.* RPC 复用
                final com.lyhn.wraith.browser.BrowserSession browserSession = new com.lyhn.wraith.browser.BrowserSession();
                final com.lyhn.wraith.browser.BrowserConnectivityCheck browserConnectivityCheck = new com.lyhn.wraith.browser.BrowserConnectivityCheck();
                registry.setBrowserGuard(new com.lyhn.wraith.browser.BrowserGuard(browserSession, new com.lyhn.wraith.browser.SensitivePagePolicy()));
                registry.setBrowserConnector(new com.lyhn.wraith.browser.BrowserConnector() {
                    public String status() { return appServerBrowserCmd("status", browserSession, browserConnectivityCheck, appServerMcp.manager(), registry, hitl); }
                    public String connectDefault() { return appServerBrowserCmd("connect", browserSession, browserConnectivityCheck, appServerMcp.manager(), registry, hitl); }
                    public String disconnect() { return appServerBrowserCmd("disconnect", browserSession, browserConnectivityCheck, appServerMcp.manager(), registry, hitl); }
                });

                return new com.lyhn.wraith.runtime.appserver.AppServer.SessionRunner() {
                    public com.lyhn.wraith.runtime.appserver.EventStreamRenderer renderer() { return renderer; }
                    public String runTurn(String input) throws Exception {
                        requireClient.get();   // 无模型时给一句人话,不是 NPE
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
                        requireClient.get();
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
                    public java.util.Map<String, Object> contextState() {
                        java.util.Map<String, Object> m = agent.contextStateCore();
                        long window = m.get("contextWindow") instanceof Number n ? n.longValue() : 0L;
                        sessionStore.artifactDir().ifPresent(dir ->
                                com.lyhn.wraith.runtime.appserver.ContextStateAggregator.merge(
                                        m, dir.resolve("context-metrics.jsonl"), window));
                        return m;
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
                    @Override
                    public java.util.List<com.lyhn.wraith.llm.LlmClient.Message> peekSession(String id) {
                        return sessionStore.peek(id);   // 纯读,不碰 agent/currentId
                    }
                    @Override
                    public java.util.List<com.lyhn.wraith.llm.LlmClient.Tool> builtinTools() {
                        return agent.getToolRegistry().getToolDefinitions();   // 权威目录,只读
                    }
                    public String persistTurn() {
                        sessionStore.persist(agent.getConversationHistory());
                        String id = sessionStore.currentId();
                        int[] ord = pendingCardOrdinal.getAndSet(null);
                        String ev = pendingCardEventsJson.getAndSet(null);
                        if (id != null && ord != null && ev != null) {
                            sessionStore.appendCard(id, ord[0], ev);
                        }
                        return id;
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
                        // 无模型时照常回目录(空 current)——面板要能列出可配的 provider,
                        // 否则用户连「去哪配」都看不到。
                        com.lyhn.wraith.llm.LlmClient c = currentClient[0];
                        return com.lyhn.wraith.runtime.appserver.ModelCatalog.result(
                                config,
                                c == null ? "" : c.getProviderName(),
                                c == null ? "" : c.getModelName(),
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
                        // 后台任务跟随当前模型 —— 否则会被钉死在「第一次装上的那个」,
                        // 用户切了模型却发现后台任务还在用旧的,又是一处说不清的分叉
                        appClientRef.set(newClient);
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
                        ensureClient.get();   // 无模型状态下「设默认」同样应立刻生效
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
                        // 存完就该能用:此前这里从不设 defaultProvider,而它的硬编码初值 "glm"
                        // 会被 save() 落盘 —— 于是配好 anthropic 点保存,createFromConfig
                        // 先试无 key 的 glm、再遍历旧白名单那 6 家,返回 null,界面说「无可用模型」。
                        ProviderDefaults.healDefault(config);
                        config.save();
                        // 首个 provider 落地后就地热装 —— 这是打破「想配 key 得先有 key」死锁的一环:
                        // 存完立刻可用,不需要重启后端,也不需要用户再去点一次「设默认」。
                        ensureClient.get();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String, Object> configRemoveProvider(String id) {
                        config.getProviders().remove(id);
                        // 删掉当前默认那个就落到下一个有 key 的。此前这里手写了一遍循环,
                        // 现在与 createFromConfig / model.list 共用 ProviderResolver —— 不写第五份。
                        ProviderDefaults.healDefault(config);
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
                        // 套 20s 上限:SHARED_HTTP_CLIENT 的 callTimeout 是 600s(按真实对话调的),
                        // 拿它等一个 ping 的结论毫无意义 —— 用户看到的就是「一直卡着没有响应」。
                        return awaitProbe(() -> {
                            long t0 = System.nanoTime();
                            try {
                                probe.chat(java.util.List.of(
                                        com.lyhn.wraith.llm.LlmClient.Message.user("ping")),
                                        java.util.List.of());
                                long ms = (System.nanoTime() - t0) / 1_000_000L;
                                return java.util.Map.of("ok", true,
                                        "model", probe.getModelName(), "latencyMs", ms);
                            } catch (Exception e) {
                                String em = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                                em = redactKey(em, tmp.getApiKey(id));
                                if (em.length() > 300) em = em.substring(0, 300);
                                return java.util.Map.of("ok", false, "error", em);
                            }
                        }, probeTimeoutSeconds());
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
                    public boolean deleteSession(String id, String path) {
                        // path 空 → 活跃 store;否则按项目路径开新 store
                        if (path == null || path.isBlank()) return sessionStore.deleteById(id);
                        return com.lyhn.wraith.session.SessionStore
                                .open(userHome(), path, "", "").deleteById(id);
                    }
                    public java.util.List<java.util.Map<String, Object>> projectSummary(java.util.List<String> paths) {
                        java.util.List<java.util.Map<String, Object>> out = new java.util.ArrayList<>();
                        for (com.lyhn.wraith.session.ProjectSessionReader.Summary s
                                : com.lyhn.wraith.session.ProjectSessionReader.summaries(userHome(), paths)) {
                            // lastSessionAt 可能为 null(无会话),Map.of 不吃 null → 用 LinkedHashMap
                            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                            m.put("path", s.path());
                            m.put("sessionCount", s.sessionCount());
                            m.put("lastSessionAt", s.lastSessionAt());
                            out.add(m);
                        }
                        return out;
                    }
                    public java.util.List<com.lyhn.wraith.session.SessionMeta> listSessionsForProject(String path, int limit) {
                        return com.lyhn.wraith.session.ProjectSessionReader.recent(userHome(), path, limit);
                    }
                    public boolean setSessionArchived(String id, boolean archived, String path) {
                        // path 空 → 活跃 store;否则按项目路径开新 store
                        if (path == null || path.isBlank()) return sessionStore.setArchived(id, archived);
                        return com.lyhn.wraith.session.SessionStore
                                .open(userHome(), path, "", "").setArchived(id, archived);
                    }
                    public java.util.List<com.lyhn.wraith.session.SessionMeta> listArchivedSessions(
                            java.util.List<String> paths, int limit) {
                        return com.lyhn.wraith.session.ProjectSessionReader.archived(userHome(), paths, limit);
                    }
                    public int archiveProjectSessions(String path) {
                        return com.lyhn.wraith.session.ProjectSessionReader.archiveAll(userHome(), path);
                    }
                    public java.util.List<com.fasterxml.jackson.databind.JsonNode> readCards(String id) {
                        return sessionStore.readCards(id);
                    }
                    @Override
                    public String beginTurn(String input) {
                        return sessionStore.beginTurn(input);
                    }
                    private java.util.Map<String, Object> memoryEntryJson(com.lyhn.wraith.memory.MemoryEntry e) {
                        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                        m.put("id", e.getId());
                        m.put("content", e.getContent());
                        m.put("scope", e.getMetadata() != null ? e.getMetadata().getOrDefault("scope", "project") : "project");
                        m.put("type", e.getType() != null ? e.getType().name() : "FACT");
                        m.put("timestampMs", e.getTimestamp() != null ? e.getTimestamp().toEpochMilli() : 0L);
                        m.put("tokenCount", e.getTokenCount());
                        return m;
                    }
                    public java.util.Map<String, Object> memoryList() {
                        java.util.List<java.util.Map<String, Object>> entries = new java.util.ArrayList<>();
                        for (com.lyhn.wraith.memory.MemoryEntry e : agent.getMemoryManager().listLongTerm()) entries.add(memoryEntryJson(e));
                        java.util.Map<String, Object> r = new java.util.LinkedHashMap<>();
                        r.put("project", agent.getMemoryManager().getCurrentProject());
                        r.put("entries", entries);
                        String projPath = agent.getToolRegistry().getProjectPath();
                        java.nio.file.Path wm = projPath != null ? java.nio.file.Path.of(projPath).resolve("WRAITH.md") : null;
                        r.put("wraithMdExists", wm != null && java.nio.file.Files.exists(wm));
                        r.put("wraithMdPath", wm != null ? wm.toString() : "");
                        return r;
                    }
                    public java.util.Map<String, Object> memoryInitProject(boolean force) {
                        String projPath = agent.getToolRegistry().getProjectPath();
                        if (projPath == null || projPath.isBlank()) return java.util.Map.of("written", false, "path", "", "message", "无项目工作区");
                        try {
                            ProjectMemoryInitializer.InitResult res = ProjectMemoryInitializer.initialize(java.nio.file.Path.of(projPath), force);
                            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                            m.put("written", res.written());
                            m.put("path", res.path() != null ? res.path().toString() : "");
                            m.put("message", res.message() != null ? res.message() : "");
                            return m;
                        } catch (Exception e) {
                            return java.util.Map.of("written", false, "path", "", "message", "生成失败: " + e.getClass().getSimpleName());
                        }
                    }
                    public java.util.Map<String, Object> memorySearch(String query) {
                        java.util.List<java.util.Map<String, Object>> entries = new java.util.ArrayList<>();
                        for (com.lyhn.wraith.memory.MemoryEntry e : agent.getMemoryManager().searchLongTerm(query, 50)) entries.add(memoryEntryJson(e));
                        java.util.Map<String, Object> r = new java.util.LinkedHashMap<>();
                        r.put("project", agent.getMemoryManager().getCurrentProject());
                        r.put("entries", entries);
                        return r;
                    }
                    public java.util.Map<String, Object> memoryDelete(String id) {
                        return java.util.Map.of("ok", agent.getMemoryManager().deleteLongTerm(id));
                    }
                    public java.util.Map<String, Object> memorySave(String fact, String scope) {
                        boolean ok = agent.getMemoryManager().storeFact(fact, scope);
                        return java.util.Map.of("ok", ok);
                    }
                    public java.util.Map<String, Object> memoryClear() {
                        agent.getMemoryManager().clearLongTerm();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String, Object> memoryPendingList() {
                        java.util.List<java.util.Map<String, Object>> items = new java.util.ArrayList<>();
                        for (com.lyhn.wraith.memory.PendingFact f : agent.getMemoryManager().listPending()) items.add(pendingFactJson(f));
                        java.util.Map<String, Object> r = new java.util.LinkedHashMap<>();
                        r.put("project", agent.getMemoryManager().getCurrentProject());
                        r.put("pending", items);
                        return r;
                    }
                    public java.util.Map<String, Object> memoryPendingApprove(String id) {
                        return java.util.Map.of("ok", agent.getMemoryManager().approvePending(id));
                    }
                    public java.util.Map<String, Object> memoryPendingApproveReplacing(String id, String oldId) {
                        return java.util.Map.of("ok", agent.getMemoryManager().approvePendingReplacing(id, oldId));
                    }
                    public java.util.Map<String, Object> memoryPendingReject(String id) {
                        return java.util.Map.of("ok", agent.getMemoryManager().rejectPending(id));
                    }
                    public java.util.Map<String, Object> memoryPendingClear() {
                        agent.getMemoryManager().clearPending();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String, Object> memoryExtractNow() {
                        int n = agent.getMemoryManager().runAutoExtraction("desktop-" + System.currentTimeMillis());
                        return java.util.Map.of("enqueued", n);
                    }
                    private java.util.Map<String, Object> pendingFactJson(com.lyhn.wraith.memory.PendingFact f) {
                        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                        m.put("id", f.id());
                        m.put("fact", f.fact());
                        m.put("type", f.type());
                        m.put("scope", f.scope());
                        m.put("nearestExistingId", f.nearestExistingId());
                        m.put("sourceSessionId", f.sourceSessionId());
                        m.put("project", f.project());
                        m.put("createdAt", f.createdAt());
                        return m;
                    }
                    public java.util.Map<String, Object> snapshotList(int limit) {
                        com.lyhn.wraith.snapshot.SnapshotService svc = agent.getToolRegistry().getSnapshotService();
                        if (svc == null) return java.util.Map.of("enabled", false, "snapshots", java.util.List.of());
                        java.util.List<java.util.Map<String, Object>> out = new java.util.ArrayList<>();
                        try {
                            int preTurnSeen = 0;
                            for (com.lyhn.wraith.snapshot.TurnSnapshot s : svc.listSnapshots(limit)) {
                                boolean isPre = s.phase() == com.lyhn.wraith.snapshot.SnapshotPhase.PRE_TURN;
                                if (isPre) preTurnSeen++;
                                java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                                m.put("commitId", s.commitId());
                                m.put("shortId", s.shortCommitId());
                                m.put("phase", s.phase() != null ? s.phase().name() : "");
                                m.put("turnId", s.turnId());
                                m.put("summary", s.summary() != null ? s.summary() : "");
                                m.put("createdAtMs", s.createdAt() != null ? s.createdAt().toEpochMilli() : 0L);
                                m.put("preTurnOffset", isPre ? preTurnSeen : 0);
                                out.add(m);
                            }
                        } catch (Exception e) {
                            return java.util.Map.of("enabled", false, "snapshots", java.util.List.of(), "error", e.getClass().getSimpleName());
                        }
                        return java.util.Map.of("enabled", true, "snapshots", out);
                    }
                    public java.util.Map<String, Object> snapshotRestore(int offset) {
                        com.lyhn.wraith.snapshot.SnapshotService svc = agent.getToolRegistry().getSnapshotService();
                        if (svc == null) return java.util.Map.of("ok", false, "message", "快照功能不可用");
                        try {
                            com.lyhn.wraith.snapshot.RestoreResult r = svc.restorePreTurn(offset);
                            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                            m.put("ok", r.success());
                            m.put("message", r.message() != null ? r.message() : "");
                            m.put("commitId", r.commitId() != null ? r.commitId() : "");
                            m.put("restoredCount", r.restoredFiles() != null ? r.restoredFiles().size() : 0);
                            m.put("removedCount", r.removedFiles() != null ? r.removedFiles().size() : 0);
                            return m;
                        } catch (Exception e) {
                            return java.util.Map.of("ok", false, "message", "恢复失败: " + e.getClass().getSimpleName());
                        }
                    }
                    public java.util.Map<String, Object> snapshotClean() {
                        com.lyhn.wraith.snapshot.SnapshotService svc = agent.getToolRegistry().getSnapshotService();
                        if (svc == null) return java.util.Map.of("ok", false, "message", "快照功能不可用");
                        try { return java.util.Map.of("ok", true, "message", svc.clean()); }
                        catch (Exception e) { return java.util.Map.of("ok", false, "message", "清理失败: " + e.getClass().getSimpleName()); }
                    }
                    public java.util.Map<String, Object> snapshotSettings() {
                        com.lyhn.wraith.snapshot.SnapshotService svc = agent.getToolRegistry().getSnapshotService();
                        com.lyhn.wraith.snapshot.SnapshotConfig.EnabledSource source =
                                com.lyhn.wraith.snapshot.SnapshotConfig.enabledSource();
                        boolean locked =
                                source == com.lyhn.wraith.snapshot.SnapshotConfig.EnabledSource.ENV
                                || source == com.lyhn.wraith.snapshot.SnapshotConfig.EnabledSource.PROPERTY;
                        java.util.Map<String, Object> out = new java.util.LinkedHashMap<>();
                        out.put("enabled", svc != null && svc.isEnabled());
                        out.put("source", source.name().toLowerCase(java.util.Locale.ROOT));
                        // locked 只说「写盘压不过它」,不代表按钮完全无用:运行期覆盖仍会生效。
                        // 面板据此把话说全,而不是简单置灰了事。
                        out.put("locked", locked);
                        out.put("available", svc != null);
                        return out;
                    }
                    public java.util.Map<String, Object> snapshotSetEnabled(boolean enabled) {
                        com.lyhn.wraith.snapshot.SnapshotService svc = agent.getToolRegistry().getSnapshotService();
                        if (svc == null) return java.util.Map.of("ok", false, "message", "快照功能不可用");
                        String saveError = svc.setEnabled(enabled);
                        java.util.Map<String, Object> out = new java.util.LinkedHashMap<>();
                        // ok=true 说的是「已生效」;写盘失败只丢「记住」那一半,靠 warning 说清
                        out.put("ok", true);
                        out.put("enabled", svc.isEnabled());
                        if (saveError != null) {
                            out.put("warning", saveError);
                        }
                        com.lyhn.wraith.snapshot.SnapshotConfig.EnabledSource source =
                                com.lyhn.wraith.snapshot.SnapshotConfig.enabledSource();
                        out.put("source", source.name().toLowerCase(java.util.Locale.ROOT));
                        if (source == com.lyhn.wraith.snapshot.SnapshotConfig.EnabledSource.ENV) {
                            out.put("warning", "环境变量 WRAITH_SNAPSHOT_ENABLED 优先级更高，"
                                    + "下次启动仍按它来。要让这次的选择长期有效，请先取消那个环境变量。");
                        }
                        return out;
                    }
                    public java.util.Map<String, Object> compactHistory() {
                        try {
                            com.lyhn.wraith.agent.Agent.CompactionResult r = agent.compactHistoryNow();
                            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                            m.put("compacted", r.compacted());
                            m.put("beforeTokens", r.beforeTokens());
                            m.put("afterTokens", r.afterTokens());
                            m.put("error", r.error());   // 已是简单消息;null 表示无错
                            m.put("summarized", r.summarized());
                            if (r.fallback() != null) m.put("fallback", r.fallback());
                            return m;
                        } catch (Exception e) {
                            return java.util.Map.of("compacted", false, "beforeTokens", 0, "afterTokens", 0,
                                    "error", e.getClass().getSimpleName());
                        }
                    }
                    private java.util.Map<String, Object> taskRow(com.lyhn.wraith.runtime.task.DurableTask t, boolean full) {
                        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                        m.put("id", t.id());
                        m.put("status", t.status() != null ? t.status().value() : "enqueued");
                        m.put("prompt", t.prompt() != null ? t.prompt() : "");
                        m.put("createdAtMs", t.createdAt() != null ? t.createdAt().toEpochMilli() : 0L);
                        m.put("durationMs", t.durationMs());
                        if (full) {
                            m.put("result", t.result() != null ? t.result() : "");
                            m.put("error", t.error());
                        }
                        return m;
                    }
                    public java.util.Map<String, Object> taskList(int limit) {
                        if (taskManager == null) return java.util.Map.of("enabled", false, "tasks", java.util.List.of());
                        try {
                            java.util.List<java.util.Map<String, Object>> out = new java.util.ArrayList<>();
                            for (com.lyhn.wraith.runtime.task.DurableTask t : taskManager.list(limit)) out.add(taskRow(t, false));
                            return java.util.Map.of("enabled", true, "tasks", out);
                        } catch (Exception e) {
                            return java.util.Map.of("enabled", false, "tasks", java.util.List.of(), "error", e.getClass().getSimpleName());
                        }
                    }
                    public java.util.Map<String, Object> taskAdd(String prompt) {
                        if (taskManager == null) return java.util.Map.of("ok", false, "message", "后台任务不可用");
                        try {
                            com.lyhn.wraith.runtime.task.DurableTask t = taskManager.enqueue(prompt);
                            return java.util.Map.of("ok", true, "id", t.id());
                        } catch (IllegalArgumentException e) {
                            return java.util.Map.of("ok", false, "message", e.getMessage() != null ? e.getMessage() : "任务内容无效");
                        } catch (Exception e) {
                            return java.util.Map.of("ok", false, "message", "提交失败: " + e.getClass().getSimpleName());
                        }
                    }
                    public java.util.Map<String, Object> taskGet(String id) {
                        if (taskManager == null) return java.util.Map.of("found", false);
                        try {
                            return taskManager.find(id).<java.util.Map<String, Object>>map(t -> {
                                java.util.Map<String, Object> m = taskRow(t, true);
                                m.put("found", true);
                                return m;
                            }).orElse(java.util.Map.of("found", false));
                        } catch (Exception e) {
                            return java.util.Map.of("found", false, "error", e.getClass().getSimpleName());
                        }
                    }
                    public java.util.Map<String, Object> taskCancel(String id) {
                        if (taskManager == null) return java.util.Map.of("ok", false);
                        try { return java.util.Map.of("ok", taskManager.cancel(id)); }
                        catch (Exception e) { return java.util.Map.of("ok", false, "error", e.getClass().getSimpleName()); }
                    }
                    public java.util.Map<String, Object> taskDelete(String id) {
                        if (taskManager == null) return java.util.Map.of("ok", false, "message", "后台任务不可用");
                        try {
                            if (taskManager.delete(id)) return java.util.Map.of("ok", true);
                            // 拒绝的原因只有两种,分开说 —— 「删除失败」四个字让人不知道下一步该干嘛。
                            return taskManager.find(id).isPresent()
                                    ? java.util.Map.of("ok", false, "message", "任务还在运行,请先取消再删除")
                                    : java.util.Map.of("ok", false, "message", "任务不存在(可能已被删除)");
                        } catch (Exception e) {
                            return java.util.Map.of("ok", false, "message", "删除失败: " + e.getClass().getSimpleName());
                        }
                    }
                    public java.util.Map<String, Object> snapshotRestoreCommit(String commitId) {
                        com.lyhn.wraith.snapshot.SnapshotService svc = agent.getToolRegistry().getSnapshotService();
                        if (svc == null) return java.util.Map.of("ok", false, "message", "快照功能不可用");
                        try {
                            com.lyhn.wraith.snapshot.RestoreResult r = svc.restoreToCommit(commitId);
                            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                            m.put("ok", r.success());
                            m.put("message", r.message() != null ? r.message() : "");
                            m.put("commitId", r.commitId() != null ? r.commitId() : "");
                            m.put("restoredCount", r.restoredFiles() != null ? r.restoredFiles().size() : 0);
                            m.put("removedCount", r.removedFiles() != null ? r.removedFiles().size() : 0);
                            return m;
                        } catch (Exception e) {
                            return java.util.Map.of("ok", false, "message", "恢复失败: " + e.getClass().getSimpleName());
                        }
                    }
                    public java.util.Map<String, Object> policyStatus() {
                        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                        m.put("projectRoot", agent.getToolRegistry().getProjectPath());
                        m.put("auditDir", String.valueOf(agent.getToolRegistry().getAuditLog().getAuditDir()));
                        m.put("dangerousTools", new java.util.ArrayList<>(com.lyhn.wraith.hitl.ApprovalPolicy.getDangerousTools()));
                        return m;
                    }
                    public java.util.Map<String, Object> auditList(int limit) {
                        int n = limit <= 0 ? 20 : limit;
                        java.util.List<java.util.Map<String, Object>> out = new java.util.ArrayList<>();
                        for (com.lyhn.wraith.policy.AuditLog.AuditEntry e : agent.getToolRegistry().getAuditLog().readRecent(n)) {
                            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                            m.put("timestamp", e.timestamp());
                            m.put("tool", e.tool());
                            m.put("args", e.args());
                            m.put("outcome", e.outcome());
                            m.put("reason", e.reason());
                            m.put("approver", e.approver());
                            m.put("durationMs", e.durationMs());
                            com.lyhn.wraith.browser.BrowserAuditMetadata meta = e.metadata();
                            if (meta != null) {
                                m.put("browserMode", meta.browserMode());
                                m.put("sensitive", meta.sensitive());
                                m.put("targetUrl", meta.targetUrl());
                            }
                            out.add(m);
                        }
                        return java.util.Map.of("entries", out);
                    }
                    public java.util.Map<String, Object> sandboxGet() {
                        return sandboxState(agent.getToolRegistry().getCommandSandbox());
                    }
                    public java.util.Map<String, Object> sandboxSet(boolean networkAllowed) {
                        agent.getToolRegistry().setCommandSandbox(new com.lyhn.wraith.policy.sandbox.CommandSandbox(networkAllowed));
                        return sandboxState(agent.getToolRegistry().getCommandSandbox());
                    }
                    public java.util.Map<String, Object> browserStatus() {
                        return java.util.Map.of("text", appServerBrowserCmd("status", browserSession, browserConnectivityCheck, appServerMcp.manager(), registry, hitl));
                    }
                    public java.util.Map<String, Object> browserConnect(String port) {
                        String payload = (port == null || port.isBlank()) ? "connect" : "connect " + port.trim();
                        return java.util.Map.of("text", appServerBrowserCmd(payload, browserSession, browserConnectivityCheck, appServerMcp.manager(), registry, hitl));
                    }
                    public java.util.Map<String, Object> browserDisconnect() {
                        return java.util.Map.of("text", appServerBrowserCmd("disconnect", browserSession, browserConnectivityCheck, appServerMcp.manager(), registry, hitl));
                    }
                    public java.util.Map<String, Object> browserTabs() {
                        return java.util.Map.of("text", appServerBrowserCmd("tabs", browserSession, browserConnectivityCheck, appServerMcp.manager(), registry, hitl));
                    }
                    private com.lyhn.wraith.rag.EmbeddingClient ragEmbeddingClient() {
                        // 与 agent 的 search_code / REPL 的 /index 共用同一个解析口,别在这里重写一份
                        return com.lyhn.wraith.rag.EmbeddingClient.fromConfigOrEnv();
                    }
                    public java.util.Map<String, Object> embeddingGet() {
                        com.lyhn.wraith.config.WraithConfig.EmbeddingConfig e = com.lyhn.wraith.config.WraithConfig.load().getEmbedding();
                        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                        m.put("provider", e != null && e.getProvider() != null ? e.getProvider() : "");
                        m.put("model", e != null && e.getModel() != null ? e.getModel() : "");
                        m.put("baseUrl", e != null && e.getBaseUrl() != null ? e.getBaseUrl() : "");
                        m.put("hasKey", e != null && e.getApiKey() != null && !e.getApiKey().isBlank());
                        return m;
                    }
                    public java.util.Map<String, Object> embeddingSet(String provider, String model, String baseUrl, String apiKey) {
                        com.lyhn.wraith.config.WraithConfig cfg = com.lyhn.wraith.config.WraithConfig.load();
                        com.lyhn.wraith.config.WraithConfig.EmbeddingConfig e = cfg.getEmbedding();
                        if (e == null) { e = new com.lyhn.wraith.config.WraithConfig.EmbeddingConfig(); cfg.setEmbedding(e); }
                        e.setProvider(provider); e.setModel(model); e.setBaseUrl(baseUrl);
                        if (apiKey != null && !apiKey.isBlank()) e.setApiKey(apiKey); // 空=保留旧 key
                        cfg.save();
                        return java.util.Map.of("ok", true);
                    }
                    /**
                     * 「测试连接」:用<b>表单值</b>发一次真实 embedding 请求。
                     *
                     * <p>此前验证 embedding 后端唯一的办法是点「建立索引」—— 那是上千个代码块的
                     * 整库扫描。配错一个字符就得等它跑完或者盯着一句 OkHttp 原文猜。
                     *
                     * <p>三件事必须与别处严格对齐,否则这个按钮会撒谎:
                     * <ul>
                     *   <li>apiKey 空 = 沿用已存(同 {@code embeddingSet})—— <b>测的是保存会落盘的那套</b>;
                     *       面板的 KEY 框从不回填已存 key,不继承就永远 401,而保存却是好的。</li>
                     *   <li>客户端走 {@code EmbeddingClient.of} —— 与索引/检索同一个构造口,
                     *       表单留空时填的默认值也就与实际跑的一致。</li>
                     *   <li>索引元信息一并带上,好在建索引<b>之前</b>就报出维度/模型冲突。</li>
                     * </ul>
                     */
                    public java.util.Map<String, Object> embeddingTest(String provider, String model,
                                                                      String baseUrl, String apiKey) {
                        com.lyhn.wraith.config.WraithConfig.EmbeddingConfig saved =
                                com.lyhn.wraith.config.WraithConfig.load().getEmbedding();
                        String key = com.lyhn.wraith.rag.EmbeddingProbe.effectiveKey(
                                saved == null ? null : saved.getApiKey(), apiKey);
                        com.lyhn.wraith.rag.EmbeddingClient client =
                                com.lyhn.wraith.rag.EmbeddingClient.of(provider, model, baseUrl, key);
                        // 已有索引的元信息:读不到就是 null(没建过 / 老索引没记过)——不猜,不警告
                        com.lyhn.wraith.rag.VectorStore.IndexMeta meta = null;
                        try (com.lyhn.wraith.rag.CodeRetriever r =
                                     new com.lyhn.wraith.rag.CodeRetriever(root, client)) {
                            com.lyhn.wraith.rag.VectorStore.IndexStats s = r.getStats();
                            if (s.embeddingModel() != null && s.chunkCount() > 0) {
                                meta = new com.lyhn.wraith.rag.VectorStore.IndexMeta(
                                        s.embeddingModel(), s.embeddingDim());
                            }
                        } catch (Exception ignored) {
                            // 索引库打不开不该让「测试连接」失败 —— 那是两件独立的事
                        }
                        final com.lyhn.wraith.rag.VectorStore.IndexMeta indexMeta = meta;
                        return awaitProbe(
                                () -> com.lyhn.wraith.rag.EmbeddingProbe.probe(client, indexMeta, key),
                                embedProbeTimeoutSeconds());
                    }
                    /** 当前索引范围设置(没配过 = 两个都关)。 */
                    private boolean[] ragScope() {
                        com.lyhn.wraith.config.WraithConfig.RagConfig r =
                                com.lyhn.wraith.config.WraithConfig.load().getRag();
                        return new boolean[]{r != null && r.isExcludeTests(), r != null && r.isExcludeDocs()};
                    }
                    public java.util.Map<String, Object> ragScopeGet() {
                        boolean[] sc = ragScope();
                        return java.util.Map.of("excludeTests", sc[0], "excludeDocs", sc[1]);
                    }
                    public java.util.Map<String, Object> ragScopeSet(boolean excludeTests, boolean excludeDocs) {
                        com.lyhn.wraith.config.WraithConfig cfg = com.lyhn.wraith.config.WraithConfig.load();
                        com.lyhn.wraith.config.WraithConfig.RagConfig r = cfg.getRag();
                        if (r == null) { r = new com.lyhn.wraith.config.WraithConfig.RagConfig(); cfg.setRag(r); }
                        r.setExcludeTests(excludeTests);
                        r.setExcludeDocs(excludeDocs);
                        cfg.save();
                        // 刻意**不**自动重建索引:那是一次整库扫描(本机 bge-m3 实测 18 分 13 秒),
                        // 不该由一次勾选触发。面板靠 rag.status 回的索引范围提示「范围不符」。
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String, Object> searchStatus() {
                        // 问的是 agent 自己那个 registry —— 用户刚 /config search 写完并 invalidate 过,
                        // 这里就能立刻反映出来,不需要重启后端。
                        return registry.searchStatus();
                    }
                    public java.util.Map<String, Object> searchSet(String provider, String apiKey, String baseUrl) {
                        com.lyhn.wraith.web.SearchConfigRules.Violation violation =
                                com.lyhn.wraith.web.SearchConfigRules.check(provider, apiKey, baseUrl);
                        if (violation != null) {
                            // 回 {ok:false,error} 而不是抛:表单要把这句话贴在字段旁边(同 pricingSet)
                            return java.util.Map.of("ok", false, "error",
                                    com.lyhn.wraith.web.SearchConfigRules.formMessage(violation, provider));
                        }
                        com.lyhn.wraith.config.WraithConfig cfg =
                                com.lyhn.wraith.config.WraithConfig.load();
                        com.lyhn.wraith.config.WraithConfig.SearchConfig search = cfg.getSearch();
                        if (search == null) {
                            search = new com.lyhn.wraith.config.WraithConfig.SearchConfig();
                            cfg.setSearch(search);
                        }
                        // 与 /config search 同一份落盘语义(空=保留旧、换 provider 不继承旧 key)
                        com.lyhn.wraith.web.SearchConfigRules.apply(search, provider, apiKey, baseUrl);
                        cfg.save();
                        // 第七次 snapshot-vs-live:不失效则本次会话仍用旧 provider ——
                        // 表现是「存成功了但 agent 还说没配」。
                        registry.invalidateSearchProvider();
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String, Object> searchTest(String provider, String apiKey, String baseUrl) {
                        com.lyhn.wraith.config.WraithConfig.SearchConfig saved = null;
                        try {
                            saved = com.lyhn.wraith.config.WraithConfig.load().getSearch();
                        } catch (Exception ignored) {
                            // 配置读不出来就当没存过:测的是表单里那套,已存的只是 key 的回落来源
                        }
                        String effective = com.lyhn.wraith.web.SearchProbe.effectiveKey(
                                saved == null ? "" : saved.getProvider(),
                                saved == null ? "" : saved.getApiKey(),
                                provider, apiKey);
                        return com.lyhn.wraith.web.SearchProbe.probe(provider, effective, baseUrl);
                    }
                    public java.util.Map<String, Object> pricingGet() {
                        return pricingPayload(com.lyhn.wraith.config.WraithConfig.load());
                    }
                    public java.util.Map<String, Object> pricingSet(
                            java.util.List<java.util.Map<String, Object>> entries) {
                        com.lyhn.wraith.config.WraithConfig cfg =
                                com.lyhn.wraith.config.WraithConfig.load();
                        String error = applyPricingEntries(cfg, entries);
                        if (error != null) {
                            // 回 {ok:false,error} 而不是抛:表单要把这句话贴在字段旁边,
                            // 走 writer.error 的话前端只能弹一个通用失败框。
                            return java.util.Map.of("ok", false, "error", error);
                        }
                        cfg.save();
                        // 第六次 snapshot-vs-live:不刷新则本次会话状态栏仍用旧计价表
                        agent.reloadPricingTable(cfg);
                        return java.util.Map.of("ok", true);
                    }
                    public java.util.Map<String, Object> ragStatus() {
                        try (com.lyhn.wraith.rag.CodeRetriever r = new com.lyhn.wraith.rag.CodeRetriever(root, ragEmbeddingClient())) {
                            com.lyhn.wraith.rag.VectorStore.IndexStats s = r.getStats();
                            java.util.Map<String, Object> out = new java.util.LinkedHashMap<>();
                            out.put("indexed", s.chunkCount() > 0);
                            out.put("chunkCount", s.chunkCount());
                            out.put("relationCount", s.relationCount());
                            // 索引是用哪个模型建的。面板据此在「换了模型但没重建」时提示 ——
                            // 否则检索会安静地返回一堆 0 分结果。老索引没记过 → 不回这两个字段,
                            // 前端显示「未知」而不是编一个默认模型名。
                            if (s.embeddingModel() != null) {
                                out.put("embeddingModel", s.embeddingModel());
                                out.put("embeddingDim", s.embeddingDim());
                            }
                            // 索引**建时的范围**。与当前设置不一致时面板提示重建 ——
                            // 范围变了但模型没变时,已有的陈旧检测都不会响(比的是模型和维度)。
                            // 老索引没记过时这两个字段**不出现**,前端据此不比较、不猜。
                            if (s.excludeTests() != null) out.put("indexExcludeTests", s.excludeTests());
                            if (s.excludeDocs() != null) out.put("indexExcludeDocs", s.excludeDocs());
                            boolean[] cur = ragScope();
                            out.put("excludeTests", cur[0]);
                            out.put("excludeDocs", cur[1]);
                            return out;
                        } catch (Exception ex) {
                            return java.util.Map.of("indexed", false, "chunkCount", 0, "relationCount", 0, "error", ex.getClass().getSimpleName());
                        }
                    }
                    public java.util.Map<String, Object> ragIndex() {
                        com.lyhn.wraith.rag.EmbeddingClient ec = ragEmbeddingClient();
                        // 先探一次:后端有问题就快速报错,不空转整库。原文必须带上 —— 402「余额不足」、
                        // 401「key 错」、连接被拒是三件完全不同的事,只回异常类名会把人引到错的地方去查。
                        try { ec.embed("probe"); }
                        catch (Exception ex) {
                            String detail = ex.getMessage() == null || ex.getMessage().isBlank()
                                    ? ex.getClass().getSimpleName() : ex.getMessage();
                            if (detail.length() > 300) detail = detail.substring(0, 300) + "…";
                            // 诊断插在**原文之前**,不替换它。OkHttp 那句
                            // 「Failed to connect to localhost/[0:0:0:0:0:0:0:1]:11434」技术上没错,
                            // 但那个 IPv6 地址是障眼法 —— 会把人引去查 IPv6,而真实原因是没在运行。
                            String hint = com.lyhn.wraith.rag.EmbeddingErrorHint.of(ec.getBaseUrl(), ec.getProvider(), ex);
                            return java.util.Map.of("error", hint.isEmpty()
                                    ? "embedding 后端探测失败:" + detail
                                    : hint + "\n\n原始错误:" + detail);
                        }
                        try {
                            // 索引进度经 writer 推 rag.index.progress 事件(writer 线程安全;桌面面板订阅显示)
                            com.lyhn.wraith.rag.CodeIndex.ProgressListener pl =
                                    m -> writer.notify("rag.index.progress", java.util.Map.of("message", m == null ? "" : m));
                            boolean[] sc = ragScope();
                            com.lyhn.wraith.rag.CodeIndex.IndexResult res =
                                    new com.lyhn.wraith.rag.CodeIndex(ec, pl, sc[0], sc[1]).index(root);
                            agent.getToolRegistry().setProjectPath(root); // search_code 工具同库
                            agent.getMemoryManager().setProjectPath(root);
                            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                            m.put("chunkCount", res.chunkCount());
                            m.put("relationCount", res.relationCount());
                            m.put("message", res.message() != null ? res.message() : "");
                            // 面板要靠这三个说明「索引了什么」。javaFileCount 尤其重要:
                            // 关系图谱只从 .java 提取,非 Java 项目必然 0 关系 —— 界面得能据此解释,
                            // 而不是让用户以为索引失败了。
                            m.put("fileCount", res.fileCount());
                            m.put("javaFileCount", res.javaFileCount());
                            m.put("elapsedMs", res.elapsedMs());
                            m.put("embeddingModel", ec.getModel());
                            // 残缺索引必须能被面板看见:只回 chunkCount 会让「已索引 N 块」看起来一切正常
                            m.put("failedChunks", res.failedChunks());
                            m.put("failedFiles", res.failedFiles());
                            // 被范围设置排掉多少:打开开关后块数会明显下降(实测 wraith 自身
                            // 排除测试后 9718→6223 块),不报的话用户会以为索引出错了。
                            m.put("excludedTests", res.excludedTests());
                            m.put("excludedDocs", res.excludedDocs());
                            return m;
                        } catch (Exception ex) {
                            return java.util.Map.of("error", ex.getClass().getSimpleName());
                        }
                    }
                    public java.util.Map<String, Object> ragSearch(String query, int topK) {
                        try (com.lyhn.wraith.rag.CodeRetriever r = new com.lyhn.wraith.rag.CodeRetriever(root, ragEmbeddingClient())) {
                            java.util.List<java.util.Map<String, Object>> out = new java.util.ArrayList<>();
                            for (com.lyhn.wraith.rag.VectorStore.SearchResult sr : r.hybridSearch(query, topK)) {
                                java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                                m.put("filePath", sr.filePath());
                                m.put("chunkType", sr.chunkType());
                                m.put("name", sr.name());
                                String c = sr.content() == null ? "" : sr.content();
                                m.put("content", c.length() > 500 ? c.substring(0, 500) + "…" : c);
                                m.put("similarity", sr.similarity());
                                out.add(m);
                            }
                            return java.util.Map.of("results", out);
                        } catch (Exception ex) {
                            return java.util.Map.of("results", java.util.List.of(), "error", ex.getClass().getSimpleName());
                        }
                    }
                    public java.util.Map<String, Object> ragGraph(String name) {
                        try (com.lyhn.wraith.rag.CodeRetriever r = new com.lyhn.wraith.rag.CodeRetriever(root, ragEmbeddingClient())) {
                            java.util.List<java.util.Map<String, Object>> out = new java.util.ArrayList<>();
                            for (com.lyhn.wraith.rag.CodeRelation rel : r.getRelationGraph(name)) {
                                java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                                m.put("fromName", rel.fromName());
                                m.put("toName", rel.toName());
                                m.put("relationType", rel.relationType());
                                m.put("fromFile", rel.fromFile());
                                m.put("toFile", rel.toFile());
                                out.add(m);
                            }
                            return java.util.Map.of("relations", out);
                        } catch (Exception ex) {
                            return java.util.Map.of("relations", java.util.List.of(), "error", ex.getClass().getSimpleName());
                        }
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
                        // references/ 下的参考文件(递归,相对路径,单文件 256KB 截断)
                        java.util.List<java.util.Map<String, Object>> refs = new java.util.ArrayList<>();
                        java.nio.file.Path rdir = s.referencesDir();
                        if (rdir != null && java.nio.file.Files.isDirectory(rdir)) {
                            try (java.util.stream.Stream<java.nio.file.Path> walk = java.nio.file.Files.walk(rdir)) {
                                java.util.List<java.nio.file.Path> files = walk
                                        .filter(java.nio.file.Files::isRegularFile)
                                        .filter(p -> !p.getFileName().toString().startsWith("."))
                                        .sorted()
                                        .collect(java.util.stream.Collectors.toList());
                                for (java.nio.file.Path f : files) {
                                    String rel = rdir.relativize(f).toString().replace('\\', '/');
                                    String content;
                                    try {
                                        byte[] bytes = java.nio.file.Files.readAllBytes(f);
                                        content = bytes.length > 256 * 1024
                                                ? new String(bytes, 0, 256 * 1024, java.nio.charset.StandardCharsets.UTF_8) + "\n…(已截断)"
                                                : new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
                                    } catch (Exception e) { content = "(读取失败: " + e.getClass().getSimpleName() + ")"; }
                                    java.util.Map<String, Object> rm = new java.util.LinkedHashMap<>();
                                    rm.put("path", rel);
                                    rm.put("content", content);
                                    refs.add(rm);
                                }
                            } catch (Exception ignored) { /* 目录读取失败 → 空 references */ }
                        }
                        v.put("references", refs);
                        return v;
                    }
                    public java.util.Map<String,Object> skillsUpsert(String scope, String name, String description,
                            String version, String author, java.util.List<String> tags, String body,
                            java.util.List<java.util.Map<String, String>> references) {
                        try {
                            skillStore.upsert(scope, name, description, version, author, tags, body);
                            skillStore.writeReferences(scope, name, references); // replace 模式:UI 是权威集
                        }
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
                        try {
                            skillStore.upsert("user", s.name(), s.description(), s.version(), s.author(), s.tags(), s.body());
                            skillStore.copyReferences("user", s.name(), s.referencesDir()); // fork 保留 references/
                        }
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
                    // ── mode=plan / mode=team 覆写：组装对应 Agent 并路由到桌面事件流 ──────────────
                    @Override
                    public String runTurn(String input,
                                         java.util.List<com.lyhn.wraith.llm.LlmClient.ContentPart> imageParts,
                                         java.util.List<String> imageNames,
                                         String mode) throws Exception {
                        if (!"plan".equals(mode) && !"team".equals(mode)) {
                            // ReAct 原路径：委托三参重载
                            return runTurn(input, imageParts, imageNames);
                        }

                        // ── mode=team 分支：组装 AgentOrchestrator 并路由到桌面事件流 ───────────
                        if ("team".equals(mode)) {
                            // @-mention 展开（与其他模式保持一致）
                            String expandedTeam = input;
                            com.lyhn.wraith.mcp.McpServerManager mt = appServerMcp.manager();
                            if (mt != null) expandedTeam = new com.lyhn.wraith.mcp.mention.AtMentionExpander(mt).expand(input);
                            final String goal = expandedTeam;

                            // teamId 与 plan 同款：identityHashCode
                            String teamId = "team_" + java.lang.System.identityHashCode(goal);

                            // out=discard：桌面 stdout 是 JSON-RPC 管道，绝不写
                            java.io.PrintStream discard = new java.io.PrintStream(java.io.OutputStream.nullOutputStream());

                            // 用量观测:包住 client,子 agent(含计划生成)每次真实用量 → 主 curator(峰值发水位+计入成本)
                            agent.beginExternalUsageTracking();
                            com.lyhn.wraith.llm.LlmClient teamClient = new com.lyhn.wraith.llm.UsageObservingLlmClient(
                                    requireClient.get(),
                                    resp -> agent.recordExternalUsage(resp.inputTokens(), resp.outputTokens(), resp.cachedInputTokens()));

                            // 装配 AgentOrchestrator（与 CLI createTeamAgent + CLI team 路径完全对齐）
                            com.lyhn.wraith.agent.AgentOrchestrator orchestrator =
                                    new com.lyhn.wraith.agent.AgentOrchestrator(
                                            teamClient,
                                            agent.getToolRegistry(),
                                            agent.getMemoryManager(),
                                            discard);

                            // 事件流 sink（TeamCard 即产出，不另发底部消息）
                            orchestrator.setProgressListener(
                                    new com.lyhn.wraith.runtime.appserver.EventStreamTeamListener(renderer, teamId));

                            // 流式转发：planner 和各步骤的 LLM delta → team.plan.output / team.step.output
                            orchestrator.setStepStreamFactory((kind, id) ->
                                    new com.lyhn.wraith.runtime.appserver.EventStreamTeamStreamListener(renderer, teamId, kind, id));

                            // UI 意图工具(open_panel/im_connect)贯通到渲染层:Team 模式也能出动作卡。
                            // 只放行这两个——普通工具在本路径没有 tool.result,放行会让工具卡永久转圈。
                            orchestrator.setToolCallObserver(calls ->
                                    renderer.appendToolCalls(com.lyhn.wraith.tool.UiIntentTools.filter(calls)));

                            // 外部上下文（MCP 资源索引，与 CLI team 路径一致）
                            orchestrator.setExternalContextSupplier(() -> {
                                com.lyhn.wraith.mcp.McpServerManager mgr = appServerMcp.manager();
                                return mgr != null ? mgr.resourceIndexForPrompt() : "";
                            });

                            // skill 装配（与 CLI team 路径一致）
                            orchestrator.setSkillSystem(skillRegistry, skillContextBuffer);

                            // 快照封装（与 CLI team 路径对齐）
                            com.lyhn.wraith.snapshot.SnapshotService snap = agent.getToolRegistry().getSnapshotService();
                            renderer.startCardRecording();
                            final String result;
                            orchestrator.setConversationContext(
                                    com.lyhn.wraith.agent.ConversationDigest.of(agent.getConversationHistory()));
                            try {
                                result = snap.runTurn("team", goal, () -> orchestrator.run(goal));
                            } catch (Exception e) {
                                renderer.stopCardRecording(); // discard partial recording; do NOT set pending holders
                                throw e;
                            }
                            java.util.List<java.util.Map<String, Object>> recordedTeam = renderer.stopCardRecording();
                            // 干净最终答案作为单条底部消息发出(无 "✅ 多 Agent..." 头 / "[step_id]" 前缀 / 结果截断;
                            // 各步进程正文已嵌套在 TeamCard 步骤行下)。run() 返回值仍保留终端 chrome,仅供 CLI。
                            String cleanTeamAnswer = orchestrator.getLastCleanResult();
                            if (cleanTeamAnswer != null && !cleanTeamAnswer.isBlank()) {
                                renderer.appendAssistantContentDelta(cleanTeamAnswer);
                                renderer.finishAssistantContent();
                            }
                            // 把本轮补进 conversationHistory,使 persistTurn 能落盘到会话历史(否则 team 轮不进左侧列表)
                            // 一致性修正：记干净答案（与 plan 对齐），resumed bubble 匹配 live
                            agent.recordExternalTurn(goal,
                                    (cleanTeamAnswer != null && !cleanTeamAnswer.isBlank()) ? cleanTeamAnswer : result);
                            if (!recordedTeam.isEmpty()) {
                                int turnOrdinal = countUserTurns(agent.getConversationHistory()) - 1;
                                pendingCardOrdinal.set(new int[]{turnOrdinal});
                                try {
                                    pendingCardEventsJson.set(
                                            com.lyhn.wraith.runtime.appserver.JsonRpc.MAPPER.writeValueAsString(recordedTeam));
                                } catch (com.fasterxml.jackson.core.JsonProcessingException __jpe) {
                                    // 序列化失败则不写旁车（不影响主流程）
                                }
                            }
                            return result;
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

                        // 用量观测:包住 client,计划生成 + 执行每次真实用量 → 主 curator(峰值发水位+计入成本)
                        agent.beginExternalUsageTracking();
                        com.lyhn.wraith.llm.LlmClient planClient = new com.lyhn.wraith.llm.UsageObservingLlmClient(
                                requireClient.get(),
                                resp -> agent.recordExternalUsage(resp.inputTokens(), resp.outputTokens(), resp.cachedInputTokens()));

                        // 装配 PlanExecuteAgent（7 参公开构造，planner=null 则内部 new Planner(llmClient)）
                        com.lyhn.wraith.agent.PlanExecuteAgent planAgent =
                                new com.lyhn.wraith.agent.PlanExecuteAgent(
                                        planClient,
                                        agent.getToolRegistry(),
                                        null,  // planner=null → 内部 new Planner(llmClient)
                                        agent.getMemoryManager(),
                                        reviewHandler,
                                        discard,
                                        new com.lyhn.wraith.runtime.appserver.EventStreamPlanListener(renderer, planId));

                        // 步骤流 → plan.step.output（嵌套在清单步骤行下，不浮动为独立 message）
                        planAgent.setStepStreamFactory(
                                (id, ss) -> new com.lyhn.wraith.runtime.appserver.EventStreamStepListener(renderer, planId, id));
                        // 规划器生成计划阶段的流 → plan.output（plan.created 前的空窗期实时出字）
                        planAgent.setPlanStreamFactory(
                                () -> new com.lyhn.wraith.runtime.appserver.EventStreamPlanGenListener(renderer, planId));

                        // UI 意图工具(open_panel/im_connect)贯通到渲染层:Plan 模式也能出动作卡。
                        // 只放行这两个——普通工具在本路径没有 tool.result,放行会让工具卡永久转圈。
                        planAgent.setToolCallObserver(calls ->
                                renderer.appendToolCalls(com.lyhn.wraith.tool.UiIntentTools.filter(calls)));

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
                        renderer.startCardRecording();
                        final String result;
                        planAgent.setConversationContext(
                                com.lyhn.wraith.agent.ConversationDigest.of(agent.getConversationHistory()));
                        try {
                            result = snap.runTurn("plan", goal, () -> planAgent.run(goal));
                        } catch (Exception e) {
                            renderer.stopCardRecording(); // discard partial recording; do NOT set pending holders
                            throw e;
                        }
                        java.util.List<java.util.Map<String, Object>> recordedPlan = renderer.stopCardRecording();
                        // 干净答案作为单条底部消息发出（无 "✅ 计划执行完成！" 头 / "[task_id]" 前缀；
                        // 各步正文已嵌套在清单行下）。run() 返回值仍保留终端 chrome，仅供 CLI 使用。
                        String cleanAnswer = planAgent.getLastCleanResult();
                        if (cleanAnswer != null && !cleanAnswer.isBlank()) {
                            renderer.appendAssistantContentDelta(cleanAnswer);
                            renderer.finishAssistantContent();
                        }
                        // 把本轮补进 conversationHistory,使 persistTurn 能落盘到会话历史(否则 plan 轮不进左侧列表)
                        agent.recordExternalTurn(goal,
                                (cleanAnswer != null && !cleanAnswer.isBlank()) ? cleanAnswer : result);
                        if (!recordedPlan.isEmpty()) {
                            int turnOrdinal = countUserTurns(agent.getConversationHistory()) - 1;
                            pendingCardOrdinal.set(new int[]{turnOrdinal});
                            try {
                                pendingCardEventsJson.set(
                                        com.lyhn.wraith.runtime.appserver.JsonRpc.MAPPER.writeValueAsString(recordedPlan));
                            } catch (com.fasterxml.jackson.core.JsonProcessingException __jpe) {
                                // 序列化失败则不写旁车（不影响主流程）
                            }
                        }
                        return result;
                    }
                };
            }, buildInitializeResult(client == null ? null : client.getModelName(),
                    com.lyhn.wraith.policy.sandbox.CommandSandbox.detect()));

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

    /** 统计 conversationHistory 中 user 角色消息数（用于确定当前轮次序号）。 */
    private static int countUserTurns(java.util.List<com.lyhn.wraith.llm.LlmClient.Message> h) {
        int n = 0;
        for (var m : h) if ("user".equals(m.role())) n++;
        return n;
    }

    /**
     * sandbox.get / sandbox.set 的统一回包。
     *
     * <p>两个 RPC 回同一个函数的结果 —— 让它们各拼一份的话，
     * 「set 之后面板显示的状态」与「刷新后显示的状态」迟早会分叉。
     *
     * <p>{@code available} 保留是为了兼容旧前端；新前端读 {@code kind}。
     * {@code degradedReason} 是本次新增：此前 fail-open 的原因只进 {@code log.warn}，
     * 桌面用户根本看不到自己为什么没有沙箱。
     */
    static java.util.Map<String, Object> sandboxState(
            com.lyhn.wraith.policy.sandbox.CommandSandbox cs) {
        com.lyhn.wraith.policy.sandbox.SandboxKind kind =
                com.lyhn.wraith.policy.sandbox.CommandSandbox.detect();
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("available", kind.sandboxed());
        m.put("kind", kind.wire());
        m.put("networkAllowed", cs != null && cs.networkAllowed());
        String reason = null;
        if (!kind.sandboxed()) {
            reason = com.lyhn.wraith.policy.sandbox.CommandSandbox.noSandboxWarning(
                    System.getProperty("os.name", ""));
            com.lyhn.wraith.policy.sandbox.AppContainerSupport.Diagnosis d =
                    com.lyhn.wraith.policy.sandbox.AppContainerSupport.diagnose();
            if (d.reason() != null) {
                reason = reason + "（" + d.reason() + "）";
            }
        }
        m.put("degradedReason", reason);
        return m;
    }

    /** app-server 沙箱工厂:默认断网,-Dwraith.sandbox.network=on 全局放行网络。 */
    static com.lyhn.wraith.policy.sandbox.CommandSandbox buildAppServerSandbox() {
        boolean networkAllowed =
                "on".equalsIgnoreCase(System.getProperty("wraith.sandbox.network", "off"));
        return new com.lyhn.wraith.policy.sandbox.CommandSandbox(networkAllowed);
    }

    /** app-server initialize 响应:serverInfo/protocol/model/capabilities(spec §5.1)。 */
    static java.util.Map<String, Object> buildInitializeResult(
            String model, com.lyhn.wraith.policy.sandbox.SandboxKind sandboxKind) {
        java.util.Map<String, Object> caps = new java.util.LinkedHashMap<>();
        caps.put("streaming", true);
        caps.put("approvals", true);
        caps.put("toolOutputStreaming", true);
        caps.put("diff", true);
        // 报**具体哪一种**沙箱,不是布尔。此前只回 macos-seatbelt|none,
        // 于是 Windows 与「mac 上 sandbox-exec 没了」拿到同一个 none,
        // 前端只好靠 platform 反推语义 —— 根因是后端没把话说清楚。
        caps.put("sandbox", (sandboxKind == null
                ? com.lyhn.wraith.policy.sandbox.SandboxKind.NONE : sandboxKind).wire());
        // 后端现在允许「无模型」启动(否则首次运行会死锁,见 startAppServer)。
        // 空 model 就是那个状态 —— 显式回一个布尔,免得前端去猜空串的含义。
        caps.put("modelConfigured", model != null && !model.isBlank());
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
        return runHeadlessTaskAt(prompt, llmClient, Path.of(".").toAbsolutePath().normalize().toString());
    }

    /** headless 后台任务:全新 registry+agent 在指定项目根跑,不共享交互会话上下文。 */
    private static String runHeadlessTaskAt(String prompt, LlmClient llmClient, String root) {
        ToolRegistry registry = new ToolRegistry();
        registry.setProjectPath(root == null || root.isBlank()
                ? Path.of(".").toAbsolutePath().normalize().toString() : root);
        Agent agent = new Agent(llmClient, registry);
        // headless 任务无交互渲染器:流式响应默认被 run() 丢成空串(见 Agent:367),
        // 与 Wecom/Automation/Gateway 等其它 headless 场景一致,须回传最终答案,否则任务 result 空(面板显示"无输出")。
        agent.setReturnFinalResponseWhenStreamed(true);
        agent.setPricingTable(new com.lyhn.wraith.context.PricingTable(
                com.lyhn.wraith.config.WraithConfig.load().getPricing()));
        return agent.run(prompt);
    }

    /**
     * 后台任务执行时解析 LLM client —— <b>调用时</b>解析，不是启动时。
     *
     * <p>后端允许「无模型」启动，所以启动那一刻 {@code ref} 里可能是 null。
     * 用户随后在 GUI 配好 provider（{@code config.setProvider} 会改这个内存 config 对象并落盘），
     * 此处就能按当前配置就地装一个，并写回 {@code ref} 供后续任务复用。
     *
     * <p>仍然拿不到时<b>抛出人话</b>而不是让 NPE 冒到面板上 ——
     * 「{@code Cannot invoke "LlmClient.supportsTools()" because "this.llmClient" is null}」
     * 对用户毫无意义，他需要知道的是「去配个模型」。
     *
     * @throws IllegalStateException 没有任何可用模型时
     */
    static LlmClient requireTaskClient(AtomicReference<LlmClient> ref, WraithConfig config) {
        LlmClient existing = ref.get();
        if (existing != null) {
            return existing;
        }
        LlmClient fresh = LlmClientFactory.createFromConfig(config);
        if (fresh == null) {
            throw new IllegalStateException(
                    "尚未配置任何模型，后台任务无法执行。请在「配置 → Provider 配置」里填入一个 API Key 并保存后重试。");
        }
        // compareAndSet:并发跑多个任务时只保留第一个装上的,避免每个任务各建一个 client
        ref.compareAndSet(null, fresh);
        return ref.get();
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
        // 进入 raw mode 监听 ESC：raw mode 关 ICANON / ECHO / IEXTEN 但保留 ISIG，所以 Ctrl+C 仍能终止 Wraith。
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

    /**
     * 从异常消息里抹掉可能被底层客户端带进来的 apiKey(防御性;红线:回包绝不含 key)。null 安全。
     *
     * <p>实现搬到了 {@link com.lyhn.wraith.config.SecretRedaction} —— {@code rag} 那边的
     * embedding 探测也要抹，而 {@code rag} 不该依赖 {@code cli}。这里保留成委托，
     * 是为了不动已有调用点与 {@code RedactKeyTest}。
     */
    static String redactKey(String message, String apiKey) {
        return com.lyhn.wraith.config.SecretRedaction.redact(message, apiKey);
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

    /**
     * 静态斜杠命令提示表。
     *
     * <p><b>刻意不含任何 provider / 模型名。</b> 这里曾硬编码 9 条
     * （{@code /model glm-5.1}、{@code /model deepseek}…），于是只配了 anthropic 的用户
     * 敲 {@code /} 会看到「切换到 GLM-5.1」。provider 名现在只有一个来源：
     * config 驱动的 {@link WraithCompleter} 补全。
     *
     * <p>本表的四个消费者里有三个是无 config 参数的 static 方法
     * （{@code printSlashCommandHelp} / {@code slashCommandTailTips} /
     * {@code formatSlashCommandChoices}），所以这里选择「删掉 provider 专属项」
     * 而不是「把 config 穿进来再生成」——后者要改三处签名，且会再造一份 provider 名单。
     */
    static List<SlashCommandHint> slashCommandHints() {
        return List.of(
                new SlashCommandHint("/model", "/model", "查看当前模型"),
                // 两参形式写在 description 里而不是另开一条 —— insertText 同时充当补全前缀,
                // 另开一条就得编一个 "/model  "(双空格)当前缀,它会在用户敲完 "/model " 时
                // 冒出来并插入第二个空格。第二段是模型名,本来也给不出候选:wraith 不知道任何
                // provider 的可用模型列表(中转站尤其没法枚举)。
                new SlashCommandHint("/model ", "/model <provider>",
                        "切换 provider（按 Tab 从已配置的里选）；两参 /model <provider> <model> 可直接指定模型"),
                new SlashCommandHint("/config provider ", "/config provider <name>", "配置 provider（按 Tab 从已配置的里选）"),
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
                new SlashCommandHint("/snapshot on", "/snapshot on", "开启快照（写进配置，立即生效）"),
                new SlashCommandHint("/snapshot off", "/snapshot off", "关闭快照（写进配置，立即生效）"),
                new SlashCommandHint("/snapshot clean", "/snapshot clean", "清理当前项目 Side-Git 快照"),
                new SlashCommandHint("/restore ", "/restore <N>", "恢复到最近第 N 个 pre-turn 快照"),
                new SlashCommandHint("/index", "/index", "索引当前代码库"),
                new SlashCommandHint("/index ", "/index [路径]", "索引指定路径代码库"),
                new SlashCommandHint("/search ", "/search <查询>", "语义检索代码（RAG 辅助）"),
                new SlashCommandHint("/graph ", "/graph <类名>", "查看代码关系图谱"),
                new SlashCommandHint("/clear", "/clear", "清空当前对话历史"),
                new SlashCommandHint("/cancel", "/cancel", "取消当前正在跑的一轮"),
                new SlashCommandHint("/resume", "/resume", "续接本项目历史会话"),
                new SlashCommandHint("/resume ", "/resume <会话名>", "按名字续接某个历史会话"),
                new SlashCommandHint("/compact", "/compact", "手动压缩当前对话历史"),
                new SlashCommandHint("/init", "/init", "生成项目级记忆 WRAITH.md"),
                new SlashCommandHint("/init --force", "/init --force", "重写项目级记忆 WRAITH.md"),
                new SlashCommandHint("/history clear", "/history clear", "清空本机输入历史"),
                new SlashCommandHint("/context", "/context", "查看上下文和记忆状态"),
                new SlashCommandHint("/ctx", "/ctx", "同 /context 的简写"),
                new SlashCommandHint("/memory", "/memory", "查看记忆状态（可简写 /mem）"),
                new SlashCommandHint("/memory list", "/memory list", "查看长期记忆列表"),
                new SlashCommandHint("/memory search ", "/memory search <关键词>", "搜索当前项目可见长期记忆"),
                new SlashCommandHint("/memory delete ", "/memory delete <id>", "删除单条长期记忆"),
                new SlashCommandHint("/memory clear", "/memory clear", "清空长期记忆"),
                // ↓ 这四条此前**不在表里**,而 CliCommandParser 一直认它们。
                // 后果不是「少一点便利」:自动记忆提取写出来的候选**只能**从这里批,
                // 补全里查不到、README 里也没写,等于整个特性没有可发现的入口。
                new SlashCommandHint("/memory pending", "/memory pending", "查看自动提取出的记忆候选（待你批）"),
                new SlashCommandHint("/memory approve ", "/memory approve <id>", "采纳一条候选记忆（写入长期记忆）"),
                new SlashCommandHint("/memory reject ", "/memory reject <id>", "丢弃一条候选记忆"),
                new SlashCommandHint("/memory pending clear", "/memory pending clear", "清空全部候选记忆"),
                new SlashCommandHint("/save ", "/save [--global] <事实内容>", "手动保存项目级或全局长期记忆"),
                new SlashCommandHint("/skill", "/skill", "查看 skill 列表"),
                new SlashCommandHint("/skill list", "/skill list", "查看 skill 列表"),
                new SlashCommandHint("/skill show ", "/skill show <name>", "查看 SKILL.md 全文"),
                new SlashCommandHint("/skill on ", "/skill on <name>", "启用 skill"),
                new SlashCommandHint("/skill off ", "/skill off <name>", "禁用 skill"),
                new SlashCommandHint("/skill reload", "/skill reload", "重新扫描 skill 目录"),
                new SlashCommandHint("/export", "/export", "导出当前会话对话记录为 Markdown"),
                new SlashCommandHint("/archive", "/archive [标题]", "归档当前聊天并清空（之后在设置或 /archive list 里回看）"),
                new SlashCommandHint("/archive list", "/archive list", "查看已归档聊天列表"),
                new SlashCommandHint("/archive show ", "/archive show <id>", "预览某条已归档聊天"),
                new SlashCommandHint("/archive restore ", "/archive restore <id>", "把某条归档载回当前对话继续聊"),
                new SlashCommandHint("/archive delete ", "/archive delete <id>", "删除某条已归档聊天"),
                new SlashCommandHint("/archive clear", "/archive clear", "清空全部已归档聊天"),
                new SlashCommandHint("/exit", "/exit", "退出 Wraith"),
                new SlashCommandHint("/quit", "/quit", "退出 Wraith")
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
                "配置文件: " + com.lyhn.wraith.config.ConfigPathDisplay.path("config.json") + " (只读视图，编辑请用编辑器)"
        );
        int selected = renderer.openPalette("配置 / config", items);
        if (selected < 0) {
            renderer.stream().println("(已关闭)");
            return;
        }
        String hint = switch (selected) {
            // 不点名具体 provider:用户可能一个 GLM 都没配。按 Tab 从已配置的里选。
            case 0, 1 -> "💡 切换 provider: /model <name>（按 Tab 列出已配置的）；配置: /config provider <name>";
            case 2 -> "💡 切换 HITL: /hitl on / /hitl off";
            case 3 -> "💡 管理 Skill: /skill list / /skill on <name> / /skill off <name>";
            case 4 -> "💡 切换渲染器（重启后生效）: WRAITH_RENDERER=inline|lanterna|plain";
            case 5 -> "💡 当前不在 TUI 内编辑 config.json，建议在编辑器里改完重启";
            default -> "(unknown)";
        };
        renderer.stream().println(hint);
    }

    static String handleConfigCommand(WraithConfig config, String payload) {
        return handleConfigCommand(config, payload, null);
    }

    /**
     * @param hook 非 null 时，写完调 {@code afterConfigWrite}——搜索与计价配置改完都要
     *             立刻生效，不再需要重启后端（第五、第六次 snapshot-vs-live）。
     *             <b>无条件调用</b>而不是按分支调：多刷一次无害，而「再解析一遍 payload
     *             判断该刷谁」会让两处判断有分叉的机会。
     */
    static String handleConfigCommand(WraithConfig config, String payload, ConfigReloadHook hook) {
        List<String> head = splitArgs(payload);
        String first = head.isEmpty() ? "" : head.get(0).toLowerCase(Locale.ROOT);
        String result = switch (first) {
            case "search" -> applySearchConfig(config, payload);
            case "pricing" -> applyPricingConfig(config, payload);
            default -> applyProviderConfig(config, payload);
        };
        if (hook != null) {
            hook.afterConfigWrite(config);
        }
        return result;
    }

    private static String applyProviderConfig(WraithConfig config, String payload) {
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
        if (update.protocol() != null) {
            providerConfig.setProtocol(update.protocol());
        }
        if (update.setDefault()) {
            config.setDefaultProvider(update.provider());
        }
        config.save();

        // baseUrl 留空时,实际会请求哪个端点由 LlmClientFactory 在运行时决定(protocol/别名/
        // client 各自的内置默认三方共同决定),这里没有能不碰生产类就拿到那个 URL 的办法——
        // 各 client 的 getApiUrl() 是 protected(AnthropicClient 甚至完全没有),为回显加公开
        // getter 不值得(X1)。于是不再用「(默认)」这种听起来一切正常的说法,而是老实说
        // 「不知道具体是哪」+ 一条警示:provider 名拼错时,请求可能被发往完全错误的服务商
        // (最典型的例子就是 X1 本身——把 anthropic 写成 claude/anthropi 等未登记别名/拼写)。
        boolean baseUrlDefaulted = providerConfig.getBaseUrl() == null || providerConfig.getBaseUrl().isBlank();

        StringBuilder out = new StringBuilder();
        out.append("✅ 已保存 provider 配置: ").append(update.provider()).append('\n');
        out.append("   model: ").append(providerConfig.getModel() == null || providerConfig.getModel().isBlank()
                ? "(默认)" : providerConfig.getModel()).append('\n');
        out.append("   baseUrl: ").append(baseUrlDefaulted
                ? "(默认，由 provider 决定)" : providerConfig.getBaseUrl()).append('\n');
        out.append("   protocol: ").append(providerConfig.getProtocol() == null || providerConfig.getProtocol().isBlank()
                ? "openai(默认)" : providerConfig.getProtocol()).append('\n');
        out.append("   apiKey: ").append(maskSecret(providerConfig.getApiKey())).append('\n');
        if ("xfyun".equals(update.provider())) {
            out.append("   loraId: ").append(providerConfig.getLoraId() == null || providerConfig.getLoraId().isBlank()
                    ? "(未配置)" : providerConfig.getLoraId()).append('\n');
        }
        if (baseUrlDefaulted) {
            out.append("   ⚠ 未指定 --base-url，该 provider 的端点将由内置默认决定。\n");
            out.append("     若 provider 名拼错，请求可能被发往错误的服务商 —— 请用 /model ")
                    .append(update.provider()).append(" 后看状态行确认。\n");
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

        String apiKey = null;
        String baseUrl = null;
        String model = null;
        String loraId = null;
        String protocol = null;
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
                case "protocol" -> protocol = value;
                default -> {
                    return ProviderConfigUpdate.error("未知配置项: " + key);
                }
            }
        }

        if (loraId != null && !"xfyun".equals(provider)) {
            return ProviderConfigUpdate.error("--lora-id 仅支持 xfyun provider");
        }

        // --protocol 决定 LlmClientFactory 的 default 分支走 AnthropicClient 还是
        // GenericOpenAiClient(见 C1)。非法取值必须报人话,不能静默吞掉或悄悄落成 openai——
        // 那样用户会以为设置生效了,实际却把 key 发去了别的地方。
        if (protocol != null) {
            String normalizedProtocol = protocol.trim().toLowerCase(Locale.ROOT);
            if (!"openai".equals(normalizedProtocol) && !"anthropic".equals(normalizedProtocol)) {
                return ProviderConfigUpdate.error("--protocol 只支持 openai 或 anthropic");
            }
            protocol = normalizedProtocol;
        }

        if (apiKey == null && baseUrl == null && model == null && loraId == null && protocol == null && !setDefault) {
            return ProviderConfigUpdate.error("至少提供一个配置项");
        }
        return new ProviderConfigUpdate(provider, apiKey, baseUrl, model, loraId, protocol, setDefault, null);
    }

    private static String providerConfigUsage() {
        return """
                用法:
                  /config provider freellmapi --base-url http://localhost:5173/v1 --api-key <key> --model auto
                  /config provider freellmapi --model qwen/qwen3-coder:free --default
                  /config provider xfyun --base-url https://maas-api.cn-huabei-1.xf-yun.com/v2 --api-key <key> --model Qwen3.6-35B-A3B --default
                  /config provider xfyun --lora-id <resourceId>
                  /config provider anthropic --protocol anthropic --api-key <key> --model claude-sonnet-4-5
                  /config search --provider searxng --base-url http://localhost:8888
                  /config pricing --list
                  /model freellmapi
                  /model xfyun
                """.stripTrailing();
    }

    // 支持的四个后端搬到 com.lyhn.wraith.web.SearchConfigRules.PROVIDERS ——
    // 桌面的 config.setSearch 也要用它,留在这儿会变成两份。

    static SearchConfigUpdate parseSearchConfigUpdate(String payload) {
        List<String> args = splitArgs(payload);
        if (args.isEmpty() || !"search".equalsIgnoreCase(args.get(0))) {
            return SearchConfigUpdate.error("用法不正确");
        }

        String provider = null;
        String apiKey = null;
        String baseUrl = null;
        for (int i = 1; i < args.size(); i++) {
            String token = args.get(i);
            String key;
            String value;
            int equals = token.indexOf('=');
            if (equals > 0) {
                key = token.substring(0, equals);
                value = token.substring(equals + 1);
            } else {
                key = token;
                if (i + 1 >= args.size()) {
                    return SearchConfigUpdate.error("缺少 " + key + " 的值");
                }
                value = args.get(++i);
            }
            switch (normalizeConfigKey(key)) {
                case "provider" -> provider = value;
                case "api-key" -> apiKey = value;
                case "base-url" -> baseUrl = value;
                default -> {
                    return SearchConfigUpdate.error("未知配置项: " + key);
                }
            }
        }

        // 规则本身在 SearchConfigRules —— 桌面的 config.setSearch 调的是同一份。
        // 在这儿重写一遍的话，两条路会漂，而漂的方向恰好是「桌面能存进 CLI 认为非法的配置」。
        // 这里只负责把「违反了哪条」翻成**点出旗标名**的话（表单那侧没有旗标，措辞不同）。
        com.lyhn.wraith.web.SearchConfigRules.Violation violation =
                com.lyhn.wraith.web.SearchConfigRules.check(provider, apiKey, baseUrl);
        if (violation != null) {
            return SearchConfigUpdate.error(switch (violation) {
                // provider 为空而 apiKey 有值时,「这个 key 属于 zhipu 还是 serpapi」不可猜,
                // 猜错会把 SerpAPI 的 key 发给智谱(或反之)。宁可现在报错。
                case PROVIDER_REQUIRED -> "必须指定 --provider（"
                        + com.lyhn.wraith.web.SearchConfigRules.PROVIDER_LIST + "）";
                case UNKNOWN_PROVIDER -> "未知搜索后端: " + provider + "，只支持 "
                        + com.lyhn.wraith.web.SearchConfigRules.PROVIDER_LIST;
                case SEARXNG_NEEDS_BASE_URL ->
                        "searxng 需要 --base-url（例如 --base-url http://localhost:8888）";
                // 静默吞掉多给的参数会让用户以为 key 生效了,之后排查不可能。
                case DUCKDUCKGO_TAKES_NOTHING -> "duckduckgo 不需要 --api-key / --base-url";
            });
        }
        return new SearchConfigUpdate(
                com.lyhn.wraith.web.SearchConfigRules.normalize(provider), apiKey, baseUrl, null);
    }

    private static String searchConfigUsage() {
        return """
                用法:
                  /config search --provider searxng --base-url http://localhost:8888
                  /config search --provider serpapi --api-key <key>
                  /config search --provider zhipu --api-key <key>
                  /config search --provider zhipu                 # 沿用 providers.glm.apiKey
                  /config search --provider duckduckgo            # 无需 key,但靠抓 HTML,会抖
                """.stripTrailing();
    }

    private static final java.util.Set<String> PRICING_CURRENCIES = java.util.Set.of("CNY", "USD");

    /**
     * 一条计价条目的校验；返回 {@code null} 表示通过，否则是给人看的错误。
     * CLI 与 RPC 共用同一套规则——否则用户在一边被拒、在另一边写进去。
     *
     * <p><b>刻意不校验 {@code cacheHit <= cacheMiss}</b>：DeepSeek Flash 的真实牌价就是
     * 0.0028 vs 0.14，但反过来也可能存在，这不是 wraith 该管的。
     */
    static String validatePricingEntry(String modelPrefix, double cacheHit, double cacheMiss,
                                       double output, String currency) {
        if (modelPrefix == null || modelPrefix.isBlank()) {
            return "模型前缀不能为空（空前缀会命中所有模型）";
        }
        for (double v : new double[]{cacheHit, cacheMiss, output}) {
            if (Double.isNaN(v) || Double.isInfinite(v) || v < 0) {
                return "价格必须是 ≥ 0 的有限数字（算出负成本比不显示更糟）";
            }
        }
        String c = currency == null ? "" : currency.trim().toUpperCase(Locale.ROOT);
        if (!PRICING_CURRENCIES.contains(c)) {
            return "币种只支持 CNY 或 USD（状态栏只认这两种符号，填别的会一律显示成 ¥）";
        }
        return null;
    }

    /**
     * 这条前缀会命中哪几个已配置模型。
     *
     * <p>语义与 {@code PricingTable.Entry.matches(exact=false)} 一致：<b>小写后 startsWith</b>。
     * 用户填 {@code glm} 会命中 {@code glm-4.7} 与 {@code glm-5v-turbo}——把这件事显示出来，
     * 前缀语义就不再是静默的。
     */
    static List<String> pricingMatchedModels(String modelPrefix, WraithConfig config) {
        if (modelPrefix == null || modelPrefix.isBlank() || config == null
                || config.getProviders() == null) {
            return List.of();
        }
        String prefix = modelPrefix.trim().toLowerCase(Locale.ROOT);
        java.util.LinkedHashSet<String> hits = new java.util.LinkedHashSet<>();
        for (String id : config.getProviders().keySet()) {
            WraithConfig.ProviderConfig pc = config.getProviders().get(id);
            String model = pc == null ? null : pc.getModel();
            if (model != null && !model.isBlank()
                    && model.trim().toLowerCase(Locale.ROOT).startsWith(prefix)) {
                hits.add(model.trim());
            }
        }
        return List.copyOf(hits);
    }

    static PricingConfigUpdate parsePricingConfigUpdate(String payload) {
        List<String> args = splitArgs(payload);
        if (args.isEmpty() || !"pricing".equalsIgnoreCase(args.get(0))) {
            return PricingConfigUpdate.error("用法不正确");
        }
        if (args.size() == 1) {
            return new PricingConfigUpdate(PricingAction.LIST, null, 0, 0, 0, null, null);
        }

        String modelPrefix = null;
        Double cacheHit = null;
        Double cacheMiss = null;
        Double output = null;
        String currency = null;
        boolean list = false;
        String remove = null;

        for (int i = 1; i < args.size(); i++) {
            String token = args.get(i);
            if (!token.startsWith("-")) {
                if (modelPrefix != null) {
                    return PricingConfigUpdate.error("多余的参数: " + token);
                }
                modelPrefix = token;
                continue;
            }
            String key;
            String value = null;
            int equals = token.indexOf('=');
            if (equals > 0) {
                key = token.substring(0, equals);
                value = token.substring(equals + 1);
            } else {
                key = token;
            }
            String normalized = normalizeConfigKey(key);
            if ("list".equals(normalized)) {
                list = true;
                continue;
            }
            if (value == null) {
                if (i + 1 >= args.size()) {
                    return PricingConfigUpdate.error("缺少 " + key + " 的值");
                }
                value = args.get(++i);
            }
            switch (normalized) {
                case "remove" -> remove = value;
                case "model-prefix" -> modelPrefix = value;
                case "cache-hit" -> {
                    Double parsed = parsePricingNumber(value);
                    if (parsed == null) return PricingConfigUpdate.error("--cache-hit 不是数字: " + value);
                    cacheHit = parsed;
                }
                case "cache-miss" -> {
                    Double parsed = parsePricingNumber(value);
                    if (parsed == null) return PricingConfigUpdate.error("--cache-miss 不是数字: " + value);
                    cacheMiss = parsed;
                }
                case "output" -> {
                    Double parsed = parsePricingNumber(value);
                    if (parsed == null) return PricingConfigUpdate.error("--output 不是数字: " + value);
                    output = parsed;
                }
                case "currency" -> currency = value;
                default -> {
                    return PricingConfigUpdate.error("未知配置项: " + key);
                }
            }
        }

        if (remove != null) {
            if (remove.isBlank()) return PricingConfigUpdate.error("--remove 需要一个模型前缀");
            return new PricingConfigUpdate(PricingAction.REMOVE, remove.trim(), 0, 0, 0, null, null);
        }
        if (list) {
            return new PricingConfigUpdate(PricingAction.LIST, null, 0, 0, 0, null, null);
        }
        // 三个价一个都不能缺:缺省成 0 会把「免费」当成事实,违反 PricingTable 的「宁缺勿虚」
        if (cacheHit == null || cacheMiss == null || output == null) {
            return PricingConfigUpdate.error(
                    "三个价都要给：--cache-hit / --cache-miss / --output（缺省成 0 会把「免费」当成事实）");
        }
        String resolvedCurrency = currency == null || currency.isBlank()
                ? "CNY" : currency.trim().toUpperCase(Locale.ROOT);
        String invalid = validatePricingEntry(modelPrefix, cacheHit, cacheMiss, output, resolvedCurrency);
        if (invalid != null) {
            return PricingConfigUpdate.error(invalid);
        }
        return new PricingConfigUpdate(PricingAction.UPSERT, modelPrefix.trim(),
                cacheHit, cacheMiss, output, resolvedCurrency, null);
    }

    /** 数字解析：解析不出返回 null（由调用方报「不是数字」并把原串回给用户）。 */
    private static Double parsePricingNumber(String value) {
        try {
            return Double.parseDouble(value.trim());
        } catch (Exception e) {
            return null;
        }
    }

    private static String pricingConfigUsage() {
        return """
                用法:
                  /config pricing --list
                  /config pricing glm-4.7 --cache-hit 20 --cache-miss 20 --output 60
                  /config pricing Qwen/Qwen3-8B --cache-hit 0.5 --cache-miss 0.5 --output 1.5 --currency CNY
                  /config pricing --remove glm-4.7
                说明:
                  价格单位是「每百万 token」;币种只支持 CNY / USD。
                  模型前缀是**前缀匹配**:填 glm 会让 glm-4.7、glm-5v-turbo 套同一个价。
                """.stripTrailing();
    }

    private static String applyPricingConfig(WraithConfig config, String payload) {
        PricingConfigUpdate update = parsePricingConfigUpdate(payload);
        if (update.error() != null) {
            return "❌ " + update.error() + "\n" + pricingConfigUsage();
        }
        return switch (update.action()) {
            case LIST -> pricingList(config);
            case REMOVE -> pricingRemove(config, update.modelPrefix());
            case UPSERT -> pricingUpsert(config, update);
        };
    }

    private static String pricingList(WraithConfig config) {
        StringBuilder out = new StringBuilder("📊 模型计价（价格单位：每百万 token）\n");
        List<com.lyhn.wraith.context.PricingTable.View> view =
                new com.lyhn.wraith.context.PricingTable(config.getPricing()).view();
        for (com.lyhn.wraith.context.PricingTable.View v : view) {
            com.lyhn.wraith.context.PricingTable.Price p = v.price();
            String symbol = "USD".equalsIgnoreCase(p.currency()) ? "$" : "¥";
            out.append("   ").append(v.modelKey())
                    .append(v.seeded() ? "  (内置，不可改)" : "")
                    .append("  ").append(symbol).append(p.cacheHitPerM())
                    .append(" / ").append(symbol).append(p.cacheMissPerM())
                    .append(" / ").append(symbol).append(p.outputPerM())
                    .append('\n');
            if (!v.seeded()) {
                List<String> hits = pricingMatchedModels(v.modelKey(), config);
                out.append("      ").append(hits.isEmpty()
                        ? "⚠ 当前不命中任何已配置模型" : "会命中：" + String.join("、", hits)).append('\n');
            }
        }
        out.append("   添加/修改: /config pricing <模型前缀> --cache-hit X --cache-miss Y --output Z");
        return out.toString();
    }

    private static String pricingRemove(WraithConfig config, String modelPrefix) {
        List<WraithConfig.PricingEntry> entries = config.getPricing();
        boolean removed = entries.removeIf(e -> e.getModelPrefix() != null
                && e.getModelPrefix().trim().equalsIgnoreCase(modelPrefix));
        if (!removed) {
            return "❌ 没有前缀为 " + modelPrefix + " 的计价条目（内置种子不可删）\n" + pricingConfigUsage();
        }
        config.save();
        return "✅ 已删除计价条目: " + modelPrefix;
    }

    private static String pricingUpsert(WraithConfig config, PricingConfigUpdate update) {
        List<WraithConfig.PricingEntry> entries = config.getPricing();
        // 同前缀覆盖而不是加第二条:最长前缀相同时哪条胜出是任意的
        entries.removeIf(e -> e.getModelPrefix() != null
                && e.getModelPrefix().trim().equalsIgnoreCase(update.modelPrefix()));
        WraithConfig.PricingEntry entry = new WraithConfig.PricingEntry();
        entry.setModelPrefix(update.modelPrefix());
        entry.setCacheHitPerM(update.cacheHitPerM());
        entry.setCacheMissPerM(update.cacheMissPerM());
        entry.setOutputPerM(update.outputPerM());
        entry.setCurrency(update.currency());
        entries.add(entry);
        config.save();

        String symbol = "USD".equals(update.currency()) ? "$" : "¥";
        StringBuilder out = new StringBuilder("✅ 已保存计价: ").append(update.modelPrefix()).append('\n');
        out.append("   ").append(symbol).append(update.cacheHitPerM())
                .append(" / ").append(symbol).append(update.cacheMissPerM())
                .append(" / ").append(symbol).append(update.outputPerM())
                .append("  每百万 token（缓存命中 / 缓存未中 / 输出）\n");
        List<String> hits = pricingMatchedModels(update.modelPrefix(), config);
        out.append("   ").append(hits.isEmpty()
                        ? "⚠ 当前不命中任何已配置模型 —— 前缀写对了吗？（预填未来要用的模型也正常）"
                        : "会命中：" + String.join("、", hits))
                .append('\n');
        out.append("   已立即生效，不需要重启。");
        return out.toString();
    }

    /** {@code config.getPricing} 的回包：用户条目 + 内置种子，各带 {@code seeded}。 */
    static java.util.Map<String, Object> pricingPayload(WraithConfig config) {
        List<java.util.Map<String, Object>> rows = new ArrayList<>();
        for (com.lyhn.wraith.context.PricingTable.View v
                : new com.lyhn.wraith.context.PricingTable(config.getPricing()).view()) {
            java.util.Map<String, Object> row = new LinkedHashMap<>();
            row.put("modelPrefix", v.modelKey());
            row.put("cacheHitPerM", v.price().cacheHitPerM());
            row.put("cacheMissPerM", v.price().cacheMissPerM());
            row.put("outputPerM", v.price().outputPerM());
            row.put("currency", v.price().currency());
            row.put("seeded", v.seeded());
            rows.add(row);
        }
        return java.util.Map.of("entries", rows);
    }

    /**
     * {@code config.setPricing} 的落地：<b>整表替换</b>。返回 {@code null} 表示成功，
     * 否则是给人看的错误（此时 config <b>一条都不写</b>）。
     *
     * <p>为什么整表替换而不是逐条 CRUD：{@code PricingEntry} 没有 id，{@code modelPrefix}
     * 是天然主键但用户会改它——「把 glm 改成 glm-4.7」在逐条 API 里是「改一条」还是
     * 「删一条加一条」有歧义，而歧义会在两个客户端之间分叉。
     *
     * <p>校验通过后才动 config：单条非法就整批拒绝，避免「写进去一半」这种最难排查的状态。
     */
    static String applyPricingEntries(WraithConfig config, List<java.util.Map<String, Object>> entries) {
        List<WraithConfig.PricingEntry> parsed = new ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (java.util.Map<String, Object> row
                : entries == null ? List.<java.util.Map<String, Object>>of() : entries) {
            String prefix = row.get("modelPrefix") == null
                    ? "" : String.valueOf(row.get("modelPrefix")).trim();
            double hit = pricingNumberOf(row.get("cacheHitPerM"));
            double miss = pricingNumberOf(row.get("cacheMissPerM"));
            double out = pricingNumberOf(row.get("outputPerM"));
            String currency = row.get("currency") == null || String.valueOf(row.get("currency")).isBlank()
                    ? "CNY" : String.valueOf(row.get("currency")).trim().toUpperCase(Locale.ROOT);

            String invalid = validatePricingEntry(prefix, hit, miss, out, currency);
            if (invalid != null) {
                return invalid + "（条目：" + (prefix.isBlank() ? "(空)" : prefix) + "）";
            }
            if (!seen.add(prefix.toLowerCase(Locale.ROOT))) {
                return "重复的模型前缀: " + prefix + "（两条同名时哪条胜出是任意的）";
            }
            WraithConfig.PricingEntry entry = new WraithConfig.PricingEntry();
            entry.setModelPrefix(prefix);
            entry.setCacheHitPerM(hit);
            entry.setCacheMissPerM(miss);
            entry.setOutputPerM(out);
            entry.setCurrency(currency);
            parsed.add(entry);
        }
        config.setPricing(parsed);
        return null;
    }

    /** JSON 数字可能是 Integer/Double/String，统一读成 double；读不出交给校验报「必须是有限数字」。 */
    private static double pricingNumberOf(Object value) {
        if (value instanceof Number n) return n.doubleValue();
        if (value == null) return 0;
        try {
            return Double.parseDouble(String.valueOf(value).trim());
        } catch (Exception e) {
            return Double.NaN;
        }
    }

    private static String applySearchConfig(WraithConfig config, String payload) {
        SearchConfigUpdate update = parseSearchConfigUpdate(payload);
        if (update.error() != null) {
            return "❌ " + update.error() + "\n" + searchConfigUsage();
        }

        WraithConfig.SearchConfig search = config.getSearch();
        if (search == null) {
            search = new WraithConfig.SearchConfig();
            config.setSearch(search);
        }
        // 落盘语义(空=保留旧、换 provider 不继承旧 key)在 SearchConfigRules.apply ——
        // 桌面的 config.setSearch 调的是同一份,否则两条路会漂。
        com.lyhn.wraith.web.SearchConfigRules.apply(search, update.provider(), update.apiKey(), update.baseUrl());
        config.save();

        StringBuilder out = new StringBuilder();
        out.append("✅ 已保存搜索后端: ").append(update.provider()).append('\n');
        out.append("   apiKey: ").append(maskSecret(search.getApiKey())).append('\n');
        out.append("   baseUrl: ").append(search.getBaseUrl() == null || search.getBaseUrl().isBlank()
                ? "(未配置)" : search.getBaseUrl()).append('\n');
        if ("duckduckgo".equals(update.provider())) {
            out.append("   ⚠ 这个后端靠抓 HTML，可能因改版或限流失效，只建议临时用。\n");
        }
        out.append("   已立即生效，不需要重启。");
        return out.toString();
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
            case "cachehit", "cache_hit" -> "cache-hit";
            case "cachemiss", "cache_miss" -> "cache-miss";
            case "modelprefix", "model_prefix", "prefix" -> "model-prefix";
            default -> key;
        };
    }

    /** 委托 {@link com.lyhn.wraith.config.ProviderNames}——别名表只存一份。 */
    private static String normalizeProviderName(String raw) {
        String normalized = com.lyhn.wraith.config.ProviderNames.normalize(raw);
        return normalized == null ? "" : normalized;
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

    /**
     * /archive [标题]:落盘当前对话 → 标归档 → 清空。
     *
     * <p>不新建存储:先 persist 成正常会话再打 archivedAt 标记。这样 .cards.jsonl(动作卡)
     * 与 starred 都留在原文件里,恢复是无损的;桌面「设置 › 归档」看到的也是同一批东西。
     */
    private static void handleArchiveCurrent(String title, SessionStore sessionStore,
                                             Agent reactAgent, Renderer renderer, PrintStream ui) {
        sessionStore.persist(reactAgent.getConversationHistory());
        String id = sessionStore.currentId();
        if (id == null) {
            ui.println("当前没有可归档的对话。\n");
            return;
        }
        if (title != null && !title.isBlank()) {
            sessionStore.rename(id, title.strip());
        }
        if (!sessionStore.setArchived(id, true)) {
            ui.println("❌ 归档失败（会话文件写入出错）\n");
            return;
        }
        // 与 /clear 同一套清空动作:归档 = 收起来 + 从干净状态继续
        reactAgent.clearHistory();
        sessionStore.startNew();
        renderer.renderTodos(List.of());
        ui.println("🗄️ 已归档并清空当前对话。用 /archive list 回看，或到桌面端「设置 › 归档」。\n");
    }

    /** /archive list:只列**当前项目**的归档(CLI 天生是项目内的工作台)。 */
    private static void handleArchiveList(SessionStore sessionStore, PrintStream ui) {
        java.util.List<com.lyhn.wraith.session.SessionMeta> metas = sessionStore.listArchived(0);
        if (metas.isEmpty()) {
            ui.println("当前项目还没有归档的聊天。\n");
            return;
        }
        ui.println("已归档的聊天（" + metas.size() + " 条）：");
        for (com.lyhn.wraith.session.SessionMeta m : metas) {
            String label = m.name() != null && !m.name().isBlank() ? m.name() : m.title();
            ui.println("  " + m.id() + "  " + label + "  （" + m.turns() + " 轮，归档于 " + m.archivedAt() + "）");
        }
        ui.println("\n只显示当前项目；全部归档见桌面端「设置 › 归档」。\n");
    }

    /** /archive show <id>:只读预览,不切活跃会话。 */
    private static void handleArchiveShow(String id, SessionStore sessionStore, PrintStream ui) {
        if (id == null || id.isBlank()) {
            ui.println("❌ 请提供归档 id，例如 /archive show 20260805-101010-ab12\n");
            return;
        }
        java.util.List<com.lyhn.wraith.llm.LlmClient.Message> msgs = sessionStore.peek(id.strip());
        if (msgs.isEmpty()) {
            ui.println("❌ 找不到这条归档：" + id.strip() + "\n");
            return;
        }
        for (com.lyhn.wraith.llm.LlmClient.Message m : msgs) {
            String content = m.content() == null ? "" : m.content();
            ui.println("[" + m.role() + "] " + (content.length() > 500 ? content.substring(0, 500) + "…" : content));
        }
        ui.println();
    }

    /** /archive restore <id>:取消归档 + 载回当前对话。 */
    private static void handleArchiveRestore(String id, SessionStore sessionStore,
                                             Agent reactAgent, PrintStream ui) {
        if (id == null || id.isBlank()) {
            ui.println("❌ 请提供归档 id，例如 /archive restore 20260805-101010-ab12\n");
            return;
        }
        String sid = id.strip();
        if (!sessionStore.setArchived(sid, false)) {
            ui.println("❌ 找不到这条归档：" + sid + "\n");
            return;
        }
        java.util.List<com.lyhn.wraith.llm.LlmClient.Message> msgs = sessionStore.resume(sid);
        reactAgent.restoreHistory(msgs);
        ui.println("↩️ 已恢复并载回当前对话（" + msgs.size() + " 条消息）。\n");
    }

    /** /archive delete <id>:永久删除。 */
    private static void handleArchiveDelete(String id, SessionStore sessionStore, PrintStream ui) {
        if (id == null || id.isBlank()) {
            ui.println("❌ 请提供归档 id，例如 /archive delete 20260805-101010-ab12\n");
            return;
        }
        boolean removed = sessionStore.deleteById(id.strip());
        ui.println(removed ? "🗑️ 已删除。\n" : "❌ 找不到这条归档：" + id.strip() + "\n");
    }

    /**
     * /archive clear:清空当前项目全部归档。二次确认 —— 返回新的 pending 态。
     * 第一次调用(pending=false)只打警告,返回 true;紧接着再来一次才真清。
     */
    private static boolean handleArchiveClear(SessionStore sessionStore, PrintStream ui, boolean pending) {
        java.util.List<com.lyhn.wraith.session.SessionMeta> metas = sessionStore.listArchived(0);
        if (metas.isEmpty()) {
            ui.println("当前项目没有归档可清。\n");
            return false;
        }
        if (!pending) {
            ui.println("⚠️ 这会永久删除当前项目的 " + metas.size() + " 条归档，不可恢复。"
                    + "确定就再输一次 /archive clear。\n");
            return true;
        }
        int n = 0;
        for (com.lyhn.wraith.session.SessionMeta m : metas) {
            if (sessionStore.deleteById(m.id())) {
                n++;
            }
        }
        ui.println("🗑️ 已删除 " + n + " 条归档。\n");
        return false;
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
        md.append("# Wraith 会话导出\n\n");
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

    /** app-server 用:null-guard 包装 handleBrowserCommand(MCP 未就绪时给友好文本,不 NPE)。 */
    static String appServerBrowserCmd(String payload,
                                      BrowserSession browserSession,
                                      BrowserConnectivityCheck connectivityCheck,
                                      com.lyhn.wraith.mcp.McpServerManager mcpServerManager,
                                      HitlToolRegistry registry,
                                      HitlHandler hitlHandler) {
        if (mcpServerManager == null) {
            return "MCP 尚未就绪,请稍候重试(chrome-devtools 会在 MCP 初始化后可用)。";
        }
        return handleBrowserCommand(payload, browserSession, connectivityCheck, mcpServerManager, registry, hitlHandler);
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
            return "❌ 未配置 chrome-devtools MCP server，请先检查 " + com.lyhn.wraith.config.ConfigPathDisplay.path("mcp.json");
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
            return com.lyhn.wraith.browser.BrowserConnectHelp.forFailedProbe(port, probe);
        }

        McpServer server = mcpServerManager.server("chrome-devtools");
        if (server == null) {
            return "❌ 未配置 chrome-devtools MCP server，请先检查 " + com.lyhn.wraith.config.ConfigPathDisplay.path("mcp.json");
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

    /**
     * {@code /snapshot on|off} —— 桌面开关按钮的 CLI 对等物。
     *
     * <p><b>被 env / 系统属性覆盖时要如实说</b>，不能装作切成功了：
     * 取值链是 env → 属性 → config.json，写盘那一层压不过前两层。
     * 用户在 shell profile 里写死了 {@code WRAITH_SNAPSHOT_ENABLED=false} 的话，
     * {@code /snapshot on} 对本次会话有效（运行期覆盖），但重启又会被那个变量按回去 ——
     * 这件事必须当场讲清，否则下次启动他会以为功能坏了。
     */
    private static void printSnapshotToggle(PrintStream out, SnapshotService snapshotService, boolean enable) {
        String saveError = snapshotService.setEnabled(enable);
        out.println(enable ? "✅ 快照已开启（本次会话立即生效）" : "🛑 快照已关闭（本次会话立即生效）");
        if (saveError != null) {
            out.println("   ⚠️ " + saveError);
        }
        com.lyhn.wraith.snapshot.SnapshotConfig.EnabledSource source =
                com.lyhn.wraith.snapshot.SnapshotConfig.enabledSource();
        if (source == com.lyhn.wraith.snapshot.SnapshotConfig.EnabledSource.ENV) {
            out.println("   ⚠️ 环境变量 WRAITH_SNAPSHOT_ENABLED 的优先级更高 ——"
                    + "下次启动仍会照它来。要让这次的选择长期有效，请先取消那个环境变量。");
        } else if (source == com.lyhn.wraith.snapshot.SnapshotConfig.EnabledSource.PROPERTY) {
            out.println("   ⚠️ 本次启动带了 --no-snapshot（或 -Dwraith.snapshot.enabled）——"
                    + "已写进配置，下次不带参数启动就按新设置来。");
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
        if ("on".equals(normalized) || "off".equals(normalized)) {
            printSnapshotToggle(out, snapshotService, "on".equals(normalized));
            return;
        }
        if (!"list".equals(normalized)) {
            out.println("""
                    ❌ 未知 /snapshot 子命令: %s
                    可用命令：
                      /snapshot
                      /snapshot status
                      /snapshot on
                      /snapshot off
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

    /**
     * GBK 之类窄编码的控制台上，把 {@code System.out}/{@code System.err} 的<b>文本</b>
     * 降级成能表示的形态。Windows 上用户看到的第一行就是 {@code ?? 终端不支持 ANSI…} ——
     * {@code ⚠}(U+26A0) 与变体选择符都不在 GBK 里，各降一个 {@code ?}。
     *
     * <p>UTF-8 控制台（mac/Linux/已 chcp 65001）不包装，零开销零行为变化。
     */
    private static void installConsoleSafety() {
        try {
            java.nio.charset.Charset out = com.lyhn.wraith.render.TerminalDoctor.consoleEncoding();
            System.setOut(com.lyhn.wraith.util.SafeConsoleStream.wrapIfNeeded(System.out, out));
            System.setErr(com.lyhn.wraith.util.SafeConsoleStream.wrapIfNeeded(System.err, out));
        } catch (Throwable ignored) {
            // 装不上就算了 —— 顶多是 emoji 显示成 ?,不该因此起不来
        }
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

    /**
     * 「/model 空参」与 {@code WraithCompleter} 的 provider 补全要展示的 id 全集：
     * config 里写下的（含暂时没填 key 的）∪ env 发现的候选，config 项在前、保持插入序，去重。
     *
     * <p>两者都要，谁都不能替代谁：{@code config.getProviders().keySet()} 收录**所有写下过的**
     * provider，包括暂时没填 key 的——用户很可能正要去填它；而 {@code ProviderResolver.candidates}
     * 只收有 key 且端点可确定的，补的是「只在 .env 里写了 {@code <NAME>_API_KEY}、从没跑过
     * {@code /config}」的用户——此前这里只用前者，于是这类用户敲 {@code /model} 时状态行报着
     * 已发现的模型，下一行却说「还没有配置任何 provider」，自相矛盾（I3）；
     * {@code WraithCompleter} 的 Tab 补全同理，一条都不给。
     */
    static List<String> knownProviderIds(WraithConfig config) {
        return knownProviderIds(config, com.lyhn.wraith.config.ProviderResolver.candidates(config));
    }

    /**
     * 同上，但候选表由调用方给出。
     *
     * <p>存在的唯一理由是<b>测试确定性</b>：{@code ProviderResolver.candidates(config)} 会扫
     * 真实环境变量 + {@code ./.env} + {@code ~/.env}，若测试走一参入口，「config 为空但 env 有
     * 发现」这类断言的结果就会取决于跑它的机器设了什么变量。
     */
    static List<String> knownProviderIds(WraithConfig config, List<String> discovered) {
        java.util.LinkedHashSet<String> ids = new java.util.LinkedHashSet<>();
        if (config != null && config.getProviders() != null) {
            ids.addAll(config.getProviders().keySet());
        }
        if (discovered != null) {
            ids.addAll(discovered);
        }
        return List.copyOf(ids);
    }

    static ModelSelection resolveModelSelection(String raw, WraithConfig config) {
        String value = raw == null ? "" : raw.trim();
        // 两参形式 /model <provider> <model> —— 不猜,两边都由用户说清(N4)。
        //
        // 单参形式必须猜「这个串是 provider 名还是模型名」,而猜的依据(已配置的 model 字段、
        // provider id 前缀、四条老前缀)都要求模型名与某个已知的东西对得上。切一个还没存进
        // config 的新模型时它们全都对不上,单参形式此时无解 —— 这就是两参存在的唯一理由。
        //
        // 第一段空白之后全算模型名(不再拆): 模型名里带空格罕见但不该被判死,而「用户已经打了
        // 空格」本身就是在用两参形式,把第一段当 provider、剩下当模型名是最不意外的读法。
        int sep = indexOfWhitespace(value);
        if (sep > 0) {
            String model = value.substring(sep + 1).trim();
            if (!model.isEmpty()) {
                return new ModelSelection(
                        resolveProviderToken(value.substring(0, sep), config), model, true);
            }
        }
        String normalized = value.toLowerCase(Locale.ROOT);
        // 先过别名表(单一来源),case 标签只留规范名 —— 此前这里把 14 个别名又抄了一遍。
        String canonical = com.lyhn.wraith.config.ProviderNames.normalize(normalized);
        if (canonical == null) {
            canonical = "";
        }
        return switch (canonical) {
            // glm 此前是 new ModelSelection("glm", "glm-5.1", true) —— 唯一被强制指定模型的
            // provider,其它都是 null(读各自 config)。拉平:GLMClient 自己的默认模型本来就是
            // glm-5.1,所以行为不变,但不再有「只有 GLM 才有的特例」。
            case "glm", "deepseek", "step", "kimi", "freellmapi", "xfyun" ->
                    new ModelSelection(canonical, null, false);
            default -> {
                // 裸 provider id 优先级最高 —— 压过下面的模型名归位与老前缀(X2/N4)。
                // 提到这里的原因:X2 守卫原先只是 return null,调序后 null 会落进老前缀,于是
                // 给中转站起名 glm-relay / deepseek-cn / step-proxy 的用户执行 /model glm-relay
                // 会被 startsWith("glm-") 接手,产出 provider=glm、model="glm-relay",调用方据此
                // 把垃圾串写进 glm 的 model 并落盘 —— 即 N3 那个回归,只是触发串换成了老前缀。
                // (这个洞在调序前就存在,老前缀在前时同样落到 glm。)
                String bareId = configuredProviderIdEqualTo(normalized, config);
                if (bareId != null) {
                    yield new ModelSelection(bareId, null, false);
                }
                // 再查「用户实际配了什么模型」,最后才回落硬编码前缀(N4)。
                //
                // 反过来的顺序(前缀在前)会让下面那四条老前缀永远抢先,于是 matchConfiguredProvider
                // 在它们覆盖的模型名上永远轮不到 —— 而那四条建立在一个巧合上:官方 provider 的 id
                // 恰好是它模型名的前缀(glm ⇒ glm-*)。中转站用户身上巧合不成立:他的 glm-4.7 挂在
                // freellmapi-4 上,却被 startsWith("glm-") 硬派给一个他根本没配的 glm。
                // 实测某用户 6 个中转站 provider,三个模型名(DeepSeek-V4-Flash / deepseek-v4-pro /
                // glm-4.7)因此完全切不动。
                //
                // 优先级含义:「这个模型名确实存在某个已配置 provider 上」是比「名字前缀像某官方
                // provider」更强的信号。同时配了官方 glm 与一个把 model 记成 glm-4.7 的中转站时,
                // 后者胜出 —— 用户把这个串写进那个 provider 就是意图本身。
                ModelSelection matched = matchConfiguredProvider(normalized, value, config);
                if (matched != null) {
                    yield matched;
                }
                // 下面四条留作兜底,不是冗余:provider id 与模型名前缀对不上时它们仍是唯一出路
                // (最典型的是 kimi ⇒ moonshot-*,前缀匹配覆盖不到)。
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
                yield new ModelSelection(canonical, null, false);
            }
        };
    }

    /**
     * 把「具体模型名」映射回它所属的已配置 provider —— 通用做法,不需要第十份硬编码前缀名单(I4)。
     * 命中条件二选一（顺序即优先级）:
     * <ol>
     *   <li>该 provider 已记录的 {@code model} 字段与 {@code normalized} 完全相等——精确相等是
     *       比前缀更强的信号,且能覆盖 provider id 与模型名前缀对不上的情况（如 provider
     *       {@code "anthropic"} 的模型是 {@code "claude-sonnet-4-5"}，起头对不上
     *       {@code "anthropic"}）。放在前缀匹配<b>之前</b>检查,避免被同 provider 或另一个
     *       provider 的前缀匹配抢先命中。</li>
     *   <li>{@code normalized} 是某个已配置 provider id 的<b>真前缀延伸</b>（如 provider
     *       {@code "qwen"} ⇒ 输入 {@code "qwen-max"}）。多个 id 都是前缀时取<b>最长</b>的那个
     *       ——多实例 id({@code freellmapi}/{@code freellmapi-2}/{@code freellmapi-3})共享公共
     *       前缀,短前缀不该抢在更具体的实例前面命中。</li>
     * </ol>
     *
     * <p><b>「裸 provider id 本身」已在调用方排掉了(X2)</b>: 见
     * {@link #configuredProviderIdEqualTo}——它在 {@link #resolveModelSelection} 里跑在本方法
     * <b>之前</b>,所以进到这里的 {@code normalized} 一定不等于任何已配置 id。
     * 那个检查曾经长在本方法开头、命中就 {@code return null},但调序(N4)之后 null 会落进四条
     * 老前缀而不是「非显式」回落,守卫就漏了,故提到调用方。若不排掉,{@code providers =
     * [freellmapi, freellmapi-2]} 时 {@code /model freellmapi-2} 会被前缀匹配命中
     * {@code freellmapi}(因为 {@code "freellmapi-2".startsWith("freellmapi")}),产出
     * {@code provider=freellmapi, model="freellmapi-2", explicitModel=true}——调用方
     * ({@code Main.java} 的 {@code /model} 处理分支)会据此执行
     * {@code ensureProviderConfig(config,"freellmapi").setModel("freellmapi-2")} 并
     * {@code config.save()}，静默把 {@code freellmapi} 的可用模型覆盖成垃圾字符串并落盘,
     * 然后切到错的 provider。多实例 id 是本仓库明确支持的概念,这条回归比合并前更糟。
     *
     * <p>只查 {@code config.getProviders()} —— 不查 {@code ProviderResolver.candidates},那个会扫
     * 真实 env,会让这条本该是纯函数的解析逻辑在不同机器上跑出不同结果。
     */
    private static ModelSelection matchConfiguredProvider(String normalized, String rawValue, WraithConfig config) {
        if (config == null || config.getProviders() == null || normalized.isEmpty()) {
            return null;
        }
        for (String id : config.getProviders().keySet()) {
            String model = config.getModel(id);
            if (model != null && normalized.equals(model.trim().toLowerCase(Locale.ROOT))) {
                return new ModelSelection(id, rawValue, true);
            }
        }
        String bestId = null;
        int bestLen = -1;
        for (String id : config.getProviders().keySet()) {
            if (id == null || id.isBlank()) {
                continue;
            }
            String idLower = id.toLowerCase(Locale.ROOT);
            if (normalized.startsWith(idLower) && idLower.length() > bestLen) {
                bestId = id;
                bestLen = idLower.length();
            }
        }
        if (bestId != null) {
            return new ModelSelection(bestId, rawValue, true);
        }
        return null;
    }

    /**
     * 撤销「为了让 {@code LlmClientFactory.create} 读到显式模型而先写进 config」那一步。
     *
     * <p>不回滚的后果：{@code /model freellmapi-9 some-model} 打错一次，本次会话的 config 里就
     * 多一个空壳 {@code freellmapi-9}（{@code /model} 空参列表里会看到它，但它没有 key）；provider
     * 名打对而模型名打错时更糟——已有 provider 的 model 被改成一个连不上的串。两种都不落盘
     * （{@code config.save()} 只在切换成功的分支跑），但会污染本次会话。
     */
    static void rollbackModelWrite(WraithConfig config, String provider,
                                   boolean providerExisted, String previousModel) {
        if (config.getProviders() == null) {
            return;
        }
        if (providerExisted) {
            WraithConfig.ProviderConfig existing = config.getProviders().get(provider);
            if (existing != null) {
                existing.setModel(previousModel);
            }
        } else {
            config.getProviders().remove(provider);
        }
    }

    /** 首个空白字符的下标，没有则 {@code -1}。 */
    private static int indexOfWhitespace(String value) {
        for (int i = 0; i < value.length(); i++) {
            if (Character.isWhitespace(value.charAt(i))) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 两参形式里第一段（provider 那段）的解析：<b>已配置的 id 压过别名表</b>。
     *
     * <p>顺序理由与 N4 同源：provider 叫 {@code moonshot} 的人执行
     * {@code /model moonshot kimi-k2.6} 想切的是他自己那个 {@code moonshot}，而别名表会把
     * {@code moonshot} 改写成 {@code kimi}。「用户实际配了什么」是比内置别名更强的信号。
     * 两个都对不上时原样返回小写串——让调用方去报「未配置 X 的 API Key」，比在这里静默改名好。
     */
    private static String resolveProviderToken(String token, WraithConfig config) {
        String lower = token.trim().toLowerCase(Locale.ROOT);
        String configured = configuredProviderIdEqualTo(lower, config);
        if (configured != null) {
            return configured;
        }
        String canonical = com.lyhn.wraith.config.ProviderNames.normalize(lower);
        return canonical == null || canonical.isEmpty() ? lower : canonical;
    }

    /**
     * {@code normalized} 逐字等于某个已配置 provider id 时返回<b>配置里那个原始大小写的 key</b>,
     * 否则 {@code null}。
     *
     * <p>返回原 key 而不是 {@code normalized} 是有意的:{@link ModelSelection#provider()} 会被拿去
     * 索引 {@code config.getProviders()},而那张 map 的 key 是用户写下的原串。此前这条路走的是
     * {@link #resolveModelSelection} 末尾的 {@code canonical} 回落(已被小写化),于是 provider 名叫
     * {@code MyRelay} 的人执行 {@code /model MyRelay} 会拿到 {@code "myrelay"},对不上自己的 key。
     *
     * @see #matchConfiguredProvider 为什么这个检查必须跑在它之前(X2/N4)
     */
    private static String configuredProviderIdEqualTo(String normalized, WraithConfig config) {
        if (config == null || config.getProviders() == null || normalized == null || normalized.isEmpty()) {
            return null;
        }
        for (String id : config.getProviders().keySet()) {
            if (id != null && normalized.equals(id.toLowerCase(Locale.ROOT))) {
                return id;
            }
        }
        return null;
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
     * 常驻固定区内容:字标(6 行)+ 信息行(Wraith / Model / 状态 / 能力,4 行),不含 Tips、不含分隔线。
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

    private static String formatPendingFacts(java.util.List<PendingFact> pending) {
        if (pending == null || pending.isEmpty()) {
            return "📭 暂无待确认候选记忆。会话结束/清空时会自动抽取,批准后才进长期记忆。";
        }
        StringBuilder sb = new StringBuilder("🕵 待确认候选记忆 (" + pending.size() + " 条)：\n");
        for (PendingFact f : pending) {
            sb.append("  • [").append(f.id()).append("] (").append(f.scope()).append(") ").append(f.fact());
            if (f.nearestExistingId() != null && !f.nearestExistingId().isBlank()) {
                sb.append("  ↔ 相似既有: ").append(f.nearestExistingId());
            }
            sb.append('\n');
        }
        sb.append("  批准: /memory approve <id>   替换旧条: /memory approve <id> replace <oldId>\n");
        sb.append("  驳回: /memory reject <id>    清空: /memory pending clear");
        return sb.toString();
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


    record ModelSelection(String provider, String model, boolean explicitModel) {
    }

    record ProviderConfigUpdate(String provider, String apiKey, String baseUrl, String model, String loraId,
                                String protocol, boolean setDefault, String error) {
        static ProviderConfigUpdate error(String error) {
            return new ProviderConfigUpdate(null, null, null, null, null, null, false, error);
        }
    }

    /**
     * provider 探测专用的守护线程池。
     *
     * <p>守护是关键：超时后我们放弃那次调用，但它仍会在后台跑到 OkHttp 的
     * {@code callTimeout}（默认 600s）才结束——非守护线程会把 JVM 退出拖到那时候。
     */
    private static final java.util.concurrent.ExecutorService PROBE_POOL =
            java.util.concurrent.Executors.newCachedThreadPool(r -> {
                Thread t = new Thread(r, "wraith-provider-probe");
                t.setDaemon(true);
                return t;
            });

    /**
     * 探测调用的上限；默认 20 秒，可用 {@code wraith.llm.probe.timeout.seconds} 覆盖。
     *
     * <p>为什么不能沿用 {@code SHARED_HTTP_CLIENT} 的超时：那套是按<b>真实对话</b>调的
     * （connect 60s / read 300s / callTimeout 600s，放这么宽是因为 GLM-5.1 生成大段
     * reasoning_content 时服务端会长时间静默）。而「测试连接」只是发一个 ping，
     * 用 10 分钟去等一个结论毫无意义。
     */
    static long probeTimeoutSeconds() {
        String raw = System.getProperty("wraith.llm.probe.timeout.seconds");
        if (raw != null && !raw.isBlank()) {
            try {
                long v = Long.parseLong(raw.trim());
                if (v > 0) return v;
            } catch (NumberFormatException ignored) {
                // 非法值不该让「测试连接」整条路挂掉,退回默认
            }
        }
        return 20L;
    }

    /**
     * embedding 探测的上限；默认 <b>60</b> 秒，可用 {@code wraith.embed.probe.timeout.seconds} 覆盖。
     *
     * <p><b>为什么不沿用上面那 20 秒</b>：ollama 的<b>首次</b>请求要把模型载进内存，这是 LLM ping
     * 没有的成本。本机实测（M 系列 + NVMe）nomic-embed-text 冷 0.6s / 热 0.06s，
     * bge-m3 冷 2.2s / 热 0.16s —— 这机器上 20 秒绰绰有余，而那正是不该按它定的理由：
     * 用户跑的是 Windows，qwen3-embedding:8b 有 4.7GB，落在机械盘上冷加载几十秒是常态。
     *
     * <p><b>取舍</b>：宁可让人多等，也不要对一个<b>好的</b>后端报「没有响应」——
     * 后者会让人去改一份本来没错的配置。等待期间按钮有转圈，等是看得见的；误报不是。
     */
    static long embedProbeTimeoutSeconds() {
        String raw = System.getProperty("wraith.embed.probe.timeout.seconds");
        if (raw != null && !raw.isBlank()) {
            try {
                long v = Long.parseLong(raw.trim());
                if (v > 0) return v;
            } catch (NumberFormatException ignored) {
                // 非法值不该让「测试连接」整条路挂掉,退回默认
            }
        }
        return 60L;
    }

    /**
     * 给探测调用套一个超时；超时返回 {@code {ok:false,error}} 而不是把调用方吊死。
     *
     * <p><b>已知残留</b>：超时返回后那次 OkHttp 调用仍在后台跑到 {@code callTimeout} ——
     * OkHttp 的 socket 读不响应线程中断，而 {@code LlmClient} 接口没有暴露 {@code Call}
     * 句柄可以取消。线程是守护线程、不阻塞退出，代价可接受；根治要给 LlmClient 加逐次调用的
     * 超时钩子，那要动所有 client 实现。
     */
    static java.util.Map<String, Object> awaitProbe(
            java.util.concurrent.Callable<java.util.Map<String, Object>> probe, long timeoutSeconds) {
        java.util.concurrent.Future<java.util.Map<String, Object>> future = PROBE_POOL.submit(probe);
        try {
            return future.get(timeoutSeconds, java.util.concurrent.TimeUnit.SECONDS);
        } catch (java.util.concurrent.TimeoutException e) {
            future.cancel(true);
            return java.util.Map.of("ok", false, "error", timeoutSeconds
                    + " 秒内没有响应 —— baseUrl 可能能连上但不回应（路径写错 / 防火墙丢包）。"
                    + "请检查 baseUrl 与网络；确实需要更长时间可设 -Dwraith.llm.probe.timeout.seconds");
        } catch (Exception e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            String m = cause.getMessage();
            return java.util.Map.of("ok", false,
                    "error", m == null || m.isBlank() ? cause.getClass().getSimpleName() : m);
        }
    }

    record SearchConfigUpdate(String provider, String apiKey, String baseUrl, String error) {
        static SearchConfigUpdate error(String error) {
            return new SearchConfigUpdate(null, null, null, error);
        }
    }

    /**
     * {@code /config} 写完后要刷新的活对象。
     *
     * <p>此前这里是 {@code ToolRegistry}（search 那条线为了失效搜索缓存加的），
     * 但 pricing 要刷的是 {@code Agent} 的计价表——继续往签名上加参数会一路长下去。
     * 收成一个回调：REPL 传一个 lambda 同时做两件事。
     */
    interface ConfigReloadHook {
        void afterConfigWrite(WraithConfig config);
    }

    enum PricingAction { LIST, UPSERT, REMOVE }

    record PricingConfigUpdate(PricingAction action, String modelPrefix,
                               double cacheHitPerM, double cacheMissPerM, double outputPerM,
                               String currency, String error) {
        static PricingConfigUpdate error(String error) {
            return new PricingConfigUpdate(null, null, 0, 0, 0, null, error);
        }
    }

    private record MemorySaveRequest(String fact, String scope) {
    }
}
