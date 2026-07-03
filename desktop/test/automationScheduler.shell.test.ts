import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AutomationScheduler } from '../src/main/automationScheduler'
import { upsertTask } from '../src/main/automationsStore'
import type { AutomationTask } from '../src/shared/types'

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
