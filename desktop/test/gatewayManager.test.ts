import { describe, it, expect } from 'vitest'
import {
  resolveGatewayCommand,
  resolveBindCommand,
  parseConnectUrl,
  classifyBindLine,
  classifyGatewayStderr,
  classifyGatewayStatusLine,
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
    expect(classifyGatewayStderr('[gateway] 未配置 gateway.qq；请先运行 wraith gateway bind')).toBe('未绑定——请先扫码绑定')
    expect(classifyGatewayStderr('[gateway] 无可用 LLM provider（缺 API key）')).toBe('缺可用 LLM provider(请先配置 provider)')
    expect(classifyGatewayStderr('普通日志行')).toBeNull()
  })
})

describe('classifyGatewayStatusLine', () => {
  it('maps each machine-readable status marker to a GatewayStatus', () => {
    expect(classifyGatewayStatusLine('WRAITH_GATEWAY_STATUS connecting')).toEqual({
      state: 'starting',
      message: '连接 QQ 中…',
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
})
