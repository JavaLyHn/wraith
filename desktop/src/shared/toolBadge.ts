import type { ToolCard } from './transcriptReducer'

const FAIL_RE = /^(工具执行失败|🛡️ 策略拒绝|工具执行超时)/

/** 卡片是否失败:显式 ok===false,或输出以失败标记开头(与正文一致,兜底 ok 信号缺失)。 */
export function toolCardFailed(card: ToolCard): boolean {
  return card.ok === false || FAIL_RE.test((card.output ?? '').trimStart())
}

export function toolBadgeLabel(card: ToolCard): string {
  if (!card.done) return 'running…'
  const failed = toolCardFailed(card)
  if (card.name === 'execute_command' && failed) {
    return `exit ${card.exitCode ?? 1}`
  }
  return failed ? '✗ 失败' : '✓ 完成'
}
