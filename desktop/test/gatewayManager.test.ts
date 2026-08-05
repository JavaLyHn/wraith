import path from 'node:path'
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
  JVM_UTF8_FLAGS,
} from '../src/main/gatewayManager'

describe('resolveGatewayCommand', () => {
  it('defaults to java -jar <jar> gateway', () => {
    expect(resolveGatewayCommand({}, '/j/wraith.jar')).toEqual({
      cmd: 'java',
      args: [...JVM_UTF8_FLAGS, '-jar', '/j/wraith.jar', 'gateway'],
    })
  })
  it('honors WRAITH_GATEWAY_CMD override', () => {
    expect(resolveGatewayCommand({ WRAITH_GATEWAY_CMD: 'foo gw' }, '/j.jar')).toEqual({
      cmd: 'foo',
      args: ['gw'],
    })
  })
  it('packaged → 捆绑 java + 捆绑 jar + gateway', () => {
    expect(resolveGatewayCommand({}, '/j/wraith.jar', { resourcesPath: '/R' }, 'darwin')).toEqual({
      cmd: path.join('/R', 'runtime', 'bin', 'java'),
      args: [...JVM_UTF8_FLAGS, '-jar', path.join('/R', 'wraith.jar'), 'gateway'],
    })
  })
  it('packaged + win32 → java.exe', () => {
    expect(resolveGatewayCommand({}, '/j/wraith.jar', { resourcesPath: '/R' }, 'win32').cmd)
      .toBe(path.join('/R', 'runtime', 'bin', 'java.exe'))
  })
  it('env 覆写最高优先(即使 packaged 也让位)', () => {
    expect(resolveGatewayCommand({ WRAITH_GATEWAY_CMD: 'bar x' }, '/j.jar', { resourcesPath: '/R' })).toEqual({
      cmd: 'bar',
      args: ['x'],
    })
  })

  // 真机(中文 Windows)上整片网关日志变成 `����Ŀ��΢��ɨ���ά��`:JVM 的 stdout 不是
  // 控制台时按平台默认编码(GBK)写,这边一律按 UTF-8 解码。日志读不了 = 后面任何故障
  // 都没法诊断,所以这几个 flag 是硬要求,不是「优化」。
  it('-D 编码 flag 必须在 -jar **之前** —— 排在后面会被当成程序参数,JVM 根本不认', () => {
    const { args } = resolveGatewayCommand({}, '/j/wraith.jar')
    for (const flag of JVM_UTF8_FLAGS) {
      expect(args.indexOf(flag)).toBeGreaterThanOrEqual(0)
      expect(args.indexOf(flag)).toBeLessThan(args.indexOf('-jar'))
    }
  })
  it('五个属性名一个都不能少 —— 覆盖 JDK 17 / 18 / 19+ 三代不同的属性名', () => {
    const { args } = resolveGatewayCommand({}, '/j/wraith.jar')
    expect(args).toContain('-Dfile.encoding=UTF-8')       // JDK 17 及以前的默认编码
    expect(args).toContain('-Dsun.stdout.encoding=UTF-8') // JDK 8–18 的名字
    expect(args).toContain('-Dstdout.encoding=UTF-8')     // JDK 19+ 扶正后的名字
  })
  it('覆写路径不塞 -D —— WRAITH_GATEWAY_CMD 是「整条命令由你说了算」的逃生口', () => {
    const { args } = resolveGatewayCommand({ WRAITH_GATEWAY_CMD: 'foo gw' }, '/j.jar')
    expect(args.some(a => a.startsWith('-D'))).toBe(false)
  })
})

describe('resolveBindCommand', () => {
  it('appends bind to the gateway command', () => {
    expect(resolveBindCommand({}, '/j/wraith.jar')).toEqual({
      cmd: 'java',
      args: [...JVM_UTF8_FLAGS, '-jar', '/j/wraith.jar', 'gateway', 'bind'],
    })
  })
  it('packaged → 捆绑 java + 捆绑 jar + gateway bind', () => {
    expect(resolveBindCommand({}, '/j/wraith.jar', { resourcesPath: '/R' }, 'darwin')).toEqual({
      cmd: path.join('/R', 'runtime', 'bin', 'java'),
      args: [...JVM_UTF8_FLAGS, '-jar', path.join('/R', 'wraith.jar'), 'gateway', 'bind'],
    })
  })
  // 二维码提示、「绑定成功」这些中文全是 bind 命令打的 —— 派生路径丢了 flag
  // 等于乱码只修好一半,而恰恰是绑定这一步最需要看清楚输出。
  it('bind / bind-weixin 都继承 UTF-8 flag（派生自同一个 resolve）', () => {
    for (const { args } of [
      resolveBindCommand({}, '/j/wraith.jar'),
      resolveBindWeixinCommand({}, '/j/wraith.jar', undefined, 'D:\\ws'),
    ]) {
      expect(args.slice(0, JVM_UTF8_FLAGS.length)).toEqual(JVM_UTF8_FLAGS)
    }
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
      args: [...JVM_UTF8_FLAGS, '-jar', '/j/wraith.jar', 'gateway', 'bind-weixin'],
    })
  })
  it('appends --workspace when provided', () => {
    expect(resolveBindWeixinCommand({}, '/j.jar', undefined, '/ws')).toEqual({
      cmd: 'java',
      args: [...JVM_UTF8_FLAGS, '-jar', '/j.jar', 'gateway', 'bind-weixin', '--workspace', '/ws'],
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
