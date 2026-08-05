# 顶栏 Git pill：项目里有 .git 就自动显示

**日期:** 2026-08-05 **状态:** 设计已定稿，未实现

用户需求原文（附 Codex 截图）：

> 这是 codex 的设计 能够显示 git 相关的 你能不能为 wraith 设计一下 然后项目中有 .git 的话 能够自动展示出来相关的内容

Codex 那个面板混了两类东西：只读展示（变更行数、当前分支、remote 列表）与写操作（提交或推送、切分支、创建 PR）。
**本期只做只读**（用户裁决），因此不涉及 HITL、鉴权、冲突处理与失败回滚。

---

## 1. 调查结论：这是项目里第一条读「真实仓库」的路径

盘过全仓库，三条都实测确认：

| 结论 | 证据 |
|---|---|
| **桌面端对用户真实 git 仓库零集成** | `grep -rl git desktop/src` 命中 8 个文件，全是 `SnapshotPanel` / `DiffView` / `SettingsAbout` 之类，没有一处读 `.git` |
| **JGit 已是依赖，但只被影子仓库用** | `pom.xml:91` 有 `org.eclipse.jgit 7.6.0`；`grep JGit` 在 `snapshot/` 之外零命中 |
| **CLI 底部状态栏也没有分支** | `StatusInfo` 那条 record 的 12 个字段里没有 branch（`render/StatusInfo.java:9-21`）。之前一份材料里写「底部 dock 显示 模型/水位/成本/分支」是错的，已修正 |

所以这是**从零起的第一条路径**，它放在哪会决定 CLI 将来能不能复用。

**取数成本实测**（本仓库，1578 个跟踪文件）：

| 命令 | 三次耗时 |
|---|---|
| `git status --porcelain=v2 --branch` | 0.02 / 0.01 / 0.01 s |
| `git diff --shortstat HEAD` | 0.02 / 0.02 s |

便宜，但**不能假定它一直这么便宜**：Windows 上 git status 默认无 fsmonitor 明显更慢，网络文件系统上的仓库或有巨大 untracked 树时会退化。所以下面有硬超时。

---

## 2. 方案选择：spawn `git`，不用 JGit

| | A. JGit | **B. spawn `git`（选定）** | C. Electron 主进程 |
|---|---|---|---|
| 新增依赖 | 无（已有） | 无 | 无 |
| 要求机器上有 git | 否 | **是** | 是 |
| 数字与用户敲 git 一致 | **否（语义有差异）** | **是** | 是 |
| CLI 将来能复用 | 是 | 是 | **否** |

**选 B 的决定性理由是一致性**：面板说 `+295 −18`，用户在终端敲 `git diff --shortstat` 必须得到同一个数。一旦不一致，这个面板就是负资产——用户不再相信它，而且**无法解释差在哪**。JGit 与 git 的已知语义差异（`.gitignore` 规则、CRLF、submodule）恰好都落在「哪些文件算变更」上，正是面板要显示的东西。

**依赖 git 二进制是可接受的**：本功能的前提就是「项目里有 `.git`」，有 `.git` 的人机器上有 git。取不到就优雅降级（pill 不渲染），不报错。

**排除 C 的理由**：只有桌面受益，违背「三形态一内核」——而那是本项目的旗舰架构约束，为一个小功能破例不值。

### ⚠️ 硬约束：不能走 `execute_command`

那是命令沙箱 + 60 秒超时的层。用它读 git 会同时踩两个坑：沙箱可能限写/禁网（`SeatbeltProfile` / AppContainer），以及触发 HITL 审批弹窗。
**必须直接 `ProcessBuilder`，与 `snapshot/` 同级。**

---

## 3. 数据契约

RPC `git.status`，无参数（仓库根由 session 的 projectPath 决定），返回：

```jsonc
{
  "repo": true,               // 没有 .git 时为 false，其余字段无意义
  "root": "/Users/x/wraith",
  "name": "wraith",           // basename(root)
  "state": "normal",          // normal | detached | unborn
  "branch": "feat/windows-parity-block1",   // detached 时是短 sha
  "upstream": "origin/feat/windows-parity-block1",  // 无则 null
  "ahead": 3,
  "behind": 0,
  "insertions": 295,
  "deletions": 18,
  "untracked": 3,
  "filesTotal": 9,            // 截断前的真实总数
  "files": [                  // 最多 MAX_FILES = 20 条；超出由 filesTotal 体现
    { "path": "src/main/java/.../Agent.java", "xy": ".M", "staged": false }
  ],
  "remotes": [ { "name": "origin", "url": "github.com/JavaLyHn/wraith" } ],
  "error": null               // 本次取数失败时的可读原因
}
```

### 3.1 行数口径（写死，不留解释空间）

- 用 **`git diff --shortstat HEAD`** —— 工作区相对 HEAD 的全部改动，**含已 staged**
- **未跟踪文件不算行数**，只报个数

第二条是关键取舍：git 自己就不统计未跟踪文件的行数，硬算会让面板与 `git diff --shortstat` 对不上，而「对得上」是选方案 B 的**唯一理由**。所以 pill 显示成：

```
⛎ feat/windows-parity-block1   +295 −18 · 3 未跟踪
```

`· N 未跟踪` **仅在 N > 0 时出现**；`+0 −0` 时整段行数省略，只留分支名（干净工作区不该占宽度）。

`unborn` 状态下没有 HEAD，`diff HEAD` 会失败 —— 该状态下行数一律为 0，只报未跟踪数。

### 3.3 `xy` 与 `staged` 的口径

porcelain v2 的 `1` / `2` 记录第二字段是两字符的 `<XY>`：**X = 暂存区相对 HEAD，Y = 工作区相对暂存区**，`.` 表示该侧无改动。

- `xy` 原样透传这两个字符（如 `.M` = 只有工作区改了、`M.` = 已全部 stage、`MM` = 两边都有）
- `staged` = `X != '.'`
- 未跟踪文件（`?` 记录）不进 `files`，只计入 `untracked` 计数

**不把 XY 折叠成单个「状态」** —— 折叠必然要在「已 stage 的修改」和「未 stage 的修改」之间做选择，而 UI 上这两者要能区分开。

### 3.2 为什么用 porcelain v2 而不是 v1

```
# branch.oid <sha> | (initial)
# branch.head <name> | (detached)
# branch.upstream origin/xxx
# branch.ab +3 -0
1 .M N... 100644 100644 100644 <sha> <sha> <path>
2 R. N... ... <path>\t<origPath>
? untracked-path
```

v2 把 **detached / initial / 无 upstream** 做成显式记号，v1 要靠猜。这三个状态都是真实会遇到的，猜必然出错。重命名在 v2 里是独立的 `2` 记录且路径用 `\t` 分隔，v1 的 `R  a -> b` 需要额外解析。

---

## 4. 后端：新包 `com.lyhn.wraith.git`

| 类 | 职责 | 为什么这样切 |
|---|---|---|
| `GitStatus` | record，即 §3 的契约 | — |
| `PorcelainV2Parser` | **纯函数**：`(statusOutput, shortstatOutput, remotesOutput) → GitStatus` | **bug 全在解析上**。拆成纯函数才能用 fixture 字符串测，不需要真仓库 |
| `GitStatusReader` | spawn git、超时、拼装、降级 | 命令执行器**以函数注入**，测试塞假输出（沿用 `SearchProviderFactory.resolveSettings` 的既有做法） |

四条命令，按序执行，前一条决定后面还跑不跑：

| # | 命令 | 作用 | 失败时 |
|---|---|---|---|
| 1 | `git rev-parse --show-toplevel` | 判是不是仓库 + 拿仓库根 | 非零退出 → `repo: false`，**后三条全部跳过** |
| 2 | `git status --porcelain=v2 --branch` | 分支 / 状态 / upstream / ahead-behind / 文件列表 | 带 `error` 返回 |
| 3 | `git diff --shortstat HEAD` | 行数 | `state == unborn` 时**不执行**（没有 HEAD） |
| 4 | `git remote -v` | remote 列表 | 失败只让 `remotes` 为空，**不影响其余字段** |

第 4 条的降级方式与前面不同是刻意的：remote 列表是锦上添花，拿不到不该让整个 pill 变成错误态。

`AppServer` 加 `case "git.status"`。

**硬超时 3 秒**，超时即返回带 `error` 的结果而不是抛。理由：网络文件系统上的仓库或巨大 untracked 树可能让 git 挂很久，不能拖住 RPC 线程——`dispatchAsync` 那个「点一个按钮整个桌面没反应」的坑已经踩过一次。

---

## 5. 前端

- `desktop/src/main/index.ts` —— `wraith:gitStatus` IPC 转 `git.status`
- `desktop/src/preload/index.ts` —— `window.wraith.gitStatus()`
- `desktop/src/shared/types.ts` —— `GitStatusView`
- `desktop/src/renderer/components/GitPill.tsx` —— pill + 弹出层
- `desktop/src/renderer/components/TopBar.tsx` —— 挂载

### 5.1 弹出层内容

```
wraith                                    ⟳
──────────────────────────────────────────
 ⛎ feat/windows-parity-block1
   ↑ 3  ↓ 0   origin/feat/windows-parity-block1
──────────────────────────────────────────
 ± 变更 9 个文件              +295  −18
   M  src/main/java/.../Agent.java
   M  desktop/src/.../TopBar.tsx
   ?? scripts/cli-pty/
   …查看全部
──────────────────────────────────────────
 ⚭ origin   github.com/JavaLyHn/wraith
──────────────────────────────────────────
 这里显示的是你的真实 .git（只读）。
 Agent 的逐轮留档在「快照」面板，两者互不影响。
```

**remote 点击是复制而不是打开浏览器** —— 远端可能是私有仓库，直接开浏览器多半得到 404 页。

**最后那两行文案是必需的，不是装饰**。理由见 §7。

### 5.2 刷新时机

| 时机 | 为什么 |
|---|---|
| `turn.completed` 事件后 | Agent 刚改完文件，正是最该刷的点；「数字变了」与「Agent 做了事」在时间上对得上 |
| 点开弹出层时**强刷** | 用户主动看的那一刻必须是新的 |
| 弹出层里的手动刷新键 | 兜「你在外部编辑器改了文件」这个缺口 |

**不轮询**：空闲时零开销；而且大多数时候轮询刷出来的结果和上一次一模一样。已知代价是外部编辑器的改动不会让 pill 自己变——由手动刷新键承担。

---

## 6. 五种状态，每种都要有明确表现

| 状态 | pill | 弹出层 |
|---|---|---|
| 没有 `.git` | **完全不渲染** | 不存在 |
| `git` 不在 PATH | **完全不渲染** | 不存在 |
| detached HEAD | `⛎ a1b2c3d 游离` | 同，且不显示 upstream / ahead-behind |
| unborn（新仓库无提交） | `⛎ main 无提交` | 行数为 0，只显示未跟踪数 |
| 取数失败 / 超时 | 保留**上次成功的值** | 明写「上次刷新 14:22，本次失败：<原因>」 |

前两种**刻意不渲染任何东西**，不显示「无仓库」——用户没要求这个功能，为它占一块顶栏是噪音。失败原因只进 log，不弹窗。

最后一种**必须标出来**：按项目既有规矩（上下文治理「绝不静默」、ghai「失败时绝不写报告」），静默拿旧数据当新的是不允许的。

---

## 7. 必须与「快照」面板划清界限

这是本设计里唯一的**用户误操作风险点**，所以文案是需求的一部分而不是润色。

| | 快照面板（已有） | Git pill（本期新增） |
|---|---|---|
| 管的是 | **影子仓库**（Side-Git） | **你的真实 `.git`** |
| 何时写 | Agent 每轮开始前自动留档 | **从不写** |
| 能做什么 | 整轮回滚 Agent 的改动 | 只看 |
| 进不进 `git log` | **不进** | 就是你的 `git log` |

两者在用户眼里都叫「版本」。区分做不好，用户会分不清「回滚」到底回滚了什么——而那是不可逆操作。

---

## 8. 测试

**Java**

- `PorcelainV2ParserTest` —— fixture 字符串覆盖八种输入：正常 / detached / unborn(`branch.oid (initial)`) / 无 upstream / 有 ahead-behind / 重命名(`2` 记录) / 只有未跟踪 / 空输出
- `GitStatusReaderTest` —— 注入假命令执行器，覆盖：超时、非零退出码、`git` 不存在（`IOException`）、`rev-parse` 说不是仓库

**桌面（vitest）**

- `GitPill` 五种状态各自的渲染断言
- 刷新调用次数：`turn.completed` 触发一次、打开弹出层触发一次、手动键触发一次
- 无 `.git` 时**确实什么都不渲染**（断言容器为空，不是断言文案）

**刻意不写依赖真实仓库的测试。** 本仓库自己的 git 状态一直在变，那种测试会随机变红——正是「隔离测试要隔离干净」那条既有教训。

---

## 9. 明确不做（YAGNI）

| 不做 | 理由 |
|---|---|
| 提交 / 推送 / 拉取 / 切分支 | 用户裁决本期只读。写操作要过 HITL、处理鉴权与冲突，是另一个量级 |
| 创建 PR | 要接 GitHub API + token 管理 |
| 提交历史列表 | 弹出层装不下；真要看，用户有更好的工具 |
| 文件系统监听（fs.watch） | 跨平台代价高（macOS FSEvents / Windows ReadDirectoryChangesW 行为不一），本期用手动刷新键兜住同一个缺口 |
| 显示 stash / submodule / 冲突态 | 边缘状态，等有人真的撞到再说 |

---

## 10. 一个待验证的开放项

**`turn.completed` 事件在 renderer 侧的接入点还没确认。** 事件流本身是九种定死事件之一（`runtime/appserver/EventStreamRenderer`），但 renderer 侧监听它的具体位置需要在实现时找到。若接入成本超预期，退路是「只保留『打开弹出层强刷』+ 手动刷新键」——那样 pill 上的数字在 Agent 改完文件后不会自动更新，但**用户主动看的那一刻仍然是准的**，可以接受。
