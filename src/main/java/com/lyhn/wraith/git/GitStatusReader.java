package com.lyhn.wraith.git;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 读用户真实仓库的状态：spawn {@code git}，按序执行四条命令，任何一步失败都优雅降级。
 *
 * <p><b>为什么直接 ProcessBuilder 而不走 execute_command</b>：那条路是命令沙箱
 * （Seatbelt / AppContainer，默认禁网限写）+ 60 秒超时 + HITL 审批弹窗。用它读 git
 * 会同时踩这三样，而这里只是读本地仓库状态。
 *
 * <p><b>为什么不用 JGit</b>（虽然它已在依赖里）：面板显示的数字必须与用户在终端敲
 * {@code git diff --shortstat} 得到的完全一致。JGit 与 git 的已知语义差异
 * （.gitignore 规则、CRLF、submodule）恰好都落在「哪些文件算变更」上，正是本类要报的东西。
 * 一旦不一致，这个面板就是负资产 —— 用户不再相信它，且无法解释差在哪。
 *
 * <p><b>为什么命令执行器是注入的</b>：测试绝不能跑真 git —— 本仓库自己的 git 状态一直在变，
 * 那种测试会随机变红（既有教训见 docs/superpowers/specs 里的隔离测试那条）。
 */
public final class GitStatusReader {
    private static final Logger log = LoggerFactory.getLogger(GitStatusReader.class);

    /** 单条命令的硬超时。网络文件系统上的仓库或巨大 untracked 树可能让 git 挂很久，
     *  不能拖住 RPC 线程 —— dispatchAsync 那个「点一个按钮整个桌面没反应」的坑已踩过一次。 */
    public static final int TIMEOUT_SECONDS = 3;

    public record Result(int exitCode, String stdout) {}

    /** 单条命令的执行抽象。抛异常 = 压根起不来（git 不在 PATH 之类）。 */
    public interface CommandRunner {
        Result run(List<String> argv, Path cwd) throws Exception;
    }

    private GitStatusReader() {}

    public static GitStatus read(String workspaceRoot) {
        return read(workspaceRoot, GitStatusReader::spawn);
    }

    public static GitStatus read(String workspaceRoot, CommandRunner runner) {
        if (workspaceRoot == null || workspaceRoot.isBlank()) return GitStatus.noRepo();
        Path cwd = Path.of(workspaceRoot);

        String root;
        try {
            Result rp = runner.run(List.of("git", "rev-parse", "--show-toplevel"), cwd);
            if (rp.exitCode() != 0) return GitStatus.noRepo();   // 不是仓库 = 正常情况，不是错误
            root = rp.stdout().strip();
            if (root.isEmpty()) return GitStatus.noRepo();
        } catch (Exception e) {
            // git 不在 PATH / 起不来。前端见 repo=false 就整块不渲染 ——
            // 用户没要求这个功能，不该为它弹错误。原因只进 log。
            log.debug("git rev-parse 失败，按「无仓库」处理: {}", e.getMessage());
            return GitStatus.noRepo();
        }

        String statusOut;
        try {
            Result st = runner.run(List.of("git", "status", "--porcelain=v2", "--branch"), cwd);
            if (st.exitCode() != 0) return GitStatus.failed(root, "git status 退出码 " + st.exitCode());
            statusOut = st.stdout();
        } catch (Exception e) {
            return GitStatus.failed(root, "git status 失败：" + e.getMessage());
        }

        boolean unborn = statusOut.contains("# branch.oid (initial)");
        String shortstatOut = "";
        if (!unborn) {
            try {
                Result df = runner.run(List.of("git", "diff", "--shortstat", "HEAD"), cwd);
                if (df.exitCode() == 0) shortstatOut = df.stdout();
            } catch (Exception e) {
                log.debug("git diff --shortstat 失败，行数按 0 显示: {}", e.getMessage());
            }
        }

        // remote 失败只让 remotes 为空 —— 它是锦上添花，不该让整个 pill 变错误态
        String remotesOut = "";
        try {
            Result rm = runner.run(List.of("git", "remote", "-v"), cwd);
            if (rm.exitCode() == 0) remotesOut = rm.stdout();
        } catch (Exception e) {
            log.debug("git remote -v 失败，remote 列表留空: {}", e.getMessage());
        }

        return PorcelainV2Parser.parse(root, statusOut, shortstatOut, remotesOut);
    }

    /** 生产实现。超时即销毁进程树并抛，由上层转成降级结果。 */
    private static Result spawn(List<String> argv, Path cwd) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(argv);
        pb.directory(cwd.toFile());
        pb.redirectErrorStream(false);   // stderr 不混进 stdout，否则会污染解析
        Process p = pb.start();
        String out;
        try (InputStream in = p.getInputStream()) {
            out = readAll(in);
        }
        if (!p.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            p.destroyForcibly();
            throw new java.util.concurrent.TimeoutException("git 超过 " + TIMEOUT_SECONDS + " 秒未返回");
        }
        return new Result(p.exitValue(), out);
    }

    private static String readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        // git 的路径按字节输出。UTF-8 解码是绝大多数场景的正确选择；
        // 非 UTF-8 文件名会显示成替换符，属于外观问题，不影响其余字段。
        return buf.toString(StandardCharsets.UTF_8);
    }
}
