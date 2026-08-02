// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import ImConnectCard from '../src/renderer/components/ImConnectCard'
import { parseQrPngMarker } from '../src/main/gatewayManager'
import type { GatewayEvent } from '../src/shared/gateway'

afterEach(cleanup)

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const QR = `data:image/png;base64,${PNG}`
const CONNECT_URL = 'https://q.qq.com/qqbot/openclaw/connect.html?task_id=t1&_wv=2&source=wraith'

let emit: (e: GatewayEvent) => void = () => {}
const openExternal = vi.fn()

beforeEach(() => {
  openExternal.mockReset()
  ;(window as unknown as { wraith: unknown }).wraith = {
    onGatewayEvent: (cb: (e: GatewayEvent) => void) => { emit = cb; return () => {} },
    gatewayBindWeixinStart: vi.fn(),
    gatewayBindStart: vi.fn(),
    gatewayBindCancel: vi.fn(),
    gatewayStatus: vi.fn(() => Promise.resolve({ state: 'stopped' })),
    gatewayStart: vi.fn(),
    openExternal,
  }
})

/** 点开始并推进到「扫码中」。 */
function startQq(extra: Partial<Extract<GatewayEvent, { kind: 'bind' }>> = {}): void {
  render(<ImConnectCard platform="qq" workspace="/w" onOpenPanel={vi.fn()} />)
  fireEvent.click(screen.getByTestId('im-connect-start'))
  act(() => emit({ kind: 'bind', phase: 'scanning', ...extra } as GatewayEvent))
}

/**
 * QQ 接入卡此前只有「打开 QQ 授权页」—— 必须跳浏览器,而微信那张卡早就能内联显示二维码。
 * 差别只在于:微信 iLink 返回二维码图片 URL,QQ 只返回一条 connect URL。
 * 但 URL 本身能编码成二维码,且仓库已有 zxing + TerminalQrRenderer(微信走的就是这条通道),
 * 所以 QQ 复用同一条,不引入新依赖也不新增协议。
 *
 * **诚实边界**:那条 URL 原本是给桌面浏览器打开的(QQ 页面再渲染真正的扫码图),
 * 直接扫它能否走通未经真机验证。所以两条路**并存** ——
 * 这组用例的重点就是钉住「并存」,防止有人日后把浏览器那条删掉。
 */
describe('QQ 内联二维码', () => {
  it('收到 qr 事件 → 内联渲染,不再只有一个跳浏览器的按钮', () => {
    startQq({ qr: QR })
    const img = screen.getByTestId('im-connect-qr') as HTMLImageElement
    expect(img.src).toContain('base64')
    expect(img.alt).toContain('QQ')
  })

  it('二维码还没到 → 给占位,不是一片空白', () => {
    startQq()
    expect(screen.queryByTestId('im-connect-qr')).toBeNull()
    expect(screen.getByText('二维码生成中…')).toBeTruthy()
  })

  it('**浏览器那条路必须还在** —— 扫不通时它是唯一出路', () => {
    startQq({ qr: QR, url: CONNECT_URL })
    fireEvent.click(screen.getByTestId('im-connect-open-url'))
    expect(openExternal).toHaveBeenCalledWith(CONNECT_URL)
  })

  it('明说扫不出也有救 —— 否则用户会以为扫不出就没戏了', () => {
    startQq({ qr: QR, url: CONNECT_URL })
    expect(screen.getByText(/扫不出也没关系/)).toBeTruthy()
  })

  it('微信那张卡不受影响', () => {
    render(<ImConnectCard platform="weixin" workspace="/w" onOpenPanel={vi.fn()} />)
    fireEvent.click(screen.getByTestId('im-connect-start'))
    act(() => emit({ kind: 'bind', phase: 'scanning', qr: QR }))
    expect((screen.getByTestId('im-connect-qr') as HTMLImageElement).alt).toContain('微信')
  })
})

describe('主进程解析 WRAITH_QR_PNG（QQ 与微信共用同一条通道）', () => {
  it('合法标记 → data URL', () => {
    expect(parseQrPngMarker(`WRAITH_QR_PNG ${PNG}`)).toBe(QR)
  })

  it('容忍标记前的日志前缀', () => {
    expect(parseQrPngMarker(`[gateway] WRAITH_QR_PNG ${PNG}`)).toContain('data:image/png;base64,')
  })

  it('非标记行 → null(普通日志不能被误当二维码)', () => {
    expect(parseQrPngMarker('请用手机 QQ 扫码完成绑定：')).toBeNull()
    expect(parseQrPngMarker(`  ${CONNECT_URL}`)).toBeNull()
  })

  it('载荷不像 base64 → null', () => {
    expect(parseQrPngMarker('WRAITH_QR_PNG 太短')).toBeNull()
    expect(parseQrPngMarker('WRAITH_QR_PNG ' + '!'.repeat(64))).toBeNull()
  })
})
