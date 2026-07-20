#!/usr/bin/env node
/**
 * mock-appserver.mjs — deterministic JSON-RPC 2.0 mock backend for E2E tests.
 *
 * Reads stdin line-by-line (JSON-RPC 2.0 JSONL), responds with canned results,
 * and emits a fixed notification sequence (no LLM).
 *
 * Env flags:
 *   MOCK_EXIT_AFTER_INIT=1  — exit(1) after initialize reply (simulates backend crash)
 *   MOCK_SUBMIT_FAIL=1      — reply error to turn.submit (simulates backend rejecting the turn)
 */

import readline from 'readline'
import fs from 'node:fs'

// Optional: append every received request to this file so E2E can assert
// what the backend saw (JSONL of {method, params}).
const recordPath = process.env['WRAITH_E2E_RECORD']
function record(method, params) {
  if (!recordPath) return
  try {
    fs.appendFileSync(recordPath, JSON.stringify({ method, params: params ?? null }) + '\n')
  } catch {
    /* ignore */
  }
}

// Optional: deterministic timing trace for the C1 flake investigation.
// When MOCK_DEBUG_LOG is set, append `<ts> SEND <method>` for every server-push
// notification and `<ts> RECV <method>` for every received request, synchronously
// (appendFileSync) so nothing is lost to buffering when the process is under load.
const mockDebugLogPath = process.env['MOCK_DEBUG_LOG']
function debugLog(dir, method) {
  if (!mockDebugLogPath) return
  try {
    fs.appendFileSync(mockDebugLogPath, `${Date.now()} ${dir} ${method}\n`)
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sessionCounter = 0
let lastWorkspaceDir = null
let sessionId = 'sess_mock_0'
let turnSeq = 0
let turnId = ''
let pendingApproval = false

// ---------------------------------------------------------------------------
// Model / provider state (Task 5: model.list / session.setModel / config.setDefaultProvider)
// ---------------------------------------------------------------------------

const providers = [
  { name: 'deepseek', model: 'deepseek-chat', hasKey: true },
  { name: 'openai', model: 'gpt-4o', hasKey: false },
]

let modelState = {
  current: { provider: 'deepseek', model: 'deepseek-chat' },
  // openai has no key but is set as default so deepseek shows the "set default" button in T45
  default: 'openai',
}

const mockMcp = (() => {
  try { return process.env['MOCK_MCP'] ? JSON.parse(process.env['MOCK_MCP']) : null } catch { return null }
})()
let mcpServers = mockMcp && Array.isArray(mockMcp.servers) ? JSON.parse(JSON.stringify(mockMcp.servers)) : []

// ---------------------------------------------------------------------------
// Automations(定时任务)状态 — E2E mock 之前完全未实现,automations.* 一律回
// "Method not found",导致面板能开但无数据、T33–T37/A4 确定性失败。这里补一套有状态
// 模拟:任务列表 + 运行历史。runNow 依 env 造出 success / waiting_approval / running。
// ---------------------------------------------------------------------------
let automations = []
let autoRuns = []
let autoSeq = 0

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

/** Write one JSON-RPC line to stdout. */
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

/** Success response for a request. */
function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

/** Server-push notification. */
function notify(method, params) {
  debugLog('SEND', method)
  send({ jsonrpc: '2.0', method, params })
}

/** Tiny async delay (ms). Keeps ordering deterministic without blocking. */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Notification sequence after turn.submit
// ---------------------------------------------------------------------------

async function emitTurnSequence() {
  // Small delay to let the result reply reach the client first
  await delay(30)

  notify('turn.started', { sessionId, turnId })
  await delay(20)

  if (process.env['MOCK_SLOW_TURN'] === '1') {
    await delay(3000) // 留出 running 且无弹窗的窗口(Esc 中断测试)
  }

  notify('thinking.begin', { sessionId, turnId, label: 'thinking' })
  await delay(20)

  notify('thinking.delta', { sessionId, turnId, text: '想一下' })
  await delay(20)

  notify('thinking.end', { sessionId, turnId })
  await delay(20)

  notify('message.delta', { sessionId, turnId, text: 'Hello ' })
  await delay(10)

  notify('message.delta', { sessionId, turnId, text: '**world**' })
  await delay(20)

  notify('message.end', { sessionId, turnId })
  await delay(20)

  notify('status', {
    sessionId,
    turnId,
    status: {
      model: 'mock-model', totalTokens: 12000, contextWindow: 64000,
      inputTokens: 9000, outputTokens: 3000, cachedInputTokens: 4000,
      estimatedCost: '¥0.012', hitlEnabled: true, elapsedMillis: 800, phase: 'running'
    }
  })
  await delay(20)

  // MOCK_NO_APPROVAL=1: skip tool call/approval, emit turn.completed immediately (for automation E2E)
  if (process.env['MOCK_NO_APPROVAL'] === '1') {
    notify('turn.completed', { sessionId, turnId, status: 'completed' })
    return
  }

  notify('tool.call', {
    sessionId,
    turnId,
    callId: 'c1',
    name: process.env['MOCK_APPROVAL_TOOL'] === 'write_file' ? 'write_file' : 'execute_command',
    argsJson: process.env['MOCK_APPROVAL_TOOL'] === 'write_file'
      ? '{"path":"src/hello.txt","content":"new line\\n"}'
      : '{"command":"echo hi"}'
  })
  await delay(20)

  if (process.env['MOCK_APPROVAL_TOOL'] === 'write_file') {
    notify('approval.requested', {
      sessionId, turnId, approvalId: 'a1',
      toolName: 'write_file',
      argsJson: '{"path":"src/hello.txt","content":"new line\\n"}',
      dangerLevel: '🟡 中危',
      riskDescription: 'writes a file',
      suggestion: '需要更新 hello.txt',
      beforeContent: 'old line\n'
    })
  } else {
    notify('approval.requested', {
      sessionId, turnId, approvalId: 'a1',
      toolName: 'execute_command',
      argsJson: '{"command":"echo hi"}',
      dangerLevel: '🔴 高危',
      riskDescription: 'runs a shell command',
      suggestion: '测试需要执行该命令',
      beforeContent: null
    })
  }

  // Mark that we are now waiting for approval.respond
  pendingApproval = true
}

// ---------------------------------------------------------------------------
// Notification sequence after approval.respond
// ---------------------------------------------------------------------------

async function emitPostApprovalSequence(approved) {
  await delay(30)

  if (approved) {
    notify('tool.output.delta', {
      sessionId,
      turnId,
      callId: 'c1',
      stream: 'stdout',
      chunk: 'hi'
    })
    await delay(20)

    notify('tool.result', {
      sessionId,
      turnId,
      callId: 'c1',
      ok: true,
      exitCode: 0
    })
    await delay(20)
    notify('diff', {
      sessionId, turnId,
      file: 'src/hello.txt',
      before: 'old line\n',
      after: 'new line\nplus\n'
    })
  } else {
    notify('tool.result', {
      sessionId,
      turnId,
      callId: 'c1',
      ok: false,
      exitCode: -1
    })
  }
  await delay(20)

  notify('turn.completed', { sessionId, turnId, status: 'completed' })
}

// ---------------------------------------------------------------------------
// Request dispatch
// ---------------------------------------------------------------------------

async function handleRequest(req) {
  const { id, method, params } = req
  record(method, params)
  debugLog('RECV', method)

  switch (method) {
    case 'initialize': {
      reply(id, {
        serverInfo: 'mock',
        protocol: '1',
        model: 'mock-model',
        capabilities: { toolOutputStreaming: true, sandbox: process.env['MOCK_SANDBOX'] || 'macos-seatbelt' }
      })

      // Simulate crash if env flag set
      if (process.env['MOCK_EXIT_AFTER_INIT'] === '1') {
        await delay(50)
        process.exit(1)
      }
      break
    }

    case 'session.start': {
      sessionId = `sess_mock_${++sessionCounter}`
      lastWorkspaceDir = (params && params.workspaceDir) || null
      reply(id, { sessionId })
      if (mockMcp && Array.isArray(mockMcp.statusScript)) {
        for (const step of mockMcp.statusScript) {
          setTimeout(() => {
            const s = mcpServers.find(x => x.name === step.name)
            if (s) { s.state = step.state; s.enabled = step.state !== 'disabled'; if (step.error) s.error = step.error }
            notify('mcp.status', { sessionId, name: step.name, state: step.state, ...(step.error ? { error: step.error } : {}) })
          }, step.afterMs)
        }
      }
      break
    }

    case 'turn.submit': {
      // MOCK_SUBMIT_FAIL=1: reply error instead of starting a turn (simulates backend rejecting)
      if (process.env['MOCK_SUBMIT_FAIL'] === '1') {
        send({ jsonrpc: '2.0', id, error: { code: -32000, message: 'mock: turn.submit rejected' } })
        break
      }
      // Assign a fresh turnId for this turn; all notifications in this turn share it
      turnId = `turn_${++turnSeq}`
      // Immediately reply with turnId + status, then stream notifications
      reply(id, { turnId, status: 'running' })
      // Fire-and-forget async sequence
      emitTurnSequence().catch(err => process.stderr.write(String(err) + '\n'))
      break
    }

    case 'approval.respond': {
      const decision = (params && params.decision) || 'APPROVED'
      const approved = decision !== 'REJECTED'
      reply(id, { ok: true })
      pendingApproval = false
      emitPostApprovalSequence(approved).catch(err => process.stderr.write(String(err) + '\n'))
      break
    }

    case 'turn.interrupt': {
      reply(id, { ok: true })
      break
    }

    case 'session.list': {
      const byWs = process.env['MOCK_SESSIONS_BY_WS']
      if (byWs) {
        let map = {}
        try { map = JSON.parse(byWs) } catch { /* 坏 JSON → 空 map */ }
        reply(id, { sessions: (lastWorkspaceDir && map[lastWorkspaceDir]) || [] })
        break
      }
      reply(id, {
        sessions: [
          { id: 'sess_a', cwd: '/p', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T01:00:00Z', provider: 'mock', model: 'mock-model', title: '第一段对话', turns: 2 },
          { id: 'sess_b', cwd: '/p', createdAt: '2026-06-30T00:00:00Z', updatedAt: '2026-06-30T01:00:00Z', provider: 'mock', model: 'mock-model', title: '早先的对话', turns: 5 }
        ]
      })
      break
    }

    case 'session.resume': {
      const rid = (params && params.sessionId) || 'sess_a'
      // sess_fallback: simulate key-loss fallback — original provider lost its key,
      // backend fell back to the default provider/model and sets modelFallback:true.
      if (rid === 'sess_fallback') {
        reply(id, {
          sessionId: rid,
          messages: [
            { role: 'user', content: '之前问的问题' },
            { role: 'assistant', content: '之前的**回答**', reasoningContent: '之前的思考' }
          ],
          provider: modelState.current.provider,
          model: modelState.current.model,
          modelFallback: true,
        })
        break
      }
      // Normal resume: emit current provider/model (no fallback)
      reply(id, {
        sessionId: rid,
        messages: [
          { role: 'user', content: '之前问的问题' },
          { role: 'assistant', content: '之前的**回答**', reasoningContent: '之前的思考' }
        ],
        provider: modelState.current.provider,
        model: modelState.current.model,
      })
      break
    }

    case 'session.setApprovalMode': {
      reply(id, { ok: true })
      break
    }

    case 'session.rewind': {
      reply(id, { ok: true })
      break
    }

    case 'mcp.list': {
      reply(id, { servers: mcpServers, ...(process.env['MOCK_MCP_CONFIG_ERROR'] ? { configError: process.env['MOCK_MCP_CONFIG_ERROR'] } : {}) })
      break
    }
    case 'mcp.enable':
    case 'mcp.disable': {
      const s = mcpServers.find(x => x.name === (params && params.name))
      if (s) { s.enabled = method === 'mcp.enable'; s.state = s.enabled ? 'ready' : 'disabled' }
      reply(id, { ok: true })
      break
    }
    case 'mcp.restart': {
      reply(id, { ok: true })
      break
    }
    case 'mcp.logs': {
      reply(id, { lines: '[mock] line1\n[mock] line2' })
      break
    }
    case 'mcp.resources': {
      const all = (mockMcp && mockMcp.resources) || []
      reply(id, { resources: params && params.name ? all.filter(r => r.server === params.name) : all })
      break
    }
    case 'mcp.prompts': {
      reply(id, { text: '[mock] prompt 列表文本' })
      break
    }
    case 'mcp.config.upsert': {
      const p = params || {}
      const existing = mcpServers.find(x => x.name === p.name)
      if (!existing) mcpServers.push({ name: p.name, state: 'starting', scope: p.scope, enabled: true, shadowed: false, transport: 'stdio', tools: [], envKeys: Object.keys(p.env || {}) })
      reply(id, { ok: true })
      break
    }
    case 'mcp.config.remove': {
      mcpServers = mcpServers.filter(x => x.name !== (params && params.name))
      reply(id, { ok: true })
      break
    }

    case 'model.list': {
      reply(id, {
        current: { ...modelState.current },
        default: modelState.default,
        providers: providers.map(p => ({ name: p.name, model: p.model, hasKey: p.hasKey })),
      })
      break
    }

    case 'session.setModel': {
      const providerName = params && params.provider
      const target = providers.find(p => p.name === providerName)
      if (!target) {
        send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown provider: ${providerName}` } })
        break
      }
      if (!target.hasKey) {
        send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Provider ${providerName} has no API key configured` } })
        break
      }
      modelState.current = { provider: target.name, model: target.model }
      reply(id, { provider: target.name, model: target.model })
      break
    }

    case 'config.setDefaultProvider': {
      const providerName = params && params.provider
      const target = providers.find(p => p.name === providerName)
      if (!target) {
        send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown provider: ${providerName}` } })
        break
      }
      modelState.default = target.name
      reply(id, { ok: true })
      break
    }

    // -----------------------------------------------------------------------
    // Automations(定时任务)
    // -----------------------------------------------------------------------
    case 'automations.list': {
      reply(id, { tasks: automations })
      break
    }
    case 'automations.upsert': {
      const t = { ...(params || {}) }
      if (!t.id) t.id = `auto_${++autoSeq}`
      if (t.createdAt == null) t.createdAt = Date.now()
      if (t.enabled == null) t.enabled = true
      if (t.lastFiredAt === undefined) t.lastFiredAt = null
      const i = automations.findIndex(x => x.id === t.id)
      if (i >= 0) automations[i] = { ...automations[i], ...t }
      else automations.push(t)
      reply(id, { ok: true, task: automations.find(x => x.id === t.id) })
      break
    }
    case 'automations.remove': {
      const rid = params && params.id
      automations = automations.filter(x => x.id !== rid)
      autoRuns = autoRuns.filter(r => r.taskId !== rid)
      reply(id, { ok: true })
      break
    }
    case 'automations.runNow': {
      const taskId = (params && params.id) || (automations[0] && automations[0].id) || 'auto_0'
      const now = Date.now()
      const run = { runId: `run_${++autoSeq}`, taskId, startedAt: now, status: 'running', sessionId: `sess_auto_${autoSeq}` }
      if (process.env['MOCK_SLOW_TURN'] === '1') {
        // 保持 running,等 automations.stop(面板已移除中断按钮,T35 为旧特性遗留,会另行说明)
      } else if (process.env['MOCK_APPROVAL_TOOL']) {
        run.status = 'waiting_approval'
        run.approvalId = `${taskId}#1`
        run.approvalTool = process.env['MOCK_APPROVAL_TOOL']
      } else {
        run.status = 'success'
        run.endedAt = now + 1
        run.summary = 'Hello **world**'
      }
      autoRuns.push(run)
      reply(id, { ok: true, runId: run.runId })
      // 自动化审批:run 落 waiting_approval 后,daemon 侧 push approval.requested;主进程据此
      // pushBadge 点红点(§1.1-6 有挂起审批即亮)。先落状态再 notify,保证 main 回拉 runs 已见 waiting。
      if (run.status === 'waiting_approval') {
        notify('approval.requested', {
          sessionId: run.sessionId, turnId: `${run.runId}-t1`, approvalId: run.approvalId,
          toolName: run.approvalTool, argsJson: '{}', dangerLevel: 'medium',
        })
      }
      break
    }
    case 'automations.runs': {
      const tid = params && params.taskId
      reply(id, { runs: tid ? autoRuns.filter(r => r.taskId === tid) : autoRuns.slice() })
      break
    }
    case 'automations.stop': {
      const r = autoRuns.find(x => x.runId === (params && params.runId))
      if (r && r.endedAt == null) { r.status = 'interrupted'; r.endedAt = Date.now() }
      reply(id, { ok: true })
      break
    }
    case 'automations.respondApproval': {
      const decision = (params && params.decision) || 'APPROVED'
      const r = autoRuns.find(x => x.approvalId === (params && params.approvalId))
        || autoRuns.find(x => x.status === 'waiting_approval')
      if (r) {
        if (decision === 'REJECTED') { r.status = 'failed' } else { r.status = 'success'; r.summary = 'Hello **world**' }
        r.endedAt = Date.now()
        delete r.approvalId; delete r.approvalTool
      }
      reply(id, { ok: true })
      break
    }
    case 'automations.qqPending': { reply(id, { items: [], count: 0 }); break }
    case 'automations.qqPendingClear': { reply(id, { ok: true }); break }

    case 'shutdown': {
      reply(id, { ok: true })
      process.exit(0)
      break
    }

    default: {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      })
    }
  }
}

// ---------------------------------------------------------------------------
// stdin readline loop
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, terminal: false })

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let req
  try {
    req = JSON.parse(trimmed)
  } catch {
    process.stderr.write(`[mock] bad JSON: ${trimmed}\n`)
    return
  }
  handleRequest(req).catch(err => process.stderr.write(`[mock] error: ${String(err)}\n`))
})

rl.on('close', () => {
  // stdin closed — clean up
  process.exit(0)
})

process.stderr.write('[mock-appserver] ready\n')
