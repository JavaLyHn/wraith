import type { Item, ToolCard } from '../../shared/transcriptReducer'

// ---------------------------------------------------------------------------
// RenderNode — transcript 渲染节点联合类型
// ---------------------------------------------------------------------------

/** 单个非工具 item，直接透传渲染。 */
export interface RenderItem {
  kind: 'item'
  item: Item
}

/**
 * 连续工具卡片组，渲染为可折叠「工作过程」区块。
 * 长度 ≥1（单工具也包装为 toolGroup，保持一致）。
 */
export interface RenderToolGroup {
  kind: 'toolGroup'
  cards: ToolCard[]
}

export type RenderNode = RenderItem | RenderToolGroup

// ---------------------------------------------------------------------------
// groupToolRuns — 纯函数，无副作用
// ---------------------------------------------------------------------------

/**
 * 将 transcript items 折叠成渲染节点列表：
 *   - 连续的 type:'tool' items 合并为一个 RenderToolGroup
 *   - 其余 item 原样包装为 RenderItem
 *
 * 纯函数、确定性，不修改输入。
 */
export function groupToolRuns(items: Item[]): RenderNode[] {
  const result: RenderNode[] = []
  let i = 0

  while (i < items.length) {
    const item = items[i]

    if (item.type === 'tool') {
      // 收集连续工具 run
      const cards: ToolCard[] = []
      while (i < items.length && items[i].type === 'tool') {
        cards.push((items[i] as { type: 'tool'; card: ToolCard }).card)
        i++
      }
      result.push({ kind: 'toolGroup', cards })
    } else {
      result.push({ kind: 'item', item })
      i++
    }
  }

  return result
}
