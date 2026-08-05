# GitHub AI 日报 · 接线与排障

每天自动产出「昨日 AI 领域 star 涨最多 / fork 涨最多 / 涨粉最多的人」的报告，投递到你选的渠道。

- **脚本**：`scripts/github-ai-daily/index.mjs`（零依赖，Node 22+，mac/Windows 通用）
- **数据与报告**：`<repo>/.ghai/`（已进 `.gitignore`）；报告另拷一份进文档资料库供面板任务读，见 §1
- **配置**：`<repo>/.ghai/config.json`（首次运行自动从模板生成）

---

## 0. 前置依赖

只要两样：**Node 22+** 和**一个 GitHub token**。token 有两种拿法，二选一。

### Node

| 平台 | 装法 | 验 |
|---|---|---|
| macOS | `brew install node` | `node -v` ≥ v22 |
| Windows | `winget install OpenJS.NodeJS.LTS` | **新开一个**窗口再 `node -v`（PowerShell / cmd 都行；装完必须重开窗口，PATH 才刷新） |

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

**Windows —— 必须设成「用户级持久变量」，不能只在当前窗口设一下：**

PowerShell：
```powershell
[Environment]::SetEnvironmentVariable("GITHUB_TOKEN", "ghp_xxx", "User")
```

cmd：
```cmd
setx GITHUB_TOKEN ghp_xxx
```

（`setx` 默认写的就是用户级，正是我们要的。它有 1024 字符上限，GitHub token 远没这么长。）

**为什么不能用 `$env:GITHUB_TOKEN="ghp_xxx"`（PowerShell）或 `set GITHUB_TOKEN=ghp_xxx`（cmd）**：
那两个都只对当前窗口有效。任务计划程序是另起进程，**看不到**它们，于是每天到点都以退出码 2 失败。
用上面两条写成持久变量之后，新开的窗口和计划任务才都能看到；**已经开着的窗口要重开**
（`setx` 连自己那个窗口都不刷新，这是它的既定行为，不是出错）。

验一下写进去没有 —— **必须新开窗口**：

| shell | 命令 |
|---|---|
| PowerShell | `[Environment]::GetEnvironmentVariable("GITHUB_TOKEN","User")` |
| cmd | `reg query HKCU\Environment /v GITHUB_TOKEN` |

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
| 用什么工具 | 直接跑 node | **只用 `documents_read`**（进程内 Java 工具，不经沙箱、跨平台、不撞 60 秒） |

**关键设计**：报告除了落在 `<repo>/.ghai/`，还会**多拷一份进文档资料库**
（`~/.wraith/documents/`，由 `copyReportTo` 控制）。面板任务用 `documents_read` 读它 ——
那是进程内 Java 工具，**既不过命令沙箱、也不受 `PathGuard` 的项目边界约束**。

于是面板任务：不需要 `execute_command`（审批可全 DENY）、**项目选哪个都行**、
两个平台行为一致。

> 早先的设计是让面板任务用 `read_file` 读 `<repo>/.ghai/`，那样**项目必须选 wraith 仓库**。
> 想过用 `execute_command` + `cat` 绕开，但那条路两个平台不一致：macOS 的 Seatbelt profile
> 打底 `(allow default)` 读得到，Windows 的 AppContainer 是能力制、只授予 workspace，读不到。
> 所以补了 `documents_read` 这个跨项目只读工具 —— 资料库本来就是「跨项目的知识存放处」，
> 在此之前却只有桌面 UI 读得到、agent 读不到。

## 2. 装取数任务（选你的系统）

> **先在面板建好日报任务再装。** 时刻由你在面板里定**一次**，安装脚本按它反推取数时刻
> （默认提前 45 分钟）—— 你不用记两个时间，也不用自己算间隔。面板任务怎么建见 §3。

**macOS：**

```bash
cd /path/to/wraith/scripts/github-ai-daily/install
./install-macos.sh --from-panel        # 提前量改成 60 分钟：--from-panel 60
```

**Windows（不需要管理员）：**

安装器本身是 PowerShell 脚本，但**两个 shell 都能启动它** —— cmd 用户不用先切到 PowerShell。

PowerShell：
```powershell
cd D:\wraith\scripts\github-ai-daily\install
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1 -FromPanel
```

cmd：
```cmd
cd /d D:\wraith\scripts\github-ai-daily\install
powershell -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1 -FromPanel
```

> **两个必踩的坑，先说在前面：**
>
> 1. **cmd 里跨盘符必须 `cd /d`。** 光写 `cd D:\wraith` 会「看起来什么都没发生」——
>    当前盘符还在 C:，后面所有相对路径全错。
> 2. **PowerShell 里直接 `.\install-windows.ps1` 可能被执行策略拦下**
>    （报「因为在此系统上禁止运行脚本」）。上面统一用 `powershell -ExecutionPolicy Bypass -File`
>    起，两个 shell 写法一致，也绕开这条。想一劳永逸就
>    `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。

两个平台的脚本都会：读面板里那条日报任务的时刻、反推取数时刻、定位 node 与 gh、
建好 `<repo>/.ghai/`、注册每日任务、把 stdout/stderr 追加到 `<repo>/.ghai/run.log`。
卸载分别是 `--uninstall` 与 `-Uninstall` —— 但**那只摘掉取数任务这一半**，
面板那条还得另外停，完整步骤见 **§8「关掉它」**。

不想让它反推就手动指定：`./install-macos.sh 06 00` / `-At "06:00"`。

### 改了面板时刻怎么办

| 平台 | 行为 |
|---|---|
| **Windows**（`-FromPanel` 装的） | **自动跟随，什么都不用做** |
| Windows（`-At` 手动装的） | 不跟随 —— 你明确指定的时刻不该被悄悄改掉 |
| macOS | **要重跑一次 `./install-macos.sh --from-panel`** |

Windows 上任务实际调的是 `run-daily.ps1`，它每天开跑前先读一次面板：时刻变了就
`schtasks /Change` 改掉自己的触发器，顺带重新解析 node 路径（所以 node 升级换目录
也不会断）。对时失败绝不挡取数 —— 面板文件读不到、`schtasks` 改不动，都只往
`run.log` 记一行然后照常取数。

> **改动是明天生效的。** 今天这次已经被触发了，改的是下一次。把面板时刻**往后**调
> 没有影响（取数早跑完了）；**往前**调的那一天，面板任务会如实说「今天的日报还没
> 生成」，第二天自愈。这是自同步这条路的固有代价 —— 换来的是你再也不用碰安装脚本。

不想等到明天验证同步逻辑对不对，跑这条（几秒钟，只对时不取数）：

```
powershell -NoProfile -ExecutionPolicy Bypass -File D:\wraith\scripts\github-ai-daily\install\run-daily.ps1 -LeadMinutes 45 -SyncOnly
```

它会打出「时刻一致（08:15），无需调整」或者「取数时刻 08:15 → 07:00」。

装完立刻验一次（不用等到明早）：

macOS：
```bash
launchctl kickstart -k gui/$(id -u)/com.lyhn.wraith.ghai && tail -f "$REPO/.ghai/run.log"
```

Windows PowerShell：
```powershell
Start-ScheduledTask -TaskName WraithGithubAiDaily
Get-Content "D:\wraith\.ghai\run.log" -Wait
```

Windows cmd：
```cmd
schtasks /Run /TN WraithGithubAiDaily
powershell -NoProfile -c "Get-Content 'D:\wraith\.ghai\run.log' -Wait"
```

**launchd 的 PATH 极简，`gh` 不在里面** —— 安装脚本已经把 node 与 gh 所在目录显式写进 plist 的
`PATH`。如果你换了 node/gh 的安装方式，重跑一次安装脚本让它重新探测。

## 2.1 Windows 命令对照：PowerShell ↔ cmd

`Start-ScheduledTask` / `Get-ScheduledTask` 这些是 **PowerShell 的 cmdlet，cmd 里没有** ——
在 cmd 里敲会报「不是内部或外部命令」，那不是出了故障，只是走错了门。cmd 的对应工具是
`schtasks`（它在 PowerShell 里也能用，所以下表右列是两个 shell 通用的）。

| 要做什么 | PowerShell | cmd（PowerShell 里同样可用） |
|---|---|---|
| 进目录（跨盘符） | `cd D:\wraith` | `cd /d D:\wraith` |
| 装 / 重装取数任务 | `powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1 -FromPanel` | `powershell -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1 -FromPanel` |
| **任务在不在** | `Get-ScheduledTask -TaskName WraithGithubAiDaily` | `schtasks /Query /TN WraithGithubAiDaily` |
| 看状态 / 上次结果 / 下次运行 | `Get-ScheduledTaskInfo -TaskName WraithGithubAiDaily` | `schtasks /Query /TN WraithGithubAiDaily /V /FO LIST` |
| 看现在定的是几点 | `(Get-ScheduledTask -TaskName WraithGithubAiDaily).Triggers` | 同上，看输出里的「下次运行时间」 |
| 立刻跑一次 | `Start-ScheduledTask -TaskName WraithGithubAiDaily` | `schtasks /Run /TN WraithGithubAiDaily` |
| 掐掉正在跑的那次 | `Stop-ScheduledTask -TaskName WraithGithubAiDaily` | `schtasks /End /TN WraithGithubAiDaily` |
| 只改时刻（不重装） | `schtasks /Change /TN WraithGithubAiDaily /ST 06:15` | `schtasks /Change /TN WraithGithubAiDaily /ST 06:15` |
| 卸载（**只摘计划任务**，面板那条要另外停 → §8） | `... -File .\install-windows.ps1 -Uninstall` | `schtasks /Delete /TN WraithGithubAiDaily /F` |
| 看日志（一次性） | `Get-Content D:\wraith\.ghai\run.log -Tail 50` | `type D:\wraith\.ghai\run.log` |
| 跟着日志滚（`tail -f`） | `Get-Content D:\wraith\.ghai\run.log -Wait` | `powershell -NoProfile -c "Get-Content 'D:\wraith\.ghai\run.log' -Wait"` |
| 设持久 token | `[Environment]::SetEnvironmentVariable("GITHUB_TOKEN","ghp_xxx","User")` | `setx GITHUB_TOKEN ghp_xxx` |

### 报错对照

| 报错 | 在哪个 shell | 什么意思 |
|---|---|---|
| `Start-ScheduledTask : 系统找不到指定的文件`（`HRESULT 0x80070002`） | PowerShell | **任务不存在** —— 安装那步没成功。回 §2 看安装脚本的输出 |
| `'Start-ScheduledTask' 不是内部或外部命令` | cmd | 走错门了，cmd 没这个 cmdlet。用 `schtasks /Run /TN ...` |
| `错误: 系统找不到指定的文件。`（`schtasks /Query` 报的） | 两者皆可 | 同第一条：任务不存在 |
| `无法加载文件 ...install-windows.ps1，因为在此系统上禁止运行脚本` | PowerShell | 执行策略拦的。用 `powershell -ExecutionPolicy Bypass -File` 起 |
| `cd` 敲完盘符没变 | cmd | 忘了 `/d` |

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

**Windows cmd**（把 `D:\wraith` 换成你的仓库路径，四处都要换）：
```cmd
mkdir "%TEMP%\ghai-smoke" 2>nul
copy "D:\wraith\scripts\github-ai-daily\install\config.smoke.json" "%TEMP%\ghai-smoke\config.json"
node "D:\wraith\scripts\github-ai-daily\index.mjs" --data-dir "%TEMP%\ghai-smoke"
echo 退出码=%ERRORLEVEL%
```

> **cmd 这段为什么把路径写死、不用 `set REPO=...`**：
> **cmd 遇到未定义变量不报错，原样留着当字面量。** 真机上撞过 ——
> 只粘了最后一行（或中间换了个窗口），`REPO` 没设，于是 node 去找
> `D:\wraith\%REPO%\scripts\github-ai-daily\index.mjs`，报 `MODULE_NOT_FOUND`，
> 错误信息里那个 `%REPO%` 一闪而过很容易看漏。PowerShell 里 `$Repo` 未定义会
> 展开成空串，路径变成 `\scripts\...`，同样安静。
> `%TEMP%` 是系统内置的，不受这条影响，所以留着。

（`mkdir` 在目录已存在时会报错，`2>nul` 是把那句噪声吞掉，不是在掩盖问题。
cmd 里看退出码用 `%ERRORLEVEL%`，PowerShell 里用 `$LASTEXITCODE`。）

**通过的标准**：退出码 0，冒烟目录下出现 `<今天>.md`，报告里有榜单条目，头部写着
「首次运行」和 follower「T+1 起可用」。测完把那个目录删掉即可，它和正式数据目录无关。

### ⚠ 精简配置为什么每个组都写成了 `[]`

`config.smoke.json` 里 `topics` 的七个组只有 `agent` 有值、其余全是空数组 —— **这是必须的，
不能靠省略**。配置合并的规则是「数组整体替换、**缺失的键从模板补齐**」，`topics` 是对象，
所以你省掉哪个组，模板就把哪个组原样补回来。第一次写这个冒烟配置时我只写了一个组，
结果它照样跑了 60 条查询、两分钟还没出发现阶段。

## 3. 建出日报的自动化任务

在桌面「自动化」面板新建，四个字段这样填：

- **名称**：GitHub AI 日报
- **项目**：**选哪个都行** —— 报告走文档资料库，`documents_read` 不受项目边界约束
- **频率**：每天，**时刻由你定** —— 这是整件事唯一需要你决定的时间，取数时刻由安装脚本按它反推（§2）
- **结果投递**：勾你想要的（桌面通知 / QQ / 微信 / 企业微信 / 飞书，随时改）
- **高级·工具调用审批**：保持**默认拒绝**即可。这个 prompt 只用 `documents_read` / `load_skill`，两个都是只读工具，不设审批闸，不需要你放行任何东西

**Prompt：**

```
生成今天的 GitHub AI 日报
```

就这一句。**「怎么做」不写在 prompt 里，写在 skill 里** —— `github-ai-daily` 是一个
**内置 skill**（打在 jar 里：`src/main/resources/skills/github-ai-daily/SKILL.md`，
首次运行时释放到 `~/.wraith/skills-cache/`），所以**不需要你在项目里放任何文件**。

wraith 会把每个 skill 的名字与触发场景注入提示词，模型看到「生成今天的 github 日报」
就自己去 `load_skill('github-ai-daily')`，拿到完整指引（去哪读、读不到怎么办、
哪些数字不许改、报告里的降级标记怎么转述）。

这样做的好处：
- **prompt 回归人话**，你以后在聊天里随口问「今天 GitHub 上有什么新项目」也能触发同一套流程
- **项目选哪个都行**，因为 skill 是内置的、报告在文档资料库里，两者都不受项目边界约束
- **指引跟着版本走**，两个平台同一份，升级一次两边都生效，不用去面板里改 prompt
- `load_skill` 不是危险工具，**不需要放行任何审批**

> **⚠ jar 必须是新的。** `documents_read` / `documents_list` 和这个内置 skill 是一起加进来的。
> 如果某台机器上跑的还是旧 jar，模型会去调一个不存在的工具。Windows 上先确认
> `%USERPROFILE%\.wraith\wraith.jar`（或你的打包版）是 `c0e285c` 之后构建的。

想改点评的口味（比如"只讲和 agent 有关的"），在桌面「技能」面板里覆盖同名 skill
即可 —— 用户级 / 项目级都会盖过内置那份，不用改仓库。

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
按顺序查：① 取数任务跑没跑；② 两个时刻的间隔够不够（§4）；
③ 看 `.ghai/run.log` 末尾，脚本是不是退了非零码。

第①步各平台的命令：

| 平台 / shell | 命令 |
|---|---|
| macOS | `launchctl print gui/$(id -u)/com.lyhn.wraith.ghai` |
| Windows PowerShell | `Get-ScheduledTaskInfo -TaskName WraithGithubAiDaily` |
| Windows cmd | `schtasks /Query /TN WraithGithubAiDaily /V /FO LIST` |

Windows 上重点看两行：**「上次运行结果」**（`0` 才是成功）和**「下次运行时间」**。
如果这条命令本身报「系统找不到指定的文件」，说明任务压根没装上，回 §2；
`'Start-ScheduledTask' 不是内部或外部命令` 则只是在 cmd 里用了 PowerShell 的 cmdlet，见 §2.1。

**面板任务说读不到，但 `.ghai/` 里明明有报告**
先确认 `.ghai/config.json` 里的 `copyReportTo` 没被设成 `null` —— 面板任务读的是**文档资料库**
（`~/.wraith/documents/`）里那份拷贝，不是 `.ghai/` 里的原件。让 agent 跑一次 `documents_list`
就能看出库里到底有没有。

**报告头部写着「窗口 48 小时」**
这不是 bug，是降级提示：昨天漏跑了，所以基线是前天的快照，所有「日增」实际覆盖 48 小时。脚本刻意不把它折算成一天，也刻意不假装是 24 小时。

**涨粉榜一直空白，写着「T+1 起可用」**
第一次运行必然如此——GitHub 没有任何 follower 历史接口，只能靠自建快照隔日做差。第二天起就有了。如果第三天还空，查 `snapshots/` 里是不是只有一份文件。

**榜单里出现明显不是 AI 的项目**
把它的 topics 抄出来，对照 §5 看是哪个词把它捞进来的，然后从 `config.json` 的 `topics` 里删掉那个词。**删之前先看 §5 那条「删词代价可能大一个量级」的实测记录。**

**报告里 star 日增全挤在一个很窄的区间**
说明基线快照被人为改过（例如测试时伪造过）。删掉 `snapshots/` 下可疑的那份，让它重新自然积累。

**磁盘涨得快**
`snapshotRetainDays` 调小。**实测 gzip 后 896 KB/天**（不是早先估的 200 KB，差 4.5 倍），
默认 400 天约 358 MB；90 天≈81 MB、30 天≈27 MB 都够用（见 §5）。

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

## 8. 关掉它

**装是两步（§2 取数任务 + §3 面板任务），关也必须两步。**
只跑卸载脚本＝只摘掉第一步：面板那条 cron 每天照样触发，`documents_read` 读到的是
**昨天的报告**（或什么都读不到），于是照样点评、照样投递。这是这套接线最容易漏的一处 ——
表面上「已经卸载了」，实际每天还在推。

### ① 摘掉取数任务

| 平台 | 命令 |
|---|---|
| **macOS** | `cd <repo>/scripts/github-ai-daily/install && ./install-macos.sh --uninstall` |
| **Windows · PowerShell** | `powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1 -Uninstall` |
| **Windows · cmd** | `schtasks /Delete /TN WraithGithubAiDaily /F` |

三条都**只删调度项**，`<repo>/.ghai/`（含 `run.log` 与历史快照）一律保留 ——
快照是 star 日增做差的唯一依据，删了等于把历史清零，所以脚本刻意不替你删。要删自己删。

### ② 停掉面板任务

到桌面「自动化」面板，把 §3 建的那条**停用或删除**。

**没有 CLI 入口。** 面板任务存在 `~/.wraith/automations.json`（Java daemon 的
`AutomationStore` 写的，见 `GatewayDaemon.java:56`）。要手改这个文件，必须在 daemon
停着的时候改 —— 否则内存里的状态会把你的编辑盖回去。

### ③ 确认真的关掉了

| 平台 | 命令 | 关掉后应该看到 |
|---|---|---|
| macOS | `launchctl print gui/$(id -u)/com.lyhn.wraith.ghai` | `Could not find service` |
| Windows · PowerShell | `Get-ScheduledTask -TaskName WraithGithubAiDaily` | 报「没有找到」 |
| Windows · cmd | `schtasks /Query /TN WraithGithubAiDaily` | `系统找不到指定的文件` |

> ⚠ **macOS：别拿「plist 在不在」当判断依据。** launchd 的配置是**加载时读进内存**的。
> plist 被删掉、甚至被清成 0 字节之后，已加载的 job 仍然按内存里的旧配置继续触发，
> 直到你 `bootout` 或者重新登录。
>
> 这是实测出来的，不是推测：本机遇到过 plist 已经是 0 字节，而
> `launchctl print` 里那个 job 还活着、`Hour => 6 / Minute => 0` 的时刻照旧。
> 反过来说也成立 —— **看到 `ls ~/Library/LaunchAgents/` 里文件还在，也不代表它还会跑**。
> 唯一可信的判断是上表的 `launchctl print`。
