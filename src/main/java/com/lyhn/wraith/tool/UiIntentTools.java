package com.lyhn.wraith.tool;

import com.lyhn.wraith.llm.LlmClient;

import java.util.List;
import java.util.Set;

/**
 * UI 意图工具(open_panel / im_connect / present_options)—— 它们没有文件/命令副作用,
 * 需要在所有模式下贯通到渲染层。
 *
 * - open_panel / im_connect:让桌面渲染层把 tool.call 特判成可交互动作卡,不依赖 tool.result。
 * - present_options:阻塞等待用户选择,依赖 tool.result(返回选中 label 或 __cancelled__)。
 *   Plan/Team 路径放行它是为了让 CLI 模式 SubAgent 经 ToolRegistry 执行时能拿到 result;
 *   app-server 模式下 promptChoice 走 default 返回 cancelled,worker 拿 __cancelled__ 降级。
 *
 * Plan/Team 模式的执行器只放行这三个工具的 tool.call 事件:前两者被归约成 action / im-bind
 * transcript 项;present_options 在 CLI 路径产出 result。放行其它普通工具会让 ToolCard
 * 永久停在「运行中」(Plan/Team 路径不产出 tool.result)。
 */
public final class UiIntentTools {
    private UiIntentTools() {}

    /** 需要在所有模式下贯通到渲染层的工具名。 */
    public static final Set<String> NAMES = Set.of("open_panel", "im_connect", "present_options");

    /** 只保留 UI 意图工具的调用;null/空/畸形(function 为 null)安全。 */
    public static List<LlmClient.ToolCall> filter(List<LlmClient.ToolCall> calls) {
        if (calls == null || calls.isEmpty()) {
            return List.of();
        }
        return calls.stream()
                .filter(c -> c != null && c.function() != null && NAMES.contains(c.function().name()))
                .toList();
    }
}
