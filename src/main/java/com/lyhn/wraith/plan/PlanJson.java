package com.lyhn.wraith.plan;

/**
 * 从 LLM 输出里抠出「计划 JSON」，以及抠不出来时该跟用户说什么。
 *
 * <p><b>为什么要这一层</b>：规划者是一个被要求「输出 JSON」的 LLM，但它随时可能
 * 输出别的东西——最常见的两种是「围栏 + 前后寒暄」和「干脆用自然语言回答」。
 * 前者要能救回来，后者要给一句人话。此前两处调用点各自为政：
 * {@code AgentOrchestrator.parsePlan}（Team）有剥离前后自然语言的逻辑，
 * {@code Planner.parsePlan}（Plan）没有，直接 {@code readTree} 原始输出，
 * 于是用户看到的是 Jackson 的
 * {@code Unrecognized token '根据对话历史': was expecting (JSON String, …)}。
 *
 * <p>抽成一份共用实现，就是不想再有第三处各写一遍——同一个缺陷在这个仓库里
 * 已经因为「同一逻辑抄了两份」发生过好几次（{@code bash -c} 写死那次最典型）。
 */
public final class PlanJson {

    private PlanJson() {}

    /** 回显模型原话的上限。超了截断——几千字糊满整屏帮不上任何人。 */
    private static final int PROSE_ECHO_LIMIT = 600;

    /**
     * 抠出计划 JSON 对象；抠不出返回 {@code null}。
     *
     * <p><b>返回 null 与「抠出来但解析失败」是两件事</b>，调用方必须分开处理：
     * 前者是「模型压根没给计划」（该给用户一句人话，见 {@link #noPlanMessage}），
     * 后者是「给了但是坏的」（那才轮到解析器报错）。
     */
    public static String extract(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String s = stripFences(raw).trim();
        int start = s.indexOf('{');
        if (start < 0) {
            return null;
        }
        // 顶层是数组时不要钻进去取内层对象:计划的约定形态是 {summary, tasks[]},
        // 一个裸数组不是计划。取了内层对象的话调用方会拿到一个"没有 tasks 的计划"
        // → 静默执行 0 步,比干脆报「模型没给计划」难懂得多。
        if (precededByArrayOpen(s, start)) {
            return null;
        }
        int end = matchingBrace(s, start);
        // 配平不上 = 输出被截断（模型说到一半没了）。宁可返回 null 走「没有计划」，
        // 也不要交一段半截 JSON 给解析器去抛一个更难懂的错。
        return end < 0 ? null : s.substring(start, end + 1);
    }

    /**
     * 模型没给计划时给用户看的话。
     *
     * <p>三件事缺一不可：**发生了什么**、**它实际说了什么**、**下一步怎么办**。
     * 中间那件尤其重要——Plan 模式下问一个问题时，规划者那段"跑题"的自然语言
     * 往往正是用户想要的答案（本次 bug 的截图里它答得完全正确），把它吞掉才是真的损失。
     */
    public static String noPlanMessage(String raw) {
        String prose = raw == null ? "" : raw.trim();
        StringBuilder sb = new StringBuilder();
        sb.append("模型没有返回可执行计划，而是直接用自然语言回答了。\n")
                .append("Plan / Team 模式会先要求模型产出 JSON 计划再逐步执行，"
                        + "所以更适合「要做的事」而不是「要问的问题」。\n")
                // 「左下角」是错的:模式选择器在输入框**右下角**(Composer 里 flex-1 之后那一簇)。
                // 这句话会被 addAssistantMessage 写进对话历史,模型此后会照着复述给用户 ——
                // 用户实测里模型就说了「ReAct 模式(左下角可切)」,把人指向一个不存在的位置。
                .append("· 想直接得到回答 → 把右下角模式选择器切回 ReAct 再问一次\n")
                .append("· 想让它动手 → 把目标写成一件事，例如「把 utils 重构成 X 并补测试」");
        if (!prose.isEmpty()) {
            sb.append("\n\n模型的原话：\n").append(truncate(prose));
        }
        return sb.toString();
    }

    /** 第一个 '{' 前面（跳过空白）紧挨着的是不是 '['。 */
    private static boolean precededByArrayOpen(String s, int braceAt) {
        for (int i = braceAt - 1; i >= 0; i--) {
            char c = s.charAt(i);
            if (Character.isWhitespace(c)) {
                continue;
            }
            return c == '[';
        }
        return false;
    }

    /** 去掉 ``` / ```json 围栏标记（只删标记行，不动内容）。 */
    private static String stripFences(String s) {
        return s.replaceAll("(?m)^\\s*```[a-zA-Z0-9_-]*\\s*$", "")
                .replaceAll("```[a-zA-Z0-9_-]*", "")
                .replace("```", "");
    }

    /**
     * 从 {@code start}（必须是 '{'）找配平的 '}'；找不到返回 -1。
     *
     * <p>要认字符串字面量与转义：JSON 的值里出现 <code>{</code> / <code>}</code>
     * 是家常便饭（"把 {x} 改成 {y}"），只数括号会在那里提前收手。
     * 也正因如此不能用「第一个 { 到最后一个 }」——那个写法反过来会被
     * 结尾散文里的花括号骗到（"计划：{...} 祝顺利 :}"）。
     */
    private static int matchingBrace(String s, int start) {
        int depth = 0;
        boolean inString = false;
        boolean escaped = false;
        for (int i = start; i < s.length(); i++) {
            char c = s.charAt(i);
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (c == '\\') {
                    escaped = true;
                } else if (c == '"') {
                    inString = false;
                }
                continue;
            }
            if (c == '"') {
                inString = true;
            } else if (c == '{') {
                depth++;
            } else if (c == '}') {
                depth--;
                if (depth == 0) {
                    return i;
                }
            }
        }
        return -1;
    }

    private static String truncate(String s) {
        return s.length() <= PROSE_ECHO_LIMIT ? s : s.substring(0, PROSE_ECHO_LIMIT) + "…";
    }
}
