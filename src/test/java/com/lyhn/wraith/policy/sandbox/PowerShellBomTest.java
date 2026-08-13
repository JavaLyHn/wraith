package com.lyhn.wraith.policy.sandbox;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 含非 ASCII 的 {@code .ps1} 必须带 UTF-8 BOM，否则在 Windows 上根本跑不起来。
 *
 * <p><b>症状</b>（用户实测）：
 * <pre>
 * D:\wraith&gt; powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1
 * 所在位置 ...\wraith-install.ps1:16 字符: 31
 * + if (-not (Test-Path $devWin)) {
 * +                               ~
 * 语句块或类型定义中缺少右"}"。
 * </pre>
 * 而那个文件的花括号<b>是平衡的</b>——所以不是语法错。
 *
 * <p><b>根因</b>：{@code powershell}（Windows PowerShell 5.1）对<b>无 BOM</b> 的 {@code .ps1}
 * 按 <b>ANSI 码页</b>解码（中文 Windows 是 GBK/936），不是 UTF-8。于是每个中文字符的 UTF-8
 * 三字节被错拆成 GBK 序列，而 GBK 的 lead byte（0x81–0xFE）会吞掉紧随的一个字节 ——
 * {@code &#125;} 是 0x7D，正好在可被吞的范围内。花括号就这么凭空消失了，
 * 报错却指向那个看起来毫无问题的 {@code &#123;}。
 *
 * <p>加了 BOM，PowerShell 5.1 与 7 都会正确按 UTF-8 读。
 *
 * <p><b>这条为什么必须有测试守</b>：BOM 是不可见的。任何人在 mac/Linux 上用编辑器保存一次
 * 就可能把它去掉，而本地怎么跑都不会发现——问题只在 Windows 上、只在中文/日文等非 ASCII
 * 码页下暴露。仓库里当时就有两个文件是无 BOM 的（{@code wraith-install.ps1} 用户已撞上，
 * {@code appcontainer-run.ps1} 只是还没被跑到）。
 */
class PowerShellBomTest {

    private static final byte[] UTF8_BOM = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};

    /** 仓库里所有 .ps1（跳过构建产物与依赖目录）。相对路径依赖 surefire 的工作目录=项目根。 */
    private static List<Path> powerShellScripts() throws IOException {
        List<Path> out = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(Path.of("."))) {
            walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".ps1"))
                    .filter(p -> {
                        String s = p.toString().replace('\\', '/');
                        // `/.claude/` 是后加的:那底下有 **git worktree**(其它分支的工作区)。
                        // 全量测试因此扫到了 feat+github-ai-daily 分支里一个无 BOM 的 .ps1 并变红 ——
                        // 那不是本分支的文件,本分支也没追踪它,这条测试管不着它。
                        // (WindowsLauncherScriptTest 一开始就排了 /.claude/,这份老测试漏了。)
                        return !s.contains("/target/") && !s.contains("/node_modules/")
                                && !s.contains("/.git/") && !s.contains("/.claude/")
                                && !s.contains("/.worktrees/")
                                && !s.contains("/dist/")
                                && !s.contains("/release/") && !s.contains("/out/");
                    })
                    .forEach(out::add);
        }
        return out;
    }

    private static boolean hasNonAscii(byte[] bytes) {
        for (byte b : bytes) {
            if ((b & 0xFF) > 0x7F) return true;
        }
        return false;
    }

    private static boolean hasBom(byte[] bytes) {
        return bytes.length >= 3 && bytes[0] == UTF8_BOM[0]
                && bytes[1] == UTF8_BOM[1] && bytes[2] == UTF8_BOM[2];
    }

    @Test
    @DisplayName("每个含非 ASCII 的 .ps1 都带 UTF-8 BOM —— 否则 Windows PowerShell 5.1 按 GBK 读,花括号会被吞")
    void everyNonAsciiScriptHasBom() throws IOException {
        List<Path> scripts = powerShellScripts();
        assertTrue(scripts.size() >= 2, "没扫到 .ps1,说明工作目录不对: " + scripts);

        List<String> offenders = new ArrayList<>();
        for (Path p : scripts) {
            byte[] bytes = Files.readAllBytes(p);
            if (hasNonAscii(bytes) && !hasBom(bytes)) {
                offenders.add(p.normalize().toString());
            }
        }

        assertTrue(offenders.isEmpty(),
                "这些 .ps1 含非 ASCII 但没有 UTF-8 BOM,在中文 Windows 上会被按 GBK 解码而报出"
                        + "「缺少右花括号」之类的假语法错:\n  " + String.join("\n  ", offenders));
    }

    @Test
    @DisplayName("沙箱发射器落盘时 BOM 要跟着写出去 —— 它是 Java 写的文件,PowerShell 直接读它")
    void materializedLauncherKeepsBom() throws Exception {
        String content = AppContainerSupport.readResource();
        assertTrue(content != null && !content.isBlank(), "jar 内缺少 appcontainer-run.ps1");

        // readResource 用 UTF-8 解码,BOM 会以 U+FEFF 的形式留在字符串首位;
        // ensureLauncher 再用 Files.writeString(UTF_8) 写回去,BOM 就原样落到磁盘。
        // 若哪天有人在 readResource 里 strip 掉它,PowerShell 就又按 GBK 读了。
        assertTrue(content.charAt(0) == '\uFEFF',
                "appcontainer-run.ps1 的 BOM 没有流到落盘内容里 —— PowerShell 会按 GBK 读它");

        // 顺带确认 BOM 之后紧跟的确实是脚本内容,而不是又多了一层 BOM
        assertTrue(content.length() > 1 && content.charAt(1) != '\uFEFF', "出现了双 BOM");
    }

    @Test
    @DisplayName("BOM 不该被误加到不含非 ASCII 的脚本上 —— 那是无谓的噪音（当前没有这种文件也要防将来）")
    void bomIsNotBlindlyRequiredForAsciiOnlyScripts() throws IOException {
        for (Path p : powerShellScripts()) {
            byte[] bytes = Files.readAllBytes(p);
            if (!hasNonAscii(bytes)) {
                continue;   // 纯 ASCII 脚本加不加 BOM 都能跑,这条测试不管它
            }
            // 含非 ASCII 的必须带 —— 与第一条同一约束,这里只是把「纯 ASCII 不强制」写清
            assertTrue(hasBom(bytes), p + " 含非 ASCII,必须带 BOM");
        }
        // 用一个纯 ASCII 内容验一下判定函数本身没有把 ASCII 误判成非 ASCII
        assertTrue(!hasNonAscii("Write-Host 'ok'".getBytes(StandardCharsets.UTF_8)));
    }
}
