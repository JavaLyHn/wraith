#!/usr/bin/env node
/**
 * mock-appserver.mjs — deterministic JSON-RPC 2.0 mock backend for E2E tests.
 *
 * Reads stdin line-by-line (JSON-RPC 2.0 JSONL), responds with canned results,
 * and emits a fixed notification sequence (no LLM).
 *
 * Env flags:
 *   MOCK_EXIT_AFTER_INIT=1  — exit(1) after initialize reply (simulates backend crash)
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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sessionCounter = 0
let sessionId = 'sess_mock_0'
let turnId = 'turn_1'
let pendingApproval = false

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
      reply(id, { sessionId })
      break
    }

    case 'turn.submit': {
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
      reply(id, {
        sessionId: rid,
        messages: [
          { role: 'user', content: '之前问的问题' },
          { role: 'assistant', content: '之前的**回答**', reasoningContent: '之前的思考' }
        ]
      })
      break
    }

    case 'session.setApprovalMode': {
      reply(id, { ok: true })
      break
    }

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
