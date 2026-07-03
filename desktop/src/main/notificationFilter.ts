/**
 * T12 — 会话级通知过滤(防御性,为多会话预埋)
 *
 * 纯函数:判断一条后端通知是否应转发给渲染进程。
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⚠  v1 单会话 id 换号问题(T12 review 确认的真 bug)
 * ──────────────────────────────────────────────────────────────────────────
 * 在 v1 单会话架构中,会话 id 在生命周期内会发生一次切换:
 *   1. session.start 返回的 wire id:形如 sess_<nanotime-hex>(main 进程生成)。
 *   2. 第一个 turn.completed 携带的持久化 id:形如 20260703T…-hex
 *      (后端 SessionStore.newId() 在 persistTurn 时生成,另一命名空间)。
 * 因此 main.currentSessionId(== sess_… )与后端通知里的 sessionId(== 20260703T…)
 * 不相等 → 若过滤门控开启,turn.completed 会被误丢弃 → turn 永卡在 running 状态。
 *
 * 同理,wraith:resumeSession 恢复时 currentSessionId 未更新为持久化 id,
 * 恢复后所有带 sessionId 的通知都会被误丢弃。
 *
 * 因此,在多会话能力正式引入之前,过滤门控必须保持关闭(multiSessionEnabled = false)。
 * 正确启用门控的前提:
 *   a. main 在 turn.completed 时采用后端返回的持久化 id 更新 currentSessionId,
 *      或者后端在整个生命周期内保持同一稳定 wire id。
 *   b. wraith:resumeSession 恢复时将 currentSessionId 同步为持久化 id。
 * 以上工作属于未来多会话设计,不属于本波次(债务清扫波 2)范围。
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 过滤规则(仅 multiSessionEnabled === true 时生效,fail-open):
 *   1. params.sessionId 缺失/undefined → 放行(兼容:许多通知不带 sessionId)。
 *   2. params.sessionId 存在 且 == activeSessionId → 放行(同会话通知)。
 *   3. params.sessionId 存在 且 !== activeSessionId → 丢弃(异会话通知)。
 *
 * 特殊情形:activeSessionId === null(尚未开启会话,应用启动初期)→ 放行。
 *
 * 注意:自动化通道(onAutomationEvent / pushAutomation)完全独立,不经过本函数。
 *
 * @param activeSessionId      - main 进程当前活跃 sessionId(null = 尚未开启会话)
 * @param params               - 通知的 params 对象(任意类型)
 * @param multiSessionEnabled  - 多会话过滤门控开关(默认 false)。
 *                               false = v1 单会话模式:始终放行所有通知(byte-identical)。
 *                               true  = 多会话模式:按 activeSessionId 过滤(未来用)。
 *                               在 v1 中必须保持 false,因为会话 id 在 turn.completed
 *                               时会从 sess_… 换为持久化 id,启用过滤将误丢弃通知。
 * @returns true = 应转发给渲染进程;false = 丢弃
 */
export function shouldForwardNotification(
  activeSessionId: string | null,
  params: unknown,
  multiSessionEnabled = false,
): boolean {
  // v1 单会话模式:门控关闭 → 始终放行(byte-identical)。
  // 会话 id 在 turn.completed 时从 sess_… 换为持久化 id,
  // 若启用过滤将误丢弃 turn.completed,导致 turn 永卡 running。
  if (!multiSessionEnabled) return true

  // 以下为多会话过滤路径(multiSessionEnabled === true,未来使用)。

  // 活跃会话未知 → fail-open(放行)
  if (activeSessionId === null) return true

  // params 非对象或 sessionId 字段缺失 → 放行(兼容无 sessionId 通知)
  if (typeof params !== 'object' || params === null) return true
  const p = params as Record<string, unknown>
  if (!('sessionId' in p) || p['sessionId'] === undefined || p['sessionId'] === null) return true

  // params.sessionId 存在:仅当匹配活跃会话时放行
  return p['sessionId'] === activeSessionId
}
