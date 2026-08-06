package com.lyhn.wraith.git;

import java.util.List;

/**
 * 用户**真实仓库**的只读状态快照。
 *
 * <p>与 {@code snapshot/}（Side-Git 影子仓库）刻意分开：这里描述的是用户自己的 {@code .git}，
 * 本包任何代码都不写它。
 *
 * @param repo       有没有 .git。false 时其余字段一律零值，调用方不该读
 * @param state      normal | detached | unborn
 * @param branch     分支名；detached 时是短 sha
 * @param upstream   如 origin/main；没有上游时为 null
 * @param insertions 口径：git diff --shortstat HEAD（**含已 staged**）
 * @param untracked  未跟踪文件**个数**。刻意不计它们的行数 —— git 自己就不算，
 *                   硬算会让面板与用户敲 git 的结果对不上
 * @param filesTotal 截断前的真实变更文件数（files 最多 MAX_FILES 条）
 * @param error      本次取数失败的可读原因；成功为 null
 */
public record GitStatus(
        boolean repo,
        String root,
        String name,
        String state,
        String branch,
        String upstream,
        int ahead,
        int behind,
        int insertions,
        int deletions,
        int untracked,
        int filesTotal,
        List<FileEntry> files,
        List<Remote> remotes,
        String error) {

    public static final String STATE_NORMAL = "normal";
    public static final String STATE_DETACHED = "detached";
    public static final String STATE_UNBORN = "unborn";

    /**
     * @param xy     porcelain v2 的两字符状态：X=暂存区相对 HEAD，Y=工作区相对暂存区，'.'=该侧无改动
     * @param staged X != '.'
     */
    public record FileEntry(String path, String xy, boolean staged) {}

    public record Remote(String name, String url) {}

    /** 不是仓库。前端见 repo=false 就整块不渲染，所以其余字段的值无所谓，给零值即可。 */
    public static GitStatus noRepo() {
        return new GitStatus(false, "", "", STATE_NORMAL, "", null,
                0, 0, 0, 0, 0, 0, List.of(), List.of(), null);
    }

    /** 取数失败但确实是仓库：保留已知的 root，其余零值，原因放 error。 */
    public static GitStatus failed(String root, String reason) {
        return new GitStatus(true, root, basename(root), STATE_NORMAL, "", null,
                0, 0, 0, 0, 0, 0, List.of(), List.of(), reason);
    }

    static String basename(String path) {
        if (path == null || path.isBlank()) return "";
        String p = path.replace('\\', '/');
        while (p.endsWith("/")) p = p.substring(0, p.length() - 1);
        int i = p.lastIndexOf('/');
        return i < 0 ? p : p.substring(i + 1);
    }
}
