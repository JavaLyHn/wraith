import { describe, it, expect } from 'vitest'
import { isValidCronShape, approvalModeLabel, deliveryTargetsToLabels, parseDeliverTo, buildDeliverTo, parseApproval } from '../src/renderer/lib/automationLabels'
import type { DeliveryTarget, AutomationTask } from '../src/shared/types'

function task(over: Partial<AutomationTask> = {}): AutomationTask {
  return {
    id: 't1', name: 'test', prompt: 'p', projectPath: '/proj',
    enabled: true, schedule: { kind: 'interval', everyMinutes: 10 },
    createdAt: 1000, enabledAt: 1000, lastFiredAt: null,
    ...over,
  }
}

describe('isValidCronShape', () => {
  it('接受标准 5 段 cron 表达式', () => {
    expect(isValidCronShape('0 9 * * 1')).toBe(true)
    expect(isValidCronShape('*/5 * * * *')).toBe(true)
    expect(isValidCronShape('0 0 1 1 *')).toBe(true)
  })

  it('前后空白不影响结果', () => {
    expect(isValidCronShape('  0 9 * * 1  ')).toBe(true)
  })

  it('拒绝段数不足或过多', () => {
    expect(isValidCronShape('')).toBe(false)
    expect(isValidCronShape('0 9 * *')).toBe(false)
    expect(isValidCronShape('0 9 * * * *')).toBe(false)
  })

  it('拒绝纯空白字符串', () => {
    expect(isValidCronShape('   ')).toBe(false)
  })
})

describe('approvalModeLabel', () => {
  it('deny → 安全默认', () => {
    expect(approvalModeLabel('deny')).toContain('拒绝')
  })
  it('auto-approve → 自动批准', () => {
    expect(approvalModeLabel('auto-approve')).toContain('自动批准')
  })
  it('ask → 询问', () => {
    expect(approvalModeLabel('ask')).toContain('询问')
  })
})

describe('deliveryTargetsToLabels', () => {
  it('空数组返回空数组', () => {
    expect(deliveryTargetsToLabels([])).toEqual([])
  })

  it('desktop → 桌面通知', () => {
    const targets: DeliveryTarget[] = [{ platform: 'desktop' }]
    expect(deliveryTargetsToLabels(targets)).toEqual(['桌面通知'])
  })

  it('qq → QQ 消息', () => {
    const targets: DeliveryTarget[] = [{ platform: 'qq' }]
    expect(deliveryTargetsToLabels(targets)).toEqual(['QQ 消息'])
  })

  it('desktop + qq → 两个标签,顺序保持', () => {
    const targets: DeliveryTarget[] = [{ platform: 'desktop' }, { platform: 'qq' }]
    expect(deliveryTargetsToLabels(targets)).toEqual(['桌面通知', 'QQ 消息'])
  })

  it('飞书/企微/微信 → 中文标签', () => {
    const targets: DeliveryTarget[] = [{ platform: 'feishu' }, { platform: 'wecom' }, { platform: 'weixin' }]
    expect(deliveryTargetsToLabels(targets)).toEqual(['飞书', '企业微信', '微信'])
  })

  it('未知平台返回 platform 字符串本身', () => {
    const targets: DeliveryTarget[] = [{ platform: 'telegram' }]
    expect(deliveryTargetsToLabels(targets)).toEqual(['telegram'])
  })
})

describe('parseDeliverTo', () => {
  it('null(新建) → {desktop}', () => {
    expect(parseDeliverTo(null)).toEqual(new Set(['desktop']))
  })

  it('deliverTo 为空数组 → {desktop}', () => {
    expect(parseDeliverTo(task({ deliverTo: [] }))).toEqual(new Set(['desktop']))
  })

  it('编辑态 desktop-only', () => {
    expect(parseDeliverTo(task({ deliverTo: [{ platform: 'desktop' }] }))).toEqual(new Set(['desktop']))
  })

  it('编辑态多平台(qq + 飞书)', () => {
    expect(parseDeliverTo(task({ deliverTo: [{ platform: 'qq' }, { platform: 'feishu' }] }))).toEqual(new Set(['qq', 'feishu']))
  })

  it('编辑态 desktop+qq', () => {
    expect(parseDeliverTo(task({ deliverTo: [{ platform: 'desktop' }, { platform: 'qq' }] }))).toEqual(new Set(['desktop', 'qq']))
  })
})

describe('buildDeliverTo', () => {
  it('desktop-only → [{platform:"desktop"}]', () => {
    expect(buildDeliverTo(['desktop'])).toEqual([{ platform: 'desktop' }])
  })

  it('多平台按传入顺序输出', () => {
    expect(buildDeliverTo(['desktop', 'qq', 'feishu'])).toEqual([
      { platform: 'desktop' }, { platform: 'qq' }, { platform: 'feishu' },
    ])
  })

  it('IM-only(无桌面)', () => {
    expect(buildDeliverTo(['weixin', 'wecom'])).toEqual([{ platform: 'weixin' }, { platform: 'wecom' }])
  })

  it('none → []', () => {
    expect(buildDeliverTo([])).toEqual([])
  })
})

describe('parseApproval', () => {
  it('null(新建) → {defaultMode:"deny", toolOverrides:[], askTimeoutMinutes:""}', () => {
    expect(parseApproval(null)).toEqual({ defaultMode: 'deny', toolOverrides: [], askTimeoutMinutes: '' })
  })

  it('approval undefined(absent) → deny 默认', () => {
    expect(parseApproval(task({ approval: undefined }))).toEqual({ defaultMode: 'deny', toolOverrides: [], askTimeoutMinutes: '' })
  })

  it('tools backfill — per-tool override rows via Object.entries', () => {
    const result = parseApproval(task({
      approval: { default: 'auto-approve', tools: { Bash: 'ask', Read: 'deny' } }
    }))
    expect(result.defaultMode).toBe('auto-approve')
    expect(result.toolOverrides).toEqual(
      expect.arrayContaining([
        { tool: 'Bash', mode: 'ask' },
        { tool: 'Read', mode: 'deny' },
      ])
    )
    expect(result.toolOverrides).toHaveLength(2)
  })

  it('askTimeoutMinutes roundtrip', () => {
    const result = parseApproval(task({
      approval: { default: 'ask', askTimeoutMinutes: 30 }
    }))
    expect(result.askTimeoutMinutes).toBe('30')
    expect(result.toolOverrides).toEqual([])
  })

  it('askTimeoutMinutes absent → 空字符串', () => {
    const result = parseApproval(task({ approval: { default: 'ask' } }))
    expect(result.askTimeoutMinutes).toBe('')
  })

  it('askTimeoutMinutes 为 JSON null → 空字符串(不得变成 "null")', () => {
    const result = parseApproval(task({ approval: { default: 'ask', askTimeoutMinutes: null } as never }))
    expect(result.askTimeoutMinutes).toBe('')
  })
})
