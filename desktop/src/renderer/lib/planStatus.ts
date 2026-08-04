export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed'

export function planStatusIcon(s: PlanStepStatus): string {
  switch (s) {
    case 'pending': return '○'
    case 'running': return '◐'
    case 'done': return '✓'
    case 'failed': return '✗'
  }
}

export function planStatusClass(s: PlanStepStatus): string {
  switch (s) {
    case 'running': return 'text-accent'
    case 'done': return 'text-green-500'
    case 'failed': return 'text-danger'
    default: return 'text-fg-subtle'
  }
}

/**
 * 运行中步骤的动画类。
 *
 * 此前计划卡的步骤行**一点动画都没有** —— 只有一个静态 `◐` 上了强调色，
 * 用户看不出它在跑（TeamCard 有 pulse，计划卡从来没加过；两张卡长得像，行为不一样）。
 *
 * **`inline-block` 不是装饰**：CSS `transform` 对 inline 元素无效，`<span>` 默认 inline，
 * 少了它 `animate-spin` 完全没反应 —— 类名还在，动画没了。
 * （`animate-pulse` 之所以在 inline 上能用，是因为它动的是 `opacity`。）
 */
export function planStatusAnimation(s: PlanStepStatus): string {
  return s === 'running' ? 'inline-block animate-spin' : ''
}

/**
 * 卡头上的实时进度。光看一排图标数不出来「跑到第几步了」。
 *
 * 序号取**最后一个** running 步骤：并行执行时前面几步可能同时在跑，
 * 取最后一个既不会超出总数，也符合「进行到哪儿了」的直觉。
 */
export function planProgressLabel(steps: { status: PlanStepStatus }[]): string {
  if (steps.length === 0) return ''
  const total = steps.length
  const failed = steps.filter(s => s.status === 'failed').length
  let lastRunning = -1
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].status === 'running') lastRunning = i
  }
  if (lastRunning >= 0) return `第 ${lastRunning + 1}/${total} 步 · 执行中`
  const done = steps.filter(s => s.status === 'done').length
  if (failed > 0) return `${done}/${total} 完成 · ${failed} 失败`
  if (done === total) return `${total}/${total} 完成`
  return ''   // 全 pending：还没开始，别报一个 0/n 制造"卡住了"的观感
}
