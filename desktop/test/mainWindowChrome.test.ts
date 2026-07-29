import { describe, it, expect } from 'vitest'
import { mainWindowChrome } from '../src/main/mainWindowChrome'

describe('mainWindowChrome', () => {
  it('darwin 片段逐字段等价(锁定 mac 不变)', () => {
    expect(mainWindowChrome('darwin')).toEqual({
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 11 },
      vibrancy: 'fullscreen-ui',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    })
  })
  it('win32 → frame:false', () => {
    expect(mainWindowChrome('win32')).toEqual({ frame: false })
  })
  it('linux/其它 → 空对象', () => {
    expect(mainWindowChrome('linux')).toEqual({})
    expect(mainWindowChrome('freebsd' as NodeJS.Platform)).toEqual({})
  })
})
