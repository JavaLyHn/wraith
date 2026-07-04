import { describe, it, expect } from 'vitest'
import {
  resolveGatewayCommand,
  resolveBindCommand,
  parseConnectUrl,
  classifyBindLine,
  classifyGatewayStderr,
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
})

describe('resolveBindCommand', () => {
  it('appends bind to the gateway command', () => {
    expect(resolveBindCommand({}, '/j/wraith.jar')).toEqual({
      cmd: 'java',
      args: ['-jar', '/j/wraith.jar', 'gateway', 'bind'],
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
    expect(classifyGatewayStderr('[gateway] 未配置 gateway.qq；请先运行 wraith gateway bind')).toBe('未绑定——请先扫码绑定')
    expect(classifyGatewayStderr('[gateway] 无可用 LLM provider（缺 API key）')).toBe('缺可用 LLM provider(请先配置 provider)')
    expect(classifyGatewayStderr('普通日志行')).toBeNull()
  })
})
