import { reduce, freshState, type Item } from './transcriptReducer'
import type { BackendEvent } from './types'

/**
 * 将一组录制事件回放到空 state，返回其中的 plan/team Item（或 null）。
 */
function replayCard(events: Array<{ method: string; params: unknown }>): Item | null {
  let s = freshState()
  for (const e of events) {
    s = reduce(s, { kind: 'notification', method: e.method, params: e.params } as BackendEvent)
  }
  return s.items.find(i => i.type === 'team' || i.type === 'plan') ?? null
}

/**
 * 将 resume 带回的 cards 按 turnOrdinal 插入 baseItems。
 *
 * 插入位置：第 turnOrdinal 个（0-based）user 项的正后方（user→card→answer 顺序）。
 *
 * 从 ordinal 最大值倒序插入：大 ordinal 对应的 user item 下标更靠后，
 * 先插后面的位置不会影响前面小 ordinal user item 的原始下标，所以无需偏移补偿。
 */
export function spliceCards(
  baseItems: Item[],
  cards?: Array<{ turnOrdinal: number; events: Array<{ method: string; params: unknown }> }>,
): Item[] {
  if (!cards || cards.length === 0) return baseItems

  // 预先收集所有 user 项在 baseItems 中的下标（0-based）
  const userIdx: number[] = []
  baseItems.forEach((it, i) => {
    if (it.type === 'user') userIdx.push(i)
  })

  const result = [...baseItems]

  // 从大 ordinal 到小 ordinal 处理，保证插入不影响后续较小 ordinal 的原始下标
  const sorted = [...cards].sort((a, b) => b.turnOrdinal - a.turnOrdinal)

  for (const c of sorted) {
    const card = replayCard(c.events)
    if (!card) continue
    const uidxInBase = userIdx[c.turnOrdinal]
    if (uidxInBase == null) continue

    // 计算在 result 中已有多少张大 ordinal 的卡片插入在 uidxInBase 之后
    // （这些插入不影响 uidxInBase 自身的位置，因为它们都在更大的下标处）
    // 所以在 result 中该 user 项的实际位置仍然等于 uidxInBase
    result.splice(uidxInBase + 1, 0, card)
  }

  return result
}
