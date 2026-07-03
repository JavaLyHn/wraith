import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AutomationRunner } from '../src/main/automationRunner'
import type { RunState } from '../src/main/automationRunState'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fakeChild = path.resolve(__dirname, 'fixtures/fake-child.mjs')

/**
 * 用真 spawn 的 fake-child(WRAITH_APPSERVER_CMD 指向内联 node 脚本)覆盖 mock 掩蔽的「终止」路径(I-6)。
 * fake-child 路径由 fixtures 目录解析,无空格,可直接用 `node <path> <flags...>` 形式注入。
 * 关键:runner spawn 子进程时不下传 this.env,子进程继承测试进程环境;故行为标志走 argv(拼进 CMD 字符串,
 * resolveBackendCommand 按空白拆分成独立 argv 项),不走 env。
 */
function makeRunner(flags: string[]): { runner: AutomationRunner; states: RunState[] } {
  const states: RunState[] = []
  const cmd = ['node', fakeChild, ...flags].join(' ')
  const env = { ...process.env, WRAITH_APPSERVER_CMD: cmd } as NodeJS.ProcessEnv
  const runner = new AutomationRunner(env, '/nonexistent-home', {
    onUpdate: s => states.push(s),
    onApproval: () => { /* 不触发 */ },
  })
  return { runner, states }
}

/** 轮询等待 runner 进入 running(turn 已提交),再执行 stop。 */
async function waitRunning(states: RunState[], timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (states.some(s => s.phase === 'running')) return
    await new Promise(r => setTimeout(r, 20))
  }
  throw new Error('runner 未在超时内进入 running')
}

describe('AutomationRunner.stopNow()(A2,will-quit 同步信号)', () => {
  it('stopNow 立即发 SIGTERM(不等 500ms 宽限)', async () => {
    // fake-child 收到 SIGTERM 时写 marker 文件,然后挂起(不退出)
    // SIGKILL 升级(2s)最终回收它,run() 落 interrupted
    const markerPath = path.join(os.tmpdir(), `sigterm-marker-${Date.now()}-${process.pid}.txt`)
    // 清理可能残留的 marker(paranoia)
    try { fs.unlinkSync(markerPath) } catch { /* 不存在则跳过 */ }

    const { runner, states } = makeRunner(['signal-on-sigterm', markerPath])
    const done = runner.run('/tmp', 'hi')
    await waitRunning(states)

    const t0 = Date.now()
    runner.stopNow()

    // SIGTERM 应当在 500ms 内到达 fake-child(stopNow 不等宽限)
    await expect.poll(() => fs.existsSync(markerPath), { timeout: 1500 }).toBe(true)
    expect(Date.now() - t0).toBeLessThan(500)

    // run() 最终以 interrupted 落地(fake-child 被 SIGKILL 升级后退出 → exit→stopped→interrupted)
    const final = await done
    expect(final.phase).toBe('interrupted')

    // 清理 marker 文件
    try { fs.unlinkSync(markerPath) } catch { /* 已删或不存在 */ }
  }, 10_000)
})

describe('AutomationRunner 终止路径(I-6,真 fake-child 子进程)', () => {
  it('用例1:stop() 后子进程忽略 SIGTERM → 2s 升级 SIGKILL → run() resolve 为 interrupted', async () => {
    const { runner, states } = makeRunner(['ignore-sigterm'])
    const done = runner.run('/tmp', '总结进展')
    await waitRunning(states)
    runner.stop()
    const final = await done
    expect(final.phase).toBe('interrupted')
  }, 10_000)

  it('用例2(I-6 主验证):stop 后子进程发 turn.failed 通知 → 最终 resolve 为 interrupted 而非 failed', async () => {
    // 同时忽略 SIGTERM,使 turn.failed 通知在子进程退出前必然先到达并被处理(否则退出竞争会先落 stopped,
    // 掩蔽 guard 是否生效)。有 guard:stopping 期 turn.failed 不 dispatch → 走 SIGKILL→exit→stopped→interrupted;
    // 无 guard:turn.failed 立即 dispatch → phase=failed。此设置让两分支结果确定性可分。
    const { runner, states } = makeRunner(['fail-on-interrupt', 'ignore-sigterm'])
    const done = runner.run('/tmp', '总结进展')
    await waitRunning(states)
    runner.stop()
    const final = await done
    expect(final.phase).toBe('interrupted')
    // 反证:若 turn.failed 被 dispatch(无 guard),phase 会是 failed
    expect(final.phase).not.toBe('failed')
  }, 10_000)
})

describe('AutomationRunner stderr 前缀(A6)', () => {
  it('stderr 转发带 taskId 前缀', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const cmd = ['node', fakeChild, 'emit-stderr'].join(' ')
    const env = { ...process.env, WRAITH_APPSERVER_CMD: cmd } as NodeJS.ProcessEnv
    const runner = new AutomationRunner(env, '/nonexistent-home', {
      onUpdate: () => { /* 不关心 */ },
      onApproval: () => { /* 不触发 */ },
    }, 'task-42')
    void runner.run('/tmp', 'hi')
    try {
      await expect.poll(() =>
        spy.mock.calls.some(c => String(c[0]).startsWith('[automation:task-42]')),
        { timeout: 5000 },
      ).toBe(true)
    } finally {
      runner.stop()
      spy.mockRestore()
    }
  }, 10_000)
})

describe('B5: 严格并发1——exited 在子进程真正退净后才 resolve', () => {
  /**
   * 验证 AutomationRunner.exited promise 的核心语义:
   * 用 complete-then-hang + ignore-sigterm 组合:子进程发 turn.completed(run() 快速 settle 为 success),
   * 然后挂起并忽略 SIGTERM(强制 2s SIGKILL)。此时 run() settle 与子进程真正退出之间有 ~2s 窗口。
   *
   * 先红后绿语义:
   *   - 改动前(无 exited 字段):tsc --noEmit 报错 Property 'exited' does not exist → 测试无法通过。
   *   - 改动后(exited 仅在 proc.on('exit') 首行 resolve):
   *       run() settle(success)后 exited 仍 pending(SIGKILL 尚未到达);
   *       await runner.exited 阻塞约 2s 后 resolve(SIGKILL reaps child)。
   *
   * 验证策略:
   *   1. run() settle 后立即对 exited 做 race(50ms timeout)→ 应超时(仍 pending)。
   *   2. await runner.exited 阻塞直到 SIGKILL 后进程真正退出。
   *   3. 再次 race(50ms) → 应立即 resolve(幂等)。
   */
  it('complete-then-hang+ignore-sigterm: run()→success settle 后 exited 仍 pending,SIGKILL 后才 resolve', async () => {
    // fake-child: 发 turn.completed(run settle),然后挂起,忽略 SIGTERM(强制 2s SIGKILL)
    const cmd = ['node', fakeChild, 'complete-then-hang', 'ignore-sigterm'].join(' ')
    const env = { ...process.env, WRAITH_APPSERVER_CMD: cmd } as NodeJS.ProcessEnv

    const states: RunState[] = []
    const runner = new AutomationRunner(env, '/nonexistent-home', {
      onUpdate: s => states.push(s),
      onApproval: () => { /* 不触发 */ },
    }, 'b5-task1')

    // run() 快速 settle 为 success(turn.completed 到达后 runner 内部 killChild → SIGTERM)
    const final = await runner.run('/tmp', 'hi')
    expect(final.phase).toBe('success')
    const settleAt = Date.now()

    // 【先红后绿核心断言】run() 刚 settle,子进程仍存活(SIGKILL 还未到,约 2s 后)
    // race exited vs 100ms timeout → exited 应仍 pending → SENTINEL 胜出
    const SENTINEL = 'timeout-sentinel'
    const raceResult = await Promise.race([
      runner.exited.then(() => 'exited'),
      new Promise<string>(r => setTimeout(() => r(SENTINEL), 100)),
    ])
    // 若 exited 在 settle 时就同步 resolve → raceResult === 'exited' → 断言失败(揭示旧语义缺陷)
    expect(raceResult).toBe(SENTINEL)

    // 等 exited 真正 resolve(SIGKILL 后子进程退出)
    await runner.exited
    const exitedAt = Date.now()

    // exited resolve 必须晚于 run() settle(证明不是 settle 时即 resolve,保证子进程退净)
    expect(exitedAt).toBeGreaterThan(settleAt)

    // 再次 race:exited 已 resolved → 应立即 resolve(幂等)
    const raceResult2 = await Promise.race([
      runner.exited.then(() => 'exited'),
      new Promise<string>(r => setTimeout(() => r(SENTINEL), 50)),
    ])
    expect(raceResult2).toBe('exited')
  }, 15_000)
})
