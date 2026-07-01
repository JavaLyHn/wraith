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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sessionId = 'sess_mock'
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

  notify('tool.call', {
    sessionId,
    turnId,
    callId: 'c1',
    name: 'execute_command',
    argsJson: '{"command":"echo hi"}'
  })
  await delay(20)

  notify('approval.requested', {
    sessionId,
    turnId,
    approvalId: 'a1',
    toolName: 'execute_command',
    argsJson: '{"command":"echo hi"}',
    dangerLevel: '🔴 高危',
    riskDescription: 'runs a shell command'
  })

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

  switch (method) {
    case 'initialize': {
      reply(id, {
        serverInfo: 'mock',
        protocol: '1',
        model: 'mock-model',
        capabilities: { toolOutputStreaming: true }
      })

      // Simulate crash if env flag set
      if (process.env['MOCK_EXIT_AFTER_INIT'] === '1') {
        await delay(50)
        process.exit(1)
      }
      break
    }

    case 'session.start': {
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
      const approved = decision === 'APPROVED'
      reply(id, { ok: true })
      pendingApproval = false
      emitPostApprovalSequence(approved).catch(err => process.stderr.write(String(err) + '\n'))
      break
    }

    case 'turn.interrupt': {
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
