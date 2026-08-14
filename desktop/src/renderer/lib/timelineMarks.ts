import type { RenderNode } from './groupToolRuns'

export type RulerMarkType = 'dot'

export interface RulerMarkAttr {
  hid: string
  markType: null | RulerMarkType
}

/**
 * 一问一答算一条横线：每个 user 消息产生一个 dot 标记，
 * 同一轮次内的所有内容（agent 回答、工具调用、thinking 等）共享同一个 hid。
 * 用户发完消息中断（无 agent 回答）也算一条。
 */
export function timelineMarksAttrs(nodes: RenderNode[]): RulerMarkAttr[] {
  let turnOrdinal = 0
  let currentHid = 'prelude'

  const result: RulerMarkAttr[] = []

  for (const node of nodes) {
    if (node.kind === 'item') {
      const item = node.item

      if (item.type === 'user') {
        turnOrdinal++
        currentHid = `turn${turnOrdinal}`
        result.push({ hid: currentHid, markType: 'dot' })
      } else {
        result.push({ hid: currentHid, markType: null })
      }
    } else if (node.kind === 'toolGroup') {
      result.push({ hid: currentHid, markType: null })
    }
  }

  return result
}
