/**
 * T12 — 会话级通知过滤(防御性,为多会话预埋)
 *
 * 纯函数:判断一条后端通知是否应转发给渲染进程。
 *
 * 匹配规则(fail-open):
 *   1. params.sessionId 缺失/undefined → 放行(兼容:许多通知不带 sessionId)。
 *   2. params.sessionId 存在 且 == activeSessionId → 放行(同会话通知)。
 *   3. params.sessionId 存在 且 !== activeSessionId → 丢弃(异会话通知)。
 *
 * 特殊情形:activeSessionId === null(尚未开启会话,应用启动初期)→ 放行。
 * 理由:初始化阶段无"当前会话"概念,连接级通知(connection/disconnection)
 * 由 sendEvent 直接调用,不经过本函数;早于 session.start 收到的通知若带
 * sessionId 也应放行(初始化阶段本无过滤需求)。
 *
 * 占位 sessionId 兼容性注记:
 *   AppServer 在 turn.submit 关键路径上可能先用 placeholder sessionId 发通知,
 *   待 turn.completed 返回真实持久化 id 后才更新。由于 v1 严格单会话,
 *   currentSessionId 始终与 session.start 返回的 id 一致;后端通知的 sessionId
 *   在同一会话内也使用相同 id,不会出现 placeholder 不匹配的情形。
 *   若未来引入 placeholder,规则仍 fail-open:placeholder 不等于 activeSessionId
 *   但也不等于任何"已知的其他会话 id"——此时 activeSessionId 将随 placeholder
 *   同步更新,保证放行。在无法确定时,宁可放行(fail-open),不丢失合法通知。
 *
 * 注意:自动化通道(onAutomationEvent / pushAutomation)完全独立,不经过本函数。
 *
 * @param activeSessionId - main 进程当前活跃 sessionId(null = 尚未开启会话)
 * @param params          - 通知的 params 对象(任意类型)
 * @returns true = 应转发给渲染进程;false = 丢弃
 */
export function shouldForwardNotification(
  activeSessionId: string | null,
  params: unknown,
): boolean {
  // 活跃会话未知 → fail-open(放行)
  if (activeSessionId === null) return true

  // params 非对象或 sessionId 字段缺失 → 放行(兼容无 sessionId 通知)
  if (typeof params !== 'object' || params === null) return true
  const p = params as Record<string, unknown>
  if (!('sessionId' in p) || p['sessionId'] === undefined || p['sessionId'] === null) return true

  // params.sessionId 存在:仅当匹配活跃会话时放行
  return p['sessionId'] === activeSessionId
}
