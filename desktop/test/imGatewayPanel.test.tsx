// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import ImGatewayPanel from '../src/renderer/components/ImGatewayPanel'
import type { GatewayConfigView } from '../src/shared/gateway'

afterEach(() => cleanup())

beforeEach(() => {
  const configByPlatform: Record<string, GatewayConfigView> = {
    qq: { bound: true } as GatewayConfigView,
    feishu: { bound: true } as GatewayConfigView,
    wecom: { bound: false } as GatewayConfigView,
    weixin: { bound: false } as GatewayConfigView,
  }
  ;(window as unknown as { wraith: unknown }).wraith = {
    gatewayGetConfig: vi.fn((platform?: string) =>
      Promise.resolve(configByPlatform[platform ?? 'qq'] ?? ({ bound: false } as GatewayConfigView))),
    gatewayStatus: vi.fn(() => Promise.resolve({ state: 'stopped' })),
    gatewayLogs: vi.fn(() => Promise.resolve({ lines: [] })),
    onGatewayEvent: vi.fn(() => () => {}),
    gatewayBindStart: vi.fn(),
    gatewayBindCancel: vi.fn(),
    gatewaySetSecret: vi.fn(),
    gatewayPickWorkspace: vi.fn(),
    gatewaySetWorkspace: vi.fn(),
    gatewayStart: vi.fn(),
    gatewayStop: vi.fn(),
    gatewaySetFeishuConfig: vi.fn(),
    gatewaySetWecomConfig: vi.fn(),
    gatewayBindWeixinStart: vi.fn(),
    gatewaySetWeixinConfig: vi.fn(),
    openExternal: vi.fn(),
  }
})

describe('ImGatewayPanel', () => {
  it('每个已配置平台各自显示「已配置」,与当前选中项无关', async () => {
    render(<ImGatewayPanel onBack={vi.fn()} />)
    // 等待挂载时的 refreshConfig() 落地(四个平台的 Promise.all)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    const qqCard = screen.getByTestId('im-platform-qq')
    const feishuCard = screen.getByTestId('im-platform-feishu')
    const wecomCard = screen.getByTestId('im-platform-wecom')

    expect(qqCard.textContent).toContain('已配置')
    expect(feishuCard.textContent).toContain('已配置')
    expect(wecomCard.textContent).toContain('可配置')
    expect(wecomCard.textContent).not.toContain('已配置')
  })
})
