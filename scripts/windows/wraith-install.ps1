# wraith-install.ps1 — 构建并安装 jar + 把 `wraith` 命令挂上 PATH(对标 macOS 的 wraith-install)。
#
#   powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1
#
# 做两件事:
#   1. 构建后端并把 jar 放到 %USERPROFILE%\.wraith\wraith.jar
#      —— 这一步**复用 desktop\scripts\dev-win.ps1**,不复制一遍构建逻辑(单一真源)。
#   2. 把本目录加进**用户级** PATH,于是新开的终端里 `wraith` / `wraith -d` 直接可用。
#      改的是用户 PATH 不是系统 PATH,不需要管理员。
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $here '..\..')).Path
$devWin = Join-Path $repo 'desktop\scripts\dev-win.ps1'

if (-not (Test-Path $devWin)) {
  Write-Error "wraith-install: 找不到 $devWin —— 本脚本必须在仓库内运行"
  exit 1
}

Write-Host "wraith-install: 构建并安装 jar…"
& powershell -ExecutionPolicy Bypass -File $devWin
if ($LASTEXITCODE -ne 0) {
  Write-Error "wraith-install: jar 构建/安装失败 (exit $LASTEXITCODE)"
  exit 1
}

# ── 把 wraith.cmd 所在目录挂上用户 PATH ──────────────────────────────────────
# 用「把仓库目录加进 PATH」而不是「把 wraith.cmd 拷到某个 bin」:
# 拷贝走之后 %~dp0..\.. 就推不出仓库根了,还得再让用户设 WRAITH_REPO。
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $userPath) { $userPath = '' }

$already = ($userPath -split ';' | Where-Object { $_.TrimEnd('\') -ieq $here.TrimEnd('\') }).Count -gt 0
if ($already) {
  Write-Host "wraith-install: PATH 里已有 $here"
} else {
  $newPath = if ($userPath -eq '') { $here } else { "$userPath;$here" }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Write-Host "wraith-install: 已把 $here 加入用户 PATH"
  Write-Host "  ⚠ 当前这个终端窗口读不到新 PATH —— **新开一个**再用 wraith"
}

Write-Host ''
Write-Host 'wraith-install: 完成。用法:'
Write-Host '  wraith              终端 CLI'
Write-Host '  wraith -d           桌面端 dev'
Write-Host '  wraith-install      改完 Java 后端后重新构建装 jar'
