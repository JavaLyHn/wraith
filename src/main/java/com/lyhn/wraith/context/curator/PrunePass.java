package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.memory.TokenBudget;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Tier 2 Prune:snip 产物→占位符;老 assistant 长文裁前两句。零 LLM,同样尾标单调。 */
public final class PrunePass {
    private static final Pattern POINTER_LINE =
            Pattern.compile("^" + Pattern.quote(CurationMarks.LOG_POINTER_PREFIX) + ".*\\]$", Pattern.MULTILINE);
    private static final Pattern SENTENCE_END = Pattern.compile("[。.!?\\n]");

    private PrunePass() {}

    public static SnipPass.Result apply(List<Message> history, int protectedFrom,
                                        ToolTierPolicy policy, long releaseTarget) {
        List<SnipPass.Change> changes = new ArrayList<>();
        long released = 0;
        Map<String, String> toolNames = ProtectionBoundary.toolNamesById(history);
        int systemEnd = !history.isEmpty() && "system".equals(history.get(0).role()) ? 1 : 0;

        for (int i = systemEnd; i < Math.min(protectedFrom, history.size()) && released < releaseTarget; i++) {
            Message m = history.get(i);
            String content = m.content();
            if (content == null || content.contains(CurationMarks.PRUNE_MARK)) continue;

            if ("tool".equals(m.role()) && content.contains(CurationMarks.SNIP_MARK)) {
                String tool = toolNames.get(m.toolCallId());
                if (!policy.compressible(tool)) continue;
                Matcher p = POINTER_LINE.matcher(content);
                String rebuilt = "[工具输出已压缩]" + CurationMarks.PRUNE_MARK
                        + (p.find() ? "\n" + p.group() : "");
                long delta = estimate(content) - estimate(rebuilt);
                history.set(i, Message.tool(m.toolCallId(), rebuilt));
                released += Math.max(0, delta);
                changes.add(new SnipPass.Change(i, tool, Math.max(0, delta), null));
            } else if ("assistant".equals(m.role())
                    && content.length() > ToolTierPolicy.ASSISTANT_PRUNE_MIN_CHARS) {
                String rebuilt = firstSentences(content) + "…[truncated]" + CurationMarks.PRUNE_MARK;
                long delta = estimate(content) - estimate(rebuilt);
                history.set(i, Message.assistant(rebuilt, m.toolCalls()));
                released += Math.max(0, delta);
                changes.add(new SnipPass.Change(i, null, Math.max(0, delta), null));
            }
        }
        return new SnipPass.Result(changes, released);
    }

    private static String firstSentences(String text) {
        Matcher m = SENTENCE_END.matcher(text);
        int end = -1;
        for (int hits = 0; m.find() && hits < 2 && m.end() <= 240; hits++) end = m.end();
        return text.substring(0, end > 0 ? end : Math.min(240, text.length()));
    }

    private static long estimate(String text) {
        return TokenBudget.estimateMessagesTokens(List.of(Message.user(text)));
    }
}
