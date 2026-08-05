package com.lyhn.wraith.git;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class GitStatusReaderTest {

    /** 按 argv 前两个词分派假输出。测试绝不碰真 git —— 那会让结果随开发机漂移。 */
    private static GitStatusReader.CommandRunner fake(java.util.Map<String, GitStatusReader.Result> table) {
        return (argv, cwd) -> {
            String key = argv.size() >= 2 ? argv.get(1) : "";
            GitStatusReader.Result r = table.get(key);
            if (r == null) throw new IllegalStateException("测试没给 " + key + " 准备输出");
            return r;
        };
    }

    @Test
    void nonZeroRevParseMeansNotARepoAndSkipsEverythingElse() {
        GitStatus s = GitStatusReader.read("/tmp/plain-dir", fake(java.util.Map.of(
                "rev-parse", new GitStatusReader.Result(128, ""))));
        assertFalse(s.repo(), "rev-parse 非零 = 不是仓库");
        assertNull(s.error(), "「不是仓库」是正常情况，不是错误");
    }

    @Test
    void gitNotOnPathDegradesToNoRepoNotToError() {
        GitStatus s = GitStatusReader.read("/tmp/x", (argv, cwd) -> {
            throw new java.io.IOException("Cannot run program \"git\"");
        });
        assertFalse(s.repo(), "git 不在 PATH 时前端什么都不渲染，所以按 noRepo 处理");
    }

    @Test
    void unbornSkipsDiffEntirely() {
        List<String> called = new java.util.ArrayList<>();
        GitStatus s = GitStatusReader.read("/r/new", (argv, cwd) -> {
            called.add(argv.get(1));
            return switch (argv.get(1)) {
                case "rev-parse" -> new GitStatusReader.Result(0, "/r/new\n");
                case "status" -> new GitStatusReader.Result(0,
                        "# branch.oid (initial)\n# branch.head main\n");
                case "remote" -> new GitStatusReader.Result(0, "");
                default -> throw new IllegalStateException("不该跑 " + argv.get(1));
            };
        });
        assertEquals(GitStatus.STATE_UNBORN, s.state());
        assertFalse(called.contains("diff"), "unborn 没有 HEAD，diff 必须跳过");
    }

    @Test
    void remoteFailureDoesNotPoisonTheRestOfTheResult() {
        GitStatus s = GitStatusReader.read("/r/p", (argv, cwd) -> switch (argv.get(1)) {
            case "rev-parse" -> new GitStatusReader.Result(0, "/r/p\n");
            case "status" -> new GitStatusReader.Result(0,
                    "# branch.oid abc1234\n# branch.head main\n");
            case "diff" -> new GitStatusReader.Result(0, " 1 file changed, 5 insertions(+)");
            case "remote" -> new GitStatusReader.Result(1, "");
            default -> throw new IllegalStateException();
        });
        assertNull(s.error(), "remote 是锦上添花，失败不该让整个 pill 变错误态");
        assertEquals("main", s.branch());
        assertEquals(5, s.insertions());
        assertTrue(s.remotes().isEmpty());
    }

    @Test
    void statusFailureReturnsErrorButKeepsRoot() {
        GitStatus s = GitStatusReader.read("/r/p", (argv, cwd) -> switch (argv.get(1)) {
            case "rev-parse" -> new GitStatusReader.Result(0, "/r/p\n");
            case "status" -> new GitStatusReader.Result(128, "");
            default -> throw new IllegalStateException();
        });
        assertTrue(s.repo());
        assertNotNull(s.error(), "确实是仓库但取不到状态 —— 必须说出来，不许静默给零值");
        assertEquals("/r/p", s.root());
    }

    @Test
    void rootComesFromRevParseNotFromTheArgument() {
        // 传进来的是子目录，仓库根应是 rev-parse 回的那个
        GitStatus s = GitStatusReader.read("/r/p/sub/dir", (argv, cwd) -> switch (argv.get(1)) {
            case "rev-parse" -> new GitStatusReader.Result(0, "/r/p\n");
            case "status" -> new GitStatusReader.Result(0,
                    "# branch.oid abc1234\n# branch.head main\n");
            case "diff" -> new GitStatusReader.Result(0, "");
            case "remote" -> new GitStatusReader.Result(0, "");
            default -> throw new IllegalStateException();
        });
        assertEquals("/r/p", s.root());
        assertEquals("p", s.name(), "pill 上显示的是仓库名，不是当前子目录名");
    }
}
