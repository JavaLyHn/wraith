import type { Item, ToolCard } from './transcriptReducer'
import type { ResumedMessage } from './types'

/**
 * Rebuild a static transcript (Item[]) from stored session messages.
 * user → user bubble; assistant reasoning → thinking (before content);
 * assistant content → message; assistant toolCalls → tool cards; tool → fills
 * the matching card's output by toolCallId. system messages are skipped.
 */
export function messagesToItems(msgs: ResumedMessage[]): Item[] {
  const items: Item[] = []
  const cardIndexByCallId = new Map<string, number>()

  for (const m of msgs) {
    if (m.role === 'user') {
      items.push({ type: 'user', text: m.content ?? '' })
    } else if (m.role === 'assistant') {
      if (m.reasoningContent) {
        items.push({ type: 'thinking', label: '', text: m.reasoningContent, done: true })
      }
      if (m.content) {
        items.push({ type: 'message', text: m.content })
      }
      for (const tc of m.toolCalls ?? []) {
        const card: ToolCard = {
          callId: tc.id,
          name: tc.name,
          argsJson: tc.arguments,
          output: '',
          done: true,
          ok: true,
        }
        cardIndexByCallId.set(tc.id, items.length)
        items.push({ type: 'tool', card })
      }
    } else if (m.role === 'tool') {
      const idx = m.toolCallId != null ? cardIndexByCallId.get(m.toolCallId) : undefined
      if (idx != null) {
        const item = items[idx]
        if (item.type === 'tool') {
          items[idx] = { type: 'tool', card: { ...item.card, output: m.content ?? '', done: true } }
        }
      }
    }
    // system → skip
  }
  return items
}
