# 顶栏 Git pill 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端顶栏常驻一个只读 Git pill——项目里有 `.git` 就显示分支与变更行数，点开是弹出层（分支 / ahead-behind / 变更文件 / remote）。

**Architecture:** 后端新包 `com.lyhn.wraith.git` 直接 `ProcessBuilder` spawn `git`（不用 JGit、不走 `execute_command`），解析 `--porcelain=v2` 输出；经 `git.status` JSON-RPC 出到桌面；前端 `GitPill.tsx` 挂在 `TopBar`，事件驱动刷新。解析器是纯函数、与 spawn 分离，因此可用 fixture 字符串测试而不需要真仓库。

**Tech Stack:** Java 17 · JUnit 5 · Electron/React 19 · TypeScript · vitest · Testing Library

**Spec:** `docs/superpowers/specs/2026-08-05-desktop-git-pill-design.md`

## Global Constraints

- **只读。** 任何任务都不得引入写仓库的操作（commit / push / checkout / PR）。
- **不得走 `execute_command`**，也不得复用 `ToolRegistry` 的命令路径——那是沙箱 + 60 秒超时 + HITL 弹窗的层。只用 `ProcessBuilder`。
- **不得引入新依赖。** 不用 JGit（已在 `pom.xml` 但只服务 `snapshot/`）。
- **行数口径写死**：`git diff --shortstat HEAD`（含已 staged）；**未跟踪文件不算行数**，只报个数。
- **git 硬超时 3 秒**，超时返回带 `error` 的结果，不抛、不阻塞。
- **没有 `.git` 或 `git` 不在 PATH 时前端什么都不渲染**，原因只进 log，不弹窗。
- **不写依赖真实仓库的测试**——本仓库自己的 git 状态一直在变，那种测试会随机变红。
- **桌面测试不得用 `@testing-library/jest-dom` 的匹配器**（`toBeEmptyDOMElement` / `toBeInTheDocument` / `toHaveTextContent` 等）——**本项目没装它**。用 `queryByTestId(...)` / `container.querySelector(...)` → `toBeNull()`、`toBeTruthy()`、`.textContent` 这套（既有写法见 `test/accountRowAndSandboxChip.test.tsx`）。
- **不得引入新 npm 依赖。** 计划用到的 `lucide-react` 图标 `GitBranch` / `RefreshCw` / `Link2` / `FileDiff` 已预检存在（lucide-react 1.24.0）。
- 中文注释与文案；解释「为什么」而不是「做了什么」。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/main/java/com/lyhn/wraith/git/GitStatus.java` | 数据契约（record） |
| `src/main/java/com/lyhn/wraith/git/PorcelainV2Parser.java` | **纯函数**：三段 git 输出 → `GitStatus`。含 remote URL 规范化 |
| `src/main/java/com/lyhn/wraith/git/GitStatusReader.java` | spawn / 超时 / 按序执行 / 降级。命令执行器以函数注入 |
| `src/test/java/com/lyhn/wraith/git/PorcelainV2ParserTest.java` | fixture 字符串，八种输入 |
| `src/test/java/com/lyhn/wraith/git/GitStatusReaderTest.java` | 假执行器，四种失败路径 |
| `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java` | `SessionRunner.gitStatus()` 默认方法 + `case "git.status"` |
| `src/main/java/com/lyhn/wraith/cli/Main.java` | app-server 匿名实现，绑到会话的 workspace root |
| `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerGitStatusTest.java` | RPC 分发与回包形状 |
| `desktop/src/shared/types.ts` | `GitStatusView` |
| `desktop/src/main/index.ts` | `wraith:gitStatus` IPC |
| `desktop/src/preload/index.ts` | `window.wraith.gitStatus()` |
| `desktop/src/renderer/lib/gitPill.ts` | **纯函数**：`GitStatusView` → pill 文案。与组件分离便于穷举测状态 |
| `desktop/src/renderer/components/GitPill.tsx` | pill + 弹出层 |
| `desktop/src/renderer/components/TopBar.tsx` | 挂载 |
| `desktop/src/renderer/App.tsx` | 取数 + `turn.completed` 后刷新 |
| `desktop/test/gitPill.test.ts` | 文案纯函数，五种状态 |
| `desktop/test/gitPillComponent.test.tsx` | 组件渲染 + 刷新次数 |

**为什么把 pill 文案抽成 `lib/gitPill.ts`**：五种状态 × 「行数是否省略」× 「未跟踪是否显示」的组合，用纯函数穷举比在组件里 render 五遍便宜得多。这也是本仓库既有做法（`lib/topBar.ts` 的 `sandboxChipView` 就这么切的，配 `topBar.test.ts`）。

---

## Task 1: `GitStatus` 契约 + `PorcelainV2Parser` 纯解析

**Files:**
- Create: `src/main/java/com/lyhn/wraith/git/GitStatus.java`
- Create: `src/main/java/com/lyhn/wraith/git/PorcelainV2Parser.java`
- Test: `src/test/java/com/lyhn/wraith/git/PorcelainV2ParserTest.java`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces:
  - `record GitStatus(boolean repo, String root, String name, String state, String branch, String upstream, int ahead, int behind, int insertions, int deletions, int untracked, int filesTotal, List<GitStatus.FileEntry> files, List<GitStatus.Remote> remotes, String error)`
  - `record GitStatus.FileEntry(String path, String xy, boolean staged)`
  - `record GitStatus.Remote(String name, String url)`
  - `static GitStatus GitStatus.noRepo()` — `repo=false`，其余零值
  - `static GitStatus PorcelainV2Parser.parse(String root, String statusOut, String shortstatOut, String remotesOut)`
  - `static String PorcelainV2Parser.normalizeRemoteUrl(String raw)`
  - `static final int PorcelainV2Parser.MAX_FILES = 20`

- [ ] **Step 1: 写 `GitStatus` record**

```java
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
```

- [ ] **Step 2: 写失败的测试（先只测 branch header 与 ab）**

```java
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
}
```

- [ ] **Step 3: 跑测试确认它红**

Run: `mvn -q -DskipTests=false -Dtest=PorcelainV2ParserTest test`
Expected: 编译失败，`cannot find symbol: class PorcelainV2Parser`

- [ ] **Step 4: 写 `PorcelainV2Parser`**

```java
package com.lyhn.wraith.git;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
     * `2` 记录（重命名）在路径位置是 `<path>\t<origPath>`，取前半即新路径。
     */
    private static GitStatus.FileEntry entry(String line) {
        String[] parts = line.split(" ", 9);
        String xy = parts.length > 1 ? parts[1] : "..";
        String path = parts.length > 8 ? parts[8] : "";
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
     */
    public static String normalizeRemoteUrl(String raw) {
        if (raw == null || raw.isBlank()) return "";
        String s = raw.trim();
        if (s.startsWith("ssh://")) s = s.substring("ssh://".length());
        else if (s.startsWith("https://")) s = s.substring("https://".length());
        else if (s.startsWith("http://")) s = s.substring("http://".length());
        else if (s.startsWith("git://")) s = s.substring("git://".length());
        int at = s.indexOf('@');
        int slash = s.indexOf('/');
        // 只在 @ 出现在第一个 / 之前时才当用户名剥掉，否则可能是路径里的 @
        if (at >= 0 && (slash < 0 || at < slash)) s = s.substring(at + 1);
        s = s.replaceFirst(":(?=\\D)", "/");   // scp 式 host:path → host/path；host:22/ 这种端口不动
        if (s.endsWith(".git")) s = s.substring(0, s.length() - 4);
        return s;
    }
}
```

- [ ] **Step 5: 跑测试确认它绿**

Run: `mvn -q -DskipTests=false -Dtest=PorcelainV2ParserTest test`
Expected: `Tests run: 1, Failures: 0, Errors: 0`

- [ ] **Step 6: 补齐其余七种输入的测试**

```java
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
```

- [ ] **Step 7: 跑全部并确认绿**

Run: `mvn -q -DskipTests=false -Dtest=PorcelainV2ParserTest test`
Expected: `Tests run: 11, Failures: 0, Errors: 0`

- [ ] **Step 8: RED 证明（本仓库硬要求）**

把 `entry()` 里的 `xy.charAt(0) != '.'` 改成 `!= 'x'`，重跑。
Expected: `stagedFlagComesFromXNotY` 与 `renameRecordTakesTheNewPath` 精确变红，其余仍绿。
确认后**改回来**再跑一遍确认全绿。

- [ ] **Step 9: 提交**

```bash
git add src/main/java/com/lyhn/wraith/git/ src/test/java/com/lyhn/wraith/git/PorcelainV2ParserTest.java
git commit -m "feat(git): porcelain v2 纯解析 + 数据契约

用 v2 而不是 v1:detached 与 initial 在 v2 里是显式记号,v1 要靠猜,
而这两种状态都真实存在。解析拆成纯函数才能用 fixture 穷举 ——
造真仓库的测试会跟着开发机的 git 状态漂移。

fixture 取自本仓库真机输出而非手编。真机也暴露了 spec 漏掉的一点:
git remote -v 给的是 git@github.com:owner/repo.git(SSH 形式),
要规范化成 host/owner/repo 才能展示;认不出的形态原样返回 —— 猜错比不动更糟。"
```

---

## Task 2: `GitStatusReader` —— spawn、超时、按序降级

**Files:**
- Create: `src/main/java/com/lyhn/wraith/git/GitStatusReader.java`
- Test: `src/test/java/com/lyhn/wraith/git/GitStatusReaderTest.java`

**Interfaces:**
- Consumes: `GitStatus`、`GitStatus.noRepo()`、`GitStatus.failed(root, reason)`、`PorcelainV2Parser.parse(...)`
- Produces:
  - `interface GitStatusReader.CommandRunner { Result run(List<String> argv, Path cwd) throws Exception; }`
  - `record GitStatusReader.Result(int exitCode, String stdout)`
  - `static GitStatus GitStatusReader.read(String workspaceRoot)` — 生产入口，内部用 `ProcessBuilder`
  - `static GitStatus GitStatusReader.read(String workspaceRoot, CommandRunner runner)` — 注入口，测试用
  - `static final int GitStatusReader.TIMEOUT_SECONDS = 3`

- [ ] **Step 1: 写失败的测试**

```java
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
```

- [ ] **Step 2: 跑测试确认它红**

Run: `mvn -q -DskipTests=false -Dtest=GitStatusReaderTest test`
Expected: 编译失败，`cannot find symbol: class GitStatusReader`

- [ ] **Step 3: 写 `GitStatusReader`**

```java
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
```

- [ ] **Step 4: 跑测试确认它绿**

Run: `mvn -q -DskipTests=false -Dtest=GitStatusReaderTest test`
Expected: `Tests run: 6, Failures: 0, Errors: 0`

- [ ] **Step 5: RED 证明**

把 `if (!unborn)` 改成 `if (true)`，重跑。
Expected: `unbornSkipsDiffEntirely` 精确变红（假 runner 会对 `diff` 抛 `IllegalStateException`）。
改回来再跑确认全绿。

- [ ] **Step 6: 提交**

```bash
git add src/main/java/com/lyhn/wraith/git/GitStatusReader.java src/test/java/com/lyhn/wraith/git/GitStatusReaderTest.java
git commit -m "feat(git): GitStatusReader —— 直接 spawn git,四步按序降级

三条降级方式刻意不同:
- rev-parse 非零 或 git 不在 PATH → noRepo(前端整块不渲染)。「不是仓库」是
  正常情况不是错误,不该弹窗
- status 失败 → failed(root, reason)。确实是仓库却取不到状态,必须说出来,
  不许静默给零值当成「干净工作区」
- diff / remote 失败 → 只让对应字段为空,其余字段照常返回。remote 是锦上添花

不走 execute_command:那条路是沙箱(默认禁网限写)+60s 超时+HITL 弹窗,
读本地仓库状态不该踩这三样。硬超时 3 秒防网络文件系统/巨大 untracked 树拖住 RPC 线程。"
```

---

## Task 3: `git.status` RPC 接线

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`（`SessionRunner` 加默认方法；dispatch 加 case）
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`（app-server 匿名实现，约 1345 行 `String root = …` 之后）
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerGitStatusTest.java`

**Interfaces:**
- Consumes: `GitStatusReader.read(String)`、`GitStatus`
- Produces: `default Map<String,Object> SessionRunner.gitStatus()`（默认抛 `UnsupportedOperationException`，与 `searchStatus` 同族）；RPC method 名 `git.status`

- [ ] **Step 1: 写失败的测试**

```java
package com.lyhn.wraith.runtime.appserver;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AppServerGitStatusTest {

    /** 用假 SessionRunner 验分发与回包形状；真实取数由 GitStatusReaderTest 覆盖。 */
    @Test
    void gitStatusIsDispatchedAndShapePreserved() throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            public Map<String, Object> gitStatus() {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("repo", true);
                m.put("name", "wraith");
                m.put("branch", "main");
                m.put("insertions", 295);
                m.put("deletions", 18);
                m.put("untracked", 3);
                return m;
            }
        };
        List<String> lines = new ArrayList<>();
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}");
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"git.status\",\"params\":{}}");
        lines.add("{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(String.join("\n", lines).concat("\n")
                .getBytes(StandardCharsets.UTF_8)), out, f).serve();

        String text = out.toString(StandardCharsets.UTF_8);
        assertTrue(text.contains("\"branch\":\"main\""), "回包该原样带上 branch");
        assertTrue(text.contains("\"insertions\":295"));
        assertTrue(text.contains("\"untracked\":3"));
    }

    /** 未实现 gitStatus 的 runner 必须回 JSON-RPC 错误而不是让 serve() 崩。 */
    @Test
    void unimplementedGitStatusReturnsErrorNotCrash() throws Exception {
        AppServer.SessionRunnerFactory f = (writer, sessionId, ws) -> new AppServer.SessionRunner() {
            public EventStreamRenderer renderer() { return new EventStreamRenderer(writer, sessionId); }
            public String runTurn(String input) { return "ok"; }
            // 刻意不覆写 gitStatus() —— 走默认的 UnsupportedOperationException
        };
        List<String> lines = List.of(
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.start\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"git.status\",\"params\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"shutdown\",\"params\":{}}");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new AppServer(new ByteArrayInputStream(String.join("\n", lines).concat("\n")
                .getBytes(StandardCharsets.UTF_8)), out, f).serve();
        assertTrue(out.toString(StandardCharsets.UTF_8).contains("\"error\""));
    }
}
```

- [ ] **Step 2: 跑测试确认它红**

Run: `mvn -q -DskipTests=false -Dtest=AppServerGitStatusTest test`
Expected: FAIL —— 第一条断言不通过（method 未知，回的是 method-not-found 错误而不是结果）

- [ ] **Step 3: 在 `AppServer.SessionRunner` 里加默认方法**

紧跟现有 `searchStatus()` 之后插入：

```java
        /**
         * 读**用户真实仓库**的只读状态（分支 / ahead-behind / 变更行数 / remote）。
         *
         * <p>与 {@code snapshot.*} 那组刻意分开：那组管的是 Side-Git 影子仓库，
         * 这个读的是用户自己的 {@code .git}，且<b>永不写</b>。
         *
         * <p>不是仓库时回 {@code {repo:false}}（不是错误）；取数失败时回 {@code {repo:true, error:"…"}}。
         * 默认抛出。
         */
        default java.util.Map<String, Object> gitStatus() {
            throw new UnsupportedOperationException("gitStatus not implemented");
        }
```

- [ ] **Step 4: 在 dispatch 里加 case**

紧跟现有 `case "config.getSearch"` 之后插入（同一 switch）：

```java
            case "git.status" -> {
                if (session == null) { writer.error(msg.id(), -32000, "no session"); return true; }
                // 同步执行:实测 status+diff 各 ~20ms,且 GitStatusReader 自带 3 秒硬超时,
                // 不会像 embedding 探测那样把唯一的 reader 线程占住几十秒。
                try { writer.result(msg.id(), session.gitStatus()); }
                catch (UnsupportedOperationException e) { writer.error(msg.id(), -32000, e.getMessage()); }
                catch (Exception e) { writer.error(msg.id(), -32000, e.getMessage()); }
            }
```

- [ ] **Step 5: 在 `Main.java` 的 app-server 匿名实现里落地**

在 `registry.setProjectPath(root);` 之后的同一个匿名类里加：

```java
                    public java.util.Map<String, Object> gitStatus() {
                        // root 是本会话的 workspace 根;GitStatusReader 会用 rev-parse 找真正的仓库根
                        com.lyhn.wraith.git.GitStatus s = com.lyhn.wraith.git.GitStatusReader.read(root);
                        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                        m.put("repo", s.repo());
                        m.put("root", s.root());
                        m.put("name", s.name());
                        m.put("state", s.state());
                        m.put("branch", s.branch());
                        m.put("upstream", s.upstream());
                        m.put("ahead", s.ahead());
                        m.put("behind", s.behind());
                        m.put("insertions", s.insertions());
                        m.put("deletions", s.deletions());
                        m.put("untracked", s.untracked());
                        m.put("filesTotal", s.filesTotal());
                        java.util.List<java.util.Map<String, Object>> fs = new java.util.ArrayList<>();
                        for (com.lyhn.wraith.git.GitStatus.FileEntry fe : s.files()) {
                            fs.add(java.util.Map.of("path", fe.path(), "xy", fe.xy(), "staged", fe.staged()));
                        }
                        m.put("files", fs);
                        java.util.List<java.util.Map<String, Object>> rs = new java.util.ArrayList<>();
                        for (com.lyhn.wraith.git.GitStatus.Remote r : s.remotes()) {
                            rs.add(java.util.Map.of("name", r.name(), "url", r.url()));
                        }
                        m.put("remotes", rs);
                        m.put("error", s.error());
                        return m;
                    }
```

- [ ] **Step 6: 跑测试确认它绿 + 跑全量确认没弄坏别的**

Run: `mvn -q -DskipTests=false -Dtest=AppServerGitStatusTest test`
Expected: `Tests run: 2, Failures: 0, Errors: 0`

Run: `mvn -DskipTests=false test 2>&1 | grep -E "Tests run:.*Failures|BUILD"` （末行）
Expected: `Failures: 0, Errors: 0` 且 `BUILD SUCCESS`。基线：本任务前是 2313 个用例，本计划累计新增约 19 个。

- [ ] **Step 7: 提交**

```bash
git add src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java src/main/java/com/lyhn/wraith/cli/Main.java src/test/java/com/lyhn/wraith/runtime/appserver/AppServerGitStatusTest.java
git commit -m "feat(git): git.status RPC

同步分发而不是 dispatchAsync:实测 status+diff 各约 20ms,且 reader 自带 3 秒
硬超时,不会像 embedding 探测那样把唯一的 reader 线程占住几十秒。

RPC 名刻意用 git.* 而不是挂进 snapshot.*:后者管的是 Side-Git 影子仓库,
这个读的是用户真实 .git 且永不写。两者在用户眼里都叫「版本」,
命名上先分开,免得以后有人往这条路上加写操作。"
```

---

## Task 4: 桥接三处 + `GitStatusView`

**Files:**
- Modify: `desktop/src/shared/types.ts`
- Modify: `desktop/src/main/index.ts`（紧邻现有 `wraith:configGetSearch` handler）
- Modify: `desktop/src/preload/index.ts`（接口声明 + 实现两处）

**Interfaces:**
- Consumes: `git.status` RPC 的回包形状（Task 3）
- Produces:
  - `export interface GitStatusView { repo, root, name, state, branch, upstream, ahead, behind, insertions, deletions, untracked, filesTotal, files, remotes, error }`
  - `export interface GitFileEntry { path: string; xy: string; staged: boolean }`
  - `export interface GitRemote { name: string; url: string }`
  - `window.wraith.gitStatus(): Promise<GitStatusView>`

- [ ] **Step 1: 加类型（`desktop/src/shared/types.ts`，紧跟 `SearchStatusView` 之后）**

```ts
/** porcelain v2 的一条变更记录。 */
export interface GitFileEntry {
  path: string
  /** 两字符 XY：X=暂存区相对 HEAD，Y=工作区相对暂存区，'.'=该侧无改动 */
  xy: string
  /** X !== '.'。刻意与 xy 并存 —— UI 要能区分「已 stage」与「只改了工作区」 */
  staged: boolean
}

export interface GitRemote {
  name: string
  /** 已规范化成 host/owner/repo；认不出的形态（本地路径等）原样保留 */
  url: string
}

/**
 * 用户**真实仓库**的只读状态。与「快照」面板（Side-Git 影子仓库）无关。
 *
 * `repo: false` 时其余字段无意义 —— 前端应整块不渲染，而不是显示「无仓库」。
 */
export interface GitStatusView {
  repo: boolean
  root: string
  name: string
  state: 'normal' | 'detached' | 'unborn'
  /** detached 时是短 sha */
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  /** 口径：git diff --shortstat HEAD（含已 staged）。unborn 时为 0 */
  insertions: number
  deletions: number
  /** 未跟踪文件个数。**不含行数** —— git 自己就不统计它们的行 */
  untracked: number
  /** 截断前的真实变更文件数；files 最多 20 条 */
  filesTotal: number
  files: GitFileEntry[]
  remotes: GitRemote[]
  /** 本次取数失败的可读原因；成功为 null */
  error: string | null
}
```

- [ ] **Step 2: 加 IPC（`desktop/src/main/index.ts`，紧跟 `wraith:configGetSearch` 那个 handler 之后）**

```ts
// 用户真实仓库的只读状态。顶栏 Git pill 靠它。
// 后端自带 3 秒硬超时,所以这里不再加一层超时 —— 两层超时会让「到底是谁超时了」说不清。
ipcMain.handle('wraith:gitStatus', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('git.status', {})
})
```

- [ ] **Step 3: 加 preload（`desktop/src/preload/index.ts` 两处）**

接口声明处（紧跟 `configGetSearch(): Promise<SearchStatusView>`）：

```ts
  gitStatus(): Promise<GitStatusView>
```

实现处（紧跟 `configGetSearch() { … }`）：

```ts
  gitStatus() {
    return ipcRenderer.invoke('wraith:gitStatus') as Promise<GitStatusView>
  },
```

并在该文件顶部的 type import 里加上 `GitStatusView`。

- [ ] **Step 4: 类型检查**

Run: `cd desktop && npx tsc --noEmit`
Expected: 0 错误

- [ ] **Step 5: 提交**

```bash
git add desktop/src/shared/types.ts desktop/src/main/index.ts desktop/src/preload/index.ts
git commit -m "feat(git): 桥接 git.status 到桌面(types + IPC + preload)

GitStatusView 里 xy 与 staged 并存不是冗余:UI 要能区分「已 stage 的修改」与
「只改了工作区」,把 XY 折叠成单个状态必然要在这两者之间做选择。

IPC 层刻意不再加超时 —— 后端 GitStatusReader 已有 3 秒硬超时,
两层超时会让「到底是谁超时了」这个问题说不清。"
```

---

## Task 5: pill 文案纯函数 + `GitPill` 组件

**Files:**
- Create: `desktop/src/renderer/lib/gitPill.ts`
- Create: `desktop/src/renderer/components/GitPill.tsx`
- Test: `desktop/test/gitPill.test.ts`
- Test: `desktop/test/gitPillComponent.test.tsx`

**Interfaces:**
- Consumes: `GitStatusView`（Task 4）
- Produces:
  - `export function gitPillView(s: GitStatusView | null): { visible: boolean; branch: string; suffix: string; title: string }`
  - `export default function GitPill({ status, onRefresh }: { status: GitStatusView | null; onRefresh: () => void }): JSX.Element | null`
  - testids：`git-pill`、`git-pill-popover`、`git-pill-refresh`、`git-pill-file`、`git-pill-remote`、`git-pill-stale`

- [ ] **Step 1: 写文案纯函数的失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { gitPillView } from '../src/renderer/lib/gitPill'
import type { GitStatusView } from '../src/shared/types'

const base: GitStatusView = {
  repo: true, root: '/r/wraith', name: 'wraith', state: 'normal',
  branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0,
  insertions: 0, deletions: 0, untracked: 0, filesTotal: 0,
  files: [], remotes: [], error: null,
}

describe('gitPillView', () => {
  it('没有仓库时不可见', () => {
    expect(gitPillView({ ...base, repo: false }).visible).toBe(false)
  })

  it('status 还没拉回来时不可见 —— 不显示占位,免得顶栏闪一下', () => {
    expect(gitPillView(null).visible).toBe(false)
  })

  it('干净工作区只显示分支名,整段行数省略', () => {
    const v = gitPillView(base)
    expect(v.visible).toBe(true)
    expect(v.branch).toBe('main')
    expect(v.suffix).toBe('')
  })

  it('有改动时显示 +N −M', () => {
    expect(gitPillView({ ...base, insertions: 295, deletions: 18 }).suffix)
      .toBe('+295 −18')
  })

  it('未跟踪数只在大于 0 时出现', () => {
    expect(gitPillView({ ...base, insertions: 295, deletions: 18, untracked: 3 }).suffix)
      .toBe('+295 −18 · 3 未跟踪')
    expect(gitPillView({ ...base, untracked: 2 }).suffix).toBe('· 2 未跟踪')
  })

  it('游离态显示短 sha 加标记', () => {
    const v = gitPillView({ ...base, state: 'detached', branch: 'a1b2c3d', upstream: null })
    expect(v.branch).toBe('a1b2c3d')
    expect(v.title).toContain('游离')
  })

  it('新仓库无提交时标出来', () => {
    expect(gitPillView({ ...base, state: 'unborn' }).title).toContain('无提交')
  })
})
```

- [ ] **Step 2: 跑测试确认它红**

Run: `cd desktop && npx vitest run test/gitPill.test.ts`
Expected: FAIL —— `Cannot find module '../src/renderer/lib/gitPill'`

- [ ] **Step 3: 写 `desktop/src/renderer/lib/gitPill.ts`**

```ts
import type { GitStatusView } from '../../shared/types'

/**
 * pill 上显示什么。抽成纯函数是因为组合多：五种状态 × 行数是否省略 × 未跟踪是否显示。
 * 用纯函数穷举比在组件里 render 五遍便宜（既有做法见 lib/topBar.ts 的 sandboxChipView）。
 */
export function gitPillView(s: GitStatusView | null): {
  visible: boolean
  branch: string
  suffix: string
  title: string
} {
  // null = 还没拉回来。刻意不显示占位 —— 顶栏闪一下比晚出现半秒更烦人。
  // repo:false = 不是仓库 / git 不在 PATH。整块不渲染，不显示「无仓库」那种噪音。
  if (!s || !s.repo) return { visible: false, branch: '', suffix: '', title: '' }

  const parts: string[] = []
  if (s.insertions > 0 || s.deletions > 0) {
    // 用 U+2212 减号而不是 hyphen：等宽对齐好看，且不会被误读成命令行参数
    parts.push(`+${s.insertions} −${s.deletions}`)
  }
  if (s.untracked > 0) parts.push(`· ${s.untracked} 未跟踪`)

  const marks: string[] = []
  if (s.state === 'detached') marks.push('游离')
  if (s.state === 'unborn') marks.push('无提交')
  if (s.ahead > 0) marks.push(`领先 ${s.ahead}`)
  if (s.behind > 0) marks.push(`落后 ${s.behind}`)
  if (s.error) marks.push('刷新失败')

  return {
    visible: true,
    branch: s.branch,
    suffix: parts.join(' '),
    title: [s.name, s.branch, ...marks].filter(Boolean).join(' · '),
  }
}
```

- [ ] **Step 4: 跑测试确认它绿**

Run: `cd desktop && npx vitest run test/gitPill.test.ts`
Expected: 7 passed

- [ ] **Step 5: 写组件的失败测试**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GitPill from '../src/renderer/components/GitPill'
import type { GitStatusView } from '../src/shared/types'

const s: GitStatusView = {
  repo: true, root: '/r/wraith', name: 'wraith', state: 'normal',
  branch: 'feat/x', upstream: 'origin/feat/x', ahead: 3, behind: 0,
  insertions: 295, deletions: 18, untracked: 3, filesTotal: 25,
  files: [{ path: 'src/A.java', xy: '.M', staged: false }],
  remotes: [{ name: 'origin', url: 'github.com/JavaLyHn/wraith' }],
  error: null,
}

describe('GitPill', () => {
  it('没有仓库时整块不渲染 —— 断言什么都没渲染,而不是断言某句文案', () => {
    // 用 container.firstChild → toBeNull()，**不要用 toBeEmptyDOMElement()**：
    // 本项目没装 @testing-library/jest-dom，那个匹配器不存在。
    // 既有写法见 test/accountRowAndSandboxChip.test.tsx:112。
    const { container } = render(<GitPill status={{ ...s, repo: false }} onRefresh={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('弹出层默认关着,点 pill 才开', () => {
    render(<GitPill status={s} onRefresh={() => {}} />)
    expect(screen.queryByTestId('git-pill-popover')).toBeNull()
    fireEvent.click(screen.getByTestId('git-pill'))
    expect(screen.getByTestId('git-pill-popover')).toBeTruthy()
  })

  it('点开时强刷一次', () => {
    const onRefresh = vi.fn()
    render(<GitPill status={s} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByTestId('git-pill'))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('手动刷新键再调一次', () => {
    const onRefresh = vi.fn()
    render(<GitPill status={s} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByTestId('git-pill'))
    fireEvent.click(screen.getByTestId('git-pill-refresh'))
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('文件列表被截断时说出总数', () => {
    render(<GitPill status={s} onRefresh={() => {}} />)
    fireEvent.click(screen.getByTestId('git-pill'))
    expect(screen.getByTestId('git-pill-popover').textContent).toContain('25')
  })

  it('取数失败时明写出来,不静默拿旧数据当新的', () => {
    render(<GitPill status={{ ...s, error: 'git status 退出码 128' }} onRefresh={() => {}} />)
    fireEvent.click(screen.getByTestId('git-pill'))
    expect(screen.getByTestId('git-pill-stale').textContent).toContain('128')
  })

  it('必须写明这是真实 .git,与快照面板互不影响', () => {
    render(<GitPill status={s} onRefresh={() => {}} />)
    fireEvent.click(screen.getByTestId('git-pill'))
    const text = screen.getByTestId('git-pill-popover').textContent ?? ''
    expect(text).toContain('快照')
    expect(text).toContain('只读')
  })
})
```

- [ ] **Step 6: 跑测试确认它红**

Run: `cd desktop && npx vitest run test/gitPillComponent.test.tsx`
Expected: FAIL —— `Cannot find module '../src/renderer/components/GitPill'`

- [ ] **Step 7: 写 `GitPill.tsx`**

```tsx
import { useState } from 'react'
import { GitBranch, RefreshCw, Link2, FileDiff } from 'lucide-react'
import type { GitStatusView } from '../../shared/types'
import { gitPillView } from '../lib/gitPill'

/**
 * 顶栏常驻的只读 Git pill + 弹出层。
 *
 * **只读**：本组件不提供任何写仓库的动作。提交 / 推送 / 切分支 / 开 PR 都不在本期范围
 * （spec §9），因为写操作要过 HITL、处理鉴权与冲突，是另一个量级。
 */
export default function GitPill({ status, onRefresh }: {
  status: GitStatusView | null
  onRefresh: () => void
}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const v = gitPillView(status)
  if (!v.visible || !status) return null

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    // 打开时强刷:用户主动看的那一刻必须是新的
    if (next) onRefresh()
  }

  return (
    <div className="relative [-webkit-app-region:no-drag]">
      <button
        data-testid="git-pill"
        onClick={toggle}
        title={v.title}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-2xs text-fg-muted transition duration-150 hover:text-fg active:scale-95 motion-reduce:transform-none"
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="max-w-[168px] truncate">{v.branch}</span>
        {v.suffix && <span className="shrink-0 tabular-nums">{v.suffix}</span>}
      </button>

      {open && (
        <>
          {/* 点外面关掉。用一层透明覆盖而不是全局 mousedown 监听 —— 后者要手动
              判断点击是否落在弹出层内，容易漏掉 portal 之类的情况 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            data-testid="git-pill-popover"
            className="absolute right-0 top-full z-50 mt-1 w-[340px] rounded-xl border border-border bg-surface p-3 shadow-lg"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="flex-1 truncate text-xs font-bold text-fg">{status.name}</span>
              <button
                data-testid="git-pill-refresh"
                onClick={onRefresh}
                title="刷新"
                className="rounded-lg p-1 text-fg-muted hover:text-fg"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>

            <div className="flex items-center gap-2 border-t border-border pt-2 text-2xs">
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-fg-muted" strokeWidth={1.5} />
              <span className="flex-1 truncate text-fg">{status.branch}</span>
              {status.state === 'detached' && <span className="shrink-0 text-warn">游离</span>}
              {status.state === 'unborn' && <span className="shrink-0 text-warn">无提交</span>}
            </div>
            {status.upstream && (
              <div className="mt-0.5 pl-[22px] text-3xs text-fg-subtle">
                ↑ {status.ahead} ↓ {status.behind} · {status.upstream}
              </div>
            )}

            <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-2xs">
              <FileDiff className="h-3.5 w-3.5 shrink-0 text-fg-muted" strokeWidth={1.5} />
              <span className="flex-1 text-fg">变更 {status.filesTotal} 个文件</span>
              <span className="shrink-0 tabular-nums">
                <span className="text-ok">+{status.insertions}</span>{' '}
                <span className="text-danger">−{status.deletions}</span>
              </span>
            </div>
            <div className="mt-1 pl-[22px]">
              {status.files.map(f => (
                <div key={f.path} data-testid="git-pill-file" className="flex gap-1.5 text-3xs">
                  <span className={'shrink-0 font-mono ' + (f.staged ? 'text-ok' : 'text-fg-subtle')}>{f.xy}</span>
                  <span className="truncate text-fg-muted">{f.path}</span>
                </div>
              ))}
              {status.filesTotal > status.files.length && (
                <div className="mt-0.5 text-3xs text-fg-subtle">
                  … 共 {status.filesTotal} 个，已显示前 {status.files.length} 个
                </div>
              )}
              {status.untracked > 0 && (
                <div className="mt-0.5 text-3xs text-fg-subtle">
                  另有 {status.untracked} 个未跟踪文件（git 不统计它们的行数）
                </div>
              )}
            </div>

            {status.remotes.length > 0 && (
              <div className="mt-2 border-t border-border pt-2">
                {status.remotes.map(r => (
                  <button
                    key={r.name}
                    data-testid="git-pill-remote"
                    onClick={() => void navigator.clipboard?.writeText(r.url)}
                    title="点击复制"
                    className="flex w-full items-center gap-2 text-left text-2xs text-fg-muted hover:text-fg"
                  >
                    <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                    <span className="shrink-0">{r.name}</span>
                    <span className="truncate">{r.url}</span>
                  </button>
                ))}
              </div>
            )}

            {status.error && (
              <div data-testid="git-pill-stale" className="mt-2 rounded-lg bg-warn/10 px-2 py-1.5 text-3xs text-warn">
                本次刷新失败：{status.error}
                <br />上面显示的是上一次成功的数据。
              </div>
            )}

            {/* 这两行是需求的一部分,不是装饰。两者在用户眼里都叫「版本」,
                分不清会导致不可逆的误回滚(spec §7)。 */}
            <div className="mt-2 border-t border-border pt-2 text-3xs leading-relaxed text-fg-subtle">
              这里显示的是你的真实 <span className="font-mono">.git</span>（<b>只读</b>）。
              Agent 的逐轮留档在「快照」面板，两者互不影响。
            </div>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 8: 跑测试确认它绿**

Run: `cd desktop && npx vitest run test/gitPillComponent.test.tsx`
Expected: 7 passed

- [ ] **Step 9: RED 证明**

把 `if (next) onRefresh()` 改成 `if (false) onRefresh()`，重跑。
Expected: `点开时强刷一次` 与 `手动刷新键再调一次` 精确变红。改回来确认全绿。

- [ ] **Step 10: 提交**

```bash
git add desktop/src/renderer/lib/gitPill.ts desktop/src/renderer/components/GitPill.tsx desktop/test/gitPill.test.ts desktop/test/gitPillComponent.test.tsx
git commit -m "feat(git): 顶栏 Git pill 组件 + 文案纯函数

文案抽成 lib/gitPill.ts 是因为组合多(五种状态 × 行数是否省略 × 未跟踪是否显示),
纯函数穷举比在组件里 render 五遍便宜 —— 既有做法见 lib/topBar.ts 的 sandboxChipView。

弹出层末尾那两行「真实 .git / 快照面板」的对照文案是**需求的一部分**,
有测试钉住。两者在用户眼里都叫「版本」,分不清会导致不可逆的误回滚。

remote 点击是复制而不是开浏览器:远端可能是私有仓库,直接开多半得到 404 页。"
```

---

## Task 6: 挂进 `TopBar` + `App.tsx` 取数与刷新

**Files:**
- Modify: `desktop/src/renderer/components/TopBar.tsx`
- Modify: `desktop/src/renderer/App.tsx`（`onEvent` 订阅处约 266 行；`<TopBar …>` 挂载处约 1008 行）
- Test: `desktop/test/topBarComponent.test.tsx`（追加用例）

**Interfaces:**
- Consumes: `GitPill`（Task 5）、`window.wraith.gitStatus()`（Task 4）
- Produces: `TopBar` 新增两个可选 prop —— `gitStatus?: GitStatusView | null`、`onRefreshGit?: () => void`

- [ ] **Step 1: 写失败的测试（追加到 `desktop/test/topBarComponent.test.tsx`）**

```tsx
  it('传了 git 状态就渲染 pill', () => {
    render(<TopBar {...baseProps} gitStatus={{
      repo: true, root: '/r/w', name: 'w', state: 'normal', branch: 'main',
      upstream: null, ahead: 0, behind: 0, insertions: 1, deletions: 0,
      untracked: 0, filesTotal: 1, files: [], remotes: [], error: null,
    }} onRefreshGit={() => {}} />)
    expect(screen.getByTestId('git-pill')).toBeTruthy()
  })

  it('没传 git 状态时顶栏照常工作 —— pill 是可选的,不该让顶栏依赖它', () => {
    render(<TopBar {...baseProps} />)
    expect(screen.getByTestId('topbar')).toBeTruthy()
    expect(screen.queryByTestId('git-pill')).toBeNull()
  })
```

> `baseProps` 沿用该测试文件里已有的那一份；若文件里叫别的名字，用文件内既有的 props 构造方式，不要新造一套。

- [ ] **Step 2: 跑测试确认它红**

Run: `cd desktop && npx vitest run test/topBarComponent.test.tsx`
Expected: FAIL —— `Unable to find an element by: [data-testid="git-pill"]`

- [ ] **Step 3: 改 `TopBar.tsx`**

签名里加两个可选 prop：

```ts
  /** 用户真实仓库的只读状态。undefined/null = 不渲染 pill（顶栏不依赖它）。 */
  gitStatus?: GitStatusView | null
  onRefreshGit?: () => void
```

import 加：

```ts
import GitPill from './GitPill'
import type { GitStatusView } from '../../shared/types'
```

在右簇里、沙箱盾**之前**插入（pill 比盾更常被看，放左边更靠近视觉中心）：

```tsx
        {gitStatus && onRefreshGit && <GitPill status={gitStatus} onRefresh={onRefreshGit} />}
```

- [ ] **Step 4: 跑测试确认它绿**

Run: `cd desktop && npx vitest run test/topBarComponent.test.tsx`
Expected: 全部 passed

- [ ] **Step 5: 在 `App.tsx` 里取数 + 接刷新**

state 与取数函数（放在其他 `fetchXxx` 附近）：

```tsx
  const [gitStatus, setGitStatus] = useState<GitStatusView | null>(null)

  // 取数失败时**保留上一次成功的值**,只把 error 换上 —— 静默拿旧数据当新的是不允许的
  // (与上下文治理「绝不静默」同一条规矩),所以 error 会在弹出层里明写出来。
  const fetchGitStatus = useCallback(async () => {
    try {
      setGitStatus(await window.wraith.gitStatus())
    } catch (e) {
      setGitStatus(prev => (prev ? { ...prev, error: String(e) } : null))
    }
  }, [])
```

挂载时取一次：

```tsx
  useEffect(() => { void fetchGitStatus() }, [fetchGitStatus])
```

在 `onEvent` 回调里（`dispatch(evt)` 那行**之前**）加：

```tsx
      // Agent 刚改完文件,正是最该刷的点 —— 「数字变了」与「Agent 做了事」在时间上对得上。
      // 刻意不轮询:空闲时零开销,而且轮询大多数时候刷出来的结果和上一次一模一样。
      if (evt.kind === 'notification'
          && (evt.method === 'turn.completed' || evt.method === 'turn.failed')) {
        void fetchGitStatus()
      }
```

并把 `fetchGitStatus` 加进该 `useEffect` 的依赖数组。

挂载处传下去：

```tsx
        gitStatus={gitStatus}
        onRefreshGit={() => void fetchGitStatus()}
```

- [ ] **Step 6: 类型检查 + 桌面全量**

Run: `cd desktop && npx tsc --noEmit`
Expected: 0 错误

Run: `cd desktop && npx vitest run 2>&1 | tail -6`
Expected: `Test Files … passed`，`Tests … passed`，0 failed。基线：本计划前是 183 文件 / 1741 用例，累计新增约 16 个用例。

- [ ] **Step 7: 真机眼验（不能只靠测试）**

```bash
mvn -q clean package -DskipTests && cp target/wraith-*.jar ~/.wraith/wraith.jar
cd desktop && npm run dev
```

逐条确认：
1. 顶栏出现 pill，分支名与 `git branch --show-current` 一致
2. pill 上的 `+N −M` 与 `git diff --shortstat HEAD` **完全一致**（这是选方案 B 的唯一理由，必须亲眼对一次）
3. 点开弹出层，文件列表与 `git status --short` 对得上
4. remote 点击后剪贴板里是 `github.com/JavaLyHn/wraith`
5. 让 Agent 改一个文件，turn 结束后 pill 上的数字**自动变了**
6. `cd /tmp && mkdir nogit && cd nogit`，把桌面工作区切到那里 → **pill 完全消失**，不是显示「无仓库」

- [ ] **Step 8: 提交**

```bash
git add desktop/src/renderer/components/TopBar.tsx desktop/src/renderer/App.tsx desktop/test/topBarComponent.test.tsx
git commit -m "feat(git): Git pill 挂进顶栏,turn 结束后自动刷新

两个 prop 都是可选的:顶栏不该依赖 pill —— 后端没连上或不是仓库时,
顶栏其余功能(侧栏开关、沙箱盾)必须照常工作。

刷新接在 turn.completed/turn.failed 上而不是轮询:Agent 刚改完文件正是最该刷的点,
「数字变了」与「Agent 做了事」在时间上对得上;空闲时零开销。
turn.failed 也刷,因为失败的 turn 一样可能已经改了文件。

取数失败时保留上一次成功的值并把 error 显示出来,不静默拿旧数据当新的
(与上下文治理「绝不静默」同一条规矩)。"
```

---

## Self-Review

**Spec 覆盖核对**

| spec 节 | 落在哪个任务 |
|---|---|
| §2 方案 B（spawn git，不用 JGit，不走 execute_command） | Task 2 类注释 + Global Constraints |
| §3 数据契约 | Task 1（Java record）+ Task 4（TS interface） |
| §3.1 行数口径 / `· N 未跟踪` 仅 N>0 / `+0 −0` 省略 | Task 2（unborn 跳 diff）+ Task 5（`gitPillView` 三条测试） |
| §3.2 porcelain v2 | Task 1 |
| §3.3 `xy` / `staged` 口径 | Task 1（`entry()` + `stagedFlagComesFromXNotY`）+ Task 4（类型注释） |
| §4 四条命令按序 + 各自降级 + 3 秒超时 | Task 2（六条测试逐一覆盖） |
| §5 前端五处文件 | Task 4 + Task 5 + Task 6 |
| §5.1 弹出层内容 + remote 点击复制 | Task 5 |
| §5.2 三个刷新时机、不轮询 | Task 5（打开强刷、手动键）+ Task 6（turn.completed） |
| §6 五种状态 | Task 5（`gitPill.test.ts` 覆盖文案层，`gitPillComponent` 覆盖渲染层） |
| §7 与快照划界 | Task 5（文案 + 钉住它的测试） |
| §8 测试策略 | 各任务的测试步骤；「不写依赖真实仓库的测试」写进 Global Constraints |
| §9 明确不做 | Global Constraints 第一条 + Task 5 组件注释 |
| §10 `turn.completed` 接入点 | Task 6 Step 5（已验证的具体位置） |

**Placeholder 扫描**：无 TBD / TODO / 「适当处理错误」。所有代码步骤都有可直接粘的代码块，所有运行步骤都有具体命令与预期输出。

**类型一致性核对**：`GitStatus`（Java record）↔ `GitStatusView`（TS interface）字段名与顺序逐一对齐；`FileEntry.xy/staged` ↔ `GitFileEntry.xy/staged`；`Remote.name/url` ↔ `GitRemote.name/url`；`GitStatusReader.read` 两个重载签名在 Task 2 与 Task 3 用法一致；`gitPillView` 返回的四个字段在 Task 5 的测试与组件里一致。

**一处补漏**：spec 只写了展示形态 `github.com/JavaLyHn/wraith`，没说 `git remote -v` 实际给的是 `git@github.com:owner/repo.git`。已在 Task 1 加 `normalizeRemoteUrl` 与两条测试（含「认不出的原样返回」）。
