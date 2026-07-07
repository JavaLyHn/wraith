import type { Item } from '../../shared/transcriptReducer'

/** 返回最后一条用户消息的 1-based ordinal 与文本;无用户消息返回 null。 */
export function lastUserMessage(items: Item[]): { ordinal: number; text: string } | null {
  let ordinal = 0
  let last: { ordinal: number; text: string } | null = null
  for (const item of items) {
    if (item.type === 'user') {
      ordinal++
      last = { ordinal, text: item.text }
    }
  }
  return last
}
