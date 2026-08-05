# GitHub AI 日报 · 每日取数入口（带面板时刻自同步）
#
# 计划任务调的是**这个**，而不是直接调 index.mjs。多这一层换来三件事：
#
#   1. 面板改了日报时刻，第二天起自动对齐 —— 不用再手跑一次安装脚本。
#      时刻本该只有面板一个真相源；此前安装脚本只是在安装那一刻抄了一份快照。
#   2. node 换了路径也不会断。路径每次运行现解析，不是装的时候写死进任务里。
#      （装死那版的失败方式很坏：任务照跑，只是每天 spawn 一个不存在的 exe。）
#   3. 对时失败绝不挡取数。取数是正事，对时是锦上添花 —— 面板文件读不到、
#      schtasks 改不动，都只记一行日志然后继续取数。
#
# 用法（一般不用手敲，由 install-windows.ps1 注册进任务计划程序）：
#   run-daily.ps1 -LeadMinutes 45   跟随面板：取数时刻 = 面板时刻 − 45 分钟
#   run-daily.ps1 -NoSync           不跟随（安装时用的是 -At 手动指定，没有面板真相可跟）
#   run-daily.ps1 -SyncOnly         只对时、不取数（几秒钟，用来验证同步逻辑）
#
# **改时刻是明天生效的**：今天这次已经被触发了，改的是下一次。把面板时刻往后调没有
# 影响（取数早跑完了）；往前调的那一天，面板任务会如实说「今天的日报还没生成」，
# 第二天自愈。这是自同步这条路的固有代价，换来的是你再也不用碰安装脚本。

param(
  [int]$LeadMinutes = 45,
  [switch]$NoSync,
  [switch]$SyncOnly
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '_panel.ps1')

$TaskName = 'WraithGithubAiDaily'
$Repo     = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$DataDir  = Join-Path $Repo '.ghai'
$Script   = Join-Path $Repo 'scripts\github-ai-daily\index.mjs'
$LogPath  = Join-Path $DataDir 'run.log'

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

function Write-Log([string]$msg) {
  $line = '[{0}] [run-daily] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Host $line
}

# ── 1. 对时（跟随面板）────────────────────────────────────────────────────────
if ($NoSync) {
  Write-Log '装的时候用的是 -At 手动指定时刻，不跟随面板（-NoSync）'
} else {
  try {
    $d    = Get-FetchTimeFromPanel $LeadMinutes
    $task = Get-ScheduledTask -TaskName $TaskName

    # StartBoundary 形如 2026-08-05T08:15:00 —— 与区域设置无关。
    # 刻意不去解析 `schtasks /Query` 的输出：那些字段名会跟着系统语言变
    # （中文机器上是「开始时间」），按它解析等于把脚本焊死在一种语言上。
    $cur = ''
    $sb  = [string]$task.Triggers[0].StartBoundary
    if ($sb -match 'T(\d{2}:\d{2})') { $cur = $Matches[1] }

    if ($cur -eq '') {
      Write-Log "读不出当前触发时刻（StartBoundary=$sb），跳过对时"
    } elseif ($cur -eq $d.FetchAt) {
      Write-Log "时刻一致（$cur），无需调整"
    } else {
      # 用 schtasks /Change 而不是 Set-ScheduledTask -Trigger：后者是整组触发器**替换**，
      # 会顺手把 -StartWhenAvailable 之外的设置也带进重建流程；前者只动开始时间，
      # 而且对一个**正在运行的任务**（此刻就是）改起来是安全的。
      schtasks /Change /TN $TaskName /ST $d.FetchAt | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Log ("面板日报任务在 $($d.PanelAt)，取数时刻 $cur → $($d.FetchAt)" +
                   "（提前 $LeadMinutes 分钟）。**明天起生效**，今天这次仍按 $cur 跑。")
      } else {
        Write-Log ("改时刻失败（schtasks 退码 $LASTEXITCODE），仍按 $cur 跑。" +
                   "手动修：install-windows.ps1 -FromPanel")
      }
    }
  } catch {
    # 吞掉：对时失败不该让今天的日报也没了
    Write-Log "对时跳过：$($_.Exception.Message)"
  }
}

if ($SyncOnly) { Write-Log '仅对时（-SyncOnly），不取数'; exit 0 }

# ── 2. 取数 ───────────────────────────────────────────────────────────────────
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Log '找不到 node —— 本次取数跳过。装一个再来：winget install OpenJS.NodeJS.LTS'
  exit 2
}
Write-Log "开始取数（node: $($node.Source)）"

# 两个 guard，缺一个都会坏：
#
# ① OutputEncoding=UTF8 —— node 输出的是 UTF-8 中文，而 Windows PowerShell 按
#    [Console]::OutputEncoding 解码子进程 stdout。中文 Windows 默认 936(GBK)，
#    不设这行日志里全是乱码。
# ② ErrorActionPreference=Continue —— `2>&1` 把原生命令的 stderr 并进管道时，
#    在 Stop 模式下会抛 NativeCommandError；脚本本身没错，纯粹是被自己的严格模式咬。
#
# 刻意**不**走 `cmd /c "… >> log"`（安装脚本里注册 action 时那种写法）：那条路要跨
# PowerShell 与 cmd 两套引号规则，而 cmd 的引号剥离规则已经在本项目坑过一次
# （node 路径带空格时会被劈开）。直接 & 调用由 PowerShell 逐个参数传递，没有引号问题。
$prevEnc = [Console]::OutputEncoding
$prevEap = $ErrorActionPreference
try {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $ErrorActionPreference = 'Continue'
  & $node.Source $Script --data-dir $DataDir 2>&1 |
    ForEach-Object { Add-Content -Path $LogPath -Value ([string]$_) -Encoding UTF8 }
  $code = $LASTEXITCODE
} finally {
  [Console]::OutputEncoding = $prevEnc
  $ErrorActionPreference = $prevEap
}

Write-Log "取数结束，退出码 $code"
exit $code
