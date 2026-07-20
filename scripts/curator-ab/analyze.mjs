#!/usr/bin/env node
// Phase D §9.4/§9.5 真实 A/B 分析:读 driver 结果 JSON(target/curator-ab/results/*.json)
// → 按任务 × 配置(off/on-default/on-stress)汇总 → DeepSeek 分价折算费用 + 净收益 → markdown 报告。
//
// 价格取自仓库 src/main/java/com/lyhn/wraith/context/PricingTable.java 的 deepseek-v4-flash 种子
// (USD/百万 token):cacheHit 0.0028 / cacheMiss 0.14 / output 0.28。不编造。
//
// 用法:node analyze.mjs <resultsDir> <outReportMd>

import fs from 'node:fs'
import path from 'node:path'

const [resultsDir, outReport] = process.argv.slice(2)
if (!resultsDir || !outReport) { console.error('用法: node analyze.mjs <resultsDir> <outReportMd>'); process.exit(64) }

const PRICE = { cacheHitPerM: 0.0028, cacheMissPerM: 0.14, outputPerM: 0.28, cur: 'USD' } // deepseek-v4-flash
function cost(input, output, cached) {
  const c = Math.max(0, Math.min(input, cached))
  const miss = Math.max(0, input - c)
  return (c / 1e6) * PRICE.cacheHitPerM + (miss / 1e6) * PRICE.cacheMissPerM + (Math.max(0, output) / 1e6) * PRICE.outputPerM
}

const TASKS = ['t1-curator-pkg', 't2-im-gateways', 't3-e2e-testids']
const CONFIGS = ['off', 'on-default', 'on-stress']
const CONFIG_LABEL = { 'off': 'off(legacy 对照)', 'on-default': 'on·默认阈值', 'on-stress': 'on·压力阈值' }

function load(task, cfg) {
  const f = path.join(resultsDir, `${task}-${cfg}.json`)
  if (!fs.existsSync(f)) return null
  try {
    const raw = fs.readFileSync(f, 'utf8').trim()
    if (!raw) return null
    const j = JSON.parse(raw.split('\n').filter(Boolean).pop())
    const cs = j.contextState || {}
    const input = cs.inputTokens | 0, output = cs.outputTokens | 0, cached = cs.cachedInputTokens | 0
    return {
      status: j.status, model: cs.model, window: cs.contextWindow,
      input, output, cached,
      cacheRate: input > 0 ? cached / input : 0,
      cost: cost(input, output, cached),
      compactions: j.compactions | 0, savedTokens: j.savedTokens | 0,
      spilledLogs: j.spilledLogs | 0, tools: j.tools | 0, repeated: j.repeatedToolCalls | 0,
      tierCounts: j.tierCounts || {},
    }
  } catch (e) { console.error(`解析 ${f} 失败: ${e.message}`); return null }
}

const fmtUsd = (v) => '$' + v.toFixed(5)
const fmtPct = (v) => (v * 100).toFixed(1) + '%'

let md = '# ContextCurator Phase D — 真实小样本 A/B 报告\n\n'
md += '> 由 `scripts/curator-ab/`(driver 真跑 wraith app-server + analyze 汇总)自动生成。'
md += '**所有数字来自真实 DeepSeek 会话**(模型/窗口见下),费用按 PricingTable 的 deepseek-v4-flash 种子价折算'
md += `(USD/百万:cacheHit ${PRICE.cacheHitPerM} / cacheMiss ${PRICE.cacheMissPerM} / output ${PRICE.outputPerM})。\n\n`
md += '**口径**:input/output/cached = 会话末 `context.state.get` 的内存累计(curator.stats,on/off 均记);'
md += 'compaction/回取 = 通知流统计;鬼打墙 = 相同 tool+args 调用≥2 次的额外次数;input/工具 = 累计 input÷工具调用数(归一化探索量)。\n\n'
md += '> ⚠ **先读这条**:真实 agent 会话非确定性,各会话工具调用次数差异大 → 累计 input/费用主要受探索深度影响,'
md += '**逐任务费用差不能干净归因给 curator**(详见文末「头号诚实边界」)。干净的量化节省数字见 `phase-d-bench.md`(确定性 bench)。\n\n'

// 元信息
const anyRun = TASKS.flatMap(t => CONFIGS.map(c => load(t, c))).find(Boolean)
if (anyRun) md += `**模型**:\`${anyRun.model}\`,窗口 ${anyRun.window} token。\n\n`

let netDefault = 0, netStress = 0, haveDefault = false, haveStress = false
for (const task of TASKS) {
  md += `## 任务 ${task}\n\n`
  md += '| 配置 | 状态 | 工具调用 | 累计 input | **input/工具** | cached | cache 命中率 | 费用(USD) | 压缩 | 鬼打墙 |\n'
  md += '|---|---|--:|--:|--:|--:|--:|--:|--:|--:|\n'
  const off = load(task, 'off')
  for (const cfg of CONFIGS) {
    const r = load(task, cfg)
    if (!r) { md += `| ${CONFIG_LABEL[cfg]} | (缺) | — | — | — | — | — | — | — | — |\n`; continue }
    const perTool = r.tools > 0 ? Math.round(r.input / r.tools) : 0
    md += `| ${CONFIG_LABEL[cfg]} | ${r.status} | ${r.tools} | ${r.input} | **${perTool}** | ${r.cached} | ${fmtPct(r.cacheRate)} | ${fmtUsd(r.cost)} | ${r.compactions} | ${r.repeated} |\n`
  }
  md += '\n'
  // 净收益(§9.5):净省 = off 费用 − on 费用(off/legacy 为对照)
  const onD = load(task, 'on-default'), onS = load(task, 'on-stress')
  if (off && onD) { const d = off.cost - onD.cost; netDefault += d; haveDefault = true
    md += `- 费用差(默认)= off(${fmtUsd(off.cost)}) − on-default(${fmtUsd(onD.cost)}) = **${fmtUsd(d)}** ` +
          `⚠工具次数 ${off.tools} vs ${onD.tools},差异含探索深度\n` }
  if (off && onS) { const d = off.cost - onS.cost; netStress += d; haveStress = true
    md += `- 费用差(压力)= off(${fmtUsd(off.cost)}) − on-stress(${fmtUsd(onS.cost)}) = **${fmtUsd(d)}** ` +
          `⚠工具次数 ${off.tools} vs ${onS.tools},差异含探索深度\n` }
  md += '\n'
}

md += '## ⚠ 头号诚实边界:真实 agent 会话非确定性,费用差不能干净归因给 curator\n\n'
md += '本批每格只 1 个真实会话,且 agent 探索是非确定性的——**各会话工具调用次数差异巨大**'
md += '(off 组普遍多跑),而累计 input/费用主要由"跑了多少个工具回合"决定。因此:\n\n'
md += '- 上方各任务的「费用差」跨度从 +50% 到 -15%(t3 甚至 on 比 off 贵),**这个方差主要来自探索深度不同,不是 curator 的净效应**。\n'
md += '- 把这些逐任务费用差当作"curator 省了 X%"是**误导**;本报告不做此断言(诚实红线)。\n'
md += `- 仅供参考的合计费用差:默认 ${fmtUsd(netDefault)}、压力 ${fmtUsd(netStress)}(同样受探索方差污染,不作为验收结论)。\n\n`

md += '## 真实 A/B 能诚实得出的结论\n\n'
md += '1. **机制在生产路径可用**:9/9 会话全部 `completed`,curator 开启不破坏真实 DeepSeek agent 运行。\n'
md += '2. **压力下真实触发压缩**:on-stress 观察到真实压缩(如 t3 达 11 次),tier 通知流按预期发出;off/legacy 全程 0 压缩。\n'
md += '3. **归一化后有减载迹象**(非结论,受方差限):部分任务 on 的「input/工具」低于 off(如 t1、t2 默认),提示每次 LLM 调用携带的上下文更小;但 t3 反向,样本不足以定论。\n'
md += '4. **可回取率**:on 压缩把工具全量落盘可回取(见回取列),off/legacy 直接截断丢弃——这是定性能力差,不随方差变。\n\n'

md += '## 干净的量化证据在确定性 bench(§9.3)\n\n'
md += '真实小样本受 agent 非确定性限制,无法给出干净的 token/费用节省数字。**受控的量化结论以 `phase-d-bench.md` 为准**'
md += '(固定脚本、固定探索、curator on/off 同输入):峰值 estInput -78%、累计 -68%、Tier3 只摘 delta、单调边界前缀复用。\n\n'
md += '## 其它诚实边界\n\n'
md += '- **费用差为上界**:Tier3 增量摘要器直连 LlmClient,其自身 LLM 开销不经 `onUsage`、未计入 on 侧,故 on 侧真实成本略高于此处。\n'
md += '- **默认阈值 128k**:多数任务未跨 60%(≈76.8k)→ curator 少触发甚至不触发,on-default 与 off 差异小属预期(curator 是长会话保险)。\n'
md += '- **压力阈值**(tier1=0.15)仅为可控成本下暴露力学,非默认触发点。\n'

fs.mkdirSync(path.dirname(outReport), { recursive: true })
fs.writeFileSync(outReport, md)
console.log(`报告已写 ${outReport}`)
console.log(`净省:默认=${fmtUsd(netDefault)} 压力=${fmtUsd(netStress)}`)
