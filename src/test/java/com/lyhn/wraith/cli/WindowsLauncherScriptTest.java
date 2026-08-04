package com.lyhn.wraith.cli;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Windows 短命令的 {@code .cmd} 必须是<b>纯 ASCII + CRLF</b>。
 *
 * <p>这是 {@link com.lyhn.wraith.policy.sandbox.PowerShellBomTest} 那一课的第二半 ——
 * 当初只给 {@code .ps1} 钉了 BOM，{@code .cmd} 没人管，于是同一个根因换了个壳又咬了一次。
 *
 * <p><b>症状</b>（用户实测，中文 Windows）：
 * <pre>
 * PS C:\Users\LyHn&gt; wraith
 * 'app-server' 不是内部或外部命令，也不是可运行的程序
 *   鑻ヨ繛 wraith-install 閮芥壘涓嶅埌,璇存槑鐭懡浠ゆ病瑁呭叏,鍦ㄤ粨搴撴牴璺?
 * </pre>
 * 乱码那行是脚本自己的中文（{@code 若连 wraith-install 都找不到…}）；而
 * {@code app-server} 这个词在整个启动器里<b>只出现在 rem 注释和 :usage 里</b>，
 * 两处都不该在无参调用时执行。
 *
 * <p><b>根因</b>：{@code cmd.exe} 按 <b>OEM 码页</b>（中文 Windows = GBK/936）
 * <b>逐字节</b>解析批处理文件，并且对 DBCS 用的是「见到 lead byte 就盲目前进 2 字节」。
 * UTF-8 的中文是三字节，被错拆成 GBK 序列后，行尾常常剩下一个孤立 lead byte（0x81–0xFE），
 * 它会把<b>紧随其后的那一个字节吞掉</b>。而可被吞的范围里有两个要命的东西：
 * <ul>
 *   <li>{@code 0x0A}（换行）—— 相邻两行被并成一行；</li>
 *   <li>{@code 0x5E}（{@code ^}，批处理的转义符）—— {@code ^(} 变成裸 {@code (}，
 *       括号块提前闭合或永不闭合。</li>
 * </ul>
 *
 * <p><b>实测（字节级模拟，见下面的 lexAsCmd）</b>：
 * <ul>
 *   <li>{@code wraith-install.cmd}：物理 6 行 → cmd 眼里 <b>4 行</b>。第 3 行的 {@code rem}
 *       吞掉两个换行，把 {@code powershell -File wraith-install.ps1} <b>整行并进了自己的注释</b>
 *       —— 于是 {@code wraith-install} 静默空转，只执行 {@code @echo off} 与 {@code exit}，
 *       退出码还是 0。jar 从来没被构建过，用户却以为装好了。</li>
 *   <li>{@code wraith.cmd}：物理 72 行 → cmd 眼里 <b>66 行</b>，另有 42 个 ASCII 字节被吞，
 *       其中包含 {@code :usage} 段里 {@code echo   wraith app-server …^(} 的那个 {@code ^}。</li>
 * </ul>
 *
 * <p><b>为什么必须由测试守而不是「小心点写」</b>：这类破坏在 mac/Linux 上<b>完全看不见</b> ——
 * 文件是合法 UTF-8，编辑器渲染正常，git diff 正常。它只在 Windows、只在非 ASCII 码页下暴露，
 * 而且症状是<b>静默的错误行为</b>（install 什么都不做还返回成功），不是报错。
 * 任何人往 {@code .cmd} 里加一句中文注释就会重新引入它。
 *
 * <p>修法是消灭整个类别，不是补一处转义：{@code .cmd} 只留纯 ASCII，
 * 所有中文（注释与用户可见文案）搬到带 BOM 的 {@code wraith-msg.ps1}。
 */
class WindowsLauncherScriptTest {

    /** 仓库里所有 .cmd / .bat（跳过依赖与构建产物）。相对路径依赖 surefire 的工作目录=项目根。 */
    private static List<Path> batchScripts() throws IOException {
        List<Path> out = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(Path.of("."))) {
            walk.filter(Files::isRegularFile)
                    .filter(p -> {
                        String n = p.getFileName().toString();
                        return n.endsWith(".cmd") || n.endsWith(".bat");
                    })
                    .filter(p -> {
                        String s = p.toString().replace('\\', '/');
                        return !s.contains("/target/") && !s.contains("/node_modules/")
                                && !s.contains("/.git/") && !s.contains("/.claude/")
                                && !s.contains("/dist/") && !s.contains("/release/")
                                && !s.contains("/out/");
                    })
                    .forEach(out::add);
        }
        return out;
    }

    /**
     * 模拟 cmd.exe 在 GBK 码页下的字节级分行：见到 lead byte（0x81–0xFE）就盲目吃掉 2 字节，
     * 只在<b>没被吃掉的</b> {@code 0x0A} 处断行。
     *
     * <p>这不是「一种可能的解释」，而是把故障机制本身写成可执行的判据：
     * 纯 ASCII 文件里没有 lead byte，模拟结果必然与真实分行逐字节相同；
     * 一旦混进中文，行数就会对不上 —— 那正是 Windows 上真实发生的事。
     *
     * <p><b>判别力的触发条件（变异实测过，不是推测）</b>：
     * <ul>
     *   <li>奇数个中文字符（3 字节 × 奇数）+ LF 行尾 → 换行被吞，本条变红；</li>
     *   <li><b>偶数</b>个中文字符 + LF → 字节被 2 字节步长整齐吃完，换行存活，本条<b>不</b>红；</li>
     *   <li>奇数个中文字符 + <b>CRLF</b> → 被吞的是 CR，换行仍存活，本条<b>不</b>红。</li>
     * </ul>
     * 最后一条就是 {@link #everyBatchScriptUsesCrlf()} 存在的理由 ——
     * CR 是个「牺牲字节」，它挡掉了大部分吞换行的情形。所以这两条是<b>防御纵深</b>：
     * 真正的第一道防线是纯 ASCII（{@link #everyBatchScriptIsPureAscii()}），
     * 本条只在有人放宽了那条约束时兜住真实故障。
     */
    private static List<byte[]> lexAsCmd(byte[] data) {
        List<byte[]> lines = new ArrayList<>();
        ByteArrayOutputStream cur = new ByteArrayOutputStream();
        int i = 0;
        while (i < data.length) {
            int b = data[i] & 0xFF;
            if (b >= 0x81 && b <= 0xFE && i + 1 < data.length) {
                cur.write(data[i]);
                cur.write(data[i + 1]);
                i += 2;
                continue;
            }
            if (b == 0x0A) {
                lines.add(cur.toByteArray());
                cur.reset();
                i++;
                continue;
            }
            cur.write(data[i]);
            i++;
        }
        if (cur.size() > 0) {
            lines.add(cur.toByteArray());
        }
        return lines;
    }

    /** 真实分行（按 0x0A），用来跟 lexAsCmd 对照。 */
    private static List<byte[]> realLines(byte[] data) {
        List<byte[]> lines = new ArrayList<>();
        ByteArrayOutputStream cur = new ByteArrayOutputStream();
        for (byte value : data) {
            if ((value & 0xFF) == 0x0A) {
                lines.add(cur.toByteArray());
                cur.reset();
            } else {
                cur.write(value);
            }
        }
        if (cur.size() > 0) {
            lines.add(cur.toByteArray());
        }
        return lines;
    }

    @Test
    @DisplayName("每个 .cmd 都是纯 ASCII —— 中文会被 cmd.exe 按 GBK 拆掉,连带吞掉换行与 ^ 转义符")
    void everyBatchScriptIsPureAscii() throws IOException {
        List<Path> scripts = batchScripts();
        assertTrue(scripts.size() >= 2, "没扫到 .cmd,说明工作目录不对: " + scripts);

        List<String> offenders = new ArrayList<>();
        for (Path p : scripts) {
            byte[] bytes = Files.readAllBytes(p);
            List<Integer> bad = new ArrayList<>();
            for (int i = 0; i < bytes.length; i++) {
                if ((bytes[i] & 0xFF) > 0x7F) {
                    bad.add(i);
                }
            }
            if (!bad.isEmpty()) {
                offenders.add(p.normalize() + " —— " + bad.size() + " 个非 ASCII 字节,首个在偏移 " + bad.get(0));
            }
        }

        assertTrue(offenders.isEmpty(),
                "这些 .cmd 含非 ASCII。cmd.exe 用 OEM 码页逐字节解析批处理,中文会让行尾剩下孤立的 GBK\n"
                        + "lead byte,把紧随的换行符或 ^ 转义符吞掉 —— 脚本会静默地执行成别的东西。\n"
                        + "把中文搬到带 BOM 的 .ps1(如 scripts/windows/wraith-msg.ps1):\n  "
                        + String.join("\n  ", offenders));
    }

    @Test
    @DisplayName("**在 GBK 码页下解析出的行数必须与真实行数一致** —— 这是把故障机制本身写成判据")
    void batchScriptSurvivesGbkLexing() throws IOException {
        for (Path p : batchScripts()) {
            byte[] bytes = Files.readAllBytes(p);
            List<byte[]> real = realLines(bytes);
            List<byte[]> lexed = lexAsCmd(bytes);

            assertEquals(real.size(), lexed.size(),
                    p.normalize() + ": cmd.exe 在 GBK 码页下会把 " + real.size()
                            + " 行读成 " + lexed.size() + " 行 —— 有换行符被 GBK lead byte 吞掉了,"
                            + "相邻两行会被并成一条命令(实测 wraith-install.cmd 的 powershell 行"
                            + "就是这样被并进上一条 rem 注释,导致安装静默空转)");

            for (int i = 0; i < real.size(); i++) {
                assertEquals(new String(real.get(i), StandardCharsets.ISO_8859_1),
                        new String(lexed.get(i), StandardCharsets.ISO_8859_1),
                        p.normalize() + " 第 " + (i + 1) + " 行在 GBK 码页下内容被改写(有字节被吞)");
            }
        }
    }

    /**
     * CRLF 的实测作用：{@code CR}（0x0D）会被行尾那个孤立的 GBK lead byte 当成 trail byte 吃掉，
     * <b>换行因此得以存活</b>。LF-only 时没有这个牺牲字节，被吃掉的就是换行本身。
     *
     * <p>变异实测：同一句奇数长度的中文注释，LF 下让
     * {@link #batchScriptSurvivesGbkLexing()} 变红，CRLF 下不红。
     */
    @Test
    @DisplayName("每个 .cmd 用 CRLF 行尾 —— CR 是挡在换行前面的「牺牲字节」,LF-only 时换行直接被吞")
    void everyBatchScriptUsesCrlf() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (Path p : batchScripts()) {
            byte[] bytes = Files.readAllBytes(p);
            int bareLf = 0;
            for (int i = 0; i < bytes.length; i++) {
                if ((bytes[i] & 0xFF) == 0x0A && (i == 0 || (bytes[i - 1] & 0xFF) != 0x0D)) {
                    bareLf++;
                }
            }
            if (bareLf > 0) {
                offenders.add(p.normalize() + " —— " + bareLf + " 个裸 LF");
            }
        }
        assertTrue(offenders.isEmpty(),
                ".cmd 必须是 CRLF(仓库用 .gitattributes 的 `-text` 保证字节原样进出):\n  "
                        + String.join("\n  ", offenders));
    }

    /**
     * 与编码无关的第二个真实缺陷：{@code rem} <b>不</b>屏蔽重定向与管道。
     *
     * <p>{@code rem note > out.txt} 会真的创建一个空文件；{@code rem a|b} 也有执行 {@code b}
     * 的风险。改之前的 {@code wraith.cmd} 里就写着 {@code rem    wraith -d|--desktop   ...}，
     * 靠运气没炸而已。注释里想表达「或」就写逗号。
     */
    @Test
    @DisplayName("rem 注释里不许出现 | & 或 尖括号 —— cmd.exe 在 rem 行上照样解析管道与重定向")
    void remLinesCarryNoShellOperators() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (Path p : batchScripts()) {
            List<String> lines = Files.readAllLines(p, StandardCharsets.ISO_8859_1);
            for (int i = 0; i < lines.size(); i++) {
                String line = lines.get(i).trim();
                if (!line.toLowerCase(java.util.Locale.ROOT).startsWith("rem ")
                        && !line.equalsIgnoreCase("rem")) {
                    continue;
                }
                for (char c : new char[]{'|', '&', '>', '<'}) {
                    if (line.indexOf(c) >= 0) {
                        offenders.add(p.normalize() + ":" + (i + 1) + " 含 `" + c + "` -> " + line);
                        break;
                    }
                }
            }
        }
        assertTrue(offenders.isEmpty(),
                "rem 不屏蔽这些操作符 —— `rem note > f` 会真的建出文件,`rem a|b` 可能执行 b:\n  "
                        + String.join("\n  ", offenders));
    }

    @Test
    @DisplayName("wraith.cmd 把所有人类可读文案委派给 wraith-msg.ps1,且引用的 .ps1 真的存在")
    void humanFacingTextIsDelegatedToPowerShell() throws IOException {
        Path cmd = Path.of("scripts/windows/wraith.cmd");
        assertTrue(Files.exists(cmd), "找不到 " + cmd.toAbsolutePath());
        String body = Files.readString(cmd, StandardCharsets.US_ASCII);

        assertTrue(body.contains("wraith-msg.ps1"),
                "wraith.cmd 应把中文文案委派给 wraith-msg.ps1,而不是自己 echo 中文");
        assertTrue(Files.exists(Path.of("scripts/windows/wraith-msg.ps1")),
                "wraith.cmd 引用了 wraith-msg.ps1 但文件不存在");

        // 委派之后就不再需要 ^( ^) ^| 这类转义 —— 而它们正是被 GBK 吞掉的目标。
        // 留着等于把脆弱结构留在原地,下一个往文件里加中文的人就会重新引爆。
        assertTrue(!body.contains("^("), "wraith.cmd 仍有 ^( 转义 —— 文案该搬进 .ps1");
        assertTrue(!body.contains("^|"), "wraith.cmd 仍有 ^| 转义 —— 文案该搬进 .ps1");
    }

    @Test
    @DisplayName("wraith-msg.ps1 认得 wraith.cmd 会传给它的每一个话题 —— 否则提示会变成一片空白")
    void everyTopicPassedByCmdIsHandled() throws IOException {
        Path msg = Path.of("scripts/windows/wraith-msg.ps1");
        assertTrue(Files.exists(msg), "找不到 " + msg.toAbsolutePath());
        String ps = Files.readString(msg, StandardCharsets.UTF_8);
        String cmd = Files.readString(Path.of("scripts/windows/wraith.cmd"), StandardCharsets.US_ASCII);

        // wraith.cmd 里每一处 `wraith-msg.ps1" <topic>` 的 topic 都要在 ps1 的 switch 里有分支
        List<String> topics = new ArrayList<>();
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("wraith-msg\\.ps1\"\\s+([a-z][a-z0-9-]*)").matcher(cmd);
        while (m.find()) {
            topics.add(m.group(1));
        }
        assertTrue(topics.size() >= 2, "wraith.cmd 至少该委派 usage 与 nojar 两个话题,实际: " + topics);
        for (String t : topics) {
            assertTrue(ps.contains("'" + t + "'"),
                    "wraith-msg.ps1 没有处理话题 `" + t + "` —— wraith.cmd 会传它过来,结果是一片空白");
        }
    }
}
