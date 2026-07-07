import { describe, it, expect } from 'vitest'
import { computeUpdate, semverCompare } from '../src/main/updateCheck'

const rel = (tag: string, prerelease = false, draft = false) =>
  ({ tag_name: tag, html_url: `https://x/${tag}`, prerelease, draft })

describe('semverCompare', () => {
  it('数值比较,忽略 v 前缀', () => {
    expect(semverCompare('v1.2.0', '1.1.9')).toBe(1)
    expect(semverCompare('1.0.0', '1.0.0')).toBe(0)
    expect(semverCompare('0.9.0', '0.10.0')).toBe(-1)
  })
})

describe('computeUpdate', () => {
  it('有更高稳定版 → hasUpdate + url', () => {
    const r = computeUpdate('0.1.0', [rel('v0.1.0'), rel('v0.2.0')], false)
    expect(r.latest).toBe('0.2.0'); expect(r.hasUpdate).toBe(true); expect(r.url).toBe('https://x/v0.2.0')
  })
  it('仅 prerelease 且 beta 关 → 无更新', () => {
    const r = computeUpdate('0.1.0', [rel('v0.2.0', true)], false)
    expect(r.latest).toBeNull(); expect(r.hasUpdate).toBe(false)
  })
  it('beta 开 → 纳入 prerelease', () => {
    const r = computeUpdate('0.1.0', [rel('v0.2.0-beta.1', true)], true)
    expect(r.latest).toBe('0.2.0'); expect(r.hasUpdate).toBe(true); expect(r.isPrerelease).toBe(true)
  })
  it('draft 恒过滤', () => {
    const r = computeUpdate('0.1.0', [rel('v9.9.9', false, true)], true)
    expect(r.latest).toBeNull()
  })
  it('已是最新 → 无更新', () => {
    expect(computeUpdate('0.2.0', [rel('v0.2.0')], false).hasUpdate).toBe(false)
  })
  it('空列表 → latest null', () => {
    expect(computeUpdate('0.1.0', [], false).latest).toBeNull()
  })
})
