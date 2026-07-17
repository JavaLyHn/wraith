package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.memory.TokenBudget;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Tier 1 Snip:保护区外、可压工具输出截短 + 用户超大代码块截短。零 LLM。
 * 破坏性原地改写 + SNIP_MARK 尾标 → 见标跳过,单调免费(spec §2)。
 */
public final class SnipPass {
    public record Change(int index, String tool, long releasedEstTokens, String logPath) {}
    public record Result(List<Change> changes, long releasedEstTokens) {}

    private static final Pattern FENCE = Pattern.compile("```[^\\n]*\\n(.*?)```", Pattern.DOTALL);
    private static final Pattern POINTER_LINE =
            Pattern.compile("^" + Pattern.quote(CurationMarks.LOG_POINTER_PREFIX) + ".*\\]$", Pattern.MULTILINE);

    private SnipPass() {}

    public static Result apply(List<Message> history, int protectedFrom, ToolTierPolicy policy, long releaseTarget) {
        List<Change> changes = new ArrayList<>();
        long released = 0;
        Map<String, String> toolNames = ProtectionBoundary.toolNamesById(history);
        int systemEnd = !history.isEmpty() && "system".equals(history.get(0).role()) ? 1 : 0;

        for (int i = systemEnd; i < Math.min(protectedFrom, history.size()) && released < releaseTarget; i++) {
            Message m = history.get(i);
            String content = m.content();
            if (content == null || content.contains(CurationMarks.SNIP_MARK)) continue;

            if ("tool".equals(m.role())) {
                String tool = toolNames.get(m.toolCallId());
                if (!policy.compressible(tool) || content.length() <= ToolTierPolicy.SNIP_MIN_CHARS) continue;
                String pointer = extractPointer(content);
                String rebuilt = content.substring(0, ToolTierPolicy.SNIP_KEEP_HEAD_CHARS)
                        + "\n" + CurationMarks.SNIP_MARK + "[原 " + content.length() + " 字符已截]"
                        + (pointer == null ? "" : "\n" + pointer);
                long delta = estimate(content) - estimate(rebuilt);
                history.set(i, Message.tool(m.toolCallId(), rebuilt));
                released += Math.max(0, delta);
                changes.add(new Change(i, tool, Math.max(0, delta), pointer));
            } else if ("user".equals(m.role())) {
                if (m.contentParts() != null) continue;  // 图片消息整条跳过(spec §11)
                String rebuilt = clipCodeblocks(content);
                if (rebuilt.equals(content)) continue;
                long delta = estimate(content) - estimate(rebuilt);
                history.set(i, Message.user(rebuilt));
                released += Math.max(0, delta);
                changes.add(new Change(i, null, Math.max(0, delta), null));
            }
        }
        return new Result(changes, released);
    }

    private static String extractPointer(String content) {
        Matcher m = POINTER_LINE.matcher(content);
        return m.find() ? m.group() : null;
    }

    /** 只截 fenced 代码块,块外文本逐字不动(用户纯文本红线)。 */
    private static String clipCodeblocks(String content) {
        Matcher m = FENCE.matcher(content);
        StringBuilder out = new StringBuilder();
        int last = 0;
        while (m.find()) {
            String body = m.group(1);
            long lines = body.lines().count();
            out.append(content, last, m.start());
            if (lines >= ToolTierPolicy.CODEBLOCK_MIN_LINES) {
                String head = body.lines().limit(ToolTierPolicy.CODEBLOCK_KEEP_LINES)
                        .reduce("", (a, b) -> a + b + "\n");
                String fenceHeader = content.substring(m.start(), content.indexOf('\n', m.start()) + 1);
                out.append(fenceHeader).append(head)
                        .append("…").append(CurationMarks.SNIP_MARK)
                        .append("[代码块原 ").append(lines).append(" 行已截]\n```");
            } else {
                out.append(content, m.start(), m.end());
            }
            last = m.end();
        }
        out.append(content.substring(last));
        return out.toString();
    }

    private static long estimate(String text) {
        return TokenBudget.estimateMessagesTokens(List.of(Message.user(text)));
    }
}
