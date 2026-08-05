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

param(
  [string]$At = "06:00",
  [switch]$FromPanel,          # 推荐：面板为唯一真相，取数时刻自动反推
  [int]$LeadMinutes = 45,      # 取数要早于面板任务多少分钟（实测一次完整运行 31 分钟）
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

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
  # 面板任务的**真实**存储:Java daemon 的 AutomationStore(GatewayDaemon.java:56 —— ~/.wraith)。
  # 第二条是迁移前的遗留文件:桌面启动时做过一次性迁移(index.ts «Part C»),迁完保留作备份、
  # 不再更新。原来这里只读那一条,后果在两种机器上不同:全新 Windows 上文件根本不存在(直接 throw),
  # 老机器上则**读到一份冻结的旧列表**——后者更坏,它会静默算出一个错的取数时刻。
  # 顺序不能反:遗留文件在老机器上一直存在,先读它就永远轮不到真的那份。
  $panelCandidates = @(
    (Join-Path $env:USERPROFILE ".wraith\automations.json"),
    (Join-Path $env:APPDATA "wraith-desktop\automations.json")
  )
  $panel = $panelCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $panel) {
    throw ("读不到面板配置。找过这些位置：`n  " + ($panelCandidates -join "`n  ") +
           "`n先在桌面「自动化」面板建好日报任务（prompt 写「生成今天的 GitHub AI 日报」），再回来跑本脚本。")
  }
  Write-Host "读面板配置：$panel"
  $tasks = (Get-Content $panel -Raw -Encoding UTF8 | ConvertFrom-Json).tasks
  # 认哪一条：名字或 prompt 里同时提到 github 与「日报/daily」。找不到或找到多条都要说清楚，不许瞎猜。
  $hit = @($tasks | Where-Object {
    $t = "$($_.name) $($_.prompt)"
    $t -match '(?i)github' -and $t -match '(?i)日报|daily'
  })
  if ($hit.Count -ne 1) {
    $names = ($tasks | ForEach-Object { if ($_.name) { $_.name } else { "(无名)" } }) -join " / "
    throw "从面板反推失败：匹配到 $($hit.Count) 条日报任务。面板里现有：$names`n也可以手动指定：.\install-windows.ps1 -At `"06:00`""
  }
  $panelAt = if ($hit[0].schedule.time) { $hit[0].schedule.time } else { $hit[0].schedule.at }
  if ($panelAt -notmatch '^\d{1,2}:\d{2}$') { throw "面板任务的时刻读不出来：$panelAt" }
  $ph, $pm = $panelAt -split ':'
  # 减提前量，跨零点回绕到前一天同一时刻
  $total = (([int]$ph * 60 + [int]$pm - $LeadMinutes) % 1440 + 1440) % 1440
  # [int] 这个转换不是装饰:[math]::Floor() 返回 **Double**,而 `d2` 是整数专用的格式
  # 说明符,喂给 Double 会抛「格式说明符无效」—— 真机首跑就死在这一行。
  # 也别图省事写成 [int]($total / 60):PowerShell 的 `/` 对两个整数产出 Double,
  # 再 [int] 走的是**银行家舍入**,210/60=3.5 会进成 4(而不是 3),时刻直接算错一小时。
  # 必须先 Floor 再转 int。
  $hh = [int][math]::Floor($total / 60)
  $mm = $total % 60
  $At = '{0:d2}:{1:d2}' -f $hh, $mm
  Write-Host "面板日报任务在 $panelAt，提前 $LeadMinutes 分钟取数 → $At"
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# 用 cmd /c 包一层做输出重定向：任务计划程序本身不提供 stdout 落盘。
# >> 追加而不是覆盖，这样多天的日志能连起来看。
$logPath = Join-Path $DataDir "run.log"
$inner   = '"{0}" "{1}" --data-dir "{2}" >> "{3}" 2>&1' -f $node.Source, $Script, $DataDir, $logPath

# 外面**必须**再套一对引号(`/c "«inner»"`,即 cmd /c ""A" "B" …" 那个经典写法)。
# cmd /? 里的规则:当 /c 后面的串引号多于两个时,它会**剥掉第一个和最后一个引号**。
# 不套外层的话被剥的就是 node 路径两边那对,于是
#     "C:\Program Files\nodejs\node.exe" "…index.mjs" …
# 变成
#     C:\Program Files\nodejs\node.exe" "…index.mjs" …
# cmd 去执行 `C:\Program` —— 每天 06:15 静默失败。winget 装的 node 正好就落在
# 「Program Files」这个带空格的目录里,所以这不是理论风险。
# 套上外层之后被剥掉的是那对多余的,inner 原样送进 cmd。
$action    = New-ScheduledTaskAction -Execute "cmd.exe" -Argument ('/c "' + $inner + '"') -WorkingDirectory $Repo

# -At 收 DateTime。直接喂字符串能不能过取决于**当前区域设置**怎么解析「06:15」——
# 这台机器行不代表下一台行,而装错时刻是静默的(任务照建,只是每天在错的点跑)。
# 显式按不变文化解析,顺便把 -At "6:00" 这种单位数小时也收下;解析不了当场报错。
$atParsed = [datetime]::MinValue
$okAt = [datetime]::TryParseExact($At, @('HH:mm', 'H:mm'),
          [Globalization.CultureInfo]::InvariantCulture,
          [Globalization.DateTimeStyles]::None, [ref]$atParsed)
if (-not $okAt) { throw "时刻格式不对：$At（要 HH:mm，例如 06:15）" }
$trigger   = New-ScheduledTaskTrigger -Daily -At $atParsed
# 关键几项：不插电也跑、跑之前不必空闲、允许跑满（默认 3 天上限足够，25 分钟的活不会被腰斩）。
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                                          -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
                       -Description "GitHub AI 日报取数（wraith）" -Force | Out-Null

Write-Host "已安装：$TaskName"
Write-Host "  每天 $At 取数 → $DataDir"
Write-Host "  日志：$logPath"
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
