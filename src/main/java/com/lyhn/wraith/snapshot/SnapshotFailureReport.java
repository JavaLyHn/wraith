package com.lyhn.wraith.snapshot;

import java.util.Locale;

/**
 * 把快照失败翻译成<b>看得出原因</b>的一行。
 *
 * <p><b>起因</b>（用户 Windows 实测）：
 * <pre>
 * [!] pre-turn 快照失败: Exception caught
 * [!] post-turn 快照失败: Exception caught during execution of add command
 * </pre>
 * 这两句<b>什么信息都没给</b>。第二句是 JGit {@code AddCommand} 的顶层消息
 * （{@code JGitInternalException}），真正的原因在 {@code cause} 里 ——
 * 而 {@code SnapshotService} 当时只打了 {@code e.getMessage()}，把整条 cause 链丢掉了。
 * 于是「哪个文件、什么原因」完全不可知，只能靠猜（我第一反应是 {@code node_modules}，
 * 可它本来就在默认 exclude 里）。
 *
 * <p>所以这里做三件事：
 * <ol>
 *   <li><b>展开 cause 链</b>——JGit 的真实原因往下两层才出现；</li>
 *   <li>对<b>能确定</b>的形态给一句可行动的话（Windows 路径过长 / 文件被占用 / 权限）；
 *       不能确定的一律不猜，只把原文摆出来；</li>
 *   <li>附上关掉快照的办法。快照失败<b>不影响对话</b>（异常被 catch 住了），
 *       但每轮刷两行错误很吵，用户得知道怎么让它安静。</li>
 * </ol>
 */
public final class SnapshotFailureReport {

    private SnapshotFailureReport() {
    }

    /** 关掉快照的办法。快照失败不阻塞对话，但用户要能让它闭嘴。 */
    static final String HOW_TO_DISABLE =
            "（不想要快照可以关掉：设 WRAITH_SNAPSHOT_ENABLED=false，或 -Dwraith.snapshot.enabled=false）";

    /**
     * @param phase 人话阶段名，如 {@code pre-turn}
     * @return 要打给用户的完整多行文本（不含尾换行）
     */
    public static String describe(String phase, Throwable error) {
        StringBuilder sb = new StringBuilder();
        sb.append("⚠️ ").append(phase).append(" 快照失败：").append(chain(error));
        String hint = actionableHint(error);
        if (!hint.isEmpty()) {
            sb.append('\n').append("   ").append(hint);
        }
        sb.append('\n').append("   ").append(HOW_TO_DISABLE);
        return sb.toString();
    }

    /**
     * 完整 cause 链，一行。
     *
     * <p>JGit 的形态是
     * {@code JGitInternalException: Exception caught during execution of add command}
     * → {@code cause = IOException: <真正的文件与原因>}。只看第一层等于什么都没看。
     */
    static String chain(Throwable error) {
        if (error == null) {
            return "(无异常对象)";
        }
        StringBuilder sb = new StringBuilder();
        Throwable t = error;
        int depth = 0;
        while (t != null && depth < 6) {
            if (depth > 0) {
                sb.append("  ← ");
            }
            sb.append(t.getClass().getSimpleName());
            String msg = t.getMessage();
            if (msg != null && !msg.isBlank()) {
                sb.append(": ").append(msg.trim());
            }
            if (t.getCause() == t) {
                break;
            }
            t = t.getCause();
            depth++;
        }
        return sb.toString();
    }

    /**
     * 只在<b>能确定</b>的形态上说话；其余返回空串。
     *
     * <p>纪律与 {@code EmbeddingErrorHint} 一致 —— 不知道就不说，
     * 猜错方向比不给建议更浪费时间。
     */
    static String actionableHint(Throwable error) {
        String all = flatten(error).toLowerCase(Locale.ROOT);
        if (all.isEmpty()) {
            return "";
        }
        if (all.contains("filename too long") || all.contains("path too long")
                || all.contains("文件名或扩展名太长") || all.contains("name too long")) {
            return "看起来是**路径过长**（Windows 默认上限 260 字符）。"
                    + "把仓库挪到更短的路径下，或给这类目录加排除："
                    + "WRAITH_SNAPSHOT_EXCLUDES=某目录名";
        }
        if (all.contains("being used by another process") || all.contains("另一个程序正在使用")
                || all.contains("access is denied") || all.contains("拒绝访问")
                || all.contains("accessdenied")) {
            return "看起来是**文件被占用或没有权限**（Windows 上杀软/索引器/正在运行的构建都会锁文件）。"
                    + "把占用方停掉，或把那个目录排除：WRAITH_SNAPSHOT_EXCLUDES=某目录名";
        }
        if (all.contains("no space left") || all.contains("磁盘空间不足")) {
            return "**磁盘空间不足**。快照目录默认在 ~/.wraith/snapshots，可用 /snapshot clean 清理。";
        }
        if (all.contains("index.lock") || all.contains("cannot lock")) {
            return "Side-Git 的 index 被锁住了。多半是上一次快照被强杀留下的 index.lock，"
                    + "删掉 ~/.wraith/snapshots/<项目>/*/index.lock 再试。";
        }
        return "";
    }

    /** 把整条 cause 链的类名与消息拼成一个串，供关键词匹配。 */
    private static String flatten(Throwable error) {
        StringBuilder sb = new StringBuilder();
        Throwable t = error;
        int depth = 0;
        while (t != null && depth < 8) {
            sb.append(t.getClass().getName()).append(' ');
            if (t.getMessage() != null) {
                sb.append(t.getMessage()).append(' ');
            }
            if (t.getCause() == t) {
                break;
            }
            t = t.getCause();
            depth++;
        }
        return sb.toString();
    }
}
