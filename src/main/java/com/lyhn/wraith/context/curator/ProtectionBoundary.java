package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.llm.LlmClient.ToolCall;
import com.lyhn.wraith.memory.TokenBudget;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 保护区:尾部累计 token 预算外扩到 user 边界,且至少最近 2 个完整 user 轮(spec §5)。 */
public final class ProtectionBoundary {
    private ProtectionBoundary() {}

    public static long protectedBudget(long window) {
        long dflt = Math.min(12_000, Math.max(1, window / 4));
        try {
            String v = System.getProperty("wraith.context.protect");
            return v == null ? dflt : Long.parseLong(v);
        } catch (NumberFormatException e) {
            return dflt;
        }
    }

    /** 返回保护区起始索引(含):[from, size) 任何 pass 不得改写。 */
    public static int protectedFrom(List<Message> history, long budget) {
        int systemEnd = !history.isEmpty() && "system".equals(history.get(0).role()) ? 1 : 0;
        if (history.size() <= systemEnd) return systemEnd;

        long acc = 0;
        int idx = history.size();
        for (int i = history.size() - 1; i >= systemEnd; i--) {
            acc += TokenBudget.estimateMessagesTokens(List.of(history.get(i)));
            idx = i;
            if (acc >= budget) break;
        }
        // 外扩到 user 边界(含该 user):仅向前检查一条消息是否直接是 user,
        // 避免跨多轮追溯把整段工具交互轮全部纳入保护区。
        int anchor = idx;
        if (anchor > systemEnd && "user".equals(history.get(anchor - 1).role())) {
            anchor = anchor - 1;
        } else if ("user".equals(history.get(anchor).role())) {
            // anchor 本身已经是 user,保持不变
        } else {
            // 当前位置不是 user、且前驱也不是 user:不外扩,保持 idx
        }

        // 至少最近 2 个 user 轮(仅在历史有超过 2 个 user 时才向前扩展)
        // 若仅有 2 个 user,整段历史本属同一任务对话,不强制回退到最老的 user
        List<Integer> users = new ArrayList<>();
        for (int i = systemEnd; i < history.size(); i++) {
            if ("user".equals(history.get(i).role())) users.add(i);
        }
        if (users.size() > 2) anchor = Math.min(anchor, users.get(users.size() - 2));
        else if (users.size() == 1) anchor = Math.min(anchor, users.get(0));

        return Math.max(anchor, systemEnd);
    }

    /** assistant.toolCalls 建 id→工具名映射,供 pass 对 tool 消息判豁免。 */
    public static Map<String, String> toolNamesById(List<Message> history) {
        Map<String, String> m = new HashMap<>();
        for (Message msg : history) {
            if (msg.toolCalls() == null) continue;
            for (ToolCall tc : msg.toolCalls()) {
                if (tc.id() != null && tc.function() != null) m.put(tc.id(), tc.function().name());
            }
        }
        return m;
    }
}
