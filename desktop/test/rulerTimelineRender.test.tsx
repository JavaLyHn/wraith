// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import React, { useEffect, useRef, useState } from 'react'
import Transcript from '../src/renderer/components/Transcript'
import RulerTimeline from '../src/renderer/components/RulerTimeline'
import { SettingsProvider } from '../src/renderer/settings/SettingsContext'
import type { Item } from '../src/shared/transcriptReducer'
import {
  reduce,
  initialState,
  addUserItem,
} from '../src/shared/transcriptReducer'
import type { BackendEvent } from '../src/shared/types'
import { groupToolRuns } from '../src/renderer/lib/groupToolRuns'
import { timelineMarksAttrs } from '../src/renderer/lib/timelineMarks'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

function notif(method: string, params: Record<string, unknown> = {}): BackendEvent {
  return { kind: 'notification', method, params }
}

const baseProps = {
  busy: false,
  onEditMessage: vi.fn(),
  onDeleteMessage: vi.fn(),
  onResendMessage: vi.fn(),
  onPlanReview: vi.fn(),
  mode: 'react' as const,
  onOpenDiff: vi.fn(),
  onUndo: vi.fn(async () => ({ ok: true })),
  editors: [] as never[],
  workspace: '/proj',
  onOpenPanel: vi.fn(),
}

function renderWithSettings(ui: React.ReactElement) {
  return render(<SettingsProvider>{ui}</SettingsProvider>)
}

function buildUserMsgOnly(): Item[] {
  let s = initialState
  s = addUserItem(s, 'hello')
  return s.items
}

function buildUserMsgAgentMsg(): Item[] {
  let s = initialState
  s = addUserItem(s, 'hi')
  s = reduce(s, notif('message.delta', { text: '已收到' }))
  s = reduce(s, notif('message.end'))
  return s.items
}

function buildUserMsgAgentMsgWriteTool(): Item[] {
  let s = initialState
  s = addUserItem(s, '请生成文件')
  s = reduce(s, notif('message.delta', { text: '好的，正在生成' }))
  s = reduce(s, notif('message.end'))
  s = reduce(s, notif('tool.call', { callId: 'c1', name: 'write_file', argsJson: '{"path":"a.md","content":"# x"}' }))
  s = reduce(s, notif('tool.result', { callId: 'c1', ok: true, exitCode: 0 }))
  return s.items
}

function collectTopLevelMarkTypes(container: HTMLElement): string[] {
  const transcriptContent = container.querySelector('[data-testid="transcript"] > div.flex.flex-col')
  if (!transcriptContent) return []
  const types: string[] = []
  transcriptContent.querySelectorAll(':scope > [data-tl-mark-type]').forEach(el => {
    const t = el.getAttribute('data-tl-mark-type')
    if (t) types.push(t)
  })
  return types
}

function triggerRulerMeasure(container: HTMLElement): void {
  const hidEls = container.querySelectorAll('[data-tl-hid]')
  if (hidEls.length > 0) {
    const first = hidEls[0] as HTMLElement
    fireEvent.mouseEnter(first)
    fireEvent.mouseLeave(first)
  }
}

describe('T5 RulerTimeline + Transcript 集成渲染测试', () => {
  it('T5.1: Transcript 渲染 1 条 user 气泡 → DOM 上存在 data-tl-hid 且 data-tl-mark-type="dot"', () => {
    const items = buildUserMsgOnly()
    const { container } = renderWithSettings(<Transcript {...baseProps} items={items} />)

    const userMsg = screen.getByTestId('user-msg')
    expect(userMsg).toBeTruthy()

    const markEls = container.querySelectorAll('[data-tl-mark-type="dot"]')
    expect(markEls.length).toBeGreaterThanOrEqual(1)

    let found = false
    markEls.forEach(el => {
      if (el.contains(userMsg)) found = true
      const hid = el.getAttribute('data-tl-hid')
      expect(hid).toBeTruthy()
    })
    expect(found).toBe(true)

    const hidEls = container.querySelectorAll('[data-tl-hid]')
    expect(hidEls.length).toBeGreaterThanOrEqual(1)
  })

  it('T5.2: user → message → toolGroup(1 个 write_file) → 有 3 个 mark 节点，类型依次是 dot/square/diamond', () => {
    const items = buildUserMsgAgentMsgWriteTool()

    const nodes = groupToolRuns(items)
    const marks = timelineMarksAttrs(nodes)
    const markTypes = marks.map(m => m.markType)
    expect(markTypes).toEqual(['dot', 'square', 'diamond'])

    const { container } = renderWithSettings(<Transcript {...baseProps} items={items} />)

    const topTypes = collectTopLevelMarkTypes(container)
    expect(topTypes).toEqual(['dot', 'square', 'diamond'])

    const dotEls = container.querySelectorAll('[data-tl-mark-type="dot"]')
    expect(dotEls.length).toBeGreaterThanOrEqual(1)
    const squareEls = container.querySelectorAll('[data-tl-mark-type="square"]')
    expect(squareEls.length).toBeGreaterThanOrEqual(1)
    const diamondEls = container.querySelectorAll('[data-tl-mark-type="diamond"]')
    expect(diamondEls.length).toBeGreaterThanOrEqual(1)
  })

  it('T5.3: RulerTimeline 在 Transcript 内可挂载且 data-testid 存在', () => {
    const items = buildUserMsgAgentMsg()
    renderWithSettings(<Transcript {...baseProps} items={items} />)

    const ruler = screen.getByTestId('ruler-timeline')
    expect(ruler).toBeTruthy()
    expect(ruler.tagName.toLowerCase()).toBe('div')
    expect(ruler.className.includes('ruler-timeline')).toBe(true)
  })

  it('T5.4: 透明降级测试：items = [] → ruler-timeline 仍挂载但内部 0 个 mark 节点', () => {
    const { container } = renderWithSettings(<Transcript {...baseProps} items={[]} />)

    const ruler = screen.getByTestId('ruler-timeline')
    expect(ruler).toBeTruthy()

    const hidEls = container.querySelectorAll('[data-tl-hid]')
    expect(hidEls.length).toBe(0)

    const markTypeEls = container.querySelectorAll('[data-tl-mark-type]')
    expect(markTypeEls.length).toBe(0)

    const markNodes = ruler.querySelectorAll('.ruler-mark-node')
    expect(markNodes.length).toBe(0)
  })

  it('T5.5: Transcript item hover → RulerTimeline 对应 mark 加 is-active 类，mouseLeave 后消失', () => {
    const items = buildUserMsgAgentMsg()
    const { container } = renderWithSettings(<Transcript {...baseProps} items={items} />)

    const hidEls = container.querySelectorAll('[data-tl-hid]')
    expect(hidEls.length).toBeGreaterThanOrEqual(1)

    const firstHidEl = hidEls[0] as HTMLElement
    const expectedHid = firstHidEl.getAttribute('data-tl-hid')
    expect(expectedHid).toBeTruthy()

    fireEvent.mouseEnter(firstHidEl)

    const ruler = screen.getByTestId('ruler-timeline')
    const activeSegs = ruler.querySelectorAll('.ruler-highlight-seg.is-active')
    const activeMarks = ruler.querySelectorAll('.ruler-mark-node.is-active')
    expect(activeSegs.length + activeMarks.length).toBeGreaterThanOrEqual(1)

    fireEvent.mouseLeave(firstHidEl)

    const activeSegsAfter = ruler.querySelectorAll('.ruler-highlight-seg.is-active')
    const activeMarksAfter = ruler.querySelectorAll('.ruler-mark-node.is-active')
    expect(activeSegsAfter.length + activeMarksAfter.length).toBe(0)
  })

  it('T5.6: RulerTimeline mark hover → onHover 回调正确触发（mouseEnter 传 hid，mouseLeave 传 null）', () => {
    const onHover = vi.fn()

    function Fixture() {
      const scrollRef = useRef<HTMLDivElement>(null)
      const contentRef = useRef<HTMLDivElement>(null)
      const [tick, setTick] = useState(0)
      useEffect(() => { setTick(1) }, [])
      return (
        <div ref={scrollRef} data-testid="scroll-container" style={{ position: 'relative' }}>
          <div ref={contentRef}>
            <div data-tl-hid="x" data-tl-mark-type="dot" style={{ height: 20 }}>hello</div>
          </div>
          <RulerTimeline
            contentRef={contentRef}
            scrollRef={scrollRef}
            activeHid={tick === 0 ? null : null}
            onHover={onHover}
          />
        </div>
      )
    }

    render(<Fixture />)

    const ruler = screen.getByTestId('ruler-timeline')
    const markNode = ruler.querySelector('.ruler-mark-node') as HTMLElement | null
    expect(markNode).toBeTruthy()

    if (markNode) {
      fireEvent.mouseEnter(markNode)
      expect(onHover).toHaveBeenCalledWith('x')

      onHover.mockClear()

      fireEvent.mouseLeave(markNode)
      expect(onHover).toHaveBeenCalledWith(null)
    }
  })

  it('T5.7: 入场动画：mark 节点 DOM 元素存在且有 ruler-mark-node base class（至少 2 个）', () => {
    const items = buildUserMsgAgentMsg()
    const { container } = renderWithSettings(<Transcript {...baseProps} items={items} />)

    triggerRulerMeasure(container)

    const ruler = screen.getByTestId('ruler-timeline')
    const markNodes = ruler.querySelectorAll('.ruler-mark-node')
    expect(markNodes.length).toBeGreaterThanOrEqual(2)

    markNodes.forEach(node => {
      expect(node.className.includes('ruler-mark-node')).toBe(true)
    })
  })
})
