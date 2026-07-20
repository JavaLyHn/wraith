#!/usr/bin/env bash
# Phase D §9.4 真实小样本 A/B 编排:3 宽读任务 × {off/legacy, on-默认, on-压力} = 9 真实会话。
# 每会话隔离 -Duser.home(拷 config.json 保住 key,不污染真实 ~/.wraith);
# 隔离 workspace(git archive 导出纯净树,只读探索,agent 任何副作用随临时目录丢弃)。
# 每会话 driver JSON 落 target/curator-ab/results/<task>-<config>.json;失败不中断整批。
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd)"
JAR="$ROOT/target/wraith-1.0-SNAPSHOT.jar"
DRIVER="$ROOT/scripts/curator-ab/driver.mjs"
RESULTS="$ROOT/target/curator-ab/results"
TIMEOUT="${WRAITH_AB_TIMEOUT:-1200}"
mkdir -p "$RESULTS"

[ -f "$JAR" ] || { echo "缺 jar: $JAR"; exit 1; }
[ -f "$HOME/.wraith/config.json" ] || { echo "缺 ~/.wraith/config.json"; exit 1; }

# 纯净只读 workspace(git archive 当前 HEAD 导出;非 git 仓,agent 动不了 .git)
WS="$(mktemp -d "${TMPDIR:-/tmp}/curator-ab-ws.XXXXXX")"
git -C "$ROOT" archive HEAD | tar -x -C "$WS" || { echo "workspace 导出失败"; exit 1; }
echo "workspace: $WS"

# 任务(宽读,逼近/跨越窗口)
declare -a TASK_IDS=(t1-curator-pkg t2-im-gateways t3-e2e-testids)
declare -a TASK_TEXTS=(
"逐个文件通读 src/main/java/com/lyhn/wraith/context 与 src/main/java/com/lyhn/wraith/agent 两个目录下的所有 Java 源码(至少 30 个文件),必须实际打开每个文件阅读其内容,逐个类记录职责,最后输出一份完整的模块职责清单。不要跳读、不要只看文件名。"
"审计 src/main/java/com/lyhn/wraith 下所有即时通讯(IM)网关适配器(飞书/企业微信/个人微信/QQ 相关的包与类),逐文件打开阅读,列出每个适配器的鉴权方式、消息收发路径、关键类与入口。尽量覆盖全部相关源码文件。"
"通读 desktop/test/e2e/shell.e2e.ts 全文,并打开其中断言引用到的主要 renderer 组件源码(desktop/src/renderer 下),逐一阅读,列出所有 data-testid 及其对应组件与用途。"
)

# 配置:名字:curator开关:额外JVMopts
declare -a CONFIGS=(
"off:false:"
"on-default:true:"
"on-stress:true:-Dwraith.context.tier1=0.15 -Dwraith.context.tier2=0.30 -Dwraith.context.tier3=0.45 -Dwraith.context.target=0.10"
)

run_one() {
  local tid="$1" ttext="$2" cname="$3" curator="$4" opts="$5"
  local out="$RESULTS/${tid}-${cname}.json"
  local tmph; tmph="$(mktemp -d "${TMPDIR:-/tmp}/curator-ab-home.XXXXXX")"
  mkdir -p "$tmph/.wraith"
  cp "$HOME/.wraith/config.json" "$tmph/.wraith/config.json"
  [ -f "$HOME/.env" ] && cp "$HOME/.env" "$tmph/.env"
  [ -f "$HOME/.wraith/.env" ] && cp "$HOME/.wraith/.env" "$tmph/.wraith/.env"
  echo ">>> [$tid / $cname] 起跑 (home=$tmph)"
  WRAITH_AB_HOME="$tmph" WRAITH_AB_CURATOR="$curator" WRAITH_AB_JAVAOPTS="$opts" WRAITH_AB_TIMEOUT="$TIMEOUT" \
    node "$DRIVER" "$JAR" "$WS" "$ttext" > "$out" 2> "$RESULTS/${tid}-${cname}.err" || echo "  (driver 非零退出,已记 $out)"
  echo "  <<< 结果: $(cat "$out" 2>/dev/null | head -c 400)"
  rm -rf "$tmph"
}

for i in "${!TASK_IDS[@]}"; do
  for cfg in "${CONFIGS[@]}"; do
    IFS=':' read -r cname curator opts <<< "$cfg"
    run_one "${TASK_IDS[$i]}" "${TASK_TEXTS[$i]}" "$cname" "$curator" "$opts"
  done
done

rm -rf "$WS"
echo "=== 全部完成,结果在 $RESULTS ==="
ls -la "$RESULTS"
