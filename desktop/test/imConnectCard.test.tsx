// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import ImConnectCard from '../src/renderer/components/ImConnectCard'
import type { GatewayEvent, GatewayState } from '../src/shared/gateway'

afterEach(() => cleanup())

let emit: (e: GatewayEvent) => void = () => {}
const bindWeixin = vi.fn()
const bindQQ = vi.fn()
const gatewayStart = vi.fn()
let gwState: GatewayState = 'stopped'

beforeEach(() => {
  bindWeixin.mockReset(); bindQQ.mockReset(); gatewayStart.mockReset()
  gwState = 'stopped'
  ;(window as unknown as { wraith: unknown }).wraith = {
    onGatewayEvent: (cb: (e: GatewayEvent) => void) => { emit = cb; return () => {} },
    gatewayBindWeixinStart: bindWeixin,
    gatewayBindStart: bindQQ,
    gatewayBindCancel: vi.fn(),
    gatewayStatus: vi.fn(() => Promise.resolve({ state: gwState })),
    gatewayStart,
    openExternal: vi.fn(),
  }
})

/** 走完「点开始 → 扫码中 → 绑定成功」,并让 bound 后的 gatewayStatus() 落地。 */
async function bindWeixinToDone(): Promise<void> {
  render(<ImConnectCard platform="weixin" workspace="/w" onOpenPanel={vi.fn()} />)
  fireEvent.click(screen.getByTestId('im-connect-start'))
  act(() => emit({ kind: 'bind', phase: 'scanning', qr: 'data:image/png;base64,AAA' }))
  await act(async () => { emit({ kind: 'bind', phase: 'bound' }) })
  await act(async () => { await Promise.resolve() })
}

describe('ImConnectCard', () => {
  it('weixin:点击启动才调 bind IPC;收到 qr 事件后内联渲染二维码', () => {
    render(<ImConnectCard platform="weixin" workspace="/w" onOpenPanel={vi.fn()} />)
    expect(bindWeixin).not.toHaveBeenCalled()            // 挂载不启动
    fireEvent.click(screen.getByTestId('im-connect-start'))
    expect(bindWeixin).toHaveBeenCalledWith('/w')
    act(() => emit({ kind: 'bind', phase: 'scanning', qr: 'data:image/png;base64,AAA' }))
    expect(screen.getByTestId('im-connect-qr').getAttribute('src')).toContain('data:image/png')
  })
  it('qq:点击调 gatewayBindStart,不渲染内联二维码,显示浏览器提示', () => {
    render(<ImConnectCard platform="qq" onOpenPanel={vi.fn()} />)
    fireEvent.click(screen.getByTestId('im-connect-start'))
    expect(bindQQ).toHaveBeenCalled()
    act(() => emit({ kind: 'bind', phase: 'scanning' }))
    expect(screen.queryByTestId('im-connect-qr')).toBeNull()
    expect(screen.getByTestId('im-connect-card').textContent).toContain('浏览器')
  })
  it('feishu:不绑定,渲染「打开 IM 网关面板」按钮', () => {
    const onOpenPanel = vi.fn()
    render(<ImConnectCard platform="feishu" onOpenPanel={onOpenPanel} />)
    expect(screen.queryByTestId('im-connect-start')).toBeNull()
    fireEvent.click(screen.getByTestId('im-connect-open-panel'))
    expect(onOpenPanel).toHaveBeenCalledWith('im-gateway')
  })
  // ── 绑定成功后的收尾态 ────────────────────────────────────────────────
  // 老 bug:二维码块只看 `started && p === 'weixin'`,不看 phase,导致绑定成功后
  // 卡片同时挂着「请扫码」+「二维码生成中…」+「✅ 绑定成功」三条自相矛盾的信息。
  it('weixin 绑定成功:扫码区整块撤掉,不再留「请扫码 / 生成中」残影', async () => {
    await bindWeixinToDone()
    const card = screen.getByTestId('im-connect-card')
    expect(screen.queryByTestId('im-connect-qr')).toBeNull()
    expect(card.textContent).not.toContain('请用目标微信扫描二维码')
    expect(card.textContent).not.toContain('二维码生成中')
    expect(screen.queryByTestId('im-connect-cancel')).toBeNull()
  })

  it('weixin 绑定成功:明确告诉用户已配置好', async () => {
    await bindWeixinToDone()
    expect(screen.getByTestId('im-connect-done').textContent).toContain('已配置好')
  })

  // 绑定 ≠ 网关在跑(面板里 start/stop 是独立开关)。说「可以发消息了」必须先确认在跑,
  // 否则就是骗用户。
  it('网关未运行:不谎称可用,给出「启动网关」按钮且点击真发 gatewayStart', async () => {
    gwState = 'stopped'
    await bindWeixinToDone()
    const done = screen.getByTestId('im-connect-done')
    expect(done.textContent).not.toContain('现在可以直接在微信里给我发消息')
    expect(done.textContent).toContain('网关未运行')
    fireEvent.click(screen.getByTestId('im-connect-start-gateway'))
    expect(gatewayStart).toHaveBeenCalled()
  })

  it('网关运行中:才说可以直接在微信里发消息,且不给「启动网关」按钮', async () => {
    gwState = 'running'
    await bindWeixinToDone()
    expect(screen.getByTestId('im-connect-done').textContent).toContain('现在可以直接在微信里给我发消息')
    expect(screen.queryByTestId('im-connect-start-gateway')).toBeNull()
  })

  it('绑定成功后网关被启动:status 事件应实时更新文案', async () => {
    gwState = 'stopped'
    await bindWeixinToDone()
    expect(screen.getByTestId('im-connect-done').textContent).toContain('网关未运行')
    await act(async () => { emit({ kind: 'status', status: { state: 'running' } }) })
    expect(screen.getByTestId('im-connect-done').textContent).toContain('现在可以直接在微信里给我发消息')
  })

  it('qq 绑定成功:浏览器授权提示撤掉,换成已配置好', async () => {
    gwState = 'running'
    render(<ImConnectCard platform="qq" onOpenPanel={vi.fn()} />)
    fireEvent.click(screen.getByTestId('im-connect-start'))
    await act(async () => { emit({ kind: 'bind', phase: 'bound' }) })
    await act(async () => { await Promise.resolve() })
    const card = screen.getByTestId('im-connect-card')
    expect(card.textContent).not.toContain('已在系统浏览器打开')
    expect(screen.getByTestId('im-connect-done').textContent).toContain('QQ 已配置好')
  })

  it('绑定失败:同样撤掉扫码区,不误导用户继续扫', async () => {
    render(<ImConnectCard platform="weixin" workspace="/w" onOpenPanel={vi.fn()} />)
    fireEvent.click(screen.getByTestId('im-connect-start'))
    act(() => emit({ kind: 'bind', phase: 'scanning', qr: 'data:image/png;base64,AAA' }))
    await act(async () => { emit({ kind: 'bind', phase: 'failed', message: '超时' }) })
    expect(screen.queryByTestId('im-connect-qr')).toBeNull()
    expect(screen.queryByTestId('im-connect-done')).toBeNull()
    expect(screen.getByTestId('im-connect-card').textContent).not.toContain('请用目标微信扫描二维码')
    expect(screen.getByTestId('im-connect-status').textContent).toContain('超时')
  })

  it('weixin:未点击「开始」前收到全局 bind 事件应被忽略(不误显二维码/状态/取消)', () => {
    render(<ImConnectCard platform="weixin" workspace="/w" onOpenPanel={vi.fn()} />)
    act(() => emit({ kind: 'bind', phase: 'scanning', qr: 'data:image/png;base64,AAA' }))
    expect(screen.queryByTestId('im-connect-qr')).toBeNull()
    expect(screen.queryByTestId('im-connect-status')).toBeNull()
    expect(screen.queryByTestId('im-connect-cancel')).toBeNull()
  })
})
