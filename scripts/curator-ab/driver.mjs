#!/usr/bin/env node
// Phase D §9.4 真实小样本 A/B 驱动:非交互跑一个真实 wraith agent 会话。
//
// 用法:node driver.mjs <jar> <workspaceDir> <taskText>
// 环境:
//   WRAITH_AB_HOME     -> -Duser.home(隔离 ~/.wraith:各跑独立 metrics,不污染真实数据)
//   WRAITH_AB_CURATOR  -> "true"|"false"(-Dwraith.context.curator.enabled,A/B 开关)
//   WRAITH_AB_TIMEOUT  -> 秒(默认 900)
//
// 协议(实证自 AppServer.java):newline-delimited JSON-RPC over stdio。
//   initialize → session.start{workspaceDir}→{sessionId} → session.setApprovalMode{auto:true}
//   → turn.submit{input,mode:"react"} → 等 notification turn.completed/turn.failed。
// 结束打印一行 JSON {sessionId,status,tools,turns} 到 stdout,exit 0(完成)/2(超时)/3(错误)。

import { spawn } from 'node:child_process'
import readline from 'node:readline'

const [jar, workspaceDir, taskText] = process.argv.slice(2)
if (!jar || !workspaceDir || !taskText) {
  console.error('用法: node driver.mjs <jar> <workspaceDir> <taskText>')
  process.exit(64)
}
const home = process.env.WRAITH_AB_HOME
const curator = process.env.WRAITH_AB_CURATOR ?? 'true'
const timeoutMs = (Number(process.env.WRAITH_AB_TIMEOUT) || 900) * 1000

const javaArgs = [
  '-Djava.awt.headless=true',
  ...(home ? [`-Duser.home=${home}`] : []),
  `-Dwraith.context.curator.enabled=${curator}`,
  '-jar', jar, 'app-server',
]

const child = spawn('java', javaArgs, { stdio: ['pipe', 'pipe', 'inherit'] })

let nextId = 1
const pending = new Map()
function send(method, params) {
  const id = nextId++
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }) + '\n')
  return new Promise((res) => pending.set(id, res))
}

let sessionId = null
let done = false
// A/B 捕获(全部来自通知流 + 会话末 context.state.get,不依赖 JSONL 文件落盘)
const cap = {
  tools: 0,
  toolSigs: new Map(),   // name+args → 次数(重复工具=鬼打墙代理)
  compactions: 0,
  savedTokens: 0,
  spilledLogs: 0,        // 落盘可回取的工具日志条数(logPath 存在)
  tierCounts: { 0: 0, 1: 0, 2: 0, 3: 0 },
  contextState: null,    // 会话末 context.state.get 结果(内存累计 input/output/cached/cost/used)
}

async function finish(code, status) {
  if (done) return
  done = true
  clearTimeout(timer)
  // 关窗前查一次内存累计(curator.stats):不受 metrics JSONL 落盘时序影响
  try {
    if (sessionId && code === 0) cap.contextState = await Promise.race([
      send('context.state.get', {}),
      new Promise((r) => setTimeout(() => r(null), 8000)),
    ])
  } catch { /* best-effort */ }
  try { child.kill('SIGKILL') } catch {}
  const repeated = [...cap.toolSigs.values()].filter((n) => n >= 2).reduce((a, n) => a + (n - 1), 0)
  process.stdout.write(JSON.stringify({
    sessionId, status, mode: curator,
    tools: cap.tools, repeatedToolCalls: repeated,
    compactions: cap.compactions, savedTokens: cap.savedTokens, spilledLogs: cap.spilledLogs,
    tierCounts: cap.tierCounts, contextState: cap.contextState,
  }) + '\n')
  process.exit(code)
}

const timer = setTimeout(() => { console.error('[driver] 超时'); finish(2, 'timeout') }, timeoutMs)
timer.unref?.()

const rl = readline.createInterface({ input: child.stdout })
rl.on('line', (line) => {
  line = line.trim()
  if (!line || line[0] !== '{') return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.id != null && pending.has(msg.id)) {
    const res = pending.get(msg.id); pending.delete(msg.id)
    res(msg.result ?? msg.error ?? {})
    return
  }
  // notification
  const m = msg.method, p = msg.params || {}
  if (m === 'tool.call') {
    cap.tools++
    const sig = (p.name || '') + '|' + (p.argsJson || p.arguments || '')
    cap.toolSigs.set(sig, (cap.toolSigs.get(sig) || 0) + 1)
    if (cap.tools % 5 === 0) console.error(`[driver] tools=${cap.tools}`)
  } else if (m === 'context.watermark') {
    const t = p.tier | 0; if (cap.tierCounts[t] != null) cap.tierCounts[t]++
  } else if (m === 'context.compaction') {
    cap.compactions++
    cap.savedTokens += (p.savedTokens | 0)
    if (Array.isArray(p.items)) cap.spilledLogs += p.items.filter((it) => it && it.logPath).length
    console.error(`[driver] compaction tier=${p.tier} saved=${p.savedTokens}`)
  } else if (m === 'turn.completed') { void finish(0, 'completed') }
  else if (m === 'turn.failed') { void finish(0, 'failed') }
})

child.on('exit', (code) => { if (!done) { console.error(`[driver] java 退出 code=${code}`); finish(3, 'java-exit') } })
child.on('error', (e) => { console.error('[driver] spawn 失败', e.message); finish(3, 'spawn-error') })

;(async () => {
  try {
    await send('initialize', {})
    const start = await send('session.start', { workspaceDir })
    sessionId = start && start.sessionId
    if (!sessionId) { console.error('[driver] 无 sessionId'); finish(3, 'no-session'); return }
    console.error(`[driver] sessionId=${sessionId} curator=${curator}`)
    await send('session.setApprovalMode', { auto: true })
    await send('turn.submit', { input: taskText, mode: 'react' })
    console.error('[driver] turn 已提交,等完成…')
  } catch (e) {
    console.error('[driver] 驱动异常', e && e.message)
    finish(3, 'drive-error')
  }
})()
