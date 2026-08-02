// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ImConnectCard from '../src/renderer/components/ImConnectCard'
import { consoleLink } from '../src/renderer/lib/imConsoleLinks'
import type { GatewayEvent } from '../src/shared/gateway'

afterEach(cleanup)

const openExternal = vi.fn()

beforeEach(() => {
  openExternal.mockReset()
  ;(window as unknown as { wraith: unknown }).wraith = {
    onGatewayEvent: (_cb: (e: GatewayEvent) => void) => () => {},
    gatewayStatus: vi.fn(() => Promise.resolve({ state: 'stopped' })),
    openExternal,
  }
})

/**
 * 飞书 / 企业微信**没有扫码这回事** —— 代码已核实:两个 provider 包里
 * qrcode/scan/扫码/二维码 关键词零命中。它们要的是开发者后台建应用后拿到的
 * App ID / App Secret / BotID / Secret。所以「也做成二维码」不存在,不是缺功能。
 *
 * 但此前卡片只有一句「需要在面板填写密钥」+ 一个开面板按钮 —— 用户的下一个问题
 * 必然是「去哪拿」,而面板里「飞书开放平台」「企业微信管理后台」又是**纯文字**,
 * 得自己去搜。这跟 QQ 那个「多跳一次」是同类缺口。
 */
describe('consoleLink', () => {
  it('飞书国内 → open.feishu.cn', () => {
    const l = consoleLink('feishu', 'feishu')
    expect(l.url).toBe('https://open.feishu.cn/app')
    expect(l.label).toContain('飞书')
  })

  it('**Lark 国际 → larksuite**,不能把国际号送去国内站(反之亦然)', () => {
    const l = consoleLink('feishu', 'lark')
    expect(l.url).toContain('larksuite.com')
    expect(l.label).toContain('Lark')
  })

  it('缺省区域按国内 —— 不给默认值会拼出 undefined 的链接', () => {
    expect(consoleLink('feishu').url).toBe('https://open.feishu.cn/app')
  })

  it('企微 → work.weixin.qq.com 管理后台', () => {
    expect(consoleLink('wecom').url).toContain('work.weixin.qq.com')
  })

  it('每条都说清「到了那儿要拿什么回来」,不是光给个网址', () => {
    expect(consoleLink('feishu').what).toContain('App ID')
    expect(consoleLink('feishu').what).toContain('长连接')
    expect(consoleLink('wecom').what).toContain('BotID')
    // 企微最容易搞混的就是这个:长连接的 Secret vs 回调模式的 Token/AESKey
    expect(consoleLink('wecom').what).toContain('长连接')
  })

  it('全是 https —— 凭证页面不该走明文', () => {
    for (const l of [consoleLink('feishu', 'feishu'), consoleLink('feishu', 'lark'), consoleLink('wecom')]) {
      expect(l.url.startsWith('https://')).toBe(true)
    }
  })
})

describe('飞书/企微 接入卡', () => {
  it('明说不用扫码 —— 免得用户一直等一个不会出现的二维码', () => {
    render(<ImConnectCard platform="feishu" onOpenPanel={vi.fn()} />)
    expect(screen.getByTestId('im-connect-card').textContent).toContain('不用扫码')
    expect(screen.queryByTestId('im-connect-qr')).toBeNull()
  })

  it('给直达后台的链接,不是让用户自己去搜', () => {
    render(<ImConnectCard platform="feishu" onOpenPanel={vi.fn()} />)
    fireEvent.click(screen.getByTestId('im-connect-console'))
    expect(openExternal).toHaveBeenCalledWith('https://open.feishu.cn/app')
  })

  it('企微同理', () => {
    render(<ImConnectCard platform="wecom" onOpenPanel={vi.fn()} />)
    fireEvent.click(screen.getByTestId('im-connect-console'))
    expect(openExternal.mock.calls[0]![0]).toContain('work.weixin.qq.com')
  })

  it('说清要拿什么回来', () => {
    render(<ImConnectCard platform="wecom" onOpenPanel={vi.fn()} />)
    expect(screen.getByTestId('im-connect-what').textContent).toContain('BotID')
  })

  it('开面板那条路仍在(填写还是得在面板里做)', () => {
    const onOpenPanel = vi.fn()
    render(<ImConnectCard platform="feishu" onOpenPanel={onOpenPanel} />)
    fireEvent.click(screen.getByTestId('im-connect-open-panel'))
    expect(onOpenPanel).toHaveBeenCalledWith('im-gateway')
  })
})
