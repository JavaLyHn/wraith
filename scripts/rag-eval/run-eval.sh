#!/usr/bin/env bash
# 代码检索质量评测:跑一遍冻结查询集,输出 R@k / MRR@10。可与上一次结果对比出「好/差」。
#
# 用法:
#   scripts/rag-eval/run-eval.sh                      # 跑一次,存 target/rag-eval/latest.json
#   scripts/rag-eval/run-eval.sh --save-baseline      # 跑一次并存成基线 target/rag-eval/baseline.json
#   scripts/rag-eval/run-eval.sh --vs-baseline        # 跑一次并与基线逐条对比
#
# 前提(缺一个就没法量,脚本会明确报出来,不静默给 0 分):
#   1. mvn package 出过 target/wraith-1.0-SNAPSHOT.jar
#   2. embedding 后端可用(本机 ollama 或云端;走 ~/.wraith/config.json 的配置)
#   3. **当前仓库已建过索引**,且索引的 embedding 模型与当前配置一致
#      —— 不一致时 rag.search 会抛维度错误,脚本直接失败(这是对的:那种情况下的分数没有意义)
#
# 只读:rag.search 不写索引也不写 config。要完全隔离可设:
#   WRAITH_EVAL_HOME=/tmp/eval-home     另一份 ~/.wraith(config + 索引)
#   WRAITH_EVAL_RAGDIR=/tmp/eval-rag    只换索引库,config 仍用真实的
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd)"
JAR="$ROOT/target/wraith-1.0-SNAPSHOT.jar"
QS="$ROOT/scripts/rag-eval/queryset.json"
OUTDIR="$ROOT/target/rag-eval"
mkdir -p "$OUTDIR"

[ -f "$JAR" ] || { echo "缺 jar: $JAR   先跑 mvn package"; exit 1; }
[ -f "$QS" ] || { echo "缺查询集: $QS"; exit 1; }

MODE="${1:-}"
case "$MODE" in
  --save-baseline) OUT="$OUTDIR/baseline.json"; EXTRA=() ;;
  --vs-baseline)
     [ -f "$OUTDIR/baseline.json" ] || { echo "还没有基线。先跑一次 --save-baseline"; exit 1; }
     OUT="$OUTDIR/latest.json"; EXTRA=(--baseline "$OUTDIR/baseline.json") ;;
  "") OUT="$OUTDIR/latest.json"; EXTRA=() ;;
  *) echo "未知参数: $MODE"; exit 64 ;;
esac

node "$ROOT/scripts/rag-eval/eval.mjs" "$JAR" "$QS" --out "$OUT" "${EXTRA[@]+"${EXTRA[@]}"}"
rc=$?
exit $rc
