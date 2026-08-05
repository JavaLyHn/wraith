# GitHub AI 日报 · Windows 取数任务安装（任务计划程序）
#
# 为什么取数不挂在 wraith 的自动化面板里：面板任务的 execute_command 跑在沙箱内
# （Windows 走 AppContainer，与 macOS 的 (deny network*) 语义一致），写也受限；
# 而这脚本要连 GitHub、要写数据目录，一次还要跑 25 分钟以上，远超 execute_command
# 的 60 秒硬超时。所以取数交给任务计划程序，wraith 那边只负责读报告、点评、投递。
#
# 用法（普通 PowerShell 即可，不需要管理员）：
#   .\install-windows.ps1                # 默认每天 06:00
#   .\install-windows.ps1 -At "05:30"
#   .\install-windows.ps1 -Uninstall

param(
  [string]$At = "06:00",
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

$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { throw "找不到 node。装一个再来：winget install OpenJS.NodeJS.LTS" }
if (-not (Test-Path $Script)) { throw "找不到取数脚本：$Script" }

# 脚本靠 `gh auth token` 拿 token（也可改用 GITHUB_TOKEN 环境变量）。
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "找不到 gh CLI。装一个：winget install GitHub.cli，然后 gh auth login"
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# 用 cmd /c 包一层做输出重定向：任务计划程序本身不提供 stdout 落盘。
# >> 追加而不是覆盖，这样多天的日志能连起来看。
$logPath = Join-Path $DataDir "run.log"
$inner   = '"{0}" "{1}" --data-dir "{2}" >> "{3}" 2>&1' -f $node.Source, $Script, $DataDir, $logPath

$action    = New-ScheduledTaskAction -Execute "cmd.exe" -Argument ('/c ' + $inner) -WorkingDirectory $Repo
$trigger   = New-ScheduledTaskTrigger -Daily -At $At
# 关键几项：不插电也跑、跑之前不必空闲、允许跑满（默认 3 天上限足够，25 分钟的活不会被腰斩）。
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                                          -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
                       -Description "GitHub AI 日报取数（wraith）" -Force | Out-Null

Write-Host "已安装：$TaskName"
Write-Host "  每天 $At 取数 → $DataDir"
Write-Host "  日志：$logPath"
Write-Host ""
Write-Host "立刻跑一次验证： Start-ScheduledTask -TaskName $TaskName"
Write-Host "看状态：         Get-ScheduledTaskInfo -TaskName $TaskName"
Write-Host ""
Write-Host "接着在 wraith 桌面「自动化」面板建一个任务，项目选 $Repo，"
Write-Host "prompt 用 docs\runbooks\github-ai-daily.md 里给的那段（只用 read_file，不碰沙箱）。"
