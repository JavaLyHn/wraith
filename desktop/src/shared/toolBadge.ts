import type { ToolCard } from './transcriptReducer'

/**
 * 工具卡片徽标文案 — 纯 TS。
 * 成功一律 ✓ 完成(execute_command 也不显误导性的 "exit 0",退出码在输出正文里已可见);
 * execute_command 失败时保留非零退出码 exit N(有诊断价值);其它工具失败 ✗ 失败。
 */
export function toolBadgeLabel(card: ToolCard): string {
  if (!card.done) return 'running…'
  const failed = card.ok === false
  if (card.name === 'execute_command' && failed) {
    return `exit ${card.exitCode ?? 1}`
  }
  return failed ? '✗ 失败' : '✓ 完成'
}
