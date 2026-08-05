#!/usr/bin/env bash
#
# 给 README 拍终端截图用的**中性演示环境**。
#
# 为什么需要它：README 里桌面端那几张图定了一个标准 ——「不消耗 API 额度、也不暴露任何
# 个人数据，对话内容由脚本化的演示后端驱动」。终端截图要同一个标准，否则图里会出现
# 你的真实项目路径、真实会话内容，而且每拍一次就花一次真钱。
#
# 它做三件事：
#   1. 起一个**本机假 LLM 端点**（说 OpenAI 兼容的 SSE），按轮次回预先编好的内容；
#   2. 造一个隔离的 HOME（$DEMO_HOME）与一个演示项目 acme-service —— 因此
#      **不会读写你真实的 ~/.wraith/config.json，也读不到仓库根目录的 .env**；
#   3. 在那个 HOME 下起 wraith。状态栏会把路径缩写成 `~/acme-service`，干净中性。
#
# 用法：
#   bash scripts/screenshots/cli-demo.sh            # 起交互式 CLI（拍图用）
#   bash scripts/screenshots/cli-demo.sh approval   # 同上，但这一轮会触发 HITL 审批卡
#   bash scripts/screenshots/cli-demo.sh doctor     # 只跑 wraith terminal doctor
#   bash scripts/screenshots/cli-demo.sh clean      # 收拾（停端点 + 删演示 HOME）
#
# 拍完记得跑一次 clean —— 假端点是后台进程，不收就一直在。
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
JAR="$REPO/target/wraith-1.0-SNAPSHOT.jar"
DEMO_HOME="${WRAITH_DEMO_HOME:-$HOME/.wraith-screenshot-demo}"
PROJ="$DEMO_HOME/acme-service"
PORT="${WRAITH_DEMO_PORT:-8799}"
PIDFILE="$DEMO_HOME/mock.pid"

die() { echo "❌ $*" >&2; exit 1; }

stop_mock() {
  if [[ -f "$PIDFILE" ]]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
  # 也按端口收一遍:上一轮可能是别的路径起的(比如临时目录里的副本),
  # 只认 pidfile 会让新的一轮**静默绑不上端口**,然后误报「端点没起来」。
  local holder
  holder=$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$holder" ]]; then
    kill $holder 2>/dev/null || true
    sleep 0.4
  fi
}

if [[ "${1:-}" == "clean" ]]; then
  stop_mock
  rm -rf "$DEMO_HOME"
  echo "🧹 已收拾：假端点已停，${DEMO_HOME} 已删除"
  exit 0
fi

[[ -f "$JAR" ]] || die "缺少 ${JAR} —— 先跑 mvn package"

# ── 1. 隔离的 HOME + 演示项目 ────────────────────────────────────────────────
mkdir -p "$DEMO_HOME/.wraith" "$PROJ/src/main/java/com/acme"

cat > "$DEMO_HOME/.wraith/config.json" <<JSON
{
  "defaultProvider" : "demo",
  "providers" : {
    "demo" : {
      "apiKey" : "sk-local-mock-not-a-real-key",
      "baseUrl" : "http://127.0.0.1:$PORT",
      "model" : "wraith-demo",
      "temperature" : 0.7,
      "maxTokens" : 8192
    }
  }
}
JSON

cat > "$PROJ/README.md" <<'MD'
# acme-service

Wraith v1.3.0

订单结算服务。本地起：`mvn spring-boot:run`
MD

cat > "$PROJ/src/main/java/com/acme/OrderService.java" <<'JAVA'
package com.acme;

public class OrderService {
    public long total(int unitPrice, int quantity) {
        return (long) unitPrice * quantity;
    }
}
JAVA

printf 'target/\n' > "$PROJ/.gitignore"

# ── 2. 假 LLM 端点 ──────────────────────────────────────────────────────────
# approval 场景让假端点回一次 execute_command(ApprovalPolicy 里是 🔴 高危,必然触发审批)
SCENE="edit"
[[ "${1:-}" == "approval" ]] && SCENE="approval"

stop_mock
WRAITH_DEMO_SCENE="$SCENE" python3 "$REPO/scripts/screenshots/mock_llm.py" "$PORT" > "$DEMO_HOME/mock.log" 2>&1 &
echo $! > "$PIDFILE"
sleep 1
# 就绪检查只做「端口能连上」。**不能用 curl 打一次真请求**:那是 SSE 流式接口,
# curl 会一直读到流结束,加 -m 就必然超时返回 28 —— 第一版因此在端点其实好着的时候误报失败。
if ! python3 - "$PORT" <<'PROBE'
import socket, sys, time
port = int(sys.argv[1])
for _ in range(20):
    try:
        socket.create_connection(("127.0.0.1", port), 0.3).close()
        sys.exit(0)
    except OSError:
        time.sleep(0.2)
sys.exit(1)
PROBE
then
  die "假端点没起来，看 ${DEMO_HOME}/mock.log"
fi

# ── 3. 起 wraith ────────────────────────────────────────────────────────────
# -Duser.home 而不是 HOME=：WraithConfig 用的是 System.getProperty("user.home")
JAVA_FLAGS=(-Duser.home="$DEMO_HOME")
# JDK 21–23 上 jni provider 会被 native access 检查挡住(见 docs/windows-usage.md),
# 探测一次;不支持这个选项的 JDK 加了会起不来。
if java --enable-native-access=ALL-UNNAMED -version >/dev/null 2>&1; then
  JAVA_FLAGS+=(--enable-native-access=ALL-UNNAMED)
fi

cd "$PROJ" || die "进不去 ${PROJ}"

if [[ "${1:-}" == "doctor" ]]; then
  exec java "${JAVA_FLAGS[@]}" -jar "$JAR" terminal doctor
fi

echo "演示环境就绪（假端点 :${PORT} · 场景 ${SCENE} · HOME=${DEMO_HOME}）"
if [[ "$SCENE" == "approval" ]]; then
  # 交互式 CLI 的 HITL **默认是关的**(Main 里 new TerminalHitlHandler(false)),
  # 不先打开的话这一轮会直接执行,拍不到审批卡。
  echo "⚠ 先敲 /hitl on 再提问，否则命令会直接执行、拍不到审批卡"
fi
echo "拍完请跑：bash scripts/screenshots/cli-demo.sh clean"
echo
exec java "${JAVA_FLAGS[@]}" -jar "$JAR"
