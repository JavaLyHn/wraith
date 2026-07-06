import { describe, it, expect } from 'vitest'
import { IM_PLATFORMS } from '../src/renderer/lib/imPlatforms'

describe('IM_PLATFORMS', () => {
  it('QQ 可用且带「单聊」备注', () => {
    const qq = IM_PLATFORMS.find(p => p.id === 'qq')
    expect(qq).toBeTruthy()
    expect(qq!.status).toBe('available')
    expect(qq!.note).toBe('单聊')
  })

  it('QQ 之外全部为 soon 占位', () => {
    for (const p of IM_PLATFORMS) {
      if (p.id !== 'qq') expect(p.status).toBe('soon')
    }
  })

  it('id 唯一,每条有 name 与 icon,status 合法', () => {
    const ids = new Set<string>()
    for (const p of IM_PLATFORMS) {
      expect(ids.has(p.id)).toBe(false); ids.add(p.id)
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.icon.length).toBeGreaterThan(0)
      expect(['available', 'soon']).toContain(p.status)
    }
  })

  it('照 hermes 真实平台清单(含微信/企业微信/飞书/钉钉/元宝/Telegram/Discord/Slack 等)', () => {
    const names = IM_PLATFORMS.map(p => p.name)
    for (const expected of ['微信', '企业微信', '飞书 / Lark', '钉钉', '元宝', 'Telegram', 'Discord', 'Slack']) {
      expect(names).toContain(expected)
    }
  })
})
