#!/bin/bash
# GitHub AI 日报 · macOS 取数任务安装（launchd）
#
# 为什么取数不挂在 wraith 的自动化面板里：面板任务的 execute_command 跑在 Seatbelt 沙箱内，
# profile 里有 (deny network*)，写也只放行 workspace 与 TMPDIR —— 而这脚本要连 GitHub、
# 还要写数据目录。外加 execute_command 有 60 秒硬超时，而一次取数要 25 分钟以上。
# 所以取数交给 launchd（不进沙箱），wraith 那边只负责读报告、点评、投递。
#
# 用法：
#   ./install-macos.sh                 # 默认 06:00 跑
#   ./install-macos.sh 05 30           # 改成 05:30
#   ./install-macos.sh --uninstall     # 卸载

set -euo pipefail

LABEL="com.lyhn.wraith.ghai"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DATA_DIR="$REPO/.ghai"
SCRIPT="$REPO/scripts/github-ai-daily/index.mjs"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "已卸载 $LABEL（数据目录 $DATA_DIR 保留，要删自己删）"
  exit 0
fi

HOUR="${1:-06}"
MINUTE="${2:-00}"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "找不到 node。装一个再来：brew install node" >&2
  exit 1
fi
if [ ! -f "$SCRIPT" ]; then
  echo "找不到取数脚本：$SCRIPT" >&2
  exit 1
fi

# launchd 起的进程 PATH 极简，gh 不在里面 —— 而 resolveToken 要靠 gh auth token。
# 所以把当前 shell 里 gh 所在的目录显式塞进 plist 的 PATH。
GH_BIN="$(command -v gh || true)"
if [ -z "$GH_BIN" ]; then
  echo "找不到 gh CLI。脚本靠 \`gh auth token\` 拿 token（也可改用 GITHUB_TOKEN 环境变量）。" >&2
  echo "装一个：brew install gh && gh auth login" >&2
  exit 1
fi
EXTRA_PATH="$(dirname "$NODE_BIN"):$(dirname "$GH_BIN")"

mkdir -p "$DATA_DIR" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$SCRIPT</string>
    <string>--data-dir</string>
    <string>$DATA_DIR</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$EXTRA_PATH:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$((10#$HOUR))</integer>
    <key>Minute</key><integer>$((10#$MINUTE))</integer>
  </dict>
  <key>StandardOutPath</key><string>$DATA_DIR/run.log</string>
  <key>StandardErrorPath</key><string>$DATA_DIR/run.log</string>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "已安装：$LABEL"
echo "  每天 $HOUR:$MINUTE 取数 → $DATA_DIR"
echo "  日志：$DATA_DIR/run.log"
echo
echo "立刻跑一次验证： launchctl kickstart -k gui/$(id -u)/$LABEL"
echo "看它在不在：     launchctl print gui/$(id -u)/$LABEL | head -20"
echo
echo "接着在 wraith 桌面「自动化」面板建一个任务，项目选 $REPO，"
echo "prompt 用 docs/runbooks/github-ai-daily.md 里给的那段（只用 read_file，不碰沙箱）。"
