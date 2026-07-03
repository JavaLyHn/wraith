/**
 * T2 — 自动化流水线砖死:spawn 同步抛兜底
 *
 * 验证:当 spawn() 同步抛出(ERR_INVALID_ARG_* / EMFILE / ENFILE 等)时,
 *   1. run() 以终态 failed 落地(不永久挂起)
 *   2. runner.exited 立即 resolve(允许 scheduler 释放并发槽)
 *   3. scheduler 的并发槽被释放:后续 runNow 能正常触发(不永久排队)
 *
 * RED PROOF(不运行,仅文档):
 *   去掉 automationRunner.ts 中的 try/catch 后:
 *   - new Promise executor 同步抛 → Promise 以 rejected 落地(而非 pending)
 *   - run() rejected → scheduler .catch 路径虽然调 finishRun,但 .finally 里
 *     runner.exited.then 仍然永久 pending(没有子进程,exit/error 事件永不触发)
 *   - this.current 永不清 → drainQueue 永不运行
 *   - 断言 1:result === TIMEOUT_SENTINEL(run() 实际是 reject 而非 resolve,
 *     但 scheduler 包了 .catch 来调 finishRun,runner 本身的 run() rejected →
 *     实际上 test 用 Promise.race 对 run() 本身,它会 reject → race 变成 reject →
 *     测试报错而非超时。无论哪种,测试都不绿)
 *   - 断言 2:exited race → SENTINEL(永不 resolve)
 *   - 断言 3:onTerminal 永不收到 task-b 的 terminal call → 测试超时
 *
 * 实现策略:
 *   - vi.mock('child_process') 文件级替换 spawn(vitest hoist,不影响其他文件)
 *   - mockImplementationOnce 控制"第一次抛 / 其余回落真实实现"
 */

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── vi.mock 必须在顶层(vitest hoist 它到文件最前) ───────────────────────────
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

// ── 在 vi.mock 之后 import,确保 runner/scheduler 拿到 mocked spawn ───────────
import * as childProcess from 'child_process'
import { AutomationRunner } from '../src/main/automationRunner'
import { AutomationScheduler } from '../src/main/automationScheduler'
import { upsertTask } from '../src/main/automationsStore'
import type { AutomationTask } from '../src/shared/types'

const spawnMock = childProcess.spawn as ReturnType<typeof vi.fn>

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fakeChild = path.resolve(__dirname, 'fixtures/fake-child.mjs')

// ─────────────────────────────────────────────────────────────────────────────
// 断言 1: run() 以 failed 终态 resolve
// ─────────────────────────────────────────────────────────────────────────────

describe('T2: spawn 同步抛兜底 — AutomationRunner.run() 终态', () => {
  it('spawn 同步抛 → run() 以 failed 终态 resolve(不挂起)', async () => {
    const syncError = new Error('EMFILE: too many open files')
    ;(syncError as NodeJS.ErrnoException).code = 'EMFILE'
    spawnMock.mockImplementationOnce(() => { throw syncError })

    const env = { ...process.env, WRAITH_APPSERVER_CMD: `node ${fakeChild}` } as NodeJS.ProcessEnv
    const runner = new AutomationRunner(env, '/nonexistent-home', {
      onUpdate: vi.fn(),
      onApproval: vi.fn(),
    }, 'task-sync-throw')

    // 超时保护:若 run() 挂住,race 中 timeout 会先触发
    const TIMEOUT_SENTINEL = 'TIMEOUT'
    const result = await Promise.race([
      runner.run('/tmp', 'test').then(s => s).catch(() => ({ phase: 'rejected' })),
      new Promise<string>(r => setTimeout(() => r(TIMEOUT_SENTINEL), 3000)),
    ])

    expect(result).not.toBe(TIMEOUT_SENTINEL)
    expect((result as { phase: string }).phase).toBe('failed')
  }, 8000)
})

// ─────────────────────────────────────────────────────────────────────────────
// 断言 2: runner.exited 立即 resolve
// ─────────────────────────────────────────────────────────────────────────────

describe('T2: spawn 同步抛兜底 — runner.exited resolve', () => {
  it('spawn 同步抛 → runner.exited 立即 resolve(允许 scheduler 释放并发槽)', async () => {
    const syncError = new Error('ERR_INVALID_ARG_TYPE: cmd must be a string')
    ;(syncError as NodeJS.ErrnoException).code = 'ERR_INVALID_ARG_TYPE'
    spawnMock.mockImplementationOnce(() => { throw syncError })

    const env = { ...process.env, WRAITH_APPSERVER_CMD: `node ${fakeChild}` } as NodeJS.ProcessEnv
    const runner = new AutomationRunner(env, '/nonexistent-home', {
      onUpdate: vi.fn(),
      onApproval: vi.fn(),
    })

    // 启动 run()(不等它,只检查 exited)
    void runner.run('/tmp', 'test').catch(() => { /* ignored */ })

    // exited 在 catch 路径中同步 resolve → race 时 exited 应快于 timeout
    const SENTINEL = 'timeout'
    const raceResult = await Promise.race([
      runner.exited.then(() => 'exited'),
      new Promise<string>(r => setTimeout(() => r(SENTINEL), 500)),
    ])
    expect(raceResult).toBe('exited')
  }, 5000)
})

// ─────────────────────────────────────────────────────────────────────────────
// 断言 3: scheduler 并发槽被释放,后续 runNow 能触发
// ─────────────────────────────────────────────────────────────────────────────

describe('T2: spawn 同步抛兜底 — AutomationScheduler 并发槽释放', () => {
  it('runNow(A) spawn 同步抛 → slot 释放 → runNow(B) 能正常触发', async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-t2-sched-'))
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-t2-proj-'))

    const taskA: AutomationTask = {
      id: 'task-a-sync', name: 'Task A', prompt: 'run A',
      projectPath: projectDir, enabled: true,
      schedule: { kind: 'interval', everyMinutes: 60 },
      createdAt: 1000, enabledAt: 1000, lastFiredAt: null,
    }
    const taskB: AutomationTask = {
      id: 'task-b-sync', name: 'Task B', prompt: 'run B',
      projectPath: projectDir, enabled: true,
      schedule: { kind: 'interval', everyMinutes: 60 },
      createdAt: 1000, enabledAt: 1000, lastFiredAt: null,
    }

    try {
      upsertTask(testDir, taskA)
      upsertTask(testDir, taskB)

      // 第一次 spawn (task-a runner) → 同步抛
      // 第二次及以后 (task-b runner + B 内部子进程) → 真实实现
      const syncError = new Error('EMFILE: too many open files')
      ;(syncError as NodeJS.ErrnoException).code = 'EMFILE'

      // 获取真实 spawn 引用(mock 包装了它,但 mock 的默认实现已经是 vi.fn(actual.spawn),
      // mockImplementationOnce 耗尽后会回落到包装的真实实现)
      spawnMock.mockImplementationOnce(() => { throw syncError })
      // 无需额外设置:mockImplementationOnce 消耗后,mock 回落到初始包装(actual.spawn)

      const onTerminal = vi.fn()
      const scheduler = new AutomationScheduler({
        userDataDir: testDir,
        // 'complete-then-hang' → task-b 的 fake-child 立即发 turn.completed 然后挂,
        // runner 收到 turn.completed 后 killChild(SIGTERM) → 子进程正常退出(不持 ignore-sigterm)
        // → 整个 B 生命周期在 ~200ms 内完成,避免等 SIGKILL 升级。
        env: { ...process.env, WRAITH_APPSERVER_CMD: `node ${fakeChild} complete-then-hang` } as NodeJS.ProcessEnv,
        homedir: os.tmpdir(),
        onRunsChanged: vi.fn(),
        onApproval: vi.fn(),
        onTerminal,
      })

      // runNow(A):立即 fire → spawn 同步抛 → exited resolve(sync) → .finally → current=null
      const resultA = scheduler.runNow('task-a-sync')
      expect(resultA.ok).toBe(true)

      // 等待 microtask/macrotask 链完成:
      //   run() settle(sync) → .then(finishRun) → .finally → exited.then → current=null
      // 给 50ms 余量
      await new Promise(r => setTimeout(r, 50))

      // 此时 this.current 应已为 null → runNow(B) 直接 fire(不排队)
      const resultB = scheduler.runNow('task-b-sync')
      expect(resultB.ok).toBe(true)

      // 验证 task-a 的 failed terminal 已经被 onTerminal 调用
      // (证明 sync 抛走完了 finishRun 路径)
      expect(onTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-a-sync', status: 'failed' }),
      )
      // resultB.ok===true 已证明 slot 被释放;task-b 的 runner 已在运行。
      // fake-child 'complete-then-hang' → turn.completed 立即触发 run() settle(success) → killChild
      // 然后 SIGTERM 发出;子进程没有 ignore-sigterm → 立即退出。
      // 等 task-b onTerminal 落地(应在 ~200ms 内)。
      await expect.poll(
        () => onTerminal.mock.calls.some(c => (c[0] as { taskId: string }).taskId === 'task-b-sync'),
        { timeout: 4000 },
      ).toBe(true)
    } finally {
      try { fs.rmSync(testDir, { recursive: true, force: true }) } catch { /* best-effort */ }
      try { fs.rmSync(projectDir, { recursive: true, force: true }) } catch { /* best-effort */ }
      spawnMock.mockReset()
      // 重置为真实实现,避免影响其他测试
      const actual = await vi.importActual<typeof import('child_process')>('child_process')
      spawnMock.mockImplementation(actual.spawn as (...args: unknown[]) => unknown)
    }
  }, 15000)
})
