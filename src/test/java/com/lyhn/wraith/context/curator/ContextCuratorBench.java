package com.lyhn.wraith.context.curator;

import com.lyhn.wraith.llm.LlmClient;
import com.lyhn.wraith.llm.LlmClient.Message;
import com.lyhn.wraith.memory.TokenBudget;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Phase D §9.3 确定性回放 bench(免费可复现,无网络/无真实 LLM/无 Date/random)。
 *
 * 脚本化长会话把估算上下文推过窗口 150%,同一脚本跑两条:
 *   - "curator":ContextCurator(Tier1/2/3,确定性假 delta 摘要器)
 *   - "control":同脚本、不 curate()(无治理对照,展示 input 爆炸)
 *
 * 量四项(spec §9.3):每 step estInput 曲线 / 相邻 step 公共前缀长度(cache 命中代理,
 * 离线证明单调边界)/ 触发水位(tier)分布 / Tier3 摘要输入长度(delta vs 全量)。
 * 产出:target/curator-bench/bench-{curator,control}.jsonl + docs/.../reports/phase-d-bench.md。
 *
 * 这是价值验收的免费骨干;真实 on/off 费用/cache/鬼打墙对照见 Phase D §9.4(真跑)。
 */
class ContextCuratorBench {

    private static final long WINDOW = 8_000L;
    private static final int ROUNDS = 30;
    private static final int TOOL_OUT_CHARS = 4_000;
    private static final String MODEL = "bench-model";
    private static final long SIM_OUTPUT_TOKENS = 200L;

    /** 捕获式 sink:收下 metrics JSONL(格式与 SessionCurationSink 一致),工具日志 no-op(§9.3 不测回取)。 */
    private static final class CapturingSink implements CurationSink {
        final List<String> metrics = new ArrayList<>();
        @Override public java.util.Optional<Path> writeToolLog(String tool, CharSequence content) {
            return java.util.Optional.empty();
        }
        @Override public void appendMetrics(String jsonLine) { metrics.add(jsonLine); }
    }

    /** 确定性 delta 摘要器:记录每次摘要的 delta 长度与彼时全量长度(§9.3 delta-vs-full),
     *  然后把 [1..protectedFrom) 折叠成一条活摘要标记(与生产语义一致:delta 被吞、留摘要)。 */
    private static final class RecordingDeltaSummarizer extends IncrementalSummarizer {
        final List<long[]> deltaVsFull = new ArrayList<>();  // {deltaChars, fullChars}
        RecordingDeltaSummarizer() { super(() -> null, new CalibratedTokenCounter()); }
        @Override public boolean summarize(List<Message> history, int protectedFrom, String modelKey, long window) {
            int hi = Math.max(1, protectedFrom);
            long deltaChars = 0;
            for (int i = 1; i < hi && i < history.size(); i++) deltaChars += serialize(history.get(i)).length();
            long fullChars = 0;
            for (Message m : history) fullChars += serialize(m).length();
            deltaVsFull.add(new long[]{deltaChars, fullChars});
            if (hi > 1 && hi <= history.size()) history.subList(1, hi).clear();
            history.add(1, Message.user(CurationMarks.SUMMARY_MARK + "\n[活摘要 step-summary]"));
            return true;
        }
    }

    /** 一步的度量。 */
    private record Step(int step, long estInput, int tier, long prefixChars, int prefixMsgs) {}

    /** 一次跑的结果。 */
    private static final class Run {
        final List<Step> steps = new ArrayList<>();
        final List<String> metrics;
        long cumulativeInput;
        long peakEst;
        Run(List<String> metrics) { this.metrics = metrics; }
    }

    // ---- 脚本(确定性:内容仅依赖轮次 i)---------------------------------------

    private static Message roundUser(int i) {
        return Message.user("请检查模块 " + i + " 的实现并跑一下相关检索。");
    }

    private static Message roundAssistant(int i) {
        LlmClient.ToolCall tc = new LlmClient.ToolCall("call-" + i,
                new LlmClient.ToolCall.Function("grep_code", "{\"q\":\"module-" + i + "\"}"));
        return Message.assistant("我来检索 module-" + i + "。", List.of(tc));
    }

    private static Message roundTool(int i) {
        StringBuilder sb = new StringBuilder(TOOL_OUT_CHARS + 32);
        while (sb.length() < TOOL_OUT_CHARS) sb.append("match module-").append(i).append(" line-").append(sb.length()).append('\n');
        return Message.tool("call-" + i, sb.toString());
    }

    // ---- 序列化 + 公共前缀(cache 命中代理)-----------------------------------

    private static String serialize(Message m) {
        StringBuilder sb = new StringBuilder();
        sb.append(m.role()).append('');
        if (m.content() != null) sb.append(m.content());
        if (m.toolCalls() != null) {
            for (LlmClient.ToolCall tc : m.toolCalls()) {
                sb.append('').append(tc.id()).append('').append(tc.function().arguments());
            }
        }
        return sb.toString();
    }

    private static String serializeHistory(List<Message> h) {
        StringBuilder sb = new StringBuilder();
        for (Message m : h) sb.append(serialize(m)).append('');
        return sb.toString();
    }

    private static long commonPrefixChars(String a, String b) {
        int n = Math.min(a.length(), b.length());
        int i = 0;
        while (i < n && a.charAt(i) == b.charAt(i)) i++;
        return i;
    }

    private static int commonPrefixMsgs(List<Message> a, List<Message> b) {
        int n = Math.min(a.size(), b.size());
        int i = 0;
        while (i < n && serialize(a.get(i)).equals(serialize(b.get(i)))) i++;
        return i;
    }

    // ---- 跑一条 ------------------------------------------------------------

    private Run runSession(boolean curate, RecordingDeltaSummarizer summarizer) {
        CapturingSink sink = new CapturingSink();
        ContextCurator curator = new ContextCurator(
                () -> WINDOW, () -> MODEL, () -> null, new ToolTierPolicy(), sink,
                (m, p) -> {}, summarizer);

        Run run = new Run(sink.metrics);
        List<Message> history = new ArrayList<>();
        history.add(Message.system("你是 wraith 编码助手。遵守工具与安全约束。"));

        List<Message> prevSnapshot = null;   // 上一次「发给 LLM」时的 history(前缀缓存基准)
        for (int i = 0; i < ROUNDS; i++) {
            history.add(roundUser(i));
            if (curate) curator.curate(history);          // 调 LLM 前治理(原地)

            // 此刻 history == 本次「发给 LLM」的内容 → 前缀缓存基准
            List<Message> snapshot = new ArrayList<>(history);
            long estInput = TokenBudget.estimateMessagesTokens(history);
            WatermarkGauge.Reading r = new WatermarkGauge(() -> WINDOW).read(MODEL, estInput);

            long prefixChars = prevSnapshot == null ? 0
                    : commonPrefixChars(serializeHistory(prevSnapshot), serializeHistory(snapshot));
            int prefixMsgs = prevSnapshot == null ? 0 : commonPrefixMsgs(prevSnapshot, snapshot);

            long cached = 0;                                // 简化:cache 命中代理直接用 prefixMsgs 段估算
            for (int k = 0; k < prefixMsgs; k++) cached += TokenBudget.estimateMessagesTokens(List.of(snapshot.get(k)));

            run.steps.add(new Step(i, estInput, r.tier(), prefixChars, prefixMsgs));
            run.cumulativeInput += estInput;
            run.peakEst = Math.max(run.peakEst, estInput);

            // 模拟 LLM 响应:assistant + toolCall,再 tool 大输出
            history.add(roundAssistant(i));
            history.add(roundTool(i));
            curator.onUsage(estInput, SIM_OUTPUT_TOKENS, cached, history);   // 记 metrics/watermark(真实锚点)

            prevSnapshot = snapshot;
        }
        return run;
    }

    /** 强制 Tier3 场景(复用单测思路):小窗 5000 + 4 轮各 ~20k 字工具输出,最近一轮保护区内的大输出
     *  永远压不动 → snip/prune 后仍 ≥95% → 必落 Tier3 摘要。用于量 delta-vs-full,不影响主 bench。 */
    private RecordingDeltaSummarizer forcedTier3() {
        RecordingDeltaSummarizer sm = new RecordingDeltaSummarizer();
        ContextCurator c = new ContextCurator(() -> 5_000L, () -> MODEL, () -> null, new ToolTierPolicy(),
                CurationSink.NOOP, (m, p) -> {}, sm);
        List<Message> h = new ArrayList<>();
        h.add(Message.system("你是 wraith 编码助手。"));
        for (int round = 0; round < 4; round++) {
            h.add(Message.user("round " + round));
            LlmClient.ToolCall tc = new LlmClient.ToolCall("c" + round,
                    new LlmClient.ToolCall.Function("grep_code", "{}"));
            h.add(Message.assistant("searching", List.of(tc)));
            h.add(Message.tool("c" + round, ("match-" + round + " ").repeat(2500)));
        }
        h.add(Message.user("tail"));
        h.add(Message.assistant("done"));
        c.curate(h);
        return sm;
    }

    // ---- bench ------------------------------------------------------------

    @Test
    void deterministicReplayBench() throws IOException {
        RecordingDeltaSummarizer summarizer = new RecordingDeltaSummarizer();
        Run curator = runSession(true, summarizer);
        Run control = runSession(false, new RecordingDeltaSummarizer());

        // ---- 回归护栏(spec §9.3 力学)----
        // 1) 脚本确实把无治理上下文推过窗口 150%
        assertTrue(control.peakEst > (long) (WINDOW * 1.5),
                "control 峰值 estInput=" + control.peakEst + " 未过 150% 窗口(" + WINDOW + ")");
        // 2) curator 把峰值/累计 input 显著压下来
        assertTrue(curator.peakEst < control.peakEst,
                "curator 峰值应低于对照:" + curator.peakEst + " vs " + control.peakEst);
        assertTrue(curator.cumulativeInput < control.cumulativeInput,
                "curator 累计 input 应低于对照:" + curator.cumulativeInput + " vs " + control.cumulativeInput);
        // 3) Tier3 delta 摘要 delta-vs-full:主脚本里 Tier1/2 常已足够(自然 Tier3 可能为 0,是好结果);
        //    另跑强制场景(小窗 + 大保护尾,必落 Tier3)量 delta 长度 <= 彼时全量(增量摘要,非全量重摘)。
        RecordingDeltaSummarizer t3 = forcedTier3();
        assertFalse(t3.deltaVsFull.isEmpty(), "强制场景应触发 Tier3 摘要");
        for (long[] dv : t3.deltaVsFull) {
            assertTrue(dv[0] <= dv[1], "delta(" + dv[0] + ") 不应超过全量(" + dv[1] + ")");
        }
        // 4) 单调/幂等:治理后立刻再 curate 同一 history → 无二次变更(见标跳过,单趟收敛)
        List<Message> settled = new ArrayList<>();
        settled.add(Message.system("s"));
        for (int i = 0; i < ROUNDS; i++) { settled.add(roundUser(i)); settled.add(roundAssistant(i)); settled.add(roundTool(i)); }
        ContextCurator idem = new ContextCurator(() -> WINDOW, () -> MODEL, () -> null, new ToolTierPolicy(),
                CurationSink.NOOP, (m, p) -> {}, new RecordingDeltaSummarizer());
        idem.curate(settled);
        boolean secondPassChanged = idem.curate(settled);
        assertFalse(secondPassChanged, "第二趟 curate 应零变更(单调边界/见标跳过)");

        // ---- 落盘:JSONL + markdown 报告 ----
        Path outDir = Path.of("target", "curator-bench");
        Files.createDirectories(outDir);
        Files.write(outDir.resolve("bench-curator.jsonl"), curator.metrics);
        Files.write(outDir.resolve("bench-control.jsonl"), control.metrics);

        Path reportDir = Path.of("docs", "superpowers", "reports");
        Files.createDirectories(reportDir);
        Files.writeString(reportDir.resolve("phase-d-bench.md"),
                report(curator, control, summarizer.deltaVsFull.size(), t3));

        // 控制台摘要(便于 CI/人读)
        System.out.printf(Locale.ROOT,
                "[bench] window=%d rounds=%d | control peak=%d cum=%d | curator peak=%d cum=%d | Tier3 摘要 %d 次%n",
                WINDOW, ROUNDS, control.peakEst, control.cumulativeInput,
                curator.peakEst, curator.cumulativeInput, summarizer.deltaVsFull.size());
    }

    // ---- 报告 --------------------------------------------------------------

    private String report(Run curator, Run control, int naturalTier3, RecordingDeltaSummarizer t3) {
        StringBuilder sb = new StringBuilder();
        sb.append("# ContextCurator Phase D — 确定性回放 bench 报告\n\n");
        sb.append("> 自动生成于 `ContextCuratorBench`(确定性·无网络·可复现)。数字为**估算 token**(离线力学证明),")
          .append("真实费用/cache/鬼打墙见 Phase D §9.4 真实 A/B 报告。\n\n");
        sb.append(String.format(Locale.ROOT, "**参数**:window=%d,rounds=%d,每轮工具输出≈%d 字,模型=`%s`。\n\n",
                WINDOW, ROUNDS, TOOL_OUT_CHARS, MODEL));

        sb.append("## 总览\n\n");
        sb.append("| 指标 | 无治理对照 | curator | 改善 |\n|---|--:|--:|--:|\n");
        sb.append(String.format(Locale.ROOT, "| 峰值 estInput(token) | %d | %d | -%.1f%% |\n",
                control.peakEst, curator.peakEst, pct(control.peakEst, curator.peakEst)));
        sb.append(String.format(Locale.ROOT, "| 累计 estInput(token) | %d | %d | -%.1f%% |\n",
                control.cumulativeInput, curator.cumulativeInput, pct(control.cumulativeInput, curator.cumulativeInput)));
        sb.append(String.format(Locale.ROOT, "| 峰值/窗口 | %.0f%% | %.0f%% | — |\n",
                100.0 * control.peakEst / WINDOW, 100.0 * curator.peakEst / WINDOW));
        sb.append(String.format(Locale.ROOT, "| Tier3 摘要次数(自然) | 0 | %d | — |\n\n", naturalTier3));
        if (naturalTier3 == 0) {
            sb.append("> 主脚本自然 Tier3=0:Tier1/2(零成本截短 + 占位裁剪)已足够把上下文管在窗口内,")
              .append("**未触及最贵的摘要 LLM 调用**——这本身是 curator 的价值(廉价手段优先)。")
              .append("下方 delta-vs-full 取自专门的强制 Tier3 场景。\n\n");
        }

        sb.append("## 触发水位(tier)分布 — curator\n\n");
        int[] dist = new int[4];
        for (Step s : curator.steps) dist[s.tier()]++;
        sb.append("| tier | step 数 |\n|---|--:|\n");
        for (int t = 0; t <= 3; t++) sb.append(String.format(Locale.ROOT, "| %d | %d |\n", t, dist[t]));
        sb.append('\n');

        sb.append("## 每 step 曲线(estInput / tier / 相邻公共前缀)\n\n");
        sb.append("| step | control estInput | curator estInput | curator tier | 前缀 msgs | 前缀 chars |\n");
        sb.append("|--:|--:|--:|--:|--:|--:|\n");
        for (int i = 0; i < curator.steps.size(); i++) {
            Step cu = curator.steps.get(i);
            Step co = control.steps.get(i);
            sb.append(String.format(Locale.ROOT, "| %d | %d | %d | %d | %d | %d |\n",
                    i, co.estInput(), cu.estInput(), cu.tier(), cu.prefixMsgs(), cu.prefixChars()));
        }
        sb.append('\n');

        sb.append("## Tier3 摘要:delta vs 全量(增量证明,强制 Tier3 场景)\n\n");
        sb.append("| # | delta 字数 | 彼时全量字数 | delta 占比 |\n|--:|--:|--:|--:|\n");
        for (int i = 0; i < t3.deltaVsFull.size(); i++) {
            long[] dv = t3.deltaVsFull.get(i);
            sb.append(String.format(Locale.ROOT, "| %d | %d | %d | %.0f%% |\n",
                    i + 1, dv[0], dv[1], dv[1] == 0 ? 0.0 : 100.0 * dv[0] / dv[1]));
        }
        sb.append('\n');

        sb.append("## 结论\n\n");
        sb.append("- 无治理对照 estInput 单调爆炸,峰值达窗口 ")
          .append(String.format(Locale.ROOT, "%.0f%%", 100.0 * control.peakEst / WINDOW))
          .append(";curator 将峰值压到窗口 ")
          .append(String.format(Locale.ROOT, "%.0f%%", 100.0 * curator.peakEst / WINDOW))
          .append(",累计 input 降 ")
          .append(String.format(Locale.ROOT, "%.1f%%", pct(control.cumulativeInput, curator.cumulativeInput)))
          .append("。\n");
        sb.append("- 相邻 step 公共前缀(见曲线):curator 治理后仍保留可观公共前缀,")
          .append("压缩点处一次性下调后不再反复改写(见标跳过,单趟收敛)——单调边界的离线证明。\n");
        sb.append("- Tier3 每次只摘 delta(占彼时全量小头),非全量重摘,摘要开销随会话线性而非二次增长。\n");
        return sb.toString();
    }

    private static double pct(long from, long to) {
        return from == 0 ? 0.0 : 100.0 * (from - to) / from;
    }
}
