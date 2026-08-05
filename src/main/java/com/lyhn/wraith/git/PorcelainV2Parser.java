package com.lyhn.wraith.git;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * `git status --porcelain=v2 --branch` + `git diff --shortstat HEAD` + `git remote -v` 的纯解析。
 *
 * <p><b>为什么单独成类且不碰 IO</b>：这一层是 bug 的集中地（分支头有五种形态、重命名是另一种记录、
 * 未跟踪与已跟踪要分开计），拆成纯函数才能用 fixture 字符串穷举，不必造真仓库
 * ——造真仓库的测试会跟着开发机的 git 状态漂移。
 *
 * <p><b>为什么用 v2 而不是 v1</b>：v2 把 detached（{@code # branch.head (detached)}）与
 * 新仓库无提交（{@code # branch.oid (initial)}）做成<b>显式记号</b>，v1 要靠猜。这两种状态都真实存在。
 *
 * <p><b>已知限制</b>：不用 {@code -z}，所以路径含制表符/换行时 git 会 C 风格转义，
 * 面板上会显示成带引号的转义形式。只读展示场景下这是外观问题而非正确性问题，
 * 换 {@code -z} 要把整个解析改成 NUL 切分，代价不值。
 */
public final class PorcelainV2Parser {

    /** files 最多带这么多条；超出由 filesTotal 体现。弹出层装不下更多，多传也是浪费。 */
    public static final int MAX_FILES = 20;

    private static final Pattern AB = Pattern.compile("^# branch\\.ab \\+(\\d+) -(\\d+)$");
    private static final Pattern SHORTSTAT_INS = Pattern.compile("(\\d+) insertion");
    private static final Pattern SHORTSTAT_DEL = Pattern.compile("(\\d+) deletion");

    /** 通用 URI scheme 前缀：字母开头，后面跟字母数字或 {@code +.-}，再跟 {@code ://}。 */
    private static final Pattern SCHEME = Pattern.compile("^([A-Za-z][A-Za-z0-9+.\\-]*)://");
    /** {@code normalizeRemoteUrl} 认识、会剥掉的四个前缀；其余带 scheme 的一律原样返回。 */
    private static final Set<String> KNOWN_SCHEMES = Set.of("ssh", "https", "http", "git");

    private PorcelainV2Parser() {}

    public static GitStatus parse(String root, String statusOut, String shortstatOut, String remotesOut) {
        String state = GitStatus.STATE_NORMAL;
        String branch = "";
        String upstream = null;
        int ahead = 0, behind = 0, untracked = 0, filesTotal = 0;
        List<GitStatus.FileEntry> files = new ArrayList<>();

        for (String line : (statusOut == null ? "" : statusOut).split("\n")) {
            if (line.isEmpty()) continue;
            if (line.startsWith("# branch.oid ")) {
                // "(initial)" = 还没有任何提交。此时没有 HEAD，diff HEAD 会失败
                if (line.endsWith("(initial)")) state = GitStatus.STATE_UNBORN;
            } else if (line.startsWith("# branch.head ")) {
                String v = line.substring("# branch.head ".length()).trim();
                if ("(detached)".equals(v)) state = GitStatus.STATE_DETACHED;
                else branch = v;
            } else if (line.startsWith("# branch.upstream ")) {
                upstream = line.substring("# branch.upstream ".length()).trim();
            } else if (line.startsWith("# branch.ab ")) {
                Matcher m = AB.matcher(line);
                if (m.matches()) { ahead = Integer.parseInt(m.group(1)); behind = Integer.parseInt(m.group(2)); }
            } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
                filesTotal++;
                if (files.size() < MAX_FILES) files.add(entry(line));
            } else if (line.startsWith("? ")) {
                untracked++;   // 只计数：git 不统计未跟踪文件的行数，我们也不算
            }
            // "u " (unmerged) 与 "! " (ignored) 本期不显示，见 spec §9
        }

        // detached 时 branch.head 是 "(detached)"，真正的短 sha 从 branch.oid 取
        if (GitStatus.STATE_DETACHED.equals(state)) {
            branch = shortOid(statusOut);
            upstream = null;   // 游离态没有上游，ahead/behind 无意义
            ahead = 0; behind = 0;
        }

        int insertions = 0, deletions = 0;
        if (!GitStatus.STATE_UNBORN.equals(state) && shortstatOut != null) {
            insertions = firstInt(SHORTSTAT_INS, shortstatOut);
            deletions = firstInt(SHORTSTAT_DEL, shortstatOut);
        }

        return new GitStatus(true, root, GitStatus.basename(root), state, branch, upstream,
                ahead, behind, insertions, deletions, untracked, filesTotal,
                List.copyOf(files), parseRemotes(remotesOut), null);
    }

    /**
     * `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` —— 路径前固定 8 个字段。
     * `2` 记录（重命名/复制）比 `1` 多一个 `<X><score>` 字段（如 {@code R100}），
     * 真机验证过（本地建仓 + {@code git mv} 触发的重命名）：路径前固定 9 个字段，
     * 位置是 `<path>\t<origPath>`，取前半即新路径。两种记录字段数不同，
     * 沿用同一个 limit=9 会把 score 吞进路径。
     */
    private static GitStatus.FileEntry entry(String line) {
        boolean renamedOrCopied = line.startsWith("2 ");
        String[] parts = line.split(" ", renamedOrCopied ? 10 : 9);
        String xy = parts.length > 1 ? parts[1] : "..";
        int pathIdx = renamedOrCopied ? 9 : 8;
        String path = parts.length > pathIdx ? parts[pathIdx] : "";
        int tab = path.indexOf('\t');
        if (tab >= 0) path = path.substring(0, tab);
        return new GitStatus.FileEntry(path, xy, !xy.isEmpty() && xy.charAt(0) != '.');
    }

    private static String shortOid(String statusOut) {
        for (String line : (statusOut == null ? "" : statusOut).split("\n")) {
            if (line.startsWith("# branch.oid ")) {
                String oid = line.substring("# branch.oid ".length()).trim();
                return oid.length() > 7 ? oid.substring(0, 7) : oid;
            }
        }
        return "";
    }

    private static int firstInt(Pattern p, String text) {
        Matcher m = p.matcher(text);
        return m.find() ? Integer.parseInt(m.group(1)) : 0;
    }

    /** `git remote -v` 每个 remote 两行（fetch/push）。按名字去重，保留先出现的那条。 */
    static List<GitStatus.Remote> parseRemotes(String remotesOut) {
        Map<String, String> byName = new LinkedHashMap<>();
        for (String line : (remotesOut == null ? "" : remotesOut).split("\n")) {
            if (line.isBlank()) continue;
            String[] parts = line.trim().split("\\s+");
            if (parts.length < 2) continue;
            byName.putIfAbsent(parts[0], normalizeRemoteUrl(parts[1]));
        }
        List<GitStatus.Remote> out = new ArrayList<>();
        byName.forEach((n, u) -> out.add(new GitStatus.Remote(n, u)));
        return List.copyOf(out);
    }

    /**
     * 把 remote URL 收成 {@code host/owner/repo} 这种人读的形态。
     *
     * <p>真机抓到的是 {@code git@github.com:JavaLyHn/wraith.git} —— SSH 形式。
     * 直接展示原样太吵（协议、用户名、.git 后缀都是噪音），所以统一规范化。
     * <b>认不出来的形态原样返回</b>（本地路径、自建协议）：猜错比不动更糟。
     *
     * <p><b>为什么先单独判断 scheme 再决定要不要剥</b>：下面的 scp 式冒号替换
     * （{@code :(?=\D) → /}）只认「{@code host:path}」这种<i>没有</i> scheme 的形态。
     * 如果一个 URL 带着未知 scheme（如 {@code file://}、{@code ftp://}、自建
     * {@code perforce://}）直接往下走，scheme 自己那个冒号会被当成 host:path 的
     * 分隔符替换掉，把整串 URL 搅烂（{@code file:///srv/repo.git} 会变成
     * {@code file////srv/repo}）。所以：认出已知 scheme 才剥前缀继续规范化；
     * 认出未知 scheme 就立刻原样返回，一个字符都不改——绝不能落进冒号替换那一步。
     */
    public static String normalizeRemoteUrl(String raw) {
        if (raw == null || raw.isBlank()) return "";
        String s = raw.trim();
        Matcher schemeMatch = SCHEME.matcher(s);
        if (schemeMatch.find()) {
            if (KNOWN_SCHEMES.contains(schemeMatch.group(1).toLowerCase())) {
                s = s.substring(schemeMatch.end());
            } else {
                return s;   // 未知 scheme：原样返回，不参与后续任何改写
            }
        }
        int at = s.indexOf('@');
        int slash = s.indexOf('/');
        // 只在 @ 出现在第一个 / 之前时才当用户名剥掉，否则可能是路径里的 @
        if (at >= 0 && (slash < 0 || at < slash)) s = s.substring(at + 1);
        s = s.replaceFirst(":(?=\\D)", "/");   // scp 式 host:path → host/path；host:22/ 这种端口不动
        if (s.endsWith(".git")) s = s.substring(0, s.length() - 4);
        return s;
    }
}
