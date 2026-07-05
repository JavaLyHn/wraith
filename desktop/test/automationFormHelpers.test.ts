import { describe, it, expect } from 'vitest'
import { isValidCronShape, approvalModeLabel, deliveryTargetsToLabels } from '../src/renderer/lib/automationLabels'
import type { DeliveryTarget } from '../src/shared/types'

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

  it('未知平台返回 platform 字符串本身', () => {
    const targets: DeliveryTarget[] = [{ platform: 'telegram' }]
    expect(deliveryTargetsToLabels(targets)).toEqual(['telegram'])
  })
})
