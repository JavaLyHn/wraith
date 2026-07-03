import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AutomationScheduler } from '../src/main/automationScheduler'
import { upsertTask } from '../src/main/automationsStore'
import type { AutomationTask } from '../src/shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fakeChild = path.resolve(__dirname, 'fixtures/fake-child.mjs')
const seqDispatch = path.resolve(__dirname, 'fixtures/seq-child-dispatch.mjs')

let dir: string

function task(over: Partial<AutomationTask> = {}): AutomationTask {
  return {
    id: 'a', name: 'test-task', prompt: 'p', projectPath: '/nonexistent-xyz',
    enabled: true, schedule: { kind: 'interval', everyMinutes: 10 },
    createdAt: 1000, enabledAt: 1000, lastFiredAt: null, ...over,
  }
}

function seedTask(dataDir: string, t: AutomationTask): void {
  upsertTask(dataDir, t)
}

describe('AutomationScheduler shell tests (A5)', () => {
  it('目录失踪的 failed run 触发 onTerminal(系统通知链)', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-sched-'))
    try {
      seedTask(dir, task({ id: 'a', projectPath: '/nonexistent-xyz' }))
      const onTerminal = vi.fn()
      const s = new AutomationScheduler({
        userDataDir: dir, env: process.env, homedir: os.tmpdir(),
        onRunsChanged: vi.fn(), onApproval: vi.fn(), onTerminal,
      })
      s.runNow('a')
      expect(onTerminal).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', summary: '项目目录不存在' }))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('AutomationScheduler B5 时序端到端:B spawn 不早于 A exit', () => {
  /**
   * 端到端验证 B5 接线护栏:scheduler 的 .finally 必须等 runner.exited(子进程真正退净)后
   * 才将 this.current 置 null 并 drainQueue,从而保证 B 的子进程 spawn 时间戳不早于 A 的
   * 子进程 exit 时间戳。
   *
   * 判别力自证(红绿):
   *   - 还原旧语义(finally 直接 current=null+drainQueue,不等 exited):B spawn 早于 A exit → 红
   *   - B5 修复后:B spawn ≥ A exit → 绿
   *
   * Task A fake-child: complete-then-hang + ignore-sigterm + record-timestamps
   *   → run() 快速 settle(turn.completed),但子进程拒绝 SIGTERM,2s SIGKILL 后才真正退净
   * Task B fake-child: complete-then-hang + record-timestamps(无 ignore-sigterm)
   *   → turn.completed 后收到 SIGTERM 即退出(无需等 SIGKILL)
   *
   * 时间戳来自 fake-child 的 record-timestamps 机制:
   *   - spawn 文件:Date.now() 写于进程启动时
   *   - exit 文件:Date.now() 写于 process.on('exit') 回调
   */
  it('B spawn 时间戳 ≥ A exit 时间戳(接线护栏端到端)', async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-b5-e2e-'))
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-b5-proj-'))

    // 时间戳文件路径(独立于 testDir,避免 rmSync 前被清)
    const aSpawnFile = path.join(testDir, 'a-spawn.ts')
    const aExitFile  = path.join(testDir, 'a-exit.ts')
    const bSpawnFile = path.join(testDir, 'b-spawn.ts')
    const counterFile = path.join(testDir, 'counter')
    fs.writeFileSync(counterFile, '0')

    try {
      // 入库两个任务(真实项目目录,通过 statSync 校验)
      seedTask(testDir, {
        id: 'task-a', name: 'Task A', prompt: 'run A',
        projectPath: projectDir,
        enabled: true, schedule: { kind: 'interval', everyMinutes: 60 },
        createdAt: 1000, enabledAt: 1000, lastFiredAt: null,
      })
      seedTask(testDir, {
        id: 'task-b', name: 'Task B', prompt: 'run B',
        projectPath: projectDir,
        enabled: true, schedule: { kind: 'interval', everyMinutes: 60 },
        createdAt: 1000, enabledAt: 1000, lastFiredAt: null,
      })

      // WRAITH_APPSERVER_CMD 指向 seq-child-dispatch 包装器。
      // AutomationRunner.spawn() 不显式传 env,子进程继承 process.env(测试进程的 env)
      // 而非 deps.env,故 SEQ_* 和 *_FILE 变量必须同时写入 process.env。
      const cmd = `${process.execPath} ${seqDispatch}`

      // 写入 process.env 使子进程能继承(spawn 无 env 选项时继承 process.env)
      process.env['SEQ_COUNTER_FILE'] = counterFile
      process.env['SEQ_FAKE_CHILD']   = fakeChild
      process.env['A_SPAWN_FILE']     = aSpawnFile
      process.env['A_EXIT_FILE']      = aExitFile
      process.env['B_SPAWN_FILE']     = bSpawnFile

      const deps: ConstructorParameters<typeof AutomationScheduler>[0] = {
        userDataDir: testDir,
        // deps.env 仅用于 resolveBackendCommand 取 WRAITH_APPSERVER_CMD
        env: { ...process.env, WRAITH_APPSERVER_CMD: cmd } as NodeJS.ProcessEnv,
        homedir: os.tmpdir(),
        onRunsChanged: vi.fn(),
        onApproval: vi.fn(),
        onTerminal: vi.fn(),
      }

      const scheduler = new AutomationScheduler(deps)

      // runNow(A):立即 fire(current 为 null)
      const resultA = scheduler.runNow('task-a')
      expect(resultA.ok).toBe(true)

      // runNow(B):A 占位中,B 入队
      const resultB = scheduler.runNow('task-b')
      expect(resultB.ok).toBe(true)

      // 等待 B spawn 文件和 A exit 文件均出现(两个子进程完整生命周期)。
      // 超时 18s(A 的 2s SIGKILL + B 全程 + 余量)。
      // 旧语义下 B spawn 早于 A exit,故需等 A 最终被 SIGKILL 后写 exit 文件。
      const deadline = Date.now() + 18_000
      await (async () => {
        while (Date.now() < deadline) {
          if (fs.existsSync(bSpawnFile) && fs.existsSync(aExitFile)) return
          await new Promise(r => setTimeout(r, 50))
        }
        const missing = [
          !fs.existsSync(bSpawnFile) && 'B-spawn',
          !fs.existsSync(aExitFile)  && 'A-exit',
        ].filter(Boolean).join(', ')
        throw new Error(`超时:文件未出现(${missing})`)
      })()

      // 读取时间戳
      const aExitTs  = parseInt(fs.readFileSync(aExitFile,  'utf8').trim(), 10)
      const bSpawnTs = parseInt(fs.readFileSync(bSpawnFile, 'utf8').trim(), 10)

      // 核心断言:B 的 spawn 不早于 A 的 exit(B5 接线护栏生效)
      // 若 .finally 不等 runner.exited 直接 drainQueue,B 会在 A 子进程退净前 spawn → 断言失败
      expect(bSpawnTs).toBeGreaterThanOrEqual(aExitTs)
    } finally {
      // 清理 process.env 注入的临时变量
      delete process.env['SEQ_COUNTER_FILE']
      delete process.env['SEQ_FAKE_CHILD']
      delete process.env['A_SPAWN_FILE']
      delete process.env['A_EXIT_FILE']
      delete process.env['B_SPAWN_FILE']
      // 清理临时目录
      try { fs.rmSync(testDir, { recursive: true, force: true }) } catch { /* best-effort */ }
      try { fs.rmSync(projectDir, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
  }, 20_000)
})
