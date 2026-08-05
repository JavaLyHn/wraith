package com.lyhn.wraith.git;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PorcelainV2ParserTest {

    /** 真机抓的输出（本仓库 2026-08-05），不是手编的 —— 手编 fixture 是「替身不像真环境」的源头。 */
    private static final String REAL_STATUS = """
            # branch.oid b0f502b126193cb88fa834dfe58288555c552a6a
            # branch.head feat/windows-parity-block1
            # branch.upstream origin/feat/windows-parity-block1
            # branch.ab +1 -0
            1 .M N... 100644 100644 100644 f39ed7bb f39ed7bb README.md
            1 .M N... 100644 100644 100644 eeb32a31 eeb32a31 desktop/src/main/index.ts
            ? scripts/cli-pty/
            """;

    @Test
    void parsesBranchHeaderAndAheadBehind() {
        GitStatus s = PorcelainV2Parser.parse("/Users/x/wraith", REAL_STATUS,
                " 15 files changed, 524 insertions(+), 26 deletions(-)", "");
        assertTrue(s.repo());
        assertEquals("wraith", s.name());
        assertEquals(GitStatus.STATE_NORMAL, s.state());
        assertEquals("feat/windows-parity-block1", s.branch());
        assertEquals("origin/feat/windows-parity-block1", s.upstream());
        assertEquals(1, s.ahead());
        assertEquals(0, s.behind());
        assertEquals(524, s.insertions());
        assertEquals(26, s.deletions());
        assertEquals(1, s.untracked(), "? 记录只计数，不进 files");
        assertEquals(2, s.filesTotal());
        assertEquals(".M", s.files().get(0).xy());
        assertFalse(s.files().get(0).staged(), "X 是 '.' 说明没 stage");
        assertEquals("README.md", s.files().get(0).path());
    }

    @Test
    void detachedHeadUsesShortOidAndDropsUpstream() {
        String out = """
                # branch.oid a1b2c3d4e5f6a7b8c9d0
                # branch.head (detached)
                """;
        GitStatus s = PorcelainV2Parser.parse("/r/proj", out, "", "");
        assertEquals(GitStatus.STATE_DETACHED, s.state());
        assertEquals("a1b2c3d", s.branch(), "游离态显示短 sha");
        assertNull(s.upstream(), "游离态没有上游");
        assertEquals(0, s.ahead());
    }

    @Test
    void unbornBranchReportsZeroLinesBecauseThereIsNoHead() {
        String out = """
                # branch.oid (initial)
                # branch.head main
                ? README.md
                """;
        // 调用方在 unborn 时压根不会跑 diff HEAD；这里传个非空值验证它被忽略
        GitStatus s = PorcelainV2Parser.parse("/r/new", out,
                " 9 files changed, 999 insertions(+)", "");
        assertEquals(GitStatus.STATE_UNBORN, s.state());
        assertEquals("main", s.branch());
        assertEquals(0, s.insertions(), "unborn 时行数必须是 0，不许用 diff 的值");
        assertEquals(1, s.untracked());
    }

    @Test
    void missingUpstreamIsNullNotEmptyString() {
        String out = """
                # branch.oid abc1234
                # branch.head local-only
                """;
        assertNull(PorcelainV2Parser.parse("/r/p", out, "", "").upstream());
    }

    @Test
    void renameRecordTakesTheNewPath() {
        String out = "2 R. N... 100644 100644 100644 aaa bbb R100 new/path.java\told/path.java\n";
        GitStatus s = PorcelainV2Parser.parse("/r/p", out, "", "");
        assertEquals(1, s.filesTotal());
        assertEquals("new/path.java", s.files().get(0).path());
        assertTrue(s.files().get(0).staged(), "R. 的 X 是 R，算已 stage");
    }

    @Test
    void stagedFlagComesFromXNotY() {
        String out = """
                # branch.oid abc1234
                # branch.head main
                1 M. N... 100644 100644 100644 a a staged-only.txt
                1 .M N... 100644 100644 100644 b b worktree-only.txt
                1 MM N... 100644 100644 100644 c c both.txt
                """;
        GitStatus s = PorcelainV2Parser.parse("/r/p", out, "", "");
        assertTrue(s.files().get(0).staged());
        assertFalse(s.files().get(1).staged());
        assertTrue(s.files().get(2).staged());
    }

    @Test
    void filesAreCappedButTotalIsNot() {
        StringBuilder sb = new StringBuilder("# branch.oid abc1234\n# branch.head main\n");
        for (int i = 0; i < PorcelainV2Parser.MAX_FILES + 5; i++) {
            sb.append("1 .M N... 100644 100644 100644 a a f").append(i).append(".txt\n");
        }
        GitStatus s = PorcelainV2Parser.parse("/r/p", sb.toString(), "", "");
        assertEquals(PorcelainV2Parser.MAX_FILES, s.files().size());
        assertEquals(PorcelainV2Parser.MAX_FILES + 5, s.filesTotal(), "截断不该影响总数");
    }

    @Test
    void emptyStatusMeansCleanTree() {
        GitStatus s = PorcelainV2Parser.parse("/r/p", "", "", "");
        assertTrue(s.repo());
        assertEquals(0, s.filesTotal());
        assertEquals(0, s.insertions());
        assertTrue(s.files().isEmpty());
    }

    @Test
    void remotesDedupeFetchAndPushAndNormalizeUrls() {
        // 真机抓的形态：同一个 remote 两行，SSH 式 URL
        String out = """
                origin\tgit@github.com:JavaLyHn/wraith.git (fetch)
                origin\tgit@github.com:JavaLyHn/wraith.git (push)
                fork\thttps://gitlab.com/someone/wraith.git (fetch)
                """;
        GitStatus s = PorcelainV2Parser.parse("/r/p", "", "", out);
        assertEquals(2, s.remotes().size(), "fetch/push 两行只算一个 remote");
        assertEquals("origin", s.remotes().get(0).name());
        assertEquals("github.com/JavaLyHn/wraith", s.remotes().get(0).url());
        assertEquals("gitlab.com/someone/wraith", s.remotes().get(1).url());
    }

    @Test
    void unrecognizedRemoteUrlIsLeftAlone() {
        // 本地路径与自建协议：猜错比不动更糟
        assertEquals("/srv/git/proj", PorcelainV2Parser.normalizeRemoteUrl("/srv/git/proj"));
        assertEquals("host/a/b", PorcelainV2Parser.normalizeRemoteUrl("ssh://git@host/a/b.git"));
    }
}
