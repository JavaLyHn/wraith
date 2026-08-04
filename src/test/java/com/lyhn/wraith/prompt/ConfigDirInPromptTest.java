package com.lyhn.wraith.prompt;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * prompt 里必须给出<b>绝对</b>配置目录，且语料里不许再写死 {@code ~/.wraith}。
 *
 * <p><b>症状</b>（用户在 Windows 上实测）：模型对他说「现在 {@code ~/.wraith} 为空，
 * 说明可能还没配置过自定义 MCP」——而那个目录存在且非空。
 *
 * <p><b>伤害链</b>：语料里写死 {@code ~/.wraith} → 模型照着塞进 {@code execute_command}
 * → Windows 那头是 {@code cmd.exe}，<b>{@code ~} 不展开</b> → 拿到空结果 → 报「为空」。
 * 路径实现一直是对的（{@code user.home} + {@code Path.of}），错的只是我们教它的写法。
 *
 * <p>所以修法有两半，缺一不可：
 * <ol>
 *   <li>Runtime Context 给出绝对路径 —— 模型根本不需要展开任何东西</li>
 *   <li>语料里不留 {@code ~/.wraith}（用 {@code {{configDir}}} 占位，装配时替换）——
 *       否则模型仍会看到一个 Unix 写法并照着用</li>
 * </ol>
 * 第二条由本文件末尾那条「语料扫描」守住：这类硬编码是加着容易、发现难
 * （只在 Windows 上、只在模型转述时暴露）。
 */
class ConfigDirInPromptTest {

    @Test
    @DisplayName("Runtime Context 报出绝对配置目录,不含任何需要展开的记号")
    void runtimeContextCarriesAbsolutePath() {
        String s = PromptAssembler.runtimeContext("2026-08-03", "Asia/Shanghai", "Windows 11",
                PromptMode.AGENT, "C:\\Users\\lyhn\\.wraith");
        assertTrue(s.contains("配置目录"), s);
        assertTrue(s.contains("C:\\Users\\lyhn\\.wraith"), s);
    }

    @Test
    @DisplayName("Windows 上显式禁止写 ~/.wraith,并点名 cmd.exe 不展开 ~")
    void windowsForbidsTilde() {
        String s = PromptAssembler.runtimeContext("2026-08-03", "UTC", "Windows 11",
                PromptMode.AGENT, "C:\\Users\\lyhn\\.wraith");
        assertTrue(s.contains("不要写"), s);
        assertTrue(s.contains("不展开"), s);
    }

    @Test
    @DisplayName("非 Windows 不加那段告诫 —— 那里 ~ 是对的,多写只是噪音")
    void posixSkipsTheWarning() {
        String s = PromptAssembler.runtimeContext("2026-08-03", "UTC", "Mac OS X",
                PromptMode.AGENT, "/Users/lyhn/.wraith");
        assertTrue(s.contains("/Users/lyhn/.wraith"), s);
        assertFalse(s.contains("不展开"), "macOS 上不该出现这段 Windows 告诫: " + s);
    }

    @Test
    @DisplayName("没给配置目录时那一行整段不出现(旧重载),不留一个空的「配置目录: 」")
    void absentConfigHomeOmitsTheLine() {
        String s = PromptAssembler.runtimeContext("2026-08-03", "UTC", "Mac OS X", PromptMode.AGENT, null);
        assertFalse(s.contains("配置目录"), s);
        String blank = PromptAssembler.runtimeContext("2026-08-03", "UTC", "Mac OS X", PromptMode.AGENT, "  ");
        assertFalse(blank.contains("配置目录"), blank);
    }

    @Test
    @DisplayName("完整 prompt 里 {{configDir}} 被换掉了 —— 占位符漏出去等于什么都没做")
    void placeholderIsSubstitutedInAssembledPrompt() {
        String prompt = PromptAssembler.createDefault().assemble(PromptMode.AGENT, PromptContext.empty());
        assertFalse(prompt.contains("{{configDir}}"), "占位符没被替换,模型会看到字面量 {{configDir}}");
        assertTrue(prompt.contains("配置目录"), "Runtime Context 那一行没进完整 prompt");
        assertTrue(prompt.contains("mcp.json"), "capabilities.md 那两处路径应仍在(只是换了前缀)");
    }

    /**
     * 语料扫描：{@code prompts/} 下不许再出现硬编码的 {@code ~/.wraith}。
     *
     * <p>这类硬编码加着容易、发现难 —— 它只在 Windows 上、只在模型转述给用户时才暴露，
     * 在 mac 上怎么跑都发现不了（与 {@code PowerShellBomTest} 守 BOM 同一类问题）。
     */
    @Test
    @DisplayName("prompts/ 下没有硬编码的 ~/.wraith —— 那在 Windows 上是错的")
    void promptCorpusHasNoHardcodedUnixConfigPath() throws IOException {
        Path root = Path.of("src/main/resources/prompts");
        assertTrue(Files.isDirectory(root), "工作目录不对,扫不到 prompts/: " + root.toAbsolutePath());

        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(root)) {
            for (Path p : walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".md")).toList()) {
                String body = Files.readString(p);
                if (body.contains("~/.wraith")) {
                    offenders.add(root.relativize(p).toString());
                }
            }
        }
        assertTrue(offenders.isEmpty(),
                "这些语料写死了 ~/.wraith。Windows 的 cmd.exe 不展开 ~,模型照着用会拿到空结果并"
                        + "对用户宣布「目录为空」。请改用 {{configDir}} 占位:\n  "
                        + String.join("\n  ", offenders));
    }
}
