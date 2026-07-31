// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import ImConnectCard from '../src/renderer/components/ImConnectCard'
import type { GatewayEvent } from '../src/shared/gateway'

afterEach(() => cleanup())

let emit: (e: GatewayEvent) => void = () => {}
const bindWeixin = vi.fn()
const bindQQ = vi.fn()

beforeEach(() => {
  bindWeixin.mockReset(); bindQQ.mockReset()
  ;(window as unknown as { wraith: unknown }).wraith = {
    onGatewayEvent: (cb: (e: GatewayEvent) => void) => { emit = cb; return () => {} },
    gatewayBindWeixinStart: bindWeixin,
    gatewayBindStart: bindQQ,
    gatewayBindCancel: vi.fn(),
    openExternal: vi.fn(),
  }
})

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
  it('weixin:未点击「开始」前收到全局 bind 事件应被忽略(不误显二维码/状态/取消)', () => {
    render(<ImConnectCard platform="weixin" workspace="/w" onOpenPanel={vi.fn()} />)
    act(() => emit({ kind: 'bind', phase: 'scanning', qr: 'data:image/png;base64,AAA' }))
    expect(screen.queryByTestId('im-connect-qr')).toBeNull()
    expect(screen.queryByTestId('im-connect-status')).toBeNull()
    expect(screen.queryByTestId('im-connect-cancel')).toBeNull()
  })
})
