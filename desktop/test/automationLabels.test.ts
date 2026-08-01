import { describe, it, expect } from 'vitest'
import { computeNextRunLabel, pendingApprovalRuns, saveErrorText } from '../src/renderer/lib/automationLabels'
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

describe('saveErrorText', () => {
  it('剥掉 Electron 远程调用前缀,保留 daemon 权威原因', () => {
    const err = new Error(
      "Error invoking remote method 'wraith:automationUpsert': Error: 非法 cron 表达式: 99 99 99 99 99",
    )
    expect(saveErrorText(err)).toBe('保存失败:非法 cron 表达式: 99 99 99 99 99')
  })

  it('无前缀的普通错误原样透出', () => {
    expect(saveErrorText(new Error('非法 cron 表达式: x'))).toBe('保存失败:非法 cron 表达式: x')
  })

  it('后端断连原因透出', () => {
    expect(saveErrorText(new Error('Backend not connected'))).toBe('保存失败:Backend not connected')
  })

  it('空消息兜底为「保存失败」', () => {
    expect(saveErrorText(new Error(''))).toBe('保存失败')
  })

  it('非 Error 值也能给出字符串', () => {
    expect(saveErrorText('炸了')).toBe('保存失败:炸了')
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

  // ── 「下次」必须是未来时刻,且随时间推进 ──────────────────────────────────
  // 真机 bug:每分钟一次的任务,守护进程没起 → lastFiredAt 永远是 null →
  // computeNextRun 恒等于 enabledAt+1min,标签固定停在创建后一分钟那个时刻
  // (实测停在 08-01 16:17,而彼时已 16:52)。「下次」显示一个 35 分钟前的
  // 时刻毫无意义。调度器那侧的"单步不追赶"语义是**故意**的(靠 miss 推进锚点),
  // 不能动;这里只改**显示**。
  const MIN = 60_000
  function labelToMinutes(label: string): number {
    const m = /(\d{2}):(\d{2})$/.exec(label)!
    return Number(m[1]) * 60 + Number(m[2])
  }

  it('interval 已过期:滚到 now 之后的下一个整周期,而不是停在过去', () => {
    const anchor = new Date(2026, 7, 1, 16, 16).getTime()
    const now = anchor + 35 * MIN              // 16:51,已过期 35 分钟
    const t = task({ schedule: { kind: 'interval', everyMinutes: 1 }, enabledAt: anchor, lastFiredAt: null })
    expect(computeNextRunLabel(t, now)).toBe('下次 08-01 16:52')
  })

  it('时间往前走,标签跟着走(这正是用户要的「实时」)', () => {
    const anchor = new Date(2026, 7, 1, 16, 16).getTime()
    const t = task({ schedule: { kind: 'interval', everyMinutes: 1 }, enabledAt: anchor, lastFiredAt: null })
    const a = computeNextRunLabel(t, anchor + 35 * MIN)
    const b = computeNextRunLabel(t, anchor + 36 * MIN)
    expect(a).not.toBe(b)
    expect(labelToMinutes(b)).toBe(labelToMinutes(a) + 1)
  })

  it('未过期时保持原样(单步),不提前跳周期', () => {
    const anchor = new Date(2026, 7, 1, 16, 16).getTime()
    const t = task({ schedule: { kind: 'interval', everyMinutes: 10 }, enabledAt: anchor, lastFiredAt: null })
    // now 在 anchor 之后 3 分钟,anchor+10min 仍在未来 → 应原样返回 16:26
    expect(computeNextRunLabel(t, anchor + 3 * MIN)).toBe('下次 08-01 16:26')
  })

  it('已触发过的任务以 lastFiredAt 为锚点滚动', () => {
    const fired = new Date(2026, 7, 1, 16, 40).getTime()
    const t = task({ schedule: { kind: 'interval', everyMinutes: 5 }, enabledAt: fired - 60 * MIN, lastFiredAt: fired })
    expect(computeNextRunLabel(t, fired + 12 * MIN)).toBe('下次 08-01 16:55')
  })

  it('daily 不受影响(其 computeNextRun 本就依赖 now 自行滚动)', () => {
    const now = new Date(2026, 7, 1, 16, 0).getTime()
    const t = task({ schedule: { kind: 'daily', time: '09:30' }, enabledAt: now - 86_400_000, lastFiredAt: null })
    expect(computeNextRunLabel(t, now)).toBe('下次 08-02 09:30')
  })
})
