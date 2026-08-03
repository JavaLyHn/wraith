package com.lyhn.wraith.prompt;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

public class PromptAssembler {
    private final PromptRepository repository;

    public PromptAssembler(PromptRepository repository) {
        this.repository = Objects.requireNonNull(repository);
    }

    public static PromptAssembler createDefault() {
        return new PromptAssembler(PromptRepository.createDefault());
    }

    public String assemble(PromptMode mode, PromptContext context) {
        Objects.requireNonNull(mode, "mode");
        PromptContext ctx = context == null ? PromptContext.empty() : context;

        String base = repository.loadRequired("base.md");
        if (!ctx.toolsEnabled()) {
            base = stripToolSections(base);
        }
        validateLanguageSection(base, "base.md");

        StringBuilder prompt = new StringBuilder();
        append(prompt, base);
        if (!ctx.toolsEnabled()) {
            append(prompt, noToolsSection());
        }
        append(prompt, repository.loadRequired("capabilities.md"));
        append(prompt, repository.loadRequired("personalities/calm.md"));
        append(prompt, applyVariables(repository.loadRequired(mode.resourcePath()), ctx));
        append(prompt, repository.loadRequired("approvals/" + approvalMode(ctx) + ".md"));
        append(prompt, runtimeContext(mode));
        append(prompt, dynamicSection("Project Context", ctx.projectMemoryContext(), ctx.memoryContext(),
                ctx.externalContext()));
        append(prompt, dynamicSection("Skills", ctx.skillIndex()));
        append(prompt, repository.loadRequired("context/context-management.md"));
        append(prompt, repository.loadRequired("handoff.md"));

        String assembled = prompt.toString().trim();
        validateLanguageSection(assembled, "assembled prompt");
        return assembled;
    }

    private String approvalMode(PromptContext context) {
        String mode = context.approvalMode();
        if (mode == null || mode.isBlank()) {
            return "suggest";
        }
        String normalized = mode.trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "auto", "never" -> normalized;
            default -> "suggest";
        };
    }

    private static String runtimeContext(PromptMode mode) {
        ZoneId zone = ZoneId.systemDefault();
        return runtimeContext(LocalDate.now(zone).toString(), zone.toString(),
                System.getProperty("os.name", ""), mode);
    }

    /** 旧三参重载：不声明模式。保留给既有调用方与测试。 */
    static String runtimeContext(String date, String zone, String osName) {
        return runtimeContext(date, zone, osName, null);
    }

    /**
     * 可测版本。
     *
     * <p><b>为什么要告诉模型 shell 是什么：</b>{@code execute_command} 在 Windows 上走
     * {@code cmd.exe /c}（而不是此前写死的 {@code bash -c}——那在 Windows 上是赌
     * {@code bash.exe} 恰好在 PATH）。模型若不知道这件事，会照 POSIX 习惯吐
     * {@code ls -la} / {@code rm -rf build}，然后拿一堆「不是内部或外部命令」回来，
     * 白白烧掉几轮往返才自己纠正过来。
     *
     * <p><b>为什么要告诉模型当前是哪个运行模式：</b>此前 prompt 语料里<b>没有任何地方</b>
     * 说这件事（唯一沾边的是 {@code modes/agent.md} 里一句静态的「你在默认 ReAct 模式下工作」）。
     * 而对话历史里<b>有</b>强信号：Plan / Team 模式下问一个问题会撞 NoPlanException，
     * 那段「把模式切回 ReAct 再问一次」会被写进历史。此后哪怕用户切回了 ReAct，模型看到
     * 历史里那段具体的话，就会对用户宣布「我注意到你当前处于 Plan 模式」—— 一句错的事实陈述。
     * 所以这里不仅要报现值，还要<b>显式作废历史里的模式说法</b>。
     */
    static String runtimeContext(String date, String zone, String osName, PromptMode mode) {
        boolean win = com.lyhn.wraith.policy.sandbox.ShellCommand.isWindows(osName);
        StringBuilder sb = new StringBuilder("## Runtime Context\n\n");
        sb.append("- 当前日期: ").append(date).append('\n');
        sb.append("- 当前时区: ").append(zone).append('\n');
        sb.append("- 操作系统: ").append(osName == null || osName.isBlank() ? "未知" : osName).append('\n');
        if (mode != null) {
            sb.append("- 当前运行模式: **").append(mode.displayName()).append("**")
                    .append("（用户可在输入框**右下角**的模式选择器切换 ReAct / Plan / Team）。")
                    .append("对话历史里可能出现关于模式的说明或提示（例如「把模式切回 ReAct 再问一次」），")
                    .append("那是**过去某一回合**的记录，**不代表现在**；判断当前模式只依据本行，")
                    .append("也不要主动向用户宣布他处于哪个模式，除非他问起。\n");
        }
        if (win) {
            sb.append("- `execute_command` 的 shell 是 **cmd.exe**（Windows）。"
                    + "请用 Windows 命令：`dir` 而非 `ls`，`type` 而非 `cat`，"
                    + "`del` / `rd /s /q` 而非 `rm -rf`，`copy` 而非 `cp`，"
                    + "路径分隔符用 `\\`，环境变量写 `%VAR%`。"
                    + "命令之间用 `&&` 串联；不要使用管道进 `sh`/`bash` 的写法。");
        } else {
            sb.append("- `execute_command` 的 shell 是 **bash**。");
        }
        return sb.toString();
    }

    private static String applyVariables(String template, PromptContext context) {
        String result = template;
        for (Map.Entry<String, String> entry : context.variables().entrySet()) {
            result = result.replace("{{" + entry.getKey() + "}}", entry.getValue());
        }
        result = result.replace("{{taskType}}", context.variable("taskType"));
        result = result.replace("{{taskDescription}}", context.variable("taskDescription"));
        return result;
    }

    private static String dynamicSection(String title, String... values) {
        StringBuilder body = new StringBuilder();
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                if (!body.isEmpty()) {
                    body.append("\n\n");
                }
                body.append(value.trim());
            }
        }
        if (body.isEmpty()) {
            return "";
        }
        return "## " + title + "\n\n" + body;
    }

    private static String stripToolSections(String base) {
        String withoutTools = base.replaceFirst("(?s)\\n## Tools\\n.*?(?=\\n## Browser Policy\\n)", "\n");
        return withoutTools.replaceFirst("(?s)\\n## Tool Policy\\n.*?(?=\\n## Browser Policy\\n)", "\n");
    }

    private static String noToolsSection() {
        return """
                ## Tool Availability

                当前模型不支持 Wraith 原生工具调用。本轮不要声称已经读取、搜索、执行或修改了任何本地文件、命令、浏览器、MCP resource 或外部工具结果。

                绝对不要输出伪造的工具标签或 XML，例如 `<toolcall>`、`<read_file>`、`<list_dir>`。如果用户请求必须依赖本地文件、代码搜索、命令执行或联网工具，请直接说明当前 provider 不支持工具调用，并提示切换到支持 tools 的 provider 后重试。
                """;
    }

    private static void append(StringBuilder sb, String section) {
        if (section == null || section.isBlank()) {
            return;
        }
        if (!sb.isEmpty()) {
            sb.append("\n\n");
        }
        sb.append(section.trim());
    }

    private static void validateLanguageSection(String prompt, String source) {
        if (prompt == null || !prompt.contains("## Language")) {
            throw new IllegalStateException("Prompt " + source + " must contain a '## Language' section");
        }
    }
}
