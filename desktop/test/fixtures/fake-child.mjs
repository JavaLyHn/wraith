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
 *                          SIGTERM so SIGKILL upgrade eventually reap it.
 *   record-timestamps    — write spawn timestamp and exit timestamp to files for B5 ordering tests.
 *                          Takes two positional args after the flag:
 *                            node fake-child.mjs record-timestamps /path/spawn.ts /path/exit.ts [ignore-sigterm]
 *                          Writes Date.now() (ms string) on startup (spawn file) and via process.on('exit')
 *                          (exit file). Combine with ignore-sigterm to force 2s SIGKILL upgrade.
 *   complete-then-hang   — after turn.submit, immediately emit turn.completed (run() settles as success),
 *                          then hang (does NOT exit). Combine with ignore-sigterm to model the B5 double-
 *                          process window: run() settles while the child is still alive, scheduler's
 *                          .finally fires; without B5 fix drainQueue runs immediately; with B5 fix,
 *                          runner.exited blocks drainQueue until SIGKILL reaps the child.
 *
 * With neither flag it replies to interrupt and exits on SIGTERM (baseline).
 */

import readline from 'readline'
import fs from 'fs'

const flags = new Set(process.argv.slice(2))

// B5: record-timestamps — write spawn/exit timestamps for concurrency ordering tests
if (flags.has('record-timestamps')) {
  const tsIndex = process.argv.indexOf('record-timestamps')
  const spawnFile = process.argv[tsIndex + 1]
  const exitFile = process.argv[tsIndex + 2]
  if (spawnFile) fs.writeFileSync(spawnFile, String(Date.now()))
  if (exitFile) {
    process.on('exit', () => { try { fs.writeFileSync(exitFile, String(Date.now())) } catch { /* best-effort */ } })
  }
}

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
      if (flags.has('complete-then-hang')) {
        // Immediately emit turn.completed so run() settles as success, then hang.
        // The runner will call killChild() → SIGTERM. If ignore-sigterm is also set,
        // the process refuses to die → 2s SIGKILL. This exercises the B5 double-process window.
        send({ jsonrpc: '2.0', method: 'turn.completed', params: { summary: 'fake done' } })
        // hang — SIGTERM/SIGKILL handling governed by the ignore-sigterm flag
      }
      // otherwise hang — no turn.completed. The turn "runs" indefinitely until stopped.
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
