import { describe, it, expect } from 'vitest'
import {
  resolveGatewayCommand,
  resolveBindCommand,
  resolveBindWeixinCommand,
  parseConnectUrl,
  parseWeixinQrUrl,
  parseQrPngMarker,
  classifyBindLine,
  classifyGatewayStderr,
  classifyGatewayStatusLine,
  parseQqFlushedLine,
} from '../src/main/gatewayManager'

describe('resolveGatewayCommand', () => {
  it('defaults to java -jar <jar> gateway', () => {
    expect(resolveGatewayCommand({}, '/j/wraith.jar')).toEqual({
      cmd: 'java',
      args: ['-jar', '/j/wraith.jar', 'gateway'],
    })
  })
  it('honors WRAITH_GATEWAY_CMD override', () => {
    expect(resolveGatewayCommand({ WRAITH_GATEWAY_CMD: 'foo gw' }, '/j.jar')).toEqual({
      cmd: 'foo',
      args: ['gw'],
    })
  })
  it('packaged → 捆绑 java + 捆绑 jar + gateway', () => {
    expect(resolveGatewayCommand({}, '/j/wraith.jar', { resourcesPath: '/R' })).toEqual({
      cmd: '/R/runtime/bin/java',
      args: ['-jar', '/R/wraith.jar', 'gateway'],
    })
  })
  it('env 覆写最高优先(即使 packaged 也让位)', () => {
    expect(resolveGatewayCommand({ WRAITH_GATEWAY_CMD: 'bar x' }, '/j.jar', { resourcesPath: '/R' })).toEqual({
      cmd: 'bar',
      args: ['x'],
    })
  })
})

describe('resolveBindCommand', () => {
  it('appends bind to the gateway command', () => {
    expect(resolveBindCommand({}, '/j/wraith.jar')).toEqual({
      cmd: 'java',
      args: ['-jar', '/j/wraith.jar', 'gateway', 'bind'],
    })
  })
  it('packaged → 捆绑 java + 捆绑 jar + gateway bind', () => {
    expect(resolveBindCommand({}, '/j/wraith.jar', { resourcesPath: '/R' })).toEqual({
      cmd: '/R/runtime/bin/java',
      args: ['-jar', '/R/wraith.jar', 'gateway', 'bind'],
    })
  })
})

describe('parseConnectUrl', () => {
  it('extracts the openclaw connect URL from a stdout line', () => {
    const line = '  https://q.qq.com/qqbot/openclaw/connect.html?task_id=abc&_wv=2&source=wraith'
    expect(parseConnectUrl(line)).toBe(
      'https://q.qq.com/qqbot/openclaw/connect.html?task_id=abc&_wv=2&source=wraith'
    )
  })
  it('returns null for unrelated lines', () => {
    expect(parseConnectUrl('等待扫码授权...')).toBeNull()
  })
})

describe('classifyBindLine', () => {
  it('maps success / secret-invalid / failed / unrelated', () => {
    expect(classifyBindLine('✅ 绑定成功,已写入 ~/.wraith/config.json')).toBe('bound')
    expect(classifyBindLine('⚠ openclaw 返回的 secret 无法换取 access_token(可能已失效)。')).toBe('secret-invalid')
    expect(classifyBindLine('[gateway] 绑定超时(未在限定时间内完成扫码),请重试')).toBe('failed')
    expect(classifyBindLine('普通行')).toBeNull()
  })
})

describe('classifyGatewayStderr', () => {
  it('maps known startup errors to readable causes', () => {
    expect(classifyGatewayStderr('[gateway] 未配置任何 IM 平台;仅运行定时任务(cron)')).toBe('未配置任何 IM 平台——仅运行定时任务(cron)')
    expect(classifyGatewayStderr('[gateway] 无可用 LLM provider（缺 API key）')).toBe('缺可用 LLM provider(请先配置 provider)')
    expect(classifyGatewayStderr('普通日志行')).toBeNull()
  })
})

describe('classifyGatewayStatusLine', () => {
  it('maps each machine-readable status marker to a GatewayStatus', () => {
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS connecting')).toEqual({
      state: 'starting',
      message: '连接中…',
    })
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS connected')).toEqual({ state: 'running' })
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS disconnected')).toEqual({
      state: 'starting',
      message: '连接断开,重连中…',
    })
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS auth-failed')).toEqual({
      state: 'error',
      message: '认证失败——凭证可能失效,请检查机器人密钥',
    })
  })
  it('extracts the marker even if a log prefix precedes it', () => {
    expect(classifyGatewayStatusLine('2026-07-04 12:00 INFO WRAITH_GATEWAY_STATUS connected')).toEqual({
      state: 'running',
    })
  })
  it('returns null for unrelated lines and unknown states', () => {
    expect(classifyGatewayStatusLine('普通日志行')).toBeNull()
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS bogus')).toBeNull()
  })
  it('认飞书 running token → running', () => {
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS running')?.state).toBe('running')
  })
  it('认飞书 error token → error', () => {
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS error')?.state).toBe('error')
  })
  it('认飞书 starting token → starting', () => {
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS starting')?.state).toBe('starting')
  })
  it('认企微 subscribed token → running', () => {
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS subscribed')?.state).toBe('running')
  })
})

describe('resolveBindWeixinCommand', () => {
  it('appends bind-weixin to the gateway command', () => {
    expect(resolveBindWeixinCommand({}, '/j/wraith.jar')).toEqual({
      cmd: 'java',
      args: ['-jar', '/j/wraith.jar', 'gateway', 'bind-weixin'],
    })
  })
  it('appends --workspace when provided', () => {
    expect(resolveBindWeixinCommand({}, '/j.jar', undefined, '/ws')).toEqual({
      cmd: 'java',
      args: ['-jar', '/j.jar', 'gateway', 'bind-weixin', '--workspace', '/ws'],
    })
  })
})

describe('parseWeixinQrUrl', () => {
  it('extracts http(s) url after 打开链接 marker', () => {
    expect(parseWeixinQrUrl('扫码失败时可打开链接:https://x.y/qr?z=1')).toBe('https://x.y/qr?z=1')
  })
  it('rejects non-http content and unrelated lines', () => {
    expect(parseWeixinQrUrl('扫码失败时可打开链接:weixin://xyz')).toBeNull()
    expect(parseWeixinQrUrl('普通行')).toBeNull()
  })
})

describe('classifyBindLine — weixin 输出', () => {
  it('认微信绑定成功/二维码过期/超时', () => {
    expect(classifyBindLine('✅ 微信绑定成功,账号: acc1')).toBe('bound')
    expect(classifyBindLine('[gateway] 二维码已过期,请重试 wraith gateway bind-weixin')).toBe('failed')
    expect(classifyBindLine('[gateway] 绑定超时(未在限定时间内完成扫码),请重试')).toBe('failed')
  })
})

describe('parseQrPngMarker', () => {
  it('把 WRAITH_QR_PNG <base64> 转成 data URL', () => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    expect(parseQrPngMarker(`WRAITH_QR_PNG ${b64}`)).toBe(`data:image/png;base64,${b64}`)
  })
  it('容忍标记前的日志前缀', () => {
    const b64 = 'A'.repeat(48)
    expect(parseQrPngMarker(`2026-07-11 INFO WRAITH_QR_PNG ${b64}`)).toBe(`data:image/png;base64,${b64}`)
  })
  it('拒绝非 base64 内容 / 过短 / 无关行', () => {
    expect(parseQrPngMarker('WRAITH_QR_PNG not base64 !!!')).toBeNull()
    expect(parseQrPngMarker('WRAITH_QR_PNG short')).toBeNull()
    expect(parseQrPngMarker('普通日志行')).toBeNull()
  })
})

describe('parseQqFlushedLine', () => {
  it('合法标记 → 计数', () => {
    expect(parseQqFlushedLine('WRAITH_QQ_FLUSHED 3')).toBe(3)
    expect(parseQqFlushedLine('WRAITH_QQ_FLUSHED 1')).toBe(1)
  })
  it('容忍前缀(与 classifyGatewayStatusLine 一致)', () => {
    expect(parseQqFlushedLine('12:00:00 INFO WRAITH_QQ_FLUSHED 2')).toBe(2)
  })
  it('非标记行 → null', () => {
    expect(parseQqFlushedLine('some log line')).toBeNull()
    expect(parseQqFlushedLine('WRAITH_GATEWAY_STATUS connected')).toBeNull()
  })
  it('计数缺失/非数字 → null', () => {
    expect(parseQqFlushedLine('WRAITH_QQ_FLUSHED')).toBeNull()
    expect(parseQqFlushedLine('WRAITH_QQ_FLUSHED x')).toBeNull()
  })
})
