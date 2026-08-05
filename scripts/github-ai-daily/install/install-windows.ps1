# GitHub AI 日报 · Windows 取数任务安装（任务计划程序）
#
# 为什么取数不挂在 wraith 的自动化面板里：面板任务的 execute_command 跑在沙箱内
# （Windows 走 AppContainer，与 macOS 的 (deny network*) 语义一致），写也受限；
# 而这脚本要连 GitHub、要写数据目录，一次还要跑 25 分钟以上，远超 execute_command
# 的 60 秒硬超时。所以取数交给任务计划程序，wraith 那边只负责读报告、点评、投递。
#
# 用法（普通 PowerShell 即可，不需要管理员）：
#   .\install-windows.ps1 -FromPanel              # 推荐：读面板里日报任务的时刻，自动提前 45 分钟取数
#   .\install-windows.ps1 -FromPanel -LeadMinutes 60
#   .\install-windows.ps1 -At "05:30"             # 手动指定
#   .\install-windows.ps1 -Uninstall
#
# 为什么推荐 -FromPanel：时刻该由你在面板里定一次，而不是两个地方各记一个、还要自己
# 算间隔。取数必须早于面板任务超过一次完整运行时长（实测 31 分钟）。
#
# **-FromPanel 装出来的任务会自己跟着面板走**：任务实际调的是 run-daily.ps1，它每天
# 开跑前先读一次面板、发现时刻变了就改掉自己的触发器（第二天生效）。所以以后你在面板
# 里改时刻，不用再回来重跑本脚本。用 -At 手动指定装的则不跟随 —— 你明确指定的时刻
# 不该被悄悄改掉。

param(
  [string]$At = "06:00",
  [switch]$FromPanel,          # 推荐：面板为唯一真相，取数时刻自动反推 + 每天自同步
  [int]$LeadMinutes = 45,      # 取数要早于面板任务多少分钟（实测一次完整运行 31 分钟）
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# 反推逻辑与 run-daily.ps1 共用同一份，见 _panel.ps1 头注释。
. (Join-Path $PSScriptRoot "_panel.ps1")

$TaskName = "WraithGithubAiDaily"
$Repo     = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$DataDir  = Join-Path $Repo ".ghai"
$Script   = Join-Path $Repo "scripts\github-ai-daily\index.mjs"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "已卸载 $TaskName（数据目录 $DataDir 保留，要删自己删）"
  exit 0
}

# 仓库根按脚本自身位置推断：在 worktree/副本里跑会把每日任务静默指到临时目录。
if ($Repo -match '\\\.git\\worktrees\\|\\\.claude\\worktrees\\') {
  throw "检测到你在 worktree 里运行：$Repo`n每日任务会被指向这个临时目录，它一旦被清理任务就断了。请到主仓库目录再跑一次。"
}

$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { throw "找不到 node。装一个再来：winget install OpenJS.NodeJS.LTS" }
if (-not (Test-Path $Script)) { throw "找不到取数脚本：$Script" }

# token 两条路二选一：gh CLI，或用户级持久环境变量。
# 只查「用户级」而不是当前会话的 $env:——计划任务是另起进程，看不到你在窗口里临时设的值，
# 那会变成每天 06:00 静默退码 2。现在就拦住。
$hasGh    = [bool](Get-Command gh -ErrorAction SilentlyContinue)
$userTok  = [Environment]::GetEnvironmentVariable("GITHUB_TOKEN", "User")
$userTok2 = [Environment]::GetEnvironmentVariable("GH_TOKEN", "User")
if (-not $hasGh -and -not $userTok -and -not $userTok2) {
  # 字面量 here-string(@' 而非 @")：可扩展版本会把里面的 $env:GITHUB_TOKEN 真的展开，
  # 等于把 token 原样打进报错信息 —— 本项目的红线是 token 绝不出现在任何输出里。
  throw @'
拿不到 GitHub token。二选一：
  1) winget install GitHub.cli  然后  gh auth login        （推荐）
  2) [Environment]::SetEnvironmentVariable("GITHUB_TOKEN","ghp_xxx","User")
     必须是 "User" 级持久变量。只在当前窗口 $env:GITHUB_TOKEN=... 计划任务看不到。
'@
}

if ($FromPanel) {
  # 反推逻辑在 _panel.ps1 里，与 run-daily.ps1 每天自同步时用的是**同一份**。
  # 两个调用点各写一遍的话，装出来 08:15、第二天自己又对成别的，任务会来回抖。
  $derived = Get-FetchTimeFromPanel $LeadMinutes
  Write-Host "读面板配置：$($derived.PanelPath)"
  $At = $derived.FetchAt
  Write-Host "面板日报任务在 $($derived.PanelAt)，提前 $LeadMinutes 分钟取数 → $At"
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$logPath = Join-Path $DataDir "run.log"

# 任务调的是 run-daily.ps1，不是直接调 node —— 多这一层换来「面板改时刻第二天自动
# 对齐」「node 换路径不会断」（详见 run-daily.ps1 的头注释）。node 路径与日志重定向
# 都挪进去由它在**运行时**处理，所以这里不再需要 cmd /c 那套引号杂技。
#
# -NoSync：安装时用 -At 手动指定的话，没有「面板真相」可跟，跟了反而会把用户
# 明确指定的时刻改掉。只有 -FromPanel 装出来的任务才自同步。
$runner   = Join-Path $PSScriptRoot "run-daily.ps1"
$syncArg  = if ($FromPanel) { "-LeadMinutes $LeadMinutes" } else { "-NoSync" }
$psArgs   = '-NoProfile -ExecutionPolicy Bypass -File "{0}" {1}' -f $runner, $syncArg

$action    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psArgs -WorkingDirectory $Repo

# -At 收 DateTime。直接喂字符串能不能过取决于**当前区域设置**怎么解析「06:15」——
# 这台机器行不代表下一台行,而失败方式很坏:任务照建,只是每天在错的点跑。
#
# 这里**刻意不用 [datetime]::TryParseExact**。第一版用了,当场炸在合法输入 08:15 上:
# @('HH:mm','H:mm') 是 Object[],PowerShell 的重载解析没挑 String[] 那个版本,
# 而是把数组拼成单个字符串 "HH:mm H:mm" 去当一个格式串匹配 —— 永远匹配不上。
# 与其和重载解析斗智(得写 [string[]]$fmts 才稳),不如根本不进那扇门:
# 自己正则拆成两个整数,再让 Get-Date 组装。没有文化、没有重载、没有解析。
if ($At -notmatch '^(\d{1,2}):(\d{2})$') { throw "时刻格式不对：$At（要 HH:mm，例如 06:15）" }
$atH = [int]$Matches[1]
$atM = [int]$Matches[2]
if ($atH -gt 23 -or $atM -gt 59) { throw "时刻超出范围：$At" }
$atParsed  = Get-Date -Hour $atH -Minute $atM -Second 0 -Millisecond 0
$trigger   = New-ScheduledTaskTrigger -Daily -At $atParsed
# 关键几项：不插电也跑、跑之前不必空闲、允许跑满（默认 3 天上限足够，25 分钟的活不会被腰斩）。
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                                          -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
                       -Description "GitHub AI 日报取数（wraith）" -Force | Out-Null

Write-Host "已安装：$TaskName"
Write-Host "  每天 $At 取数 → $DataDir"
Write-Host "  日志：$logPath"
if ($FromPanel) {
  Write-Host "  自同步：已开启 —— 以后在面板改时刻，第二天自动对齐，不用再跑本脚本"
  Write-Host "          验证同步（几秒钟，不取数）："
  Write-Host "          powershell -NoProfile -ExecutionPolicy Bypass -File `"$runner`" -LeadMinutes $LeadMinutes -SyncOnly"
} else {
  Write-Host "  自同步：未开启（用 -At 手动指定的时刻不会被改动）。想跟随面板就改用 -FromPanel"
}
Write-Host ""
Write-Host "立刻跑一次验证（一次完整取数约 31 分钟）："
Write-Host "  PowerShell:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  cmd:         schtasks /Run /TN $TaskName"
Write-Host "看状态："
Write-Host "  PowerShell:  Get-ScheduledTaskInfo -TaskName $TaskName"
Write-Host "  cmd:         schtasks /Query /TN $TaskName /V /FO LIST"
Write-Host ""
Write-Host "另一半（读报告 + 点评 + 投递）在 wraith 桌面「自动化」面板里，prompt 就一句"
Write-Host "「生成今天的 GitHub AI 日报」，项目选哪个都行 —— 报告走文档资料库，"
Write-Host "由内置 skill 指引 documents_read 去读，不受项目边界约束。详见"
Write-Host "docs\runbooks\github-ai-daily.md 的 §3。"
