import { describe, it, expect } from 'vitest'
import { wecomConfigPayload } from '../src/renderer/lib/wecomConfigPayload'

describe('wecomConfigPayload', () => {
  it('省略空白字段(空 secret 不下发,避免覆盖已存密钥)', () => {
    expect(wecomConfigPayload({ botId: ' bot1 ', secret: '', ownerUserid: '  ', workspace: '/w' }))
      .toEqual({ botId: 'bot1', workspace: '/w' })
  })
  it('全部非空则全带上(trim 后)', () => {
    expect(wecomConfigPayload({ botId: 'b', secret: 's', ownerUserid: 'u', workspace: '/w' }))
      .toEqual({ botId: 'b', secret: 's', ownerUserid: 'u', workspace: '/w' })
  })
  it('全空则空对象', () => {
    expect(wecomConfigPayload({ botId: '', secret: '', ownerUserid: '', workspace: '' })).toEqual({})
  })
})
