import type { ToolCard } from './transcriptReducer'

/**
 * 工具卡片徽标文案 — 纯 TS。
 * execute_command 有真实子进程,显示退出码 exit N;
 * 其他工具无进程语义,借用 "exit 0" 会误导,改用 ✓ 完成 / ✗ 失败。
 */
export function toolBadgeLabel(card: ToolCard): string {
  if (!card.done) return 'running…'
  const failed = card.ok === false
  if (card.name === 'execute_command') {
    return failed ? `exit ${card.exitCode ?? 1}` : `exit ${card.exitCode ?? 0}`
  }
  return failed ? '✗ 失败' : '✓ 完成'
}
