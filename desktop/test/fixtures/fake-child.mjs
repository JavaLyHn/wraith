#!/usr/bin/env node
/**
 * fake-child.mjs — minimal JSON-RPC 2.0 backend for AutomationRunner unit tests (I-6).
 *
 * Drives the runner's exact request sequence (initialize → session.start → turn.submit),
 * then behaves per CLI flags to exercise the "stop" paths that the E2E mock cannot.
 *
 * Flags are read from process.argv (NOT env): the runner spawns the child WITHOUT passing
 * its own env down, so the child inherits the parent test-runner env — flags via argv are the
 * only reliable channel, and WRAITH_APPSERVER_CMD is whitespace-split so `node <script> <flag>`
 * lands each flag as a separate argv entry.
 *
 *   ignore-sigterm       — install a no-op SIGTERM handler so the process refuses to die on SIGTERM
 *                          (forces the runner's 2s SIGKILL upgrade). Then hang.
 *   fail-on-interrupt    — on a `turn.interrupt` request, emit a `turn.failed` notification (mimics a
 *                          real Java thread-interrupt) then hang. Verifies the runner ignores that
 *                          terminal notification while stopping and lands on `interrupted` (via
 *                          SIGTERM→exit→stopped), not `failed`.
 *   emit-stderr          — after turn.submit succeeds, write one line to stderr then hang.
 *                          Used to verify the runner's stderr prefix forwarding (A6).
 *   signal-on-sigterm    — write the marker line "SIGTERM_RECEIVED\n" to stdout when SIGTERM arrives,
 *                          then hang (does NOT exit). Lets tests assert SIGTERM was delivered promptly
 *                          without waiting for process exit. Implies the process stays alive after
 *                          SIGTERM so SIGKILL upgrade eventually reaps it.
 *
 * With neither flag it replies to interrupt and exits on SIGTERM (baseline).
 */

import readline from 'readline'
import fs from 'fs'

const flags = new Set(process.argv.slice(2))

if (flags.has('ignore-sigterm')) {
  process.on('SIGTERM', () => { /* refuse to die on SIGTERM → runner must SIGKILL */ })
}

if (flags.has('signal-on-sigterm')) {
  // Write a marker file when SIGTERM arrives then hang (do NOT exit).
  // The marker file path is passed as the next argv after 'signal-on-sigterm':
  //   node fake-child.mjs signal-on-sigterm /path/to/marker
  // The test polls for the file's existence to confirm SIGTERM was delivered promptly.
  // SIGKILL will eventually reap this process.
  const markerIndex = process.argv.indexOf('signal-on-sigterm')
  const markerPath = process.argv[markerIndex + 1] ?? '/tmp/fake-child-sigterm.marker'
  process.on('SIGTERM', () => {
    // Sync write: guaranteed flushed before SIGKILL might arrive (2s later)
    fs.writeFileSync(markerPath, '1')
    // hang — SIGKILL will eventually reap us
  })
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })

rl.on('line', line => {
  const trimmed = line.trim()
  if (!trimmed) return
  let req
  try { req = JSON.parse(trimmed) } catch { return }
  const { id, method } = req

  switch (method) {
    case 'initialize':
      send({ jsonrpc: '2.0', id, result: { serverInfo: 'fake', model: 'fake-model', capabilities: {} } })
      break
    case 'session.start':
      send({ jsonrpc: '2.0', id, result: { sessionId: 'sess_fake_1' } })
      break
    case 'turn.submit':
      send({ jsonrpc: '2.0', id, result: { turnId: 'turn_fake_1' } })
      if (flags.has('emit-stderr')) {
        // Write one line to stderr so the runner's stderr prefix forwarding can be tested.
        process.stderr.write('fake stderr line\n')
      }
      // then hang — no turn.completed. The turn "runs" indefinitely until stopped.
      break
    case 'turn.interrupt':
      send({ jsonrpc: '2.0', id, result: { ok: true } })
      if (flags.has('fail-on-interrupt')) {
        // Real backend: interrupting the turn thread surfaces as turn.failed BEFORE SIGTERM lands.
        send({ jsonrpc: '2.0', method: 'turn.failed', params: { error: 'interrupted by user' } })
      }
      // then hang (SIGTERM handling governed by the ignore-sigterm flag)
      break
    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
})

rl.on('close', () => process.exit(0))
