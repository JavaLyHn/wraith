#!/usr/bin/env node
/**
 * seq-child-dispatch.mjs — sequential dispatch wrapper for scheduler B5 E2E timing tests.
 *
 * Two tasks share one WRAITH_APPSERVER_CMD but need different fake-child flags:
 *   Invocation 1 (task A): complete-then-hang + ignore-sigterm + record-timestamps → 2s SIGKILL
 *   Invocation 2 (task B): complete-then-hang + record-timestamps (no ignore-sigterm → exits on SIGTERM)
 *
 * The wrapper increments a counter file and then *replaces itself* (exec-style) with fake-child
 * using spawn+signal-forwarding so that SIGTERM sent to this process is forwarded to fake-child.
 * This ensures ignore-sigterm in fake-child is effective.
 *
 * Env vars (set on process.env by the test, inherited by all spawned processes):
 *   SEQ_COUNTER_FILE  — path to a counter file (created by the test, initially "0")
 *   SEQ_FAKE_CHILD    — absolute path to fake-child.mjs
 *   A_SPAWN_FILE      — task A spawn timestamp file
 *   A_EXIT_FILE       — task A exit timestamp file
 *   B_SPAWN_FILE      — task B spawn timestamp file
 */

import { spawn } from 'child_process'
import fs from 'fs'

const counterFile = process.env['SEQ_COUNTER_FILE']
const fakeChild   = process.env['SEQ_FAKE_CHILD']
const aSpawn      = process.env['A_SPAWN_FILE']
const aExit       = process.env['A_EXIT_FILE']
const bSpawn      = process.env['B_SPAWN_FILE']

if (!counterFile || !fakeChild) {
  process.stderr.write('seq-child-dispatch: missing SEQ_COUNTER_FILE or SEQ_FAKE_CHILD\n')
  process.exit(1)
}

// Atomic read-increment-write of counter
let count = 0
try { count = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10) || 0 } catch { /* 0 */ }
fs.writeFileSync(counterFile, String(count + 1))

// Choose flags based on invocation order
let extraArgs
if (count === 0) {
  // First invocation: task A — complete quickly, refuse SIGTERM (forces 2s SIGKILL), record timestamps
  extraArgs = ['complete-then-hang', 'ignore-sigterm', 'record-timestamps', aSpawn ?? '', aExit ?? '']
} else {
  // Second+ invocation: task B — complete and exit on SIGTERM promptly, record spawn timestamp
  extraArgs = ['complete-then-hang', 'record-timestamps', bSpawn ?? '', '/dev/null']
}

// Spawn fake-child and transparently proxy stdin/stdout/stderr.
// Using async spawn (not spawnSync) so we can forward SIGTERM to the real fake-child —
// critical for ignore-sigterm to work: scheduler sends SIGTERM to this wrapper, we forward
// it to fake-child. Without forwarding, SIGTERM would kill this wrapper and fake-child would
// be orphaned/not experience the ignore-sigterm path.
const child = spawn(process.execPath, [fakeChild, ...extraArgs], {
  stdio: 'inherit',  // share stdin/stdout/stderr FDs directly (no pipe buffering)
  env: process.env,
})

// Forward SIGTERM to fake-child (so ignore-sigterm flag is exercised on the real child).
// Also install ignore-sigterm ourselves so this wrapper stays alive until fake-child exits.
process.on('SIGTERM', () => {
  try { child.kill('SIGTERM') } catch { /* child already dead */ }
})

child.on('exit', (code, signal) => {
  // Exit with same code/signal as fake-child
  if (signal) {
    process.kill(process.pid, signal)
  } else {
    process.exit(code ?? 0)
  }
})

child.on('error', () => {
  process.exit(1)
})
