import { describe, it, expect } from 'vitest'
import { sandboxNetHint, sandboxKindOf, sandboxToggleEnabled } from '../src/renderer/lib/sandboxPanel'
import type { SandboxState } from '../src/shared/types'

const seatbelt: SandboxState = { available: true, kind: 'macos-seatbelt', networkAllowed: false }
const appc: SandboxState = { available: true, kind: 'windows-appcontainer', networkAllowed: false }
const none: SandboxState = {
  available: false,
  kind: 'none',
  networkAllowed: false,
  degradedReason: 'AppContainer 沙箱不可用（powershell.exe → 在 PATH 中找不到）',
}

/**
 * 安全面板「命令沙箱联网」那一行。
 *
 * 起因:Windows 上它恒显示「当前无沙箱(非 macOS 或不可用),命令不受网络限制」,
 * 开关灰着,用户点不动也不知道该做什么 —— 一行死文案。
 */
describe('sandboxNetHint', () => {
  it('有沙箱时说清开关管什么,并点名是哪一种', () => {
    expect(sandboxNetHint(seatbelt)).toContain('Seatbelt')
    expect(sandboxNetHint(appc)).toContain('AppContainer')
    // 开关语义两边一致
    expect(sandboxNetHint(seatbelt)).toContain('默认更安全')
    expect(sandboxNetHint(appc)).toContain('默认更安全')
  })

  it('无沙箱时把后端给的降级原因显示出来 —— 此前它只进 log.warn,桌面完全看不到', () => {
    const s = sandboxNetHint(none)
    expect(s).toContain('powershell.exe')
    expect(s).toContain('无沙箱')
  })

  it('无沙箱且后端没给原因时,至少交代还剩什么在保护', () => {
    const s = sandboxNetHint({ available: false, kind: 'none', networkAllowed: false })
    expect(s).toContain('命令黑名单')
  })

  it('不再把无沙箱归咎于「非 macOS」—— Windows 现在也该有,那句话会让人以为无解', () => {
    expect(sandboxNetHint(none)).not.toContain('非 macOS')
    expect(sandboxNetHint({ available: false, kind: 'none', networkAllowed: false }))
      .not.toContain('非 macOS')
  })

  it('还没读到状态时不假装知道', () => {
    expect(sandboxNetHint(null)).toBe('读取中…')
  })
})

describe('sandboxKindOf', () => {
  it('优先用后端明说的 kind', () => {
    expect(sandboxKindOf(appc)).toBe('windows-appcontainer')
    expect(sandboxKindOf(none)).toBe('none')
  })

  it('旧后端没有 kind 字段时从 available 兜底', () => {
    // 旧后端唯一实现过的就是 Seatbelt,所以 available=true 只能是它
    expect(sandboxKindOf({ available: true, networkAllowed: false })).toBe('macos-seatbelt')
    expect(sandboxKindOf({ available: false, networkAllowed: false })).toBe('none')
  })
})

describe('sandboxToggleEnabled', () => {
  it('有沙箱才可点 —— 没沙箱时「网络围栏」这回事不存在', () => {
    expect(sandboxToggleEnabled(seatbelt)).toBe(true)
    expect(sandboxToggleEnabled(appc)).toBe(true)
    expect(sandboxToggleEnabled(none)).toBe(false)
    expect(sandboxToggleEnabled(null)).toBe(false)
  })

  it('旧后端(只有 available)照样能用', () => {
    expect(sandboxToggleEnabled({ available: true, networkAllowed: false })).toBe(true)
    expect(sandboxToggleEnabled({ available: false, networkAllowed: false })).toBe(false)
  })
})
