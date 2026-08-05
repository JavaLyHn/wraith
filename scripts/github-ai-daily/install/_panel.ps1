# 从面板反推取数时刻 —— install-windows.ps1（装的时候）与 run-daily.ps1（每天跑的时候）共用。
#
# 单独抽出来是因为这段逻辑现在有**两个**调用点，而它们必须给出完全一致的答案：
# 装的时候算出 08:15、每天自同步又算出别的，任务就会自己来回抖。
#
# 本文件只被 dot-source，不单独执行。

function Get-PanelAutomationsPath {
  # 面板任务的**真实**存储：Java daemon 的 AutomationStore（GatewayDaemon.java —— ~/.wraith）。
  # 第二条是迁移前的遗留文件（桌面 index.ts «Part C» 一次性迁移，迁完保留作备份、不再更新）。
  # 顺序不能反：遗留文件在老机器上一直存在，先读它就永远轮不到真的那份 —— 后果不是
  # 「读不到」而是静默按一份冻结的旧列表算出错的时刻。
  $candidates = @(
    (Join-Path $env:USERPROFILE '.wraith\automations.json'),
    (Join-Path $env:APPDATA 'wraith-desktop\automations.json')
  )
  $hit = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $hit) {
    throw ("读不到面板配置。找过这些位置：`n  " + ($candidates -join "`n  ") +
           "`n先在桌面「自动化」面板建好日报任务（prompt 写「生成今天的 GitHub AI 日报」）。")
  }
  return $hit
}

function Get-PanelDailyTime([string]$PanelPath) {
  $tasks = (Get-Content $PanelPath -Raw -Encoding UTF8 | ConvertFrom-Json).tasks
  # 认哪一条：名字或 prompt 里同时提到 github 与「日报/daily」。找不到或找到多条都要说清楚，不许瞎猜。
  $hit = @($tasks | Where-Object {
    $t = "$($_.name) $($_.prompt)"
    $t -match '(?i)github' -and $t -match '(?i)日报|daily'
  })
  if ($hit.Count -ne 1) {
    $names = ($tasks | ForEach-Object { if ($_.name) { $_.name } else { '(无名)' } }) -join ' / '
    throw "从面板反推失败：匹配到 $($hit.Count) 条日报任务。面板里现有：$names"
  }
  $at = if ($hit[0].schedule.time) { $hit[0].schedule.time } else { $hit[0].schedule.at }
  if ($at -notmatch '^\d{1,2}:\d{2}$') { throw "面板任务的时刻读不出来：$at" }
  return $at
}

<#
.SYNOPSIS
读面板 → 返回 @{ PanelAt; FetchAt; PanelPath }。读不到 / 认不出唯一一条时抛错。
#>
function Get-FetchTimeFromPanel([int]$LeadMinutes) {
  $panel   = Get-PanelAutomationsPath
  $panelAt = Get-PanelDailyTime $panel
  $ph, $pm = $panelAt -split ':'
  # 减提前量，跨零点回绕到前一天同一时刻
  $total = (([int]$ph * 60 + [int]$pm - $LeadMinutes) % 1440 + 1440) % 1440
  # [int] 不是装饰：[math]::Floor() 返回 Double，而 d2 是整数专用说明符，喂 Double 会抛
  # 「格式说明符无效」—— 真机首跑就死在这行。
  # 也别图省事写成 [int]($total / 60)：PowerShell 的 `/` 对两个整数产出 Double，
  # [int] 走**银行家舍入**，210/60=3.5 会进成 4 —— 时刻直接错一小时，而且是静默的。
  $hh = [int][math]::Floor($total / 60)
  $mm = $total % 60
  return [pscustomobject]@{
    PanelAt   = $panelAt
    FetchAt   = ('{0:d2}:{1:d2}' -f $hh, $mm)
    PanelPath = $panel
  }
}
