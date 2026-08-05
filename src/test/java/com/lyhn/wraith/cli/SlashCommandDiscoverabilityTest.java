package com.lyhn.wraith.cli;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * <b>能敲的命令必须能被发现。</b>
 *
 * <p>起因：整理终端手册时把 {@code CliCommandParser} 认的命令和 {@code slashCommandHints()}
 * 摆在一起比，发现有一组命令<b>真实存在但 Tab 补不出来、`/` 菜单里也没有</b>：
 *
 * <pre>
 * /memory pending          自动提取出的记忆候选
 * /memory approve &lt;id&gt;     采纳一条
 * /memory reject &lt;id&gt;      丢弃一条
 * /memory pending clear    全部清空
 * </pre>
 *
 * <p>那不是「少一点便利」——<b>自动记忆提取写出来的候选只能从这里批</b>。
 * 补全里查不到、README 里也没写，等于这个特性没有任何可发现的入口。
 *
 * <p>所以这条测试守的不是「两张表一模一样」（提示表刻意更粗：`/mem` 这类别名不必占一行，
 * provider 专属项也刻意不进表），而是：<b>每个命令族至少有一个提示条目能引到它</b>。
 */
class SlashCommandDiscoverabilityTest {

    /**
     * 从 {@code CliCommandParser} 的源码里抠出它真正认的命令字面量。
     *
     * <p>刻意读源码而不是手抄一份清单：手抄的那份会和代码一起腐烂，
     * 而这条测试的全部价值就在于「新加了 dispatch 却忘了加提示」时变红。
     */
    private static Set<String> commandsTheParserAccepts() throws Exception {
        java.nio.file.Path source = java.nio.file.Path.of(
                "src/main/java/com/lyhn/wraith/cli/CliCommandParser.java");
        org.junit.jupiter.api.Assumptions.assumeTrue(
                java.nio.file.Files.isRegularFile(source), "不在仓库根目录跑,跳过");
        String text = java.nio.file.Files.readString(source, java.nio.charset.StandardCharsets.UTF_8);
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"(/[a-z][a-z\\- ]*)\\s*\"").matcher(text);
        Set<String> out = new LinkedHashSet<>();
        while (m.find()) {
            out.add(m.group(1).trim());
        }
        return out;
    }

    /** 提示表里出现过的命令字面量。 */
    private static Set<String> hintedCommands() {
        Set<String> out = new LinkedHashSet<>();
        for (Main.SlashCommandHint hint : Main.slashCommandHints()) {
            out.add(hint.insertText().trim());
        }
        return out;
    }

    /**
     * 刻意<b>不</b>要求出现在提示表里的东西，每一条都要有理由。
     *
     * <p><b>判据是严格字面量比对</b>，不是「族覆盖」。第一版按「首个词相同就算覆盖」写，
     * 结果 {@code /memory pending} 被 {@code /memory} 顶掉 ——
     * 那正是本测试要抓的那种漏项，却被自己的宽松判据放过了。
     *
     * <p>豁免名单只收「结构上不该占一行」的：{@code /mem*} 是 {@code /memory*} 的纯别名，
     * 每条都进菜单会把它撑成两倍长，而正式写法已经在表里了。
     */
    private static final Set<String> ALIAS_PREFIXES = Set.of("/mem", "/ctx");

    private static boolean isAlias(String command) {
        for (String prefix : ALIAS_PREFIXES) {
            if (command.equals(prefix) || command.startsWith(prefix + " ")) {
                return true;
            }
        }
        return false;
    }

    @Test
    @DisplayName("**parser 认的每条命令都能在 / 菜单里找到** —— 否则等于这个功能不存在")
    void everyAcceptedCommandIsDiscoverable() throws Exception {
        Set<String> accepted = commandsTheParserAccepts();
        assertTrue(accepted.size() > 30, "没抠到命令,正则该修了: " + accepted);

        Set<String> hinted = hintedCommands();
        List<String> invisible = new ArrayList<>();
        for (String command : accepted) {
            if (command.equals("/") || isAlias(command)) {
                continue;   // "/" 是触发菜单的字符;别名见 ALIAS_PREFIXES
            }
            if (!hinted.contains(command)) {
                invisible.add(command);
            }
        }

        assertTrue(invisible.isEmpty(),
                "这些命令敲得动但 Tab 补不出来、/ 菜单里也没有 —— 用户不可能发现它们，"
                        + "请加进 Main.slashCommandHints():\n  " + String.join("\n  ", invisible));
    }

    @Test
    @DisplayName("候选记忆那四条必须在表里 —— 它们是自动记忆提取的**唯一**入口")
    void pendingMemoryCommandsAreListed() {
        Set<String> inserts = new LinkedHashSet<>();
        for (Main.SlashCommandHint hint : Main.slashCommandHints()) {
            inserts.add(hint.insertText().trim());
        }
        for (String required : List.of(
                "/memory pending", "/memory approve", "/memory reject", "/memory pending clear")) {
            assertTrue(inserts.contains(required), required + " 不在提示表里: " + inserts);
        }
    }

    @Test
    @DisplayName("提示表自身不该有重复 insertText —— 菜单里出现两行一样的很难看")
    void hintsHaveNoDuplicateInsertText() {
        List<String> seen = new ArrayList<>();
        List<String> duplicates = new ArrayList<>();
        for (Main.SlashCommandHint hint : Main.slashCommandHints()) {
            if (seen.contains(hint.insertText())) {
                duplicates.add(hint.insertText());
            }
            seen.add(hint.insertText());
        }
        assertTrue(duplicates.isEmpty(), "重复条目: " + duplicates);
    }

    @Test
    @DisplayName("每条提示都得有人话描述 —— 菜单里一行空白等于没有这条")
    void everyHintExplainsItself() {
        for (Main.SlashCommandHint hint : Main.slashCommandHints()) {
            assertTrue(hint.description() != null && hint.description().trim().length() >= 4,
                    hint.insertText() + " 缺少可读描述");
            assertTrue(hint.display() != null && hint.display().startsWith("/"),
                    hint.insertText() + " 的 display 不像命令: " + hint.display());
        }
    }
}
