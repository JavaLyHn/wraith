import { toolCardFailed } from '../../shared/toolBadge'
import type { ToolCard } from '../../shared/transcriptReducer'

/** 智能默认:运行中或失败→展开;完成且成功→折叠。 */
export function toolCardDefaultExpanded(card: ToolCard): boolean {
  return !card.done || toolCardFailed(card)
}
