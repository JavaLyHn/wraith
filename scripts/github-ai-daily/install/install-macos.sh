#!/bin/bash
# GitHub AI 日报 · macOS 取数任务安装（launchd）
#
# 为什么取数不挂在 wraith 的自动化面板里：面板任务的 execute_command 跑在 Seatbelt 沙箱内，
# profile 里有 (deny network*)，写也只放行 workspace 与 TMPDIR —— 而这脚本要连 GitHub、
# 还要写数据目录。外加 execute_command 有 60 秒硬超时，而一次取数要 25 分钟以上。
# 所以取数交给 launchd（不进沙箱），wraith 那边只负责读报告、点评、投递。
#
# 用法：
#   ./install-macos.sh --from-panel        # 推荐:面板为唯一真相,取数时刻自动反推(默认提前 45 分钟)
#   ./install-macos.sh --from-panel 60     # 提前量改成 60 分钟
#   ./install-macos.sh 05 30               # 手动指定取数时刻 05:30
#   ./install-macos.sh --uninstall         # 卸载
#
# 为什么默认走 --from-panel:时刻该由你在面板里定一次,而不是在两个地方各记一个、
# 还要自己算间隔。取数必须早于面板任务超过一次完整运行时长(实测 31 分钟)。

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

# 仓库根是按本脚本自身位置推断的 —— 在 git worktree 或任何副本里跑,会把每日任务
# 静默指到那个副本上,而副本随时可能被清理。这坑我自己踩过一次,所以拦一下。
case "$REPO" in
  */.git/worktrees/*|*/.claude/worktrees/*)
    echo "⚠ 检测到你在 worktree 里运行：$REPO" >&2
    echo "  每日任务会被指向这个临时目录,它一旦被清理任务就断了。" >&2
    echo "  请到主仓库目录再跑一次本脚本。" >&2
    echo "  确实想这么装就加 --force-worktree。" >&2
    case " $* " in *" --force-worktree "*) ;; *) exit 1 ;; esac
    ;;
esac

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "找不到 node。装一个再来：brew install node" >&2
  exit 1
fi

# 面板任务的**真实**存储:Java daemon 的 AutomationStore(GatewayDaemon.java:56 —— ~/.wraith)。
# 第二条是迁移前的遗留文件:桌面启动时做过一次性迁移(index.ts «Part C»),迁完保留作备份、
# 不再更新。原来这里只读那一条,后果不是"读不到"而是**读到一份冻结的旧列表**——
# 开发机上实测:遗留文件停在一个月前的「给我打招呼」,而真实面板里躺着今天建的「GitHub AI 日报」。
# 顺序不能反:遗留文件在老机器上一直存在,先读它就永远轮不到真的那份。
PANEL_JSON_CANDIDATES=(
  "$HOME/.wraith/automations.json"
  "$HOME/Library/Application Support/wraith-desktop/automations.json"
)

if [ "${1:-}" = "--from-panel" ]; then
  LEAD="${2:-45}"
  PANEL_JSON=""
  for candidate in "${PANEL_JSON_CANDIDATES[@]}"; do
    if [ -f "$candidate" ]; then PANEL_JSON="$candidate"; break; fi
  done
  if [ -z "$PANEL_JSON" ]; then
    echo "读不到面板配置。找过这些位置：" >&2
    for candidate in "${PANEL_JSON_CANDIDATES[@]}"; do echo "  $candidate" >&2; done
    echo "先在桌面「自动化」面板建好日报任务(prompt 写「生成今天的 GitHub AI 日报」),再回来跑本脚本。" >&2
    exit 1
  fi
  echo "读面板配置：$PANEL_JSON"
  # 用 node 解析 —— node 本来就是本脚本的硬依赖,不额外引入 jq/python。
  DERIVED="$("$NODE_BIN" -e '
    const fs = require("fs");
    const lead = Number(process.argv[2]);
    const tasks = (JSON.parse(fs.readFileSync(process.argv[1], "utf8")).tasks) || [];
    // 认哪一条:名字或 prompt 里提到 GitHub 日报的。找不到/找到多条都要说清楚,不许瞎猜。
    const hit = tasks.filter(t => /github/i.test(`${t.name ?? ""} ${t.prompt ?? ""}`)
                                  && /日报|daily/i.test(`${t.name ?? ""} ${t.prompt ?? ""}`));
    if (hit.length !== 1) {
      console.error(`AMBIGUOUS:${hit.length}:` + tasks.map(t => t.name ?? "(无名)").join(" / "));
      process.exit(2);
    }
    const at = hit[0].schedule?.time ?? hit[0].schedule?.at;
    if (!/^\d{1,2}:\d{2}$/.test(at ?? "")) { console.error("NOTIME:" + at); process.exit(3); }
    const [h, m] = at.split(":").map(Number);
    // 减提前量,跨零点回绕到前一天的同一时刻
    const total = ((h * 60 + m - lead) % 1440 + 1440) % 1440;
    console.log(`${String(Math.floor(total / 60)).padStart(2, "0")} ${String(total % 60).padStart(2, "0")} ${at}`);
  ' "$PANEL_JSON" "$LEAD")" || {
    echo "从面板反推失败。要么还没建日报任务,要么建了多条同名的 —— 上面一行是实际找到的任务名。" >&2
    echo "也可以手动指定：./install-macos.sh 06 00" >&2
    exit 1
  }
  HOUR="$(echo "$DERIVED" | cut -d' ' -f1)"
  MINUTE="$(echo "$DERIVED" | cut -d' ' -f2)"
  PANEL_AT="$(echo "$DERIVED" | cut -d' ' -f3)"
  echo "面板日报任务在 $PANEL_AT，提前 ${LEAD} 分钟取数 → $HOUR:$MINUTE"
else
  HOUR="${1:-06}"
  MINUTE="${2:-00}"
fi

if [ ! -f "$SCRIPT" ]; then
  echo "找不到取数脚本：$SCRIPT" >&2
  exit 1
fi

# launchd 起的进程 PATH 极简，gh 不在里面 —— 而 resolveToken 要靠 gh auth token。
# 所以把当前 shell 里 gh 所在的目录显式塞进 plist 的 PATH。
GH_BIN="$(command -v gh || true)"
EXTRA_PATH="$(dirname "$NODE_BIN")"
if [ -n "$GH_BIN" ]; then
  EXTRA_PATH="$EXTRA_PATH:$(dirname "$GH_BIN")"
elif [ -z "${GITHUB_TOKEN:-}" ] && [ -z "${GH_TOKEN:-}" ]; then
  # 两条取 token 的路都没有 —— 现在拦住，好过每天 06:00 静默退码 2。
  echo "拿不到 GitHub token。二选一：" >&2
  echo "  1) brew install gh && gh auth login      （推荐，本脚本会把 gh 目录写进 plist 的 PATH）" >&2
  echo "  2) 自己往 plist 的 EnvironmentVariables 里加 GITHUB_TOKEN" >&2
  echo "     —— 注意 launchd 看不到你 shell 里 export 的变量，且本项目规矩是 token 不落仓库内文件。" >&2
  exit 1
fi

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
echo "接着在 wraith 桌面「自动化」面板建一个任务，项目选 ${REPO}，"
echo "prompt 用 docs/runbooks/github-ai-daily.md 里给的那段（只用 read_file，不碰沙箱）。"
