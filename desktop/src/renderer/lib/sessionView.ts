import type { SessionMeta } from '../../shared/types'

/** 会话展示名:自定义名优先,其次自动标题,最后兜底。 */
export function sessionDisplayName(s: SessionMeta): string {
  const n = s.name?.trim()
  if (n) return n
  return s.title || '(未命名)'
}

/** 按 starred 拆成两组,各自保持传入顺序(不改 updatedAt 倒序)。 */
export function partitionStarred(sessions: SessionMeta[]): { starred: SessionMeta[]; rest: SessionMeta[] } {
  const starred: SessionMeta[] = []
  const rest: SessionMeta[] = []
  for (const s of sessions) (s.starred ? starred : rest).push(s)
  return { starred, rest }
}

const DAY_MS = 86400000

/** 本地时区当天 00:00 的毫秒时间戳。 */
function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 按 updatedAt 相对 now 的【日历天差】分档:今天(0)/昨天(1)/近7天(2–6)/近30天(7–29)/更早(≥30)。
 * - now 为毫秒时间戳,由调用方传入(纯函数、可测,不在内部取当前时间)。
 * - 空档省略;组内保持传入顺序(会话已按 updatedAt 倒序);组顺序固定。
 * - 未来时间(时钟偏差,daysAgo<0)归「今天」;非法 updatedAt 归「更早」(防御,不抛)。
 */
export function groupSessionsByTime(
  sessions: SessionMeta[],
  now: number,
): { label: string; sessions: SessionMeta[] }[] {
  const startToday = startOfDay(now)
  const order = ['今天', '昨天', '近7天', '近30天', '更早']
  const buckets = new Map<string, SessionMeta[]>(order.map(l => [l, []]))
  for (const s of sessions) {
    const daysAgo = Math.round((startToday - startOfDay(new Date(s.updatedAt).getTime())) / DAY_MS)
    const label =
      daysAgo <= 0 ? '今天'
        : daysAgo === 1 ? '昨天'
          : daysAgo <= 6 ? '近7天'
            : daysAgo <= 29 ? '近30天'
              : '更早'
    buckets.get(label)!.push(s)
  }
  return order.filter(l => buckets.get(l)!.length > 0).map(l => ({ label: l, sessions: buckets.get(l)! }))
}
