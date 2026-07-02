import { describe, it, expect } from 'vitest'
import path from 'node:path'
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
