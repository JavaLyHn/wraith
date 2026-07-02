/**
 * 时间窗合并节流 — 纯 TS。首个值立即 emit;窗口内后续值只保留最新,
 * 窗口结束时 emit 挂起值并开启下一窗;窗口结束无挂起则回到空闲。
 */
export function createThrottleLatest<T>(windowMs: number, emit: (v: T) => void): (v: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { v: T } | null = null

  const flush = (): void => {
    timer = null
    if (pending) {
      const v = pending.v
      pending = null
      emit(v)
      timer = setTimeout(flush, windowMs)
    }
  }

  return (v: T) => {
    if (timer === null) {
      emit(v)
      timer = setTimeout(flush, windowMs)
    } else {
      pending = { v }
    }
  }
}
