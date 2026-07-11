/** 快照相位/模式/时间的中文展示辅助(纯函数,可单测)。 */

export function phaseLabel(phase: string): string {
  if (phase === 'PRE_TURN') return '轮前'
  if (phase === 'POST_TURN') return '轮后'
  if (phase === 'PRE_RESTORE') return '恢复前'
  return phase
}

/** 一句话说明这个快照是什么(给相位配人话)。 */
export function phaseMeaning(phase: string): string {
  if (phase === 'PRE_TURN') return '这轮对话开始前的存档'
  if (phase === 'POST_TURN') return '这轮对话结束后的存档'
  if (phase === 'PRE_RESTORE') return '一次恢复操作前的存档'
  return '存档'
}

/** 从 turnId(形如 plan-1783578128576)解析运行模式的中文标签。 */
export function modeLabel(turnId: string): string {
  const prefix = (turnId || '').split('-')[0]
  if (prefix === 'plan') return '计划模式'
  if (prefix === 'team') return '团队模式'
  if (prefix === 'react') return '常规对话'
  return '对话'
}

/** epoch 毫秒 → 本地可读 `YYYY-MM-DD HH:mm`;0/无效返回空串。 */
export function absTime(ms: number): string {
  if (!ms || Number.isNaN(ms)) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** epoch 毫秒 → 相对时间「刚刚 / N 分钟前 / N 小时前 / N 天前 / N 个月前」;0/无效返回空串。 */
export function relativeTime(ms: number, nowMs: number = Date.now()): string {
  if (!ms || Number.isNaN(ms)) return ''
  const diff = nowMs - ms
  if (diff < 60_000) return '刚刚'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return `${Math.floor(day / 30)} 个月前`
}

/**
 * 从快照 summary(形如 `mode=team\ninput=帮我改下登录逻辑`)提取当时的输入正文。
 * 没有 input= 段则返回空串。
 */
export function summaryInput(summary: string): string {
  if (!summary) return ''
  const m = summary.match(/input=([\s\S]*)$/)
  return m ? m[1].trim() : ''
}
