// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, renderHook } from '@testing-library/react'
import ImConnectCard from '../src/renderer/components/ImConnectCard'
import { imBoundEventText } from '../src/renderer/lib/gatewayLabels'
import { makeSystemEvent, parseSystemEvent, SYSTEM_EVENT_PREFIX } from '../src/shared/systemEvent'
import { messagesToItems } from '../src/shared/messagesToItems'
import { useSystemEventQueue } from '../src/renderer/lib/useSystemEventQueue'
import type { GatewayEvent, GatewayState } from '../src/shared/gateway'
import type { ResumedMessage } from '../src/shared/types'

afterEach(() => cleanup())

// ── 1. 系统事件标记(纯) ────────────────────────────────────────────────
describe('systemEvent 标记', () => {
  it('往返:makeSystemEvent → parseSystemEvent 拿回正文', () => {
    expect(parseSystemEvent(makeSystemEvent('微信绑定成功'))).toBe('微信绑定成功')
  })
  it('普通用户消息不被误判为系统事件', () => {
    expect(parseSystemEvent('帮我接入微信')).toBeNull()
    expect(parseSystemEvent('')).toBeNull()
  })
  it('前缀出现在句中不算(必须打头,防用户复述时被吞成系统事件)', () => {
    expect(parseSystemEvent(`你刚才说的 ${SYSTEM_EVENT_PREFIX} 是什么意思`)).toBeNull()
  })
})

// ── 2. 会话恢复:系统事件不能还原成「用户说过的话」 ─────────────────────
describe('messagesToItems 还原系统事件', () => {
  it('带标记的 user 消息还原成 system-event,而非 user 气泡', () => {
    const msgs = [{ role: 'user', content: makeSystemEvent('微信绑定成功(网关:运行中)') }] as ResumedMessage[]
    const items = messagesToItems(msgs)
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('system-event')
    expect(items[0]).toMatchObject({ text: expect.stringContaining('微信绑定成功') })
  })
  it('普通 user 消息照旧还原成 user 气泡', () => {
    const items = messagesToItems([{ role: 'user', content: '帮我接入微信' }] as ResumedMessage[])
    expect(items[0]!.type).toBe('user')
  })
})

// ── 3. 事件文案必须如实反映网关运行态 ───────────────────────────────────
describe('imBoundEventText', () => {
  it('网关在跑才允许出现「可以直接在微信里」这类结论', () => {
    expect(imBoundEventText('weixin', 'running')).toContain('运行中')
    expect(imBoundEventText('weixin', 'running')).toContain('微信')
  })
  it('网关没跑必须点明还需启动,不能让 agent 拍胸脯', () => {
    const t = imBoundEventText('weixin', 'stopped')
    expect(t).toContain('未运行')
    expect(t).not.toContain('运行中')
  })
  it('状态未知时如实说未知', () => {
    expect(imBoundEventText('qq', null)).toContain('未知')
  })
})

// ── 4. 补轮排队:有轮在跑绝不硬发(app-server 会回 turn in progress) ──────
describe('useSystemEventQueue', () => {
  it('空闲:立即发', () => {
    const emit = vi.fn()
    const { result } = renderHook(({ r }) => useSystemEventQueue(r, emit), { initialProps: { r: false } })
    act(() => result.current('e1'))
    expect(emit).toHaveBeenCalledWith('e1')
  })

  it('有轮在跑:先压住,等轮结束再发', () => {
    const emit = vi.fn()
    const { result, rerender } = renderHook(({ r }) => useSystemEventQueue(r, emit), { initialProps: { r: true } })
    act(() => result.current('e1'))
    expect(emit).not.toHaveBeenCalled()      // 压住
    act(() => rerender({ r: false }))         // 轮次结束
    expect(emit).toHaveBeenCalledWith('e1')
    expect(emit).toHaveBeenCalledTimes(1)     // 只补发一次,不重放
  })

  it('压住期间来第二条:两条都发,顺序不乱', () => {
    const emit = vi.fn()
    const { result, rerender } = renderHook(({ r }) => useSystemEventQueue(r, emit), { initialProps: { r: true } })
    act(() => { result.current('e1'); result.current('e2') })
    act(() => rerender({ r: false }))
    expect(emit.mock.calls.map(c => c[0])).toEqual(['e1', 'e2'])
  })

  it('轮次反复空闲不会重发已发过的', () => {
    const emit = vi.fn()
    const { result, rerender } = renderHook(({ r }) => useSystemEventQueue(r, emit), { initialProps: { r: true } })
    act(() => result.current('e1'))
    act(() => rerender({ r: false }))
    act(() => rerender({ r: true }))
    act(() => rerender({ r: false }))
    expect(emit).toHaveBeenCalledTimes(1)
  })
})

// ── 5. 卡片上报:一次,且只有本卡发起的绑定才报 ───────────────────────────
describe('ImConnectCard onBound 上报', () => {
  let emit: (e: GatewayEvent) => void = () => {}
  let gwState: GatewayState = 'running'
  const onBound = vi.fn()

  beforeEach(() => {
    onBound.mockReset()
    gwState = 'running'
    ;(window as unknown as { wraith: unknown }).wraith = {
      onGatewayEvent: (cb: (e: GatewayEvent) => void) => { emit = cb; return () => {} },
      gatewayBindWeixinStart: vi.fn(),
      gatewayBindStart: vi.fn(),
      gatewayBindCancel: vi.fn(),
      gatewayStatus: vi.fn(() => Promise.resolve({ state: gwState })),
      gatewayStart: vi.fn(),
      openExternal: vi.fn(),
    }
  })

  it('绑定成功后上报一次,带上平台与网关运行态', async () => {
    render(<ImConnectCard platform="weixin" workspace="/w" onOpenPanel={vi.fn()} onBound={onBound} />)
    fireEvent.click(screen.getByTestId('im-connect-start'))
    await act(async () => { emit({ kind: 'bind', phase: 'bound' }) })
    await act(async () => { await Promise.resolve() })
    expect(onBound).toHaveBeenCalledTimes(1)
    expect(onBound).toHaveBeenCalledWith('weixin', 'running')
  })

  // 真实的二次触发路径:本卡绑完后,用户又去 IM 面板发起一次绑定。startedRef 一旦为 true
  // 就永久接收全局 bind 事件,于是本卡会再走一遍 scanning→bound。没有闩锁就会二次补轮,
  // 用户平白多看一条「绑定成功」。(注:连发两条 bound 不构成二次触发——phase 没变,
  // effect 不重跑;早期版本的用例正是这么写的,拆掉闩锁也照样绿,是条恒真测试。)
  it('绑完后别处再绑一次:仍只上报一次', async () => {
    render(<ImConnectCard platform="weixin" workspace="/w" onOpenPanel={vi.fn()} onBound={onBound} />)
    fireEvent.click(screen.getByTestId('im-connect-start'))
    await act(async () => { emit({ kind: 'bind', phase: 'bound' }) })
    await act(async () => { await Promise.resolve() })
    await act(async () => { emit({ kind: 'bind', phase: 'scanning' }) })
    await act(async () => { emit({ kind: 'bind', phase: 'bound' }) })
    await act(async () => { await Promise.resolve() })
    expect(onBound).toHaveBeenCalledTimes(1)
  })

  // 会话恢复会重建这张卡:started=false → 全局 bind 事件被 startedRef 挡掉 → 不该上报。
  // 否则每次 resume 都会凭空补一轮「绑定成功」。
  it('未点击开始(如历史回放):收到 bound 也不上报', async () => {
    render(<ImConnectCard platform="weixin" workspace="/w" onOpenPanel={vi.fn()} onBound={onBound} />)
    await act(async () => { emit({ kind: 'bind', phase: 'bound' }) })
    await act(async () => { await Promise.resolve() })
    expect(onBound).not.toHaveBeenCalled()
  })

  it('绑定失败不上报', async () => {
    render(<ImConnectCard platform="weixin" workspace="/w" onOpenPanel={vi.fn()} onBound={onBound} />)
    fireEvent.click(screen.getByTestId('im-connect-start'))
    await act(async () => { emit({ kind: 'bind', phase: 'failed', message: '超时' }) })
    await act(async () => { await Promise.resolve() })
    expect(onBound).not.toHaveBeenCalled()
  })

  it('没传 onBound 也不炸(卡片在别处复用时可省略)', async () => {
    render(<ImConnectCard platform="weixin" workspace="/w" onOpenPanel={vi.fn()} />)
    fireEvent.click(screen.getByTestId('im-connect-start'))
    await act(async () => { emit({ kind: 'bind', phase: 'bound' }) })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('im-connect-done')).toBeTruthy()
  })
})
