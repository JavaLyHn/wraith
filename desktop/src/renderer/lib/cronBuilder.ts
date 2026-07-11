// cron「模式构建器」纯函数:把用户友好的重复模式 ↔ 标准 5 段 cron 表达式互转。
// cron 由守护进程(Java)权威调度并支持完整语法,前端只需生成/反解常见形态 + 手写兜底。

export type CronMode = 'hourly' | 'everyNHours' | 'monthly' | 'weekdays' | 'raw'

/** 构建器状态:各模式各取所需字段,其余字段保留合理默认(方便切换模式时不丢值)。 */
export interface CronBuilderState {
  mode: CronMode
  minute: number    // hourly:每小时的第几分 (0-59)
  everyN: number    // everyNHours:每隔几小时 (1-23)
  monthDay: number  // monthly:每月几号 (1-31)
  time: string      // monthly / weekdays:'HH:MM'
  raw: string       // raw:手写表达式
}

export const CRON_MODE_OPTIONS: Array<{ value: CronMode; label: string }> = [
  { value: 'hourly', label: '每小时' },
  { value: 'everyNHours', label: '每 N 小时' },
  { value: 'monthly', label: '每月某天' },
  { value: 'weekdays', label: '工作日(周一~五)' },
  { value: 'raw', label: '自定义(手写)' },
]

export const CRON_DEFAULT_STATE: CronBuilderState = {
  mode: 'weekdays', minute: 0, everyN: 2, monthDay: 1, time: '09:00', raw: '',
}

function clampInt(n: number, lo: number, hi: number): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return lo
  return Math.min(hi, Math.max(lo, v))
}

/** 'HH:MM' → [hour, minute];非法回退 09:00。 */
function splitTime(t: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim())
  if (!m) return [9, 0]
  return [clampInt(Number(m[1]), 0, 23), clampInt(Number(m[2]), 0, 59)]
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 由构建器状态生成标准 5 段 cron(raw 模式直接回其手写值,去空白)。 */
export function buildCron(s: CronBuilderState): string {
  switch (s.mode) {
    case 'hourly':
      return `${clampInt(s.minute, 0, 59)} * * * *`
    case 'everyNHours':
      return `0 */${clampInt(s.everyN, 1, 23)} * * *`
    case 'monthly': {
      const [h, mi] = splitTime(s.time)
      return `${mi} ${h} ${clampInt(s.monthDay, 1, 31)} * *`
    }
    case 'weekdays': {
      const [h, mi] = splitTime(s.time)
      return `${mi} ${h} * * 1-5`
    }
    case 'raw':
      return s.raw.trim()
  }
}

/**
 * 反解 cron 表达式为构建器状态:命中 hourly/everyNHours/monthly/weekdays 形态即回对应模式,
 * 否则归为 raw(手写),原样保留表达式。未命中字段一律用默认值补齐。
 */
export function parseCron(expr: string): CronBuilderState {
  const e = (expr ?? '').trim()
  const base = { ...CRON_DEFAULT_STATE }
  let m: RegExpExecArray | null

  if ((m = /^(\d{1,2}) \* \* \* \*$/.exec(e))) {
    return { ...base, mode: 'hourly', minute: clampInt(Number(m[1]), 0, 59) }
  }
  if ((m = /^0 \*\/(\d{1,2}) \* \* \*$/.exec(e))) {
    return { ...base, mode: 'everyNHours', everyN: clampInt(Number(m[1]), 1, 23) }
  }
  if ((m = /^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \*$/.exec(e))) {
    const mi = clampInt(Number(m[1]), 0, 59), h = clampInt(Number(m[2]), 0, 23), d = clampInt(Number(m[3]), 1, 31)
    return { ...base, mode: 'monthly', monthDay: d, time: `${pad2(h)}:${pad2(mi)}` }
  }
  if ((m = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(e))) {
    const mi = clampInt(Number(m[1]), 0, 59), h = clampInt(Number(m[2]), 0, 23)
    return { ...base, mode: 'weekdays', time: `${pad2(h)}:${pad2(mi)}` }
  }
  return { ...base, mode: 'raw', raw: e }
}

/** 构建器状态 → 中文可读描述(用于实时预览)。 */
export function describeCron(s: CronBuilderState): string {
  switch (s.mode) {
    case 'hourly':
      return `每小时的第 ${clampInt(s.minute, 0, 59)} 分触发`
    case 'everyNHours':
      return `每隔 ${clampInt(s.everyN, 1, 23)} 小时(整点)触发`
    case 'monthly': {
      const [h, mi] = splitTime(s.time)
      return `每月 ${clampInt(s.monthDay, 1, 31)} 号 ${pad2(h)}:${pad2(mi)} 触发`
    }
    case 'weekdays': {
      const [h, mi] = splitTime(s.time)
      return `每个工作日(周一至周五)${pad2(h)}:${pad2(mi)} 触发`
    }
    case 'raw':
      return '自定义 cron 表达式(守护进程做权威解析)'
  }
}
