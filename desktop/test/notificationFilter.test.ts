/**
 * T12 — 会话级通知过滤(防御性,为多会话预埋)
 *
 * 测试 shouldForwardNotification 纯函数的三条核心断言:
 *   1. 异会话 sessionId (≠ activeSessionId) → 丢弃(not forwarded)。
 *   2. 匹配 sessionId (== activeSessionId) → 放行(forwarded)。
 *   3. 无 sessionId → 放行(forwarded,兼容)。
 *
 * RED PROOF(不运行,文档):
 *   若去掉过滤(直接 return true),测试 1 断言 shouldForwardNotification('sess-A', { sessionId: 'sess-B' }) === false
 *   将失败(实际返回 true)→ 测试变 RED,证明过滤必要。
 *   下方 [RED 演示] 用"forward-all"函数模拟旧代码路径,断言其行为与预期不符,
 *   记录该用例 RED 状态。
 */

import { describe, it, expect } from 'vitest'
import { shouldForwardNotification } from '../src/main/notificationFilter'

// ---------------------------------------------------------------------------
// 辅助:模拟旧代码(无过滤,verbatim 转发)
// ---------------------------------------------------------------------------

function forwardAll(_activeSessionId: string | null, _params: unknown): boolean {
  return true  // 旧代码:不过滤,始终放行
}

// ---------------------------------------------------------------------------
// RED PROOF:旧代码(forward-all)在异 sessionId 通知上的行为
// ---------------------------------------------------------------------------

describe('T12 RED: 无过滤(forward-all)旧代码行为证明', () => {
  it('[RED 演示] forward-all 对异 sessionId 通知返回 true(不过滤)→ 预期 false 则 RED', () => {
    const result = forwardAll('sess-A', { sessionId: 'sess-B', data: 'foreign' })
    // 旧代码 forward-all 返回 true;若我们断言"应返回 false(丢弃)",测试就 RED。
    // 这里正向记录旧代码的"坏"行为:
    expect(result).toBe(true)
    // ^ 旧代码确实 forward 了异 sessionId 通知 — 这是"去过滤 → 误入"的证据。
    // 用新 shouldForwardNotification 替换此处:
    const filteredResult = shouldForwardNotification('sess-A', { sessionId: 'sess-B', data: 'foreign' })
    // 新函数应丢弃:
    expect(filteredResult).toBe(false)
    // 两个断言对比,证明 RED(旧 true) → GREEN(新 false)。
  })
})

// ---------------------------------------------------------------------------
// GREEN: 核心三条断言(shouldForwardNotification)
// ---------------------------------------------------------------------------

describe('T12 GREEN: shouldForwardNotification — 核心过滤规则', () => {
  // 断言 1:异会话 sessionId → 丢弃
  it('1. 异会话 sessionId (sess-B ≠ sess-A) → 丢弃(false)', () => {
    expect(shouldForwardNotification('sess-A', { sessionId: 'sess-B' })).toBe(false)
  })

  // 断言 2:匹配 sessionId → 放行
  it('2. 匹配 sessionId (sess-A == sess-A) → 放行(true)', () => {
    expect(shouldForwardNotification('sess-A', { sessionId: 'sess-A' })).toBe(true)
  })

  // 断言 3:无 sessionId → 放行(兼容)
  it('3. 无 sessionId 字段 → 放行(true,兼容)', () => {
    expect(shouldForwardNotification('sess-A', { method: 'status', data: {} })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 边界用例
// ---------------------------------------------------------------------------

describe('T12 GREEN: shouldForwardNotification — 边界与单会话不变性', () => {
  // activeSessionId = null(应用启动初期,尚未 session.start)→ fail-open
  it('activeSessionId = null(初始化阶段)→ 放行(fail-open)', () => {
    expect(shouldForwardNotification(null, { sessionId: 'some-session' })).toBe(true)
  })

  it('activeSessionId = null + 无 sessionId → 放行', () => {
    expect(shouldForwardNotification(null, { method: 'turn.started' })).toBe(true)
  })

  // params = undefined / null / 非对象 → 放行(兼容:通知 params 可缺失)
  it('params = undefined → 放行', () => {
    expect(shouldForwardNotification('sess-A', undefined)).toBe(true)
  })

  it('params = null → 放行', () => {
    expect(shouldForwardNotification('sess-A', null)).toBe(true)
  })

  it('params = 非对象(string) → 放行', () => {
    expect(shouldForwardNotification('sess-A', 'bare-string')).toBe(true)
  })

  // params.sessionId = null / undefined(显式置空)→ 放行(视为无 sessionId)
  it('params.sessionId = null(显式) → 放行(视为无 sessionId)', () => {
    expect(shouldForwardNotification('sess-A', { sessionId: null })).toBe(true)
  })

  it('params.sessionId = undefined → 放行', () => {
    expect(shouldForwardNotification('sess-A', { sessionId: undefined })).toBe(true)
  })

  // 单会话不变性:v1 下 activeSessionId === params.sessionId → 所有带 sessionId 通知放行
  it('单会话场景:activeSessionId = params.sessionId → 所有通知放行(行为不变)', () => {
    const sid = 'session-v1-abc123'
    const notifications = [
      { sessionId: sid, method: 'turn.started' },
      { sessionId: sid, type: 'message.delta', text: 'hello' },
      { sessionId: sid, type: 'turn.completed', turnId: 'turn-1' },
      { sessionId: sid, type: 'status', agentState: 'thinking' },
    ]
    for (const params of notifications) {
      expect(shouldForwardNotification(sid, params)).toBe(true)
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
      expect(shouldForwardNotification('sess-A', params)).toBe(true)
    }
  })
})
