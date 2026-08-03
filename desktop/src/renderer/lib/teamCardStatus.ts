import type { TeamStep } from '../../shared/transcriptReducer'

/**
 * 团队卡的「此刻谁在干活」判定。
 *
 * 用户症状:reviewer 明明在跑,界面上一点动静都没有,以为死机了。原因不是没渲染,
 * 是 reviewer 在 UI 里**没有自己的状态** —— 它唯一的信号曾是流式正文增量,于是:
 * - 审查块要等第一个 token 才出现(思考型模型出第一个 token 前可能沉默几十秒)
 * - 表头那个 reviewer 圆点跟的是「任意步骤在跑」,worker 在跑它也闪 —— 它从来不代表 reviewer
 *
 * 现在后端会发 team.review.started / completed,状态落在 TeamStep.reviewStatus 上。
 */

/**
 * 步骤行上的阶段文字;步骤不在运行时返回 `null`（不占位）。
 *
 * 「审查中」优先于「执行中」：同一个 running 步骤,worker 与 reviewer 是先后两个阶段,
 * 而 reviewStatus === 'running' 恰好只在后者成立。
 */
export function stepPhaseLabel(step: TeamStep): string | null {
  if (step.status !== 'running') {
    return null
  }
  if (step.reviewStatus === 'running') {
    return '审查中…'
  }
  // reviewStatus === 'done' 而步骤仍在跑 = 审查未通过,worker 正按反馈重跑
  return '执行中…'
}

/** 表头 reviewer 圆点的配色。只在**真的**有一步在审查时闪。 */
export function reviewerDotClass(steps: TeamStep[]): string {
  return steps.some(s => s.reviewStatus === 'running')
    ? 'bg-amber-400 animate-pulse'
    : 'bg-fg-subtle/40'
}

/**
 * 审查块要不要渲染。
 *
 * 「审查中但还没吐字」也要渲染 —— 那几十秒的沉默正是用户以为死机的那一段。
 */
export function showsReviewerBlock(step: TeamStep): boolean {
  return step.reviewStatus !== undefined
    || (typeof step.reviewOutput === 'string' && step.reviewOutput.length > 0)
}
