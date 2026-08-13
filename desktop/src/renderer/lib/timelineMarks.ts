import type { RenderNode } from './groupToolRuns'

export type RulerMarkType = 'dot' | 'square' | 'diamond'

export interface RulerMarkAttr {
  hid: string
  markType: null | RulerMarkType
}

const WRITE_TOOLS = new Set<string>(['write_file', 'execute_command', 'create_project'])

export function timelineMarksAttrs(nodes: RenderNode[]): RulerMarkAttr[] {
  let userOrdinal = 0
  let hidForAgent = 'prelude'
  let agentFirstMsg = true
  let writeEmphasisCount = 0

  const result: RulerMarkAttr[] = []

  for (const node of nodes) {
    if (node.kind === 'item') {
      const item = node.item

      if (item.type === 'user') {
        userOrdinal++
        hidForAgent = `a${userOrdinal}`
        agentFirstMsg = true
        writeEmphasisCount = 0
        result.push({ hid: `u${userOrdinal}`, markType: 'dot' })
      } else if (item.type === 'message') {
        if (agentFirstMsg) {
          agentFirstMsg = false
          result.push({ hid: hidForAgent, markType: 'square' })
        } else {
          result.push({ hid: hidForAgent, markType: null })
        }
      } else if (item.type === 'tool') {
        const card = item.card
        if (WRITE_TOOLS.has(card.name) && writeEmphasisCount < 3) {
          writeEmphasisCount++
          result.push({ hid: hidForAgent, markType: 'diamond' })
        } else {
          result.push({ hid: hidForAgent, markType: null })
        }
      } else {
        result.push({ hid: hidForAgent, markType: null })
      }
    } else if (node.kind === 'toolGroup') {
      const firstWriteCard = node.cards.find(c => WRITE_TOOLS.has(c.name))
      if (firstWriteCard && writeEmphasisCount < 3) {
        writeEmphasisCount++
        result.push({ hid: hidForAgent, markType: 'diamond' })
      } else {
        result.push({ hid: hidForAgent, markType: null })
      }
    }
  }

  return result
}
