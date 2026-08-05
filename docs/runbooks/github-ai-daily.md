# GitHub AI 日报 · 接线与排障

每天自动产出「昨日 AI 领域 star 涨最多 / fork 涨最多 / 涨粉最多的人」的报告，投递到你选的渠道。

- **脚本**：`scripts/github-ai-daily/index.mjs`（零依赖，Node 22+，mac/Windows 通用）
- **数据与报告**：`<repo>/.ghai/`（**放项目内**是为了让面板任务的 `read_file` 够得着，见 §1；已进 `.gitignore`）
- **配置**：`<repo>/.ghai/config.json`（首次运行自动从模板生成）

---

## 0. 前置依赖

只要两样：**Node 22+** 和**一个 GitHub token**。token 有两种拿法，二选一。

### Node

| 平台 | 装法 | 验 |
|---|---|---|
| macOS | `brew install node` | `node -v` ≥ v22 |
| Windows | `winget install OpenJS.NodeJS.LTS` | 新开一个 PowerShell 再 `node -v`（装完要重开窗口，PATH 才刷新） |

### token 方式一：gh CLI（推荐）

脚本会调 `gh auth token`，不需要你手工保管密钥。

| 平台 | 装法 |
|---|---|
| macOS | `brew install gh` |
| Windows | `winget install GitHub.cli`（或去 https://cli.github.com 下 MSI） |

装完都要登录一次：

```
gh auth login
```

选 `GitHub.com` → `HTTPS` → `Login with a web browser`，浏览器里贴一次一次性代码即可。
验：`gh auth status` 显示 `✓ Logged in`。

**只读公开数据，不需要任何特殊 scope**，默认给的就够。

### token 方式二：环境变量（不想装 gh 就用这个）

去 https://github.com/settings/tokens 生成一个 classic token，**不用勾任何 scope**
（本脚本只读公开仓库）。然后：

**Windows —— 必须设成「用户级持久变量」，不能只在当前窗口 `$env:` 一下：**

```powershell
[Environment]::SetEnvironmentVariable("GITHUB_TOKEN", "ghp_xxx", "User")
```

**为什么不能用 `$env:GITHUB_TOKEN="ghp_xxx"`**：那只对当前 PowerShell 窗口有效。
任务计划程序是另起进程，**看不到**它，于是每天 06:00 都会以退出码 2 失败。
设成 `"User"` 之后新开的窗口和计划任务才都能看到；**已经开着的窗口要重开**。

**macOS**：launchd 同理看不到 shell 里 export 的变量。所以 mac 上**建议直接用 gh 方式**
—— 安装脚本已经把 gh 所在目录写进 plist 的 PATH。若坚持用 token，要自己往
`~/Library/LaunchAgents/com.lyhn.wraith.ghai.plist` 的 `EnvironmentVariables` 里加一条。
**本项目的规矩是 token 绝不落进任何仓库内文件**，所以安装脚本不会替你写这一条。

### 取值优先级

`GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token`。三条都拿不到就退出码 2，
stderr 会告诉你跑 `gh auth login`。**token 值不会出现在任何日志、报告或错误信息里。**

## 1. 为什么取数不挂在自动化面板里

面板任务的 `execute_command` **跑在沙箱内**，而这脚本干的两件事恰好都被沙箱挡住：

| 沙箱规则 | 出处 | 撞在哪 |
|---|---|---|
| `(deny network*)` | `SeatbeltProfile.java:43`，`AutomationRunner.java:153` 传的 `wraith.sandbox.network` 默认 `off` | 脚本整个工作就是调 GitHub API |
| 写只放行 `WORKSPACE` 与 `TMPDIR` | `SeatbeltProfile.java:27-30` | 数据目录若在项目外，一个字节也写不进去 |
| `execute_command` 硬超时 60 秒 | `ToolRegistry.java:67` | 一次取数 25 分钟以上 |

（Windows 走 AppContainer，`(deny network*)` 语义一致。）

所以职责这样切，两边各干各擅长的：

| | 取数（25 分钟、要联网、要写盘） | 出日报（几十秒、只读、要投递） |
|---|---|---|
| 谁来跑 | **系统调度**：macOS launchd / Windows 任务计划程序 | **wraith 自动化面板** |
| 为什么 | 不进沙箱，网络与写盘都正常 | 面板天生擅长：点评 + 多渠道投递 |
| 用什么工具 | 直接跑 node | **只用 `read_file`**（进程内 Java 工具，不经沙箱、跨平台、不撞 60 秒） |

**关键设计**：数据目录放在**项目内**（`<repo>/.ghai/`）。`read_file` 受 `PathGuard(projectPath)`
约束，只能读项目内的文件 —— 数据在项目里，面板任务就完全不需要 `execute_command`，
审批可以保持全 DENY。`.ghai/` 已进 `.gitignore`。

## 2. 装取数任务（选你的系统）

> **先在面板建好日报任务再装。** 时刻由你在面板里定**一次**，安装脚本按它反推取数时刻
> （默认提前 45 分钟）—— 你不用记两个时间，也不用自己算间隔。面板任务怎么建见 §3。

**macOS：**

```bash
cd /path/to/wraith/scripts/github-ai-daily/install
./install-macos.sh --from-panel        # 提前量改成 60 分钟：--from-panel 60
```

**Windows（普通 PowerShell，不需要管理员）：**

```powershell
cd D:\wraith\scripts\github-ai-daily\install
.\install-windows.ps1 -FromPanel                     # 提前量：-LeadMinutes 60
```

两个脚本都会：读面板里那条日报任务的时刻、反推取数时刻、定位 node 与 gh、
建好 `<repo>/.ghai/`、注册每日任务、把 stdout/stderr 追加到 `<repo>/.ghai/run.log`。
卸载分别是 `--uninstall` 与 `-Uninstall`。

**⚠ 改了面板时刻，要重跑一次安装脚本**，取数时刻不会自己跟着动。这是「面板为唯一真相」
这个选择的代价：换来的是你平时只需要记一个时间。

不想让它反推就手动指定：`./install-macos.sh 06 00` / `.\install-windows.ps1 -At "06:00"`。

装完立刻验一次（不用等到明早）：

```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.lyhn.wraith.ghai && tail -f "$REPO/.ghai/run.log"
```
```powershell
# Windows
Start-ScheduledTask -TaskName WraithGithubAiDaily; Get-Content "$Repo\.ghai\run.log" -Wait
```

**launchd 的 PATH 极简，`gh` 不在里面** —— 安装脚本已经把 node 与 gh 所在目录显式写进 plist 的
`PATH`。如果你换了 node/gh 的安装方式，重跑一次安装脚本让它重新探测。

## 2.5 先冒烟测一次（85 秒，别等 25 分钟才发现装错了）

完整一次运行 25–31 分钟，拿它当第一次测试太亏。用仓库自带的精简配置先把**整条链路**
（发现 → 新库 → 快照 → 人物 → 出报告）跑通，实测 **85 秒、GraphQL 3 点、Search 3 次**：

**macOS / Linux**（第一行改成你的仓库路径，其余原样粘）：
```bash
REPO=/Users/you/Desktop/wraith
SMOKE=/tmp/ghai-smoke && mkdir -p $SMOKE
cp $REPO/scripts/github-ai-daily/install/config.smoke.json $SMOKE/config.json
node $REPO/scripts/github-ai-daily/index.mjs --data-dir $SMOKE
```

**Windows PowerShell**（同上，只改第一行）：
```powershell
$Repo  = "D:\wraith"
$Smoke = "$env:TEMP\ghai-smoke"; New-Item -ItemType Directory -Force $Smoke | Out-Null
Copy-Item "$Repo\scripts\github-ai-daily\install\config.smoke.json" "$Smoke\config.json"
node "$Repo\scripts\github-ai-daily\index.mjs" --data-dir $Smoke
```

**通过的标准**：退出码 0，`$Smoke` 下出现 `<今天>.md`，报告里有榜单条目，头部写着
「首次运行」和 follower「T+1 起可用」。测完把 `$Smoke` 删掉即可，它和正式数据目录无关。

### ⚠ 精简配置为什么每个组都写成了 `[]`

`config.smoke.json` 里 `topics` 的七个组只有 `agent` 有值、其余全是空数组 —— **这是必须的，
不能靠省略**。配置合并的规则是「数组整体替换、**缺失的键从模板补齐**」，`topics` 是对象，
所以你省掉哪个组，模板就把哪个组原样补回来。第一次写这个冒烟配置时我只写了一个组，
结果它照样跑了 60 条查询、两分钟还没出发现阶段。

## 3. 建出日报的自动化任务

在桌面「自动化」面板新建，四个字段这样填：

- **名称**：GitHub AI 日报
- **项目**：选**装了取数任务的那个仓库目录**（必须一致，否则 `read_file` 够不着 `.ghai/`）
- **频率**：每天，**时刻由你定** —— 这是整件事唯一需要你决定的时间，取数时刻由安装脚本按它反推（§2）
- **结果投递**：勾你想要的（桌面通知 / QQ / 微信 / 企业微信 / 飞书，随时改）
- **高级·工具调用审批**：保持**默认拒绝**即可。这个 prompt 只用 `read_file`，不需要放行任何工具

**Prompt：**

```
生成今天的 GitHub AI 日报
```

就这一句。**「怎么做」不写在 prompt 里，写在 skill 里** ——
仓库自带一个 project skill：`.wraith/skills/github-ai-daily/SKILL.md`。

wraith 会把每个 skill 的名字与触发场景注入提示词，模型看到「生成今天的 github 日报」
就自己去 `load_skill('github-ai-daily')`，拿到完整指引（去哪读、读不到怎么办、
哪些数字不许改、报告里的降级标记怎么转述）。

这样做的好处：
- **prompt 回归人话**，你以后在聊天里随口问「今天 GitHub 上有什么新项目」也能触发同一套流程
- **指引跟着仓库走**，两个平台同一份，改一次两边都生效，不用去面板里改 prompt
- `load_skill` 不是危险工具，**不需要放行任何审批**

想改点评的口味（比如"只讲和 agent 有关的"），直接编辑那个 SKILL.md，不用动面板。

## 4. 时刻怎么定

两个时刻都由你自己设，代码里没写死任何时间。唯一的硬约束：

> **出日报的时刻 − 取数的时刻 > 一次完整运行的时长**

实测数据（用来估这个间隔）：

| 项 | 实测值 |
|---|---|
| 完整一次运行 | **25 分钟以上**（词表已增至 71 条查询，会更久） |
| 其中「发现候选池」阶段 | 约 14 分钟 |
| 为什么这么慢 | Search API 硬限 **30 次/分**，71 条查询、每条最多翻 3 页 |
| GraphQL 消耗 | 约 84 点（额度 5000/小时，占 1.7%） |

**推荐**：取数 06:00、出日报 07:00（留 60 分钟余量，是实测时长的两倍多）。

第一次跑完后用 `.ghai/run.log` 里的时间戳量一下你机器上的真实耗时再决定要不要缩。
间隔不够时出日报那个任务只会读不到报告（它会明说，不会编），但你白等一天。

## 5. 配置：所有口径都在这里

文件：`<repo>/.ghai/config.json`。改完下次运行生效，不用重启任何东西。

### 决定「什么算 AI 项目」

| 键 | 默认 | 作用 |
|---|---|---|
| `topics` | 7 组共 60+ 词 | topic 命中一个 **+3 分**（上限 6）。分组只是给人看的，代码不区分组 |
| `keywords.include` | 15 词 | 名称/简介/fullName/**topics** 命中一个 **+1 分**（上限 3） |
| `keywords.exclude` | mirror/镜像/翻译/fanyi | 命中即整个仓库剔除 |
| `aiThreshold` | `2` | 总分 ≥ 这个数才算 AI 相关。**嫌噪声就调到 3，嫌漏就调到 1** |
| `knowledgeRepoHints` | awesome/cookbook/教程… | 命中即归「知识类」单独一栏，不进主榜 |

**调这块之前先知道两件实测过的事：**

1. **最重要的仓库往往标得最少。** `ggml-org/llama.cpp` 只打了一个 `ggml` tag，`ggml-org/whisper.cpp` 一个通用 AI 词都没打。所以关键词要扫 topics、门槛才敢定在 2——纯靠 topic 强信号会漏掉这一整类。
2. **删词的代价可能大一个量级。** 曾经删掉 5 个「看起来很通用」的 topic（`observability`/`evaluation`/`inference`/`memory`/`sandbox`），实测掉了 **540 个仓库**，其中包括 `huggingface/evaluate`、`huggingface/lighteval`、`LMCache`。删词前先量，别凭感觉。

### 榜单形状

| 键 | 默认 | 作用 |
|---|---|---|
| `tiers.rising` / `tiers.mid` | 3000 / 30000 | 三层切分：新星 `<3000`、中坚 `<30000`、巨头以上 |
| `topN` | 5 | 每张榜取几条 |
| `minStars` | 100 | 进候选池的最低 star |
| `newRepoMinStars` | 5 | 「首日开源」榜专用的低门槛（新库不可能有 100 星） |
| `activeWithinDays` | 90 | 超过这么久没被召回就踢出池子 |

### 关注名单

| 键 | 默认 | 作用 |
|---|---|---|
| `watchlist.orgs` | anthropics/openai/google/langchain-ai | 这些 org 下的 release、新建库、异常涨幅单独一栏 |
| `watchlist.users` | 空 | 同上，按人 |
| `watchlistMinScore` | `1` | 关注名单的 AI 门槛，**故意比主榜低** |
| `watchlistReposPerOwner` | 20 | 每个 org 最多看多少个最近推送的仓库 |

**为什么关注名单的门槛更低**：`anthropics/claude-code` 一个 topic 都没打、描述里的 "agentic" 又不命中关键词 `agent`（词边界差一个字母），按主榜标准它 0 分。关注名单存在的意义恰恰是兜住打分器兜不住的仓库。

**`google` 这种巨型 org 会带噪声**（`boringssl`、`xls` 之类）。已经用 AI 门槛滤过一遍，仍嫌吵就把它换成 `google-deepmind`。

### 时间与成本

| 键 | 默认 | 作用 |
|---|---|---|
| `streakTtlDays` | 30 | 「连续在榜 N 天」的记录多久没上榜就清掉 |
| `windowNominalHours` / `windowToleranceHours` | 24 / 1 | 窗口偏离标称值超过容差就在报告头部标「退化」 |
| `baselineMinAgeHours` | 20 | 至少多久之前的快照才能当基线 |
| `copyReportTo` | `~/.wraith/documents` | 每天把报告**多拷一份**到这个目录。桌面「文档」面板以目录为唯一真相源（readdir 现算、不建索引），所以文件一放进去就出现在左侧列表里。设成 `null` 关闭。⚠ 必须真拷贝，面板用 `lstat`、软链会被跳过 |
| `snapshotRetainDays` | 400 | 快照保留天数。**实测 896 KB/天**（gzip 后），400 天≈358 MB；只用于「和昨天做差」与「连续在榜天数」，**90 天≈81 MB / 30 天≈27 MB 完全够用** |
| `searchThrottleMs` | 2100 | Search 请求间隔。**别调小**，30 次/分是 GitHub 的硬限 |
| `graphqlMaxRetries` | 3 | GraphQL 限流/5xx 的重试次数 |
| `contributorPoolTopRepos` | 50 | 从涨得最多的前 N 个仓库里扒贡献者补进人物池；设 0 关闭 |
| `contributorsPerRepo` | 5 | 每个仓库扒几个贡献者 |

### ⚠ 改配置的一个坑

模板升级时**只补缺失的键，绝不覆盖你已有的键**——这是故意的（你删掉的 topic 不该被下次升级偷偷加回来）。副作用是：

> **数组是整体替换语义。** 新版模板往 `topics` 或 `keywords.include` 里加了词，你**已经存在**的 `config.json` 不会自动拿到。想要就手工补，或者把 `config.json` 删掉让它重新生成（会丢掉你的自定义）。

标量新键（比如 `aiThreshold`）会自动补上，不受此限。

## 6. 排障

### 退出码

| 码 | 含义 | 怎么办 |
|---|---|---|
| 0 | 成功 | — |
| 1 | 配置文件语法错 | stderr 会指出文件路径。**故意不回退默认值**——静默回退会让你以为改生效了 |
| 2 | 拿不到 token | `gh auth status` 看登录是否还在；或设环境变量 `GITHUB_TOKEN` |
| 3 | 网络整体失败 | 看 `run.log`。**失败时绝不写报告**，宁可让你看见失败也不投一份看着正常的空报告 |

### 常见症状

**面板任务说「今天没有报告」**
按顺序查：① 取数任务跑没跑 —— mac `launchctl print gui/$(id -u)/com.lyhn.wraith.ghai`、
Windows `Get-ScheduledTaskInfo -TaskName WraithGithubAiDaily`；② 两个时刻的间隔够不够（§4）；
③ 看 `.ghai/run.log` 末尾，脚本是不是退了非零码。

**面板任务读不到文件，但 `.ghai/` 里明明有报告**
面板任务的**项目**选错了。`read_file` 只能读所选项目目录内的文件，必须和装取数任务的仓库是同一个。

**报告头部写着「窗口 48 小时」**
这不是 bug，是降级提示：昨天漏跑了，所以基线是前天的快照，所有「日增」实际覆盖 48 小时。脚本刻意不把它折算成一天，也刻意不假装是 24 小时。

**涨粉榜一直空白，写着「T+1 起可用」**
第一次运行必然如此——GitHub 没有任何 follower 历史接口，只能靠自建快照隔日做差。第二天起就有了。如果第三天还空，查 `snapshots/` 里是不是只有一份文件。

**榜单里出现明显不是 AI 的项目**
把它的 topics 抄出来，对照 §5 看是哪个词把它捞进来的，然后从 `config.json` 的 `topics` 里删掉那个词。**删之前先看 §5 那条「删词代价可能大一个量级」的实测记录。**

**报告里 star 日增全挤在一个很窄的区间**
说明基线快照被人为改过（例如测试时伪造过）。删掉 `snapshots/` 下可疑的那份，让它重新自然积累。

**磁盘涨得快**
`snapshotRetainDays` 调小。gzip 后约 200KB/天，默认 400 天约 80MB。

### 有用的开关

| 参数 | 用途 |
|---|---|
| `--data-dir <path>` | 换数据目录。**排障时务必用它**，别拿真实目录做实验 |
| `--skip-discover` | 跳过 14 分钟的候选池发现，只做快照+做差+出报告。复跑排障时用 |
| `--dry-run` | 只发现和快照，不出报告。**注意：它和完整运行一样慢**，它在跑完整个人物池之后才返回，省下的只有渲染 |

## 7. 已知限制

- **窗口不是日历日**，是「过去 24 小时」（今天 07:00 减昨天 07:00）。这是刻意取舍：单个任务就能完成，且包含美国白天那段 GitHub 高活跃期。跟第三方的「日历日榜」对不上账是预期行为。
- **池外的爆款会漏**：不在候选池、又没登上 GitHub 全站 Trending 的垂直新秀抓不到。缓解办法是把它加进 `watchlist`。
- **涨粉榜只覆盖人物池**：池外的人涨粉再多也统计不到。人物池 = 池内仓库的 owner（只算 `User`，组织归关注名单栏）+ 涨得最多的前 N 个仓库的贡献者。
- **Trending 兜底是 HTML 抓取**，GitHub 改版即失效。它只在冷启动路径上，失效后主链路不受影响，但报告里会明写「Trending 兜底不可用」。
- **`stargazers` 接口对他人仓库返回 404**（实测），所以 star 日增没法零冷启动精确回溯，只能靠快照做差。哪天 GitHub 放开，这套可以大幅简化。
- **单批 GraphQL 失败已按批隔离**（2026-08-05 修）：某批耗尽重试只丢那一批并在报告里记 note；
  但整批失败占比超过 `maxBatchFailureRatio`（默认 0.25）仍然抛错、不出报告 —— 容错不能滑成
  「拿残缺数据出日报」。这条是真机撞出来的：首次运行 57 批里坏 1 批，赔掉了一整天。
