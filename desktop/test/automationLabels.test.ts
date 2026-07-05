import { describe, it, expect } from 'vitest'
import { computeNextRunLabel, pendingApprovalRuns } from '../src/renderer/lib/automationLabels'
import type { AutomationTask, AutomationRun } from '../src/shared/types'

function task(over: Partial<AutomationTask> = {}): AutomationTask {
  return {
    id: 't1', name: 'test', prompt: 'p', projectPath: '/proj',
    enabled: true, schedule: { kind: 'interval', everyMinutes: 10 },
    createdAt: 1000, enabledAt: 1000, lastFiredAt: null,
    ...over,
  }
}

function run(over: Partial<AutomationRun> = {}): AutomationRun {
  return {
    runId: 'r1', taskId: 't1', startedAt: 1000,
    status: 'waiting_approval', approvalId: 'task1#1',
    ...over,
  }
}

describe('pendingApprovalRuns', () => {
  it('包含 status=waiting_approval 且有 approvalId 的 run', () => {
    const r = run()
    expect(pendingApprovalRuns([r])).toEqual([r])
  })

  it('排除 status!=waiting_approval 的 run', () => {
    expect(pendingApprovalRuns([run({ status: 'running' })])).toEqual([])
    expect(pendingApprovalRuns([run({ status: 'success' })])).toEqual([])
    expect(pendingApprovalRuns([run({ status: 'failed' })])).toEqual([])
    expect(pendingApprovalRuns([run({ status: 'interrupted' })])).toEqual([])
  })

  it('排除 status=waiting_approval 但无 approvalId 的 run(守护未填字段)', () => {
    expect(pendingApprovalRuns([run({ approvalId: undefined })])).toEqual([])
    expect(pendingApprovalRuns([run({ approvalId: '' })])).toEqual([])
  })

  it('混合列表仅返回满足条件的', () => {
    const pending = run({ runId: 'r-pending', approvalId: 'task1#2' })
    const running = run({ runId: 'r-running', status: 'running' })
    const noId = run({ runId: 'r-noid', approvalId: undefined })
    expect(pendingApprovalRuns([pending, running, noId])).toEqual([pending])
  })
})

describe('computeNextRunLabel', () => {
  it('lastFiredAt===null && enabledAt===0 → 待触发兜底', () => {
    expect(computeNextRunLabel(task({ lastFiredAt: null, enabledAt: 0 }))).toBe('待触发')
  })

  it('正常任务返回「下次 MM-DD HH:mm」格式', () => {
    const label = computeNextRunLabel(task({ enabledAt: Date.now(), lastFiredAt: null }))
    expect(label).toMatch(/^下次 \d{2}-\d{2} \d{2}:\d{2}$/)
  })
})
