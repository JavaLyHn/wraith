#!/usr/bin/env node
// 代码检索质量评测：对冻结的查询集逐条跑 rag.search，算 R@k / MRR@10。
//
// **刻意驱动真实实现**：走 app-server 的 `rag.search` RPC，也就是真实的
// `CodeRetriever.hybridSearch` + 真实的 `RagQueryTokenizer`(jieba) + 真实的打分。
// 不做任何本地复刻 —— 复刻会和实现漂，而漂了之后评测报的是复刻的分数，不是产品的分数。
//
// 用法: node eval.mjs <jar> <querysetJson> [--out result.json] [--baseline prev.json] [--topk 10]
// 环境:
//   WRAITH_EVAL_HOME    -> -Duser.home(隔离 ~/.wraith:用另一份 config + 另一份索引库)
//   WRAITH_EVAL_RAGDIR  -> -Dwraith.rag.dir(只隔离索引库,config 仍用真实的)
//   WRAITH_EVAL_TIMEOUT -> 秒(默认 600;整套 24 条含 24 次 embedding 往返)
//
// 只读：rag.search 不写索引、不写 config。
//
// 协议(实证自 AppServer.java)：newline-delimited JSON-RPC over stdio。
//   session.start → rag.search{query,topK} × N → shutdown

import { spawn } from 'node:child_process'
import readline from 'node:readline'
import fs from 'node:fs'
import crypto from 'node:crypto'

const args = process.argv.slice(2)
const jar = args[0]
const qsPath = args[1]
if (!jar || !qsPath) {
  console.error('用法: node eval.mjs <jar> <querysetJson> [--out r.json] [--baseline prev.json] [--topk 10]')
  process.exit(64)
}
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const outPath = flag('--out', null)
const basePath = flag('--baseline', null)
const topK = Number(flag('--topk', '10'))
const timeoutMs = (Number(process.env.WRAITH_EVAL_TIMEOUT) || 600) * 1000

const raw = fs.readFileSync(qsPath, 'utf8')
const qsMd5 = crypto.createHash('md5').update(raw).digest('hex')
const QS = JSON.parse(raw).queries
if (!Array.isArray(QS) || QS.length === 0) { console.error('查询集为空'); process.exit(64) }

const jvmArgs = []
if (process.env.WRAITH_EVAL_HOME) jvmArgs.push(`-Duser.home=${process.env.WRAITH_EVAL_HOME}`)
if (process.env.WRAITH_EVAL_RAGDIR) jvmArgs.push(`-Dwraith.rag.dir=${process.env.WRAITH_EVAL_RAGDIR}`)

const child = spawn('java', [...jvmArgs, '-jar', jar, 'app-server'], { stdio: ['pipe', 'pipe', 'pipe'] })
child.stderr.on('data', () => {})   // JVM 的 native-access 警告等，与评测无关

const pending = new Map()
let nextId = 1
const rl = readline.createInterface({ input: child.stdout })
rl.on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }   // 非 JSON 行(启动横幅等)忽略
  if (msg.id == null) return                        // notification
  const r = pending.get(msg.id)
  if (!r) return
  pending.delete(msg.id)
  r(msg.error ? { __rpcError: msg.error.message ?? String(msg.error.code) } : msg.result)
})
function call(method, params) {
  const id = nextId++
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((res, rej) => {
    pending.set(id, res)
    setTimeout(() => { if (pending.delete(id)) rej(new Error(`${method} 超时`)) }, timeoutMs)
  })
}

/** 正确答案在结果列表里的位置(1-based)；不在则 null。 */
function rankOf(results, tgt) {
  for (let i = 0; i < results.length; i++) {
    const fp = String(results[i].filePath ?? '').toLowerCase()
    const nm = String(results[i].name ?? '').toLowerCase()
    if (fp.includes(tgt.path.toLowerCase()) && (!tgt.name || nm.includes(tgt.name.toLowerCase()))) return i + 1
  }
  return null
}
const rr = (r) => (r == null ? 0 : 1 / r)
const pct = (n, d) => (100 * n) / d

async function main() {
  const started = await call('session.start', {})
  if (started?.__rpcError) throw new Error('session.start 失败: ' + started.__rpcError)

  const rows = []
  for (const q of QS) {
    const r = await call('rag.search', { query: q.q, topK })
    if (r?.__rpcError || r?.error) {
      // 索引没建 / 维度不一致 都会走到这里 —— 必须显式失败，不能当成「0 分」混进指标
      throw new Error(`rag.search 失败(${q.q}): ${r.__rpcError ?? r.error}`)
    }
    const results = Array.isArray(r.results) ? r.results : []
    rows.push({ q: q.q, group: q.group ?? '', rank: rankOf(results, q), returned: results.length })
  }
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'shutdown', params: {} }) + '\n')

  const n = rows.length
  const rec = (k) => rows.filter((x) => x.rank != null && x.rank <= k).length
  const metrics = {
    n, R1: pct(rec(1), n), R3: pct(rec(3), n), R5: pct(rec(5), n), R10: pct(rec(10), n),
    MRR: rows.reduce((a, x) => a + rr(x.rank), 0) / n,
    misses: rows.filter((x) => x.rank == null).length,
  }

  console.log(`查询集 ${qsPath}  md5=${qsMd5}  n=${n}  topK=${topK}`)
  console.log('')
  console.log('查询'.padEnd(44) + '名次  组')
  console.log('-'.repeat(56))
  for (const x of rows) console.log(x.q.slice(0, 42).padEnd(44) + String(x.rank ?? '-').padStart(4) + '  ' + x.group.slice(0, 1))
  console.log('-'.repeat(56))
  console.log(`R@1 ${metrics.R1.toFixed(1)}%  R@3 ${metrics.R3.toFixed(1)}%  R@5 ${metrics.R5.toFixed(1)}%  R@10 ${metrics.R10.toFixed(1)}%  MRR@10 ${metrics.MRR.toFixed(4)}  未命中 ${metrics.misses}/${n}`)

  if (basePath) {
    const prev = JSON.parse(fs.readFileSync(basePath, 'utf8'))
    const byQ = new Map(prev.rows.map((x) => [x.q, x.rank]))
    let better = 0, worse = 0, same = 0, unknown = 0
    const deltas = []
    for (const x of rows) {
      if (!byQ.has(x.q)) { unknown++; continue }   // 新加的题:基线里没有,不参与好/差
      const b = byQ.get(x.q)
      if (rr(x.rank) > rr(b)) { better++; deltas.push(['↑', x.q, b, x.rank]) }
      else if (rr(x.rank) < rr(b)) { worse++; deltas.push(['↓', x.q, b, x.rank]) }
      else same++
    }
    console.log('')
    console.log(`对比基线 ${basePath}:  好 ${better} / 差 ${worse} / 不变 ${same}` + (unknown ? ` / 基线里没有的新题 ${unknown}` : ''))
    console.log(`  MRR ${prev.metrics.MRR.toFixed(4)} → ${metrics.MRR.toFixed(4)}  (${((metrics.MRR / prev.metrics.MRR - 1) * 100).toFixed(1)}%)`)
    if (prev.querysetMd5 !== qsMd5) {
      console.log(`  ⚠ 查询集变了(基线 md5 ${prev.querysetMd5?.slice(0, 8)} → 现在 ${qsMd5.slice(0, 8)})——跨查询集比总分是没有意义的，只看逐条升降`)
    }
    for (const [d, q, b, a] of deltas) console.log(`  ${d} ${q.slice(0, 40).padEnd(42)} ${b ?? '-'} → ${a ?? '-'}`)
  }

  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify({ querysetPath: qsPath, querysetMd5: qsMd5, topK, metrics, rows }, null, 1))
    console.log(`\n已写 ${outPath}`)
  }
  child.kill()
}

main().catch((e) => { console.error('评测失败:', e.message); child.kill(); process.exit(1) })
