package com.lyhn.wraith.render;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lyhn.wraith.hitl.ApprovalPolicy;
import com.lyhn.wraith.hitl.ApprovalRequest;
import com.lyhn.wraith.hitl.ApprovalResult;
import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.tool.todo.TodoItem;
import com.lyhn.wraith.tool.todo.TodoStatus;
import com.lyhn.wraith.util.AnsiStyle;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Plain 渲染器：纯 println 模式，等价 phase-15 行为，无折叠、无状态栏。
 *
 * <p>同时充当 inline / lanterna 两套实现的回退基线——任何高级特性都退化成普通文本。
 */
public final class PlainRenderer implements Renderer {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final PrintStream out;
    private final BufferedReader in;

    public PlainRenderer() {
        this(System.out, new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)));
    }

    PlainRenderer(PrintStream out, BufferedReader in) {
        this.out = out;
        this.in = in;
    }

    @Override
    public void start() {
        // no-op
    }

    @Override
    public void close() {
        // no-op：不接管 System.out / System.in，启动者自己管生命周期
    }

    @Override
    public PrintStream stream() {
        return out;
    }

    @Override
    public void appendToolCalls(List<LlmClient.ToolCall> toolCalls) {
        if (toolCalls == null || toolCalls.isEmpty()) {
            return;
        }
        Map<String, List<LlmClient.ToolCall>> grouped = new LinkedHashMap<>();
        for (LlmClient.ToolCall tc : toolCalls) {
            grouped.computeIfAbsent(tc.function().name(), k -> new ArrayList<>()).add(tc);
        }
        for (var group : grouped.entrySet()) {
            String toolName = group.getKey();
            List<LlmClient.ToolCall> calls = group.getValue();
            out.println(AnsiStyle.subtle("  " + toolLabel(toolName, calls.size())));
            for (LlmClient.ToolCall tc : calls) {
                String detail = extractKeyParam(toolName, tc.function().arguments());
                if (!detail.isEmpty()) {
                    out.println(AnsiStyle.subtle("    └ " + detail));
                }
            }
        }
    }

    @Override
    public void appendDiff(String filePath, String before, String after) {
        out.println();
        out.println(AnsiStyle.heading("📝 " + (filePath == null ? "(unnamed)" : filePath)));
        if (before == null && after != null) {
            out.println(AnsiStyle.subtle("  (新建文件，" + after.length() + " 字符)"));
            return;
        }
        if (before != null && after == null) {
            out.println(AnsiStyle.subtle("  (删除文件)"));
            return;
        }
        // Day 4 才做行内 diff；plain 模式只打印长度变化提示。
        int beforeLen = before == null ? 0 : before.length();
        int afterLen = after == null ? 0 : after.length();
        out.println(AnsiStyle.subtle("  " + beforeLen + " → " + afterLen + " 字符"));
    }

    @Override
    public void renderTodos(List<TodoItem> todos) {
        printTodos(out, todos);
    }

    /** 纯文本打印任务清单(plain 形态;inline degraded 无 dock 时也复用)。 */
    public static void printTodos(PrintStream out, List<TodoItem> todos) {
        if (todos == null || todos.isEmpty()) {
            return;
        }
        long done = todos.stream().filter(t -> t.status() == TodoStatus.COMPLETED).count();
        out.println(AnsiStyle.heading("Tasks " + done + "/" + todos.size()));
        for (TodoItem t : todos) {
            String marker = switch (t.status()) {
                case COMPLETED -> "[x]";
                case IN_PROGRESS -> "[>]";
                case PENDING -> "[ ]";
            };
            out.println("  " + marker + " " + t.content());
        }
        out.println();
    }

    @Override
    public void updateStatus(StatusInfo status) {
        // plain 模式没有状态栏
    }

    @Override
    public ApprovalResult promptApproval(ApprovalRequest request) {
        boolean sensitive = request.sensitiveNotice() != null && !request.sensitiveNotice().isBlank();
        out.println();
        out.println("────────── ⚠️  HITL 审批请求 ──────────");
        if (sensitive) {
            out.println("⚠️  " + request.sensitiveNotice());
        }
        out.println(request.toDisplayText());

        // 首选项走统一的 promptChoice（编号列表 + 数字输入），不再走单字符重试循环。
        // 非敏感：[批准, 全部放行, 拒绝, 跳过, 修改参数]（索引 0-4）
        // 敏感：  [批准, 拒绝, 跳过, 修改参数]（索引 0-3，无全部放行）
        List<ChoiceOption> options = new ArrayList<>();
        options.add(new ChoiceOption("批准", null));
        if (!sensitive) {
            options.add(new ChoiceOption("全部放行", null));
        }
        options.add(new ChoiceOption("拒绝", null));
        options.add(new ChoiceOption("跳过", null));
        options.add(new ChoiceOption("修改参数", null));

        ChoiceResult choice = this.promptChoice(new ChoiceRequest("HITL 审批", options, false, null));
        if (choice.isCancelled()) {
            out.println("  [HITL] 用户取消，保守处理为拒绝");
            return ApprovalResult.reject("用户取消");
        }

        int idx = choice.selectedIndex();
        int approveIdx = 0;
        int approveAllIdx = sensitive ? -1 : 1;
        int rejectIdx = sensitive ? 1 : 2;
        int skipIdx = sensitive ? 2 : 3;
        int modifyIdx = sensitive ? 3 : 4;

        if (idx == approveIdx) {
            out.println("  已批准");
            return ApprovalResult.approve();
        }
        if (idx == approveAllIdx && approveAllIdx >= 0) {
            return promptApproveAllScope(request);
        }
        if (idx == rejectIdx) {
            out.print("  拒绝原因（可直接回车跳过）：");
            out.flush();
            String reason;
            try {
                reason = in.readLine();
            } catch (IOException e) {
                reason = "";
            }
            return ApprovalResult.reject(reason == null ? "" : reason.trim());
        }
        if (idx == skipIdx) {
            out.println("  已跳过本次操作");
            return ApprovalResult.skip();
        }
        if (idx == modifyIdx) {
            // 子流程返回 null（非法 JSON / IO 失败）时无重试循环可回退，保守改为批准原参数，
            // 与 InlineApprovalPrompter 的 modify 路径行为一致。
            ApprovalResult modified = promptModifiedArguments(request);
            return modified != null ? modified : ApprovalResult.approve();
        }
        return ApprovalResult.reject("未识别的选择");
    }

    @Override
    public ChoiceResult promptChoice(ChoiceRequest request) {
        if (request == null || request.options() == null || request.options().isEmpty()) {
            return ChoiceResult.cancelled();
        }
        out.println();
        out.println(AnsiStyle.heading("📋 " + (request.title() == null ? "请选择" : request.title())));
        for (int i = 0; i < request.options().size(); i++) {
            ChoiceOption opt = request.options().get(i);
            out.printf("  [%d] %s%n", i + 1, opt.label());
            if (opt.description() != null && !opt.description().isBlank()) {
                out.println("      " + AnsiStyle.subtle(opt.description()));
            }
        }
        out.print("> ");
        out.flush();
        try {
            String line = in.readLine();
            if (line == null || line.isBlank()) {
                return ChoiceResult.cancelled();
            }
            int idx = Integer.parseInt(line.trim()) - 1;
            if (idx >= 0 && idx < request.options().size()) {
                return ChoiceResult.selected(idx);
            }
            return ChoiceResult.cancelled();
        } catch (IOException | NumberFormatException e) {
            return ChoiceResult.cancelled();
        }
    }

    private ApprovalResult promptApproveAllScope(ApprovalRequest request) {
        String mcpServer = ApprovalPolicy.mcpServerName(request.toolName());
        if (mcpServer == null || mcpServer.isBlank()) {
            out.println("  已批准，后续 " + request.toolName() + " 操作将自动通过");
            return ApprovalResult.approveAll();
        }

        out.println("  全部放行范围：");
        out.println("  [tool / Enter] 仅本工具 " + request.toolName());
        out.println("  [server]       整个 MCP server " + mcpServer + "（连续浏览器操作推荐）");
        out.print("> ");
        out.flush();
        String scope;
        try {
            scope = in.readLine();
        } catch (IOException e) {
            out.println("  读取范围失败，默认按工具维度放行");
            scope = "";
        }
        String normalized = scope == null ? "" : scope.trim().toLowerCase();
        if ("server".equals(normalized) || "s".equals(normalized)) {
            out.println("  已批准，后续 MCP server " + mcpServer + " 的工具调用将自动通过");
            return ApprovalResult.approveAllByServer();
        }
        out.println("  已批准，后续 " + request.toolName() + " 操作将自动通过");
        return ApprovalResult.approveAll();
    }

    private ApprovalResult promptModifiedArguments(ApprovalRequest request) {
        out.println("  当前参数：" + request.arguments());
        out.print("  请输入修改后的参数（JSON 格式，空行则使用原始参数）：");
        out.flush();

        String modified;
        try {
            modified = in.readLine();
        } catch (IOException e) {
            out.println("  读取失败，回到主菜单");
            return null;
        }
        if (modified == null || modified.isBlank()) {
            out.println("  输入为空，改为批准原始参数");
            return ApprovalResult.approve();
        }

        String trimmed = modified.trim();
        try {
            JSON.readTree(trimmed);
        } catch (Exception e) {
            out.println("  ❌ 修改后的参数不是合法 JSON：" + e.getMessage());
            return null;
        }
        return ApprovalResult.modify(trimmed);
    }

    // ---- 工具标签格式化（与 Agent.printToolCalls 保持一致） ----

    private static String toolLabel(String toolName, int count) {
        return switch (toolName) {
            case "read_file" -> "📖 读取 " + count + " 个文件";
            case "write_file" -> "✏️ 写入 " + count + " 个文件";
            case "list_dir" -> "📂 列出 " + count + " 个目录";
            case "execute_command" -> "⚡ 执行 " + count + " 条命令";
            case "create_project" -> "🏗️ 创建 " + count + " 个项目";
            case "search_code" -> "🔍 搜索代码 " + count + " 次";
            case "web_search" -> "🌐 联网搜索 " + count + " 次";
            case "web_fetch" -> "📰 抓取 " + count + " 个网页";
            case "save_memory" -> "💾 保存长期记忆 " + count + " 条";
            default -> toolName != null && toolName.startsWith("mcp__")
                    ? formatMcpLabel(toolName, count)
                    : "🔧 " + toolName + " × " + count;
        };
    }

    private static String formatMcpLabel(String toolName, int count) {
        String[] parts = toolName.split("__", 3);
        String display = parts.length == 3 ? parts[1] + "." + parts[2] : toolName;
        return count == 1
                ? "🔌 调用 MCP 工具 " + display
                : "🔌 调用 MCP 工具 " + display + " × " + count;
    }

    private static String extractKeyParam(String toolName, String argsJson) {
        try {
            JsonNode node = JSON.readTree(argsJson);
            String key = switch (toolName) {
                case "read_file", "write_file", "list_dir" -> "path";
                case "execute_command" -> "command";
                case "create_project" -> "name";
                case "search_code", "web_search" -> "query";
                case "web_fetch" -> "url";
                case "save_memory" -> "fact";
                default -> null;
            };
            if (key == null) {
                return argsJson.length() > 80 ? argsJson.substring(0, 77) + "..." : argsJson;
            }
            String value = node.path(key).asText("");
            if (value.length() > 80) {
                value = value.substring(0, 77) + "...";
            }
            return value;
        } catch (Exception e) {
            return argsJson.length() > 80 ? argsJson.substring(0, 77) + "..." : argsJson;
        }
    }
}
