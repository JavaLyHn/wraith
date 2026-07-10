import { describe, it, expect } from 'vitest'
import { feishuConfigPayload } from '../src/renderer/lib/feishuConfigPayload'

describe('feishuConfigPayload', () => {
  it('省略空白字段(空 appSecret 不下发,避免覆盖已存密钥)', () => {
    const p = feishuConfigPayload({ appId: 'cli_x', appSecret: '', ownerOpenid: '', region: 'feishu', workspace: '' })
    expect(p).toEqual({ appId: 'cli_x', region: 'feishu' })
    expect('appSecret' in p).toBe(false)
    expect('ownerOpenid' in p).toBe(false)
    expect('workspace' in p).toBe(false)
  })

  it('全填则全带', () => {
    const p = feishuConfigPayload({ appId: 'cli_x', appSecret: 'sec', ownerOpenid: 'ou_o', region: 'lark', workspace: '/w' })
    expect(p).toEqual({ appId: 'cli_x', appSecret: 'sec', ownerOpenid: 'ou_o', region: 'lark', workspace: '/w' })
  })

  it('trim 后为空视为空', () => {
    const p = feishuConfigPayload({ appId: '  ', appSecret: '  ', ownerOpenid: 'ou_o', region: 'feishu', workspace: '' })
    expect(p).toEqual({ ownerOpenid: 'ou_o', region: 'feishu' })
  })
})
