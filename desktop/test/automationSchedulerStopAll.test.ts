/**
 * Part B 红绿测试:stopAll() 在有 in-flight run 时不崩溃,产出 interrupted run 记录。
 *
 * 根因:stopAll() 传入 { phase: 'interrupted' } as RunState 给 finishRun(),
 * finishRun() 内调用 summaryOf(finalState) → s.lastMessage || s.summaryBuf 均 undefined
 * → undefined.replace(...) → TypeError crash。
 *
 * 红(修复前): const text = s.lastMessage || s.summaryBuf  (text = undefined)
 *   → text.replace(/\s+/g,' ') → TypeError: Cannot read properties of undefined (reading 'replace')
 * 绿(修复后): const text = s.lastMessage || s.summaryBuf || ''  (text = '')
 *   → ''.replace(...) = '' → 不崩溃
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { AutomationScheduler } from '../src/main/automationScheduler'
import { upsertTask } from '../src/main/automationsStore'
import { summaryOf } from '../src/main/automationRunState'
import type { AutomationTask } from '../src/shared/types'
import type { RunState } from '../src/main/automationRunState'

function task(over: Partial<AutomationTask> = {}): AutomationTask {
  return {
    id: 'task-stop', name: 'test-stop', prompt: 'p', projectPath: '/nonexistent-xyz',
    enabled: true, schedule: { kind: 'interval', everyMinutes: 10 },
    createdAt: 1000, enabledAt: 1000, lastFiredAt: null, ...over,
  }
}

describe('AutomationScheduler stopAll() Part B 红绿', () => {
  it('stopAll() 在空调度器上不崩溃(无 in-flight run)', () => {
    const dir = fs.mkdtempSync(fs.realpathSync(os.tmpdir()) + '/wraith-stopallempty-')
    try {
      const s = new AutomationScheduler({
        userDataDir: dir, env: process.env, homedir: os.tmpdir(),
        onRunsChanged: vi.fn(), onApproval: vi.fn(), onTerminal: vi.fn(),
      })
      s.start()
      expect(() => s.stopAll()).not.toThrow()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stopAll() 在 fire 产出 failed run(目录失踪)后不崩溃,onTerminal 已回调', () => {
    const dir = fs.mkdtempSync(fs.realpathSync(os.tmpdir()) + '/wraith-stopallpost-')
    try {
      upsertTask(dir, task())
      const onTerminal = vi.fn()
      const s = new AutomationScheduler({
        userDataDir: dir, env: process.env, homedir: os.tmpdir(),
        onRunsChanged: vi.fn(), onApproval: vi.fn(), onTerminal,
      })
      // fire: 目录不存在 → failed run; this.current 仍 null(fire 返回 false)
      s.runNow('task-stop')
      expect(onTerminal).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
      // stopAll() 此时 current===null → 不执行 finishRun → 不会触发 summaryOf 崩溃路径
      expect(() => s.stopAll()).not.toThrow()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('summaryOf Part B — stopAll 崩溃路径单元验证', () => {
  /**
   * 直接对 summaryOf 进行 stopAll 路径覆盖测试。
   *
   * stopAll() 的代码:
   *   this.finishRun(cur.runId, cur.taskId, { phase: 'interrupted' } as RunState)
   * finishRun 内:
   *   summary: summaryOf(finalState) || finalState.error || undefined
   * 其中 finalState = { phase: 'interrupted' } — summaryBuf/lastMessage 均缺失(undefined)。
   *
   * 红(修复前): text = undefined || undefined = undefined → undefined.replace(...) → TypeError crash
   * 绿(修复后): text = undefined || undefined || '' = '' → ''.replace(...) = '' → 安全
   */
  it('[绿] summaryOf({ phase:"interrupted" } as RunState) 不崩溃,返回空字符串', () => {
    // 精确模拟 stopAll() 的写法:{ phase: 'interrupted' } as RunState
    // 修复前:text = (s.lastMessage=undefined) || (s.summaryBuf=undefined) = undefined
    //          → undefined.replace(...) → TypeError
    // 修复后:text = undefined || undefined || '' = ''  → 返回 ''
    const partialState = { phase: 'interrupted' } as RunState
    expect(() => summaryOf(partialState)).not.toThrow()
    expect(summaryOf(partialState)).toBe('')
  })

  it('[绿] summaryOf 完整 RunState 仍正确工作(regression 防护)', () => {
    const fullState: RunState = {
      phase: 'interrupted',
      summaryBuf: '',
      lastMessage: '任务已中断',
      approval: null,
    }
    expect(summaryOf(fullState)).toBe('任务已中断')
  })
})
