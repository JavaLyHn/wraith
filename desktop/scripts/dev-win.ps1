# dev-win.ps1 — Windows 备 wraith 后端 jar 到稳定位置,供桌面 dev 用。
# 对标 macOS 的 wraith-install。用法(仓库任意位置):
#   powershell -ExecutionPolicy Bypass -File desktop\scripts\dev-win.ps1
$ErrorActionPreference = 'Stop'

# 仓库根 = 本脚本上上级(desktop\scripts\ -> desktop -> repo)
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dest = Join-Path $env:USERPROFILE '.wraith\wraith.jar'

Write-Host "dev-win: 构建中 (mvn -q clean package -DskipTests)…"
Push-Location $repo
try {
  mvn -q clean package -DskipTests
  if ($LASTEXITCODE -ne 0) { Write-Error "dev-win: mvn 构建失败 (exit $LASTEXITCODE)"; exit 1 }
} finally {
  Pop-Location
}

# shade 后的可执行包是 target\wraith-*.jar 里最大的那个(original-* 不匹配此通配)
$src = Get-ChildItem (Join-Path $repo 'target\wraith-*.jar') -ErrorAction SilentlyContinue |
  Sort-Object Length -Descending | Select-Object -First 1
if (-not $src) { Write-Error "dev-win: 没找到构建产物 $repo\target\wraith-*.jar"; exit 1 }

New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
Copy-Item $src.FullName $dest -Force
Write-Host "dev-win: 已安装 -> $dest"
Get-Item $dest | Format-List Name, Length, LastWriteTime
