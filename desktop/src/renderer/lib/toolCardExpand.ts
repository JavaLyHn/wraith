import { toolCardFailed } from '../../shared/toolBadge'
import type { ToolCard } from '../../shared/transcriptReducer'

/**
 * 默认折叠策略:仅失败→展开;运行中和完成成功均默认折叠。
 * 运行中工具显示单行 header（工具名 + args 预览 + "running…" 徽标），不展开参数块。
 */
export function toolCardDefaultExpanded(card: ToolCard): boolean {
  return toolCardFailed(card)
}
