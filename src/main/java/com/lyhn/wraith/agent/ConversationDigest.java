package com.lyhn.wraith.agent;

import com.lyhn.wraith.llm.LlmClient;

import java.util.ArrayList;
import java.util.List;

/**
 * 从 ReAct 主线 conversationHistory 生成有界的「近期对话」摘录,供 Plan/Team 的
 * 决策入口(计划生成 / planner)理解「继续/它/上面」等指代。纯函数、确定性、无 LLM 调用。
 */
public final class ConversationDigest {

    public static final int DEFAULT_MAX_ROUNDS = 4;
    public static final int DEFAULT_MAX_CHARS = 2500;
    public static final int TOOL_RESULT_PREVIEW_CHARS = 200;
    public static final int TOOL_ARGS_PREVIEW_CHARS = 120;

    public static final String INJECT_PREFIX =
            "对话上下文(来自主线会话,供理解『继续/它/上面』等指代):\n";

    private static final String TRUNCATED_NOTE = "(仅显示最近若干轮)";

    private ConversationDigest() {}

    public static String of(List<LlmClient.Message> history) {
        return of(history, DEFAULT_MAX_ROUNDS, DEFAULT_MAX_CHARS);
    }

    public static String of(List<LlmClient.Message> history, int maxRounds, int maxChars) {
        if (history == null || history.isEmpty()) {
            return "";
        }
        // 1. 分轮:一轮从 user 消息开始,含其后到下一条 user 前的 assistant/tool。跳过 system。
        List<List<LlmClient.Message>> rounds = new ArrayList<>();
        List<LlmClient.Message> current = null;
        for (LlmClient.Message m : history) {
            String role = m.role();
            if ("system".equals(role)) {
                continue;
            }
            if ("user".equals(role)) {
                current = new ArrayList<>();
                current.add(m);
                rounds.add(current);
            } else if (current != null) {
                current.add(m);
            }
        }
        if (rounds.isEmpty()) {
            return "";
        }
        // 2. 只保留最近 maxRounds 轮
        boolean truncated = rounds.size() > maxRounds;
        List<List<LlmClient.Message>> kept =
                new ArrayList<>(rounds.subList(Math.max(0, rounds.size() - maxRounds), rounds.size()));
        List<String> rendered = new ArrayList<>();
        for (List<LlmClient.Message> r : kept) {
            rendered.add(renderRound(r));
        }
        // 3. 字符封顶:从最旧保留轮起整轮丢弃,直到不超(至少留 1 轮)
        while (rendered.size() > 1
                && totalLen(rendered) + (truncated ? TRUNCATED_NOTE.length() + 1 : 0) > maxChars) {
            rendered.remove(0);
            truncated = true;
        }
        StringBuilder sb = new StringBuilder();
        if (truncated) {
            sb.append(TRUNCATED_NOTE).append("\n");
        }
        for (int i = 0; i < rendered.size(); i++) {
            if (i > 0) {
                sb.append("\n");
            }
            sb.append(rendered.get(i));
        }
        String out = sb.toString();
        if (out.length() > maxChars) {
            out = out.substring(0, maxChars); // 单轮就超时的硬兜底
        }
        return out.strip();
    }

    /** 注入辅助:空/空白 ctx 返回 base(引用不变,保证零回归);否则前缀 + ctx + 空行 + base。 */
    public static String prepend(String conversationContext, String baseBody) {
        if (conversationContext == null || conversationContext.isBlank()) {
            return baseBody;
        }
        return INJECT_PREFIX + conversationContext + "\n\n" + baseBody;
    }

    private static int totalLen(List<String> parts) {
        int n = 0;
        for (String p : parts) {
            n += p.length() + 1;
        }
        return n;
    }

    private static String renderRound(List<LlmClient.Message> round) {
        StringBuilder sb = new StringBuilder();
        for (LlmClient.Message m : round) {
            switch (m.role()) {
                case "user" -> sb.append("用户: ").append(safeTrim(m.content())).append("\n");
                case "assistant" -> {
                    if (m.content() != null && !m.content().isBlank()) {
                        sb.append("助手: ").append(safeTrim(m.content())).append("\n");
                    }
                    if (m.toolCalls() != null) {
                        for (LlmClient.ToolCall tc : m.toolCalls()) {
                            sb.append("[工具 ").append(tc.function().name()).append(": ")
                              .append(preview(tc.function().arguments(), TOOL_ARGS_PREVIEW_CHARS))
                              .append("]\n");
                        }
                    }
                }
                case "tool" -> sb.append("  ↳ 结果: ")
                        .append(preview(m.content(), TOOL_RESULT_PREVIEW_CHARS)).append("\n");
                default -> { /* 其它角色忽略 */ }
            }
        }
        return sb.toString().stripTrailing();
    }

    private static String safeTrim(String s) {
        return s == null ? "" : s.strip();
    }

    private static String preview(String s, int max) {
        if (s == null) {
            return "";
        }
        String t = s.strip().replaceAll("\\s+", " ");
        return t.length() <= max ? t : t.substring(0, max) + "…";
    }
}
