// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
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

function buildThreeTurns(): Item[] {
  let s = initialState
  s = addUserItem(s, '第一轮')
  s = reduce(s, notif('message.delta', { text: '回答一' }))
  s = reduce(s, notif('message.end'))
  s = addUserItem(s, '第二轮')
  s = reduce(s, notif('message.delta', { text: '回答二' }))
  s = reduce(s, notif('message.end'))
  s = addUserItem(s, '第三轮(中断,无回答)')
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

  it('T5.2: user → message → toolGroup(write_file) → 只有 user 消息有 dot 标记，其余 null', () => {
    const items = buildUserMsgAgentMsgWriteTool()

    const nodes = groupToolRuns(items)
    const marks = timelineMarksAttrs(nodes)
    const markTypes = marks.map(m => m.markType)
    // 一问一答=一条横线：只有 user 消息产生 dot，message 和 toolGroup 都是 null
    expect(markTypes).toEqual(['dot', null, null])

    const { container } = renderWithSettings(<Transcript {...baseProps} items={items} />)

    // 只有 user 消息带 data-tl-mark-type
    const topTypes = collectTopLevelMarkTypes(container)
    expect(topTypes).toEqual(['dot'])
  })

  it('T5.3: RulerTimeline 在 Transcript 内可挂载且 data-testid 存在', () => {
    const items = buildUserMsgAgentMsg()
    renderWithSettings(<Transcript {...baseProps} items={items} />)

    const ruler = screen.getByTestId('ruler-timeline')
    expect(ruler).toBeTruthy()
    expect(ruler.tagName.toLowerCase()).toBe('div')
    expect(ruler.className.includes('ruler-timeline')).toBe(true)
  })

  it('T5.4: 透明降级测试：items = [] → ruler-timeline 仍挂载但内部 0 条横线', () => {
    const { container } = renderWithSettings(<Transcript {...baseProps} items={[]} />)

    const ruler = screen.getByTestId('ruler-timeline')
    expect(ruler).toBeTruthy()

    const hidEls = container.querySelectorAll('[data-tl-hid]')
    expect(hidEls.length).toBe(0)

    const lineNodes = ruler.querySelectorAll('.ruler-line')
    expect(lineNodes.length).toBe(0)
  })

  it('T5.5: 横线数量 = 轮次数 —— 3 轮(含中断) → 3 条横线,1 轮 → 1 条(核心需求回归)', () => {
    const three = buildThreeTurns()
    const { container: c3 } = renderWithSettings(<Transcript {...baseProps} items={three} />)
    const ruler3 = screen.getByTestId('ruler-timeline')
    // 第三轮 user 发完即中断(无 agent 回答)也必须算一条
    expect(ruler3.querySelectorAll('.ruler-line').length).toBe(3)
    // 每条横线的 hid 与内容节点一一对应
    const hids = Array.from(ruler3.querySelectorAll('.ruler-line')).map(
      el => el.className
    )
    expect(hids.length).toBe(3)
    // 内容侧应有 3 个 dot 标记节点(user 气泡)
    const dots3 = c3.querySelectorAll('[data-tl-mark-type="dot"]')
    expect(dots3.length).toBe(3)
    cleanup()

    const one = buildUserMsgOnly()
    renderWithSettings(<Transcript {...baseProps} items={one} />)
    const ruler1 = screen.getByTestId('ruler-timeline')
    expect(ruler1.querySelectorAll('.ruler-line').length).toBe(1)
  })

  it('T5.6: 结构性断言 —— 横线列固定在内容滚动区外,不随内容滚动', () => {
    const items = buildThreeTurns()
    renderWithSettings(<Transcript {...baseProps} items={items} />)

    const ruler = screen.getByTestId('ruler-timeline')
    const transcript = screen.getByTestId('transcript')

    // ruler 必须不是内容滚动区(transcript)的子孙 —— 否则内容滚动时横线跟着滚走
    expect(transcript.contains(ruler)).toBe(false)
    // 两者是兄弟布局:共同父级存在
    expect(ruler.parentElement).toBeTruthy()
    expect(ruler.parentElement).toBe(transcript.parentElement)
  })

  it('T5.7: hover 内容节点 → 对应横线加 ruler-line--on 类，mouseLeave 后消失', () => {
    const items = buildThreeTurns()
    const { container } = renderWithSettings(<Transcript {...baseProps} items={items} />)

    // hover 第二轮的 user 气泡
    const dots = container.querySelectorAll('[data-tl-mark-type="dot"]')
    expect(dots.length).toBe(3)
    const secondTurn = dots[1] as HTMLElement
    const expectedHid = secondTurn.getAttribute('data-tl-hid')
    expect(expectedHid).toBe('turn2')

    fireEvent.mouseEnter(secondTurn)

    const ruler = screen.getByTestId('ruler-timeline')
    const activeLines = ruler.querySelectorAll('.ruler-line.ruler-line--on')
    expect(activeLines.length).toBe(1)
    // 高亮的正是第二条横线(顺序对应轮次)
    const lines = ruler.querySelectorAll('.ruler-line')
    expect(lines[1].classList.contains('ruler-line--on')).toBe(true)

    fireEvent.mouseLeave(secondTurn)
    expect(ruler.querySelectorAll('.ruler-line.ruler-line--on').length).toBe(0)
  })

  it('T5.8: RulerTimeline 直测 — hover 回调 + 点击 onJump(带 hid)', () => {
    const onHover = vi.fn()
    const onJump = vi.fn()
    render(
      <RulerTimeline
        turns={['turn1', 'turn2', 'turn3']}
        activeHid={null}
        onHover={onHover}
        onJump={onJump}
      />,
    )

    const lines = screen.getAllByRole('button')
    expect(lines.length).toBe(3)

    fireEvent.mouseEnter(lines[1])
    expect(onHover).toHaveBeenCalledWith('turn2')

    onHover.mockClear()
    fireEvent.mouseLeave(lines[1])
    expect(onHover).toHaveBeenCalledWith(null)

    fireEvent.click(lines[2])
    expect(onJump).toHaveBeenCalledWith('turn3')
  })

  it('T5.9: Transcript 集成 — 点击横线滚动内容到对应轮次', () => {
    // jsdom 未实现 Element.scrollTo(为 undefined 非 no-op),mock 后才能走完真实点击路径
    const scrollToMock = vi.fn()
    Element.prototype.scrollTo = scrollToMock as unknown as typeof Element.prototype.scrollTo
    const items = buildThreeTurns()
    renderWithSettings(<Transcript {...baseProps} items={items} />)

    const ruler = screen.getByTestId('ruler-timeline')
    const lines = ruler.querySelectorAll('.ruler-line')
    fireEvent.click(lines[1])
    // 点击第二条横线 → 内容滚动到第二轮开头(带 smooth 行为)
    expect(scrollToMock).toHaveBeenCalledTimes(1)
    expect(scrollToMock).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
  })
})
