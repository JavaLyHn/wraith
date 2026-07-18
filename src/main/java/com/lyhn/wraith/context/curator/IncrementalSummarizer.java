package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Supplier;

/**
 * Tier3 增量活摘要(spec §1/§2.1):history 驻留一条 SUMMARY_MARK 活摘要,
 * 触发时 LLM 输入 = 旧活摘要 + delta(最老优先、user 边界切、超预算分批),
 * 合并出新活摘要替换旧摘要并删除已吞 delta。失败/空摘要即放弃原样保留。
 */
public class IncrementalSummarizer {
    private static final Logger log = LoggerFactory.getLogger(IncrementalSummarizer.class);

    static final String SUMMARY_PROMPT = """
            你在维护一份"活摘要"——对话历史的持续更新状态。把[旧活摘要]与[新增对话]合并成一份新活摘要。
            结构化四段(用小标题):进展 / 文件与代码 / 待办 / 约束与偏好。
            同一文件或事实以最新状态覆盖旧描述;保留变量名、函数签名、错误信息等关键细节;
            输出中文,不超过 %d token,不输出任何元描述。

            === 旧活摘要(可能为空)===
            %s
            === 旧活摘要(结束)===

            === 新增对话 ===
            %s
            === 新增对话(结束)===
            """;

    private final Supplier<LlmClient> clientSupplier;
    private final CalibratedTokenCounter counter;

    public IncrementalSummarizer(Supplier<LlmClient> clientSupplier, CalibratedTokenCounter counter) {
        this.clientSupplier = clientSupplier;
        this.counter = counter;
    }

    /** @return true = history 已被改写(摘要成功) */
    public boolean summarize(List<Message> history, int protectedFrom, String modelKey, long window) {
        try {
            int systemEnd = !history.isEmpty() && "system".equals(history.get(0).role()) ? 1 : 0;
            int summaryIdx = findSummaryIdx(history);
            String oldSummary = summaryIdx < 0 ? ""
                    : history.get(summaryIdx).content().replace(CurationMarks.SUMMARY_MARK, "").trim();
            if (oldSummary.startsWith("[活摘要]")) {
                oldSummary = oldSummary.substring("[活摘要]".length()).trim();
            }
            int deltaStart = summaryIdx < 0 ? systemEnd : summaryIdx + 1;
            // 跳过驻留 ack(摘要后固定跟一条 assistant 确认)
            if (summaryIdx >= 0 && deltaStart < history.size()
                    && "assistant".equals(history.get(deltaStart).role())
                    && history.get(deltaStart).toolCalls() == null) {
                deltaStart++;
            }
            int deltaEnd = Math.min(protectedFrom, history.size());
            // deltaEnd 必须落 user 边界(防拆 tool 对);ProtectionBoundary 通常已保证,此处防御回退
            while (deltaEnd > deltaStart && deltaEnd < history.size()
                    && !"user".equals(history.get(deltaEnd).role())) {
                deltaEnd--;
            }
            if (deltaEnd <= deltaStart) return false;

            long inputBudget = inputBudget(window)
                    - counter.estimate(modelKey, List.of(Message.user(oldSummary)))
                    - 1_000;   // prompt 脚手架余量
            // 最老优先切片:累计超预算就停在最近一个 user 边界
            long acc = 0;
            int sliceEnd = -1;
            for (int i = deltaStart; i < deltaEnd; i++) {
                acc += counter.estimate(modelKey, List.of(history.get(i)));
                if (acc > inputBudget) break;
                if (i + 1 >= deltaEnd || "user".equals(history.get(i + 1).role())) sliceEnd = i + 1;
            }
            if (sliceEnd <= deltaStart) {
                log.warn("summary slice found no user boundary within budget; abort");
                return false;
            }

            String transcript = renderTranscript(history.subList(deltaStart, sliceEnd));
            long outputBudget = outputBudget(window);
            String prompt = String.format(Locale.ROOT, SUMMARY_PROMPT, outputBudget,
                    oldSummary.isBlank() ? "(空)" : oldSummary, transcript);
            String newSummary = callLlm(prompt);
            if (newSummary == null || newSummary.isBlank()) {
                log.warn("summary returned blank; abort");
                return false;
            }

            List<Message> rebuilt = new ArrayList<>();
            for (int i = 0; i < systemEnd; i++) rebuilt.add(history.get(i));
            rebuilt.add(Message.user(CurationMarks.SUMMARY_MARK + "\n[活摘要]\n" + newSummary.trim()));
            rebuilt.add(Message.assistant("好的，我已了解之前的上下文，请继续。"));
            for (int i = sliceEnd; i < history.size(); i++) rebuilt.add(history.get(i));
            history.clear();
            history.addAll(rebuilt);
            return true;
        } catch (Exception e) {
            log.warn("incremental summarize failed: {}", e.getClass().getSimpleName());
            return false;
        }
    }

    /** 真正调 LLM。protected 供测试子类覆写(照 ConversationHistoryCompactor 模式)。 */
    protected String callLlm(String prompt) throws IOException {
        LlmClient client = clientSupplier.get();
        if (client == null) throw new IOException("LLM client not configured");
        List<Message> req = List.of(
                Message.system("你是一个对话摘要助手，只输出摘要本身，不输出元描述。"),
                Message.user(prompt));
        LlmClient.ChatResponse resp = client.chat(req, null);
        return resp == null ? null : resp.content();
    }

    static int findSummaryIdx(List<Message> history) {
        for (int i = 0; i < history.size(); i++) {
            String c = history.get(i).content();
            if (c != null && c.contains(CurationMarks.SUMMARY_MARK)) return i;
        }
        return -1;
    }

    static long inputBudget(long window) {
        double ratio = WatermarkGauge.threshold("wraith.context.summary.inputRatio", 0.4);
        long cap = (long) WatermarkGauge.threshold("wraith.context.summary.inputCap", 128_000);
        return Math.max(2_000, Math.min((long) (window * ratio), cap));
    }

    static long outputBudget(long window) {
        long dflt = Math.min((long) (window * 0.03), 8_000);
        return (long) WatermarkGauge.threshold("wraith.context.summary.outputBudget", dflt);
    }

    private static String renderTranscript(List<Message> messages) {
        StringBuilder sb = new StringBuilder();
        for (Message m : messages) {
            sb.append(m.role().toUpperCase(Locale.ROOT)).append(": ");
            if (m.content() != null) sb.append(m.content());
            if (m.toolCalls() != null) {
                for (LlmClient.ToolCall tc : m.toolCalls()) {
                    sb.append("\n  TOOL_CALL ").append(tc.function().name())
                            .append(": ").append(tc.function().arguments());
                }
            }
            sb.append("\n\n");
        }
        return sb.toString();
    }
}
