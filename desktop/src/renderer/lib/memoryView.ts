/** 长期记忆条目的展示辅助(纯函数,可单测)。 */

export function scopeLabel(scope: string): string {
  if (scope === 'global') return '全局'
  if (scope === 'project') return '项目'
  return scope
}

/** 相对时间:刚刚 / N 分钟前 / N 小时前 / N 天前(<7天);超 7 天回退绝对日期。 */
export function relativeTime(timestampMs: number, nowMs: number): string {
  const diff = nowMs - timestampMs
  const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
  if (diff < MIN) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`
  const d = new Date(timestampMs)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 绝对时间格式化:用于聊天消息悬停显示。
 * 今天 → HH:mm; 今年非今日 → MM-DD HH:mm; 跨年 → YYYY-MM-DD HH:mm。
 */
export function absoluteTime(timestampMs: number, nowMs: number = Date.now()): string {
  const d = new Date(timestampMs)
  const now = new Date(nowMs)
  const p = (n: number): string => String(n).padStart(2, '0')
  const hhmm = `${p(d.getHours())}:${p(d.getMinutes())}`
  // 同一天
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    return hhmm
  }
  // 今年不同日
  if (d.getFullYear() === now.getFullYear()) {
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hhmm}`
  }
  // 跨年
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hhmm}`
}
