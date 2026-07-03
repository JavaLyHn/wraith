/**
 * T12 — 会话级通知过滤(防御性,为多会话预埋)
 *
 * 测试 shouldForwardNotification 纯函数:
 *
 * ── v1 默认路径(multiSessionEnabled = false,门控关闭) ──────────────────
 *   所有通知无条件放行(byte-identical)。
 *   关键回归守卫:divergent-id turn.completed(sess_… vs 20260703T…)
 *   必须被放行 —— 此用例是 T12 review 发现的真 bug 的回归测试。
 *
 * ── 多会话路径(multiSessionEnabled = true,未来用) ──────────────────────
 *   1. 异会话 sessionId (≠ activeSessionId) → 丢弃(not forwarded)。
 *   2. 匹配 sessionId (== activeSessionId) → 放行(forwarded)。
 *   3. 无 sessionId → 放行(forwarded,兼容)。
 *
 * RED/GREEN 证明(见下方各 describe 内注释)。
 */

import { describe, it, expect } from 'vitest'
import { shouldForwardNotification } from '../src/main/notificationFilter'

// ---------------------------------------------------------------------------
// v1 默认路径:门控关闭(multiSessionEnabled = false / 默认值)
// ---------------------------------------------------------------------------

describe('T12 v1 默认路径(门控关闭):始终放行 — 回归守卫', () => {
  /**
   * ⚠ 核心回归守卫 — T12 review 确认的真 bug:
   *   v1 中 session.start 返回 sess_<nanotime-hex>,
   *   但第一个 turn.completed 携带持久化 id(20260703T…-hex)。
   *   若门控开启(multiSessionEnabled = true),两个 id 不匹配 → turn.completed 被丢弃
   *   → turn 永卡 running。
   *
   * RED 观察(门控开启时):
   *   shouldForwardNotification('sess_abc123', { sessionId: '20260703T120000-hexid' }, true)
   *   → false(丢弃) — RED:turn.completed 被误丢,turn 永卡。
   *
   * GREEN(门控关闭,默认):
   *   shouldForwardNotification('sess_abc123', { sessionId: '20260703T120000-hexid' })
   *   → true(放行) — GREEN:turn.completed 正常到达渲染进程。
   */
  it('[v1 回归守卫] divergent-id turn.completed(sess_… vs 20260703T…)→ 放行(true)', () => {
    const wireId = 'sess_1a2b3c4d'
    const persistedId = '20260703T120000-hexid'

    // RED 验证:门控开启时确实会丢弃(证明 bug 存在)
    expect(
      shouldForwardNotification(wireId, { sessionId: persistedId, type: 'turn.completed' }, true),
    ).toBe(false) // ← RED:这正是导致 turn 永卡的 bug 路径

    // GREEN:默认门控关闭 → 放行(v1 byte-identical)
    expect(
      shouldForwardNotification(wireId, { sessionId: persistedId, type: 'turn.completed' }),
    ).toBe(true) // ← GREEN:门控关闭后放行,turn 正常完成

    // 显式传 false 等价于默认值
    expect(
      shouldForwardNotification(wireId, { sessionId: persistedId, type: 'turn.completed' }, false),
    ).toBe(true)
  })

  it('[v1] activeSessionId 有值 + 异 sessionId → 仍放行(门控关闭)', () => {
    expect(shouldForwardNotification('sess-A', { sessionId: 'sess-B' })).toBe(true)
  })

  it('[v1] activeSessionId 有值 + 匹配 sessionId → 放行', () => {
    expect(shouldForwardNotification('sess-A', { sessionId: 'sess-A' })).toBe(true)
  })

  it('[v1] activeSessionId 有值 + 无 sessionId → 放行', () => {
    expect(shouldForwardNotification('sess-A', { method: 'status' })).toBe(true)
  })

  it('[v1] activeSessionId = null → 放行', () => {
    expect(shouldForwardNotification(null, { sessionId: 'any-id' })).toBe(true)
  })

  it('[v1] params = undefined → 放行', () => {
    expect(shouldForwardNotification('sess-A', undefined)).toBe(true)
  })

  it('[v1] params = null → 放行', () => {
    expect(shouldForwardNotification('sess-A', null)).toBe(true)
  })

  it('[v1] params = 非对象(string) → 放行', () => {
    expect(shouldForwardNotification('sess-A', 'bare-string')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 辅助:模拟旧代码(无过滤,verbatim 转发)
// ---------------------------------------------------------------------------

function forwardAll(_activeSessionId: string | null, _params: unknown): boolean {
  return true  // 旧代码:不过滤,始终放行
}

// ---------------------------------------------------------------------------
// RED PROOF:旧代码(forward-all)在异 sessionId 通知上的行为
// (保留原有文档测试,现在用 multiSessionEnabled=true 代表"过滤激活"路径)
// ---------------------------------------------------------------------------

describe('T12 RED: 无过滤(forward-all)旧代码行为证明', () => {
  it('[RED 演示] forward-all 对异 sessionId 通知返回 true(不过滤)→ 预期 false 则 RED', () => {
    const result = forwardAll('sess-A', { sessionId: 'sess-B', data: 'foreign' })
    // 旧代码 forward-all 返回 true;若我们断言"应返回 false(丢弃)",测试就 RED。
    // 这里正向记录旧代码的"坏"行为:
    expect(result).toBe(true)
    // ^ 旧代码确实 forward 了异 sessionId 通知 — 这是"去过滤 → 误入"的证据。
    // 用 multiSessionEnabled=true(过滤激活)的 shouldForwardNotification 替换此处:
    const filteredResult = shouldForwardNotification('sess-A', { sessionId: 'sess-B', data: 'foreign' }, true)
    // 多会话激活时应丢弃:
    expect(filteredResult).toBe(false)
    // 两个断言对比,证明 RED(旧 true) → GREEN(新 false)。
  })
})

// ---------------------------------------------------------------------------
// 多会话路径(multiSessionEnabled = true):核心三条断言
// ---------------------------------------------------------------------------

describe('T12 GREEN: shouldForwardNotification — 多会话过滤规则(multiSessionEnabled=true)', () => {
  // 断言 1:异会话 sessionId → 丢弃
  it('1. 异会话 sessionId (sess-B ≠ sess-A) → 丢弃(false)', () => {
    expect(shouldForwardNotification('sess-A', { sessionId: 'sess-B' }, true)).toBe(false)
  })

  // 断言 2:匹配 sessionId → 放行
  it('2. 匹配 sessionId (sess-A == sess-A) → 放行(true)', () => {
    expect(shouldForwardNotification('sess-A', { sessionId: 'sess-A' }, true)).toBe(true)
  })

  // 断言 3:无 sessionId → 放行(兼容)
  it('3. 无 sessionId 字段 → 放行(true,兼容)', () => {
    expect(shouldForwardNotification('sess-A', { method: 'status', data: {} }, true)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 多会话路径:边界用例(multiSessionEnabled = true)
// ---------------------------------------------------------------------------

describe('T12 GREEN: shouldForwardNotification — 边界用例(multiSessionEnabled=true)', () => {
  // activeSessionId = null(应用启动初期,尚未 session.start)→ fail-open
  it('activeSessionId = null(初始化阶段)→ 放行(fail-open)', () => {
    expect(shouldForwardNotification(null, { sessionId: 'some-session' }, true)).toBe(true)
  })

  it('activeSessionId = null + 无 sessionId → 放行', () => {
    expect(shouldForwardNotification(null, { method: 'turn.started' }, true)).toBe(true)
  })

  // params = undefined / null / 非对象 → 放行(兼容:通知 params 可缺失)
  it('params = undefined → 放行', () => {
    expect(shouldForwardNotification('sess-A', undefined, true)).toBe(true)
  })

  it('params = null → 放行', () => {
    expect(shouldForwardNotification('sess-A', null, true)).toBe(true)
  })

  it('params = 非对象(string) → 放行', () => {
    expect(shouldForwardNotification('sess-A', 'bare-string', true)).toBe(true)
  })

  // params.sessionId = null / undefined(显式置空)→ 放行(视为无 sessionId)
  it('params.sessionId = null(显式) → 放行(视为无 sessionId)', () => {
    expect(shouldForwardNotification('sess-A', { sessionId: null }, true)).toBe(true)
  })

  it('params.sessionId = undefined → 放行', () => {
    expect(shouldForwardNotification('sess-A', { sessionId: undefined }, true)).toBe(true)
  })

  // 单会话场景:activeSessionId === params.sessionId → 所有带 sessionId 通知放行
  it('单会话场景(id 匹配):所有通知放行(行为不变)', () => {
    const sid = 'session-v1-abc123'
    const notifications = [
      { sessionId: sid, method: 'turn.started' },
      { sessionId: sid, type: 'message.delta', text: 'hello' },
      { sessionId: sid, type: 'turn.completed', turnId: 'turn-1' },
      { sessionId: sid, type: 'status', agentState: 'thinking' },
    ]
    for (const params of notifications) {
      expect(shouldForwardNotification(sid, params, true)).toBe(true)
    }
  })

  // 无 sessionId 的通知(大量系统通知走此路径)→ 放行
  it('无 sessionId 的系统通知(status, mcp.status, connection)→ 放行', () => {
    const systemNotifications = [
      { type: 'status', agentState: 'idle' },
      { name: 'my-mcp', state: 'ready' },
      { connected: true },
    ]
    for (const params of systemNotifications) {
      expect(shouldForwardNotification('sess-A', params, true)).toBe(true)
    }
  })
})
