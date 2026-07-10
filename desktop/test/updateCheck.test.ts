import { describe, it, expect } from 'vitest'
import { computeUpdate, semverCompare, describeHttpError } from '../src/main/updateCheck'

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

describe('describeHttpError', () => {
  const now = 1_000_000_000_000 // 固定基准,避免依赖真实时钟

  it('403 + remaining 0 + 有 reset → 限流文案含剩余分钟(向上取整)', () => {
    const reset = String(Math.floor(now / 1000) + 5 * 60) // 5 分钟后重置
    expect(describeHttpError(403, '0', reset, now)).toBe('GitHub 接口访问频繁(匿名限流),请约 5 分钟后再试')
  })

  it('403 限流但已到/过重置点 → 至少显示 1 分钟', () => {
    const reset = String(Math.floor(now / 1000) - 10) // 已过
    expect(describeHttpError(403, '0', reset, now)).toBe('GitHub 接口访问频繁(匿名限流),请约 1 分钟后再试')
  })

  it('403 限流但 reset 头缺失 → 通用限流文案', () => {
    expect(describeHttpError(403, '0', null, now)).toBe('GitHub 接口访问频繁(匿名限流),请稍后再试')
  })

  it('403 但 remaining 非 0(非限流 403)→ 回落 HTTP 码', () => {
    expect(describeHttpError(403, '42', null, now)).toBe('HTTP 403')
  })

  it('其它状态码 → HTTP 码', () => {
    expect(describeHttpError(500, null, null, now)).toBe('HTTP 500')
  })
})
