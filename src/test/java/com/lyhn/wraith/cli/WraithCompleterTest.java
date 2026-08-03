package com.lyhn.wraith.cli;

import org.jline.reader.Candidate;
import org.jline.reader.ParsedLine;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import com.lyhn.wraith.mcp.resources.McpResourceDescriptor;
import com.lyhn.wraith.skill.Skill;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class WraithCompleterTest {

    @Test
    void suggestsSlashCommandsWhenInputStartsWithSlash() {
        WraithCompleter completer = new WraithCompleter(List::of);
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/", "/"), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.displ().equals("/model")));
        assertTrue(candidates.stream().anyMatch(c -> c.displ().equals("/browser connect")));
        assertTrue(candidates.stream().anyMatch(c -> c.displ().equals("/search <查询>")));
    }

    @Test
    void completesSubCommandWithoutDuplicatingPrefix() {
        WraithCompleter completer = new WraithCompleter(List::of);
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/mcp r", "r"), candidates);

        Candidate restart = candidates.stream()
                .filter(c -> c.displ().equals("/mcp restart <name>"))
                .findFirst()
                .orElseThrow();
        assertEquals("restart ", restart.value());
    }

    @Test
    void ignoresNormalWords() {
        WraithCompleter completer = new WraithCompleter(List::of);
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("hello", "hello"), candidates);

        assertTrue(candidates.isEmpty());
    }

    @Test
    void completesModelProviderNames() {
        // 数据源从硬编码列表换成 config —— 本任务删掉了那份硬编码。
        // 这条与新增的 modelCompletionListsConfiguredProviders 的区别在于:它验的是**前缀匹配**
        // (输入 "st" 只补出 step),那条验的是空前缀下的全量列出。
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("step", "kimi"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/model st", "st"), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().equals("step")));
        assertFalse(candidates.stream().anyMatch(c -> c.value().equals("kimi")),
                "前缀 st 不该匹配 kimi");
    }

    @Test
    void completesConfigProviderCommand() {
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("freellmapi"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/config provider fr", "fr"), candidates);

        // 尾随空格是有意义的:它让补全直接推进到下一个参数位。
        assertTrue(candidates.stream().anyMatch(c -> c.value().equals("freellmapi ")));
    }

    @Test
    void completesXfyunProviderCommand() {
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("xfyun"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/config provider xf", "xf"), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().equals("xfyun ")));
    }

    @Test
    void completesMcpServerNamesFromResources() {
        WraithCompleter completer = new WraithCompleter(() -> List.of(
                new McpResourceDescriptor("chrome-devtools", "file:///a", "a", "", "", "text/plain", null),
                new McpResourceDescriptor("filesystem", "file:///b", "b", "", "", "text/plain", null)
        ));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/mcp logs ch", "ch"), candidates);

        Candidate candidate = candidates.stream()
                .filter(c -> c.value().equals("chrome-devtools"))
                .findFirst()
                .orElseThrow();
        assertEquals("MCP server", candidate.group());
    }

    @Test
    void completesSkillNames() {
        WraithCompleter completer = new WraithCompleter(List::of, () -> List.of(
                skill("web-access", "浏览器和联网策略"),
                skill("ai-article", "文章写作")
        ));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/skill show web", "web"), candidates);

        Candidate candidate = candidates.stream()
                .filter(c -> c.value().equals("web-access"))
                .findFirst()
                .orElseThrow();
        assertEquals("浏览器和联网策略", candidate.descr());
    }

    @Test
    void completesSkillSubCommands() {
        WraithCompleter completer = new WraithCompleter(List::of);
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/skill sh", "sh"), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().equals("show ")));
    }

    @Test
    void completesTaskSubCommands() {
        WraithCompleter completer = new WraithCompleter(List::of);
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/task ca", "ca"), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().equals("cancel ")));
    }

    @Test
    void completesLocalPathMentions() {
        WraithCompleter completer = new WraithCompleter(List::of);
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("@pom", "@pom"), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().equals("@pom.xml")));
    }

    @Test
    void completesImagePathMentionsWithTokenPrefix() {
        WraithCompleter completer = new WraithCompleter(List::of);
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("@image:pom", "@image:pom"), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().equals("@image:pom.xml")));
    }

    private static Skill skill(String name, String description) {
        return new Skill(name, description, "1.0.0", null, List.of(), Skill.Source.USER, "body", null, null);
    }

    private static ParsedLine parsed(String line, String word) {
        return new ParsedLine() {
            @Override public String word() { return word; }
            @Override public int wordCursor() { return word.length(); }
            @Override public int wordIndex() { return 0; }
            @Override public List<String> words() { return List.of(word); }
            @Override public String line() { return line; }
            @Override public int cursor() { return line.length(); }
        };
    }

    // ── provider 补全来自 config,不是硬编码 ──────────────────────────────────
    //
    // 此前 completeModel(:91-98)与 completeConfig(:117-122)各硬编码了一份
    // {glm,deepseek,step,kimi,freellmapi,xfyun},而 completeModel 那份还把两个**模型名**
    // (glm-5.1 / glm-5v-turbo)混进了 provider 列表 —— /model 收的是 provider 名。

    private static com.lyhn.wraith.config.WraithConfig cfgWith(String... providerIds) {
        com.lyhn.wraith.config.WraithConfig c = new com.lyhn.wraith.config.WraithConfig();
        c.setProviders(new java.util.LinkedHashMap<>());
        for (String id : providerIds) {
            c.getProviders().put(id,
                    new com.lyhn.wraith.config.WraithConfig.ProviderConfig("sk-x", null, "m"));
        }
        return c;
    }

    @Test
    void modelCompletionListsConfiguredProviders() {
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("anthropic", "siliconflow"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/model ", ""), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().trim().equals("anthropic")),
                "补全里应有已配置的 anthropic: " + values(candidates));
        assertTrue(candidates.stream().anyMatch(c -> c.value().trim().equals("siliconflow")),
                "补全里应有已配置的 siliconflow: " + values(candidates));
    }

    @Test
    void modelCompletionDropsUnconfiguredHardcodedProviders() {
        // discovered 显式注入空表(四参构造器),不走会扫真实 env 的默认实现:
        // 本仓库自己的默认 provider 就叫 GLM_API_KEY,贡献者本机很可能设了它——
        // 若这里用三参构造器走默认实现,"没配 glm 就不该推荐它" 这条断言会在这类机器上假红。
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("anthropic"), List::of);
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/model ", ""), candidates);

        assertFalse(candidates.stream().anyMatch(c -> c.value().trim().equals("glm")),
                "没配 glm 就不该推荐它: " + values(candidates));
    }

    @Test
    @DisplayName("env 发现的 provider 也该出现在补全里 —— 否则只写了 .env 的用户 Tab 补全一条不给(I3)")
    void modelCompletionIncludesEnvDiscoveredProviders() {
        // discovered 显式注入(四参构造器),不扫真实 env —— 这里验的是「注入的候选会被并进补全」
        // 这条合并逻辑本身,不是 ProviderResolver.candidates 有没有正确扫到真实环境变量
        // (那部分由 ProviderResolverTest 覆盖)。
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith(), () -> List.of("deepseek"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/model ", ""), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().trim().equals("deepseek")),
                "config 为空但 env 发现了 deepseek 时,补全应包含它: " + values(candidates));
    }

    @Test
    void modelCompletionContainsNoModelNames() {
        // /model 收的是 provider 名,模型名由各 provider 的 config 决定,混在一起本身就是错的
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("glm"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/model ", ""), candidates);

        assertFalse(candidates.stream().anyMatch(c -> c.value().contains("glm-5")),
                "模型名不该出现在 provider 补全里: " + values(candidates));
    }

    @Test
    void configProviderCompletionListsConfiguredProviders() {
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith("openrouter"));
        List<Candidate> candidates = new ArrayList<>();

        completer.complete(null, parsed("/config provider ", ""), candidates);

        assertTrue(candidates.stream().anyMatch(c -> c.value().trim().equals("openrouter")),
                "实际: " + values(candidates));
    }

    @Test
    void completionFollowsLiveConfigNotASnapshot() {
        // 本仓库已四次栽在 snapshot-vs-live-signal 上(沙箱护盾、动作卡…)。
        // 用户刚在桌面面板里加完 provider,不该等重启才补全得出来。
        //
        // discovered 显式注入空表(四参构造器),不走会扫真实 env 的默认实现 —— 否则 "groq"
        // 在恰好设了 GROQ_API_KEY 的宿主机上会从一开始就出现,断言就假红。
        java.util.List<String> ids = new java.util.ArrayList<>(List.of("anthropic"));
        WraithCompleter completer = new WraithCompleter(
                List::of, List::of, () -> cfgWith(ids.toArray(new String[0])), List::of);

        List<Candidate> before = new ArrayList<>();
        completer.complete(null, parsed("/model ", ""), before);
        assertFalse(before.stream().anyMatch(c -> c.value().trim().equals("groq")));

        ids.add("groq");

        List<Candidate> after = new ArrayList<>();
        completer.complete(null, parsed("/model ", ""), after);
        assertTrue(after.stream().anyMatch(c -> c.value().trim().equals("groq")),
                "config 变了补全没跟上 —— 说明取了快照: " + values(after));
    }

    @Test
    void missingConfigSupplierDoesNotCrashCompletion() {
        // 一参 / 二参构造器仍在用(12 处),它们没有 config —— 补全应安静地不给 provider 建议
        WraithCompleter completer = new WraithCompleter(List::of);
        List<Candidate> candidates = new ArrayList<>();

        assertDoesNotThrow(() -> completer.complete(null, parsed("/model ", ""), candidates));
    }

    private static String values(List<Candidate> candidates) {
        return candidates.stream().map(Candidate::value).toList().toString();
    }
}
