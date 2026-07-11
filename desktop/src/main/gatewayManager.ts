import path from 'path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import readline from 'readline'
import { defaultJarPath } from './backend'
import type { GatewayBindPhase, GatewayEvent, GatewayStatus } from '../shared/gateway'

// ─────────────────────────────────────────────────────────────────────────
// 纯函数(可单测,无副作用)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 常驻网关命令。默认 `java -jar ~/.wraith/wraith.jar gateway`;
 * 可用 WRAITH_GATEWAY_CMD 覆盖(空格分割,首 token 为 cmd)。
 * 优先级:WRAITH_GATEWAY_CMD 覆写 > packaged(捆绑 java+jar)> dev(系统 java + defaultJar)。
 */
export function resolveGatewayCommand(
  env: NodeJS.ProcessEnv,
  defaultJar: string,
  packaged?: { resourcesPath: string },
): { cmd: string; args: string[] } {
  const override = env['WRAITH_GATEWAY_CMD']
  if (override && override.trim().length > 0) {
    const tokens = override.trim().split(/\s+/)
    const [cmd, ...args] = tokens
    return { cmd: cmd!, args }
  }
  if (packaged) {
    return {
      cmd: path.join(packaged.resourcesPath, 'runtime', 'bin', 'java'),
      args: ['-jar', path.join(packaged.resourcesPath, 'wraith.jar'), 'gateway'],
    }
  }
  return { cmd: 'java', args: ['-jar', defaultJar, 'gateway'] }
}

/** 绑定命令 = 网关命令 + `bind`。 */
export function resolveBindCommand(
  env: NodeJS.ProcessEnv,
  defaultJar: string,
  packaged?: { resourcesPath: string },
): { cmd: string; args: string[] } {
  const g = resolveGatewayCommand(env, defaultJar, packaged)
  return { cmd: g.cmd, args: [...g.args, 'bind'] }
}

/** 从 bind stdout 行中抽取 openclaw 扫码 connect URL。 */
export function parseConnectUrl(line: string): string | null {
  const m = line.match(/https:\/\/q\.qq\.com\/qqbot\/openclaw\/connect\.html\?\S+/)
  return m ? m[0] : null
}

/** 微信绑定命令 = 网关命令 + `bind-weixin` [+ --workspace <dir>]。 */
export function resolveBindWeixinCommand(
  env: NodeJS.ProcessEnv,
  defaultJar: string,
  packaged?: { resourcesPath: string },
  workspace?: string,
): { cmd: string; args: string[] } {
  const g = resolveGatewayCommand(env, defaultJar, packaged)
  const args = [...g.args, 'bind-weixin']
  if (workspace && workspace.trim()) args.push('--workspace', workspace.trim())
  return { cmd: g.cmd, args }
}

/**
 * 解析 bind-weixin stdout 上的机读二维码标记 `WRAITH_QR_PNG <base64-png>`。
 * 命中且 base64 合法(仅 base64 字符、长度 ≥32)→ 返回可直接用于 <img src> 的 data URL;否则 null。
 * 用 indexOf 容忍标记前的日志前缀。
 */
export function parseQrPngMarker(line: string): string | null {
  const marker = 'WRAITH_QR_PNG'
  const idx = line.indexOf(marker)
  if (idx < 0) return null
  const b64 = line.slice(idx + marker.length).trim()
  if (b64.length < 32 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return null
  return `data:image/png;base64,${b64}`
}

/** 从 bind-weixin 输出行提取扫码兜底链接;仅 http(s) 才返回(防 openExternal 误开非 URL 内容)。 */
export function parseWeixinQrUrl(line: string): string | null {
  const marker = '扫码失败时可打开链接:'
  const idx = line.indexOf(marker)
  if (idx < 0) return null
  const url = line.slice(idx + marker.length).trim()
  return /^https?:\/\/\S+$/.test(url) ? url : null
}

/** 把 bind 输出行归类为绑定阶段(null = 无关行)。 */
export function classifyBindLine(line: string): GatewayBindPhase | null {
  if (line.includes('绑定成功')) return 'bound'
  if (line.includes('无法换取 access_token')) return 'secret-invalid'
  if (line.includes('绑定失败') || line.includes('绑定超时') || line.includes('已过期')) return 'failed'
  return null
}

/** 把网关 stderr 行归类为可读错误原因(null = 非已知错误)。 */
export function classifyGatewayStderr(line: string): string | null {
  if (line.includes('未配置任何 IM 平台')) return '未配置任何 IM 平台——仅运行定时任务(cron)'
  if (line.includes('无可用 LLM provider')) return '缺可用 LLM provider(请先配置 provider)'
  return null
}

/**
 * 解析 daemon stdout 上的机读连接状态标记(F-4):
 * `WRAITH_GATEWAY_STATUS <connecting|connected|disconnected|auth-failed>`。
 * 命中 → 映射为 GatewayStatus;非状态行 / 未知状态 → null。
 * 用正则容忍标记前有 logback 前缀。
 */
export function classifyGatewayStatusLine(line: string): GatewayStatus | null {
  const m = line.match(/WRAITH_GATEWAY_STATUS\s+(\S+)/)
  if (!m) return null
  switch (m[1]) {
    case 'connecting':
      return { state: 'starting', message: '连接中…' }
    case 'connected':
    case 'running':
    case 'subscribed':
      return { state: 'running' }
    case 'disconnected':
      return { state: 'starting', message: '连接断开,重连中…' }
    case 'auth-failed':
      return { state: 'error', message: '认证失败——凭证可能失效,请检查机器人密钥' }
    case 'starting':
      return { state: 'starting', message: '连接中…' }
    case 'error':
      return { state: 'error', message: '连接失败' }
    default:
      return null
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GatewayManager —— 常驻守护进程 + 一次性 bind 的进程管理
// ─────────────────────────────────────────────────────────────────────────

const SIGKILL_UPGRADE_MS = 2000
const MAX_LOG_LINES = 300

export class GatewayManager {
  private daemon: ChildProcessWithoutNullStreams | null = null
  private bindProc: ChildProcessWithoutNullStreams | null = null
  private status: GatewayStatus = { state: 'stopped' }
  private stopping = false
  private readonly logs: string[] = []

  constructor(
    private readonly onEvent: (evt: GatewayEvent) => void,
    private readonly env: NodeJS.ProcessEnv,
    private readonly jarPath: string,
    /** 注入 shell.openExternal 以便测试。 */
    private readonly openExternal: (url: string) => void,
    private readonly packaged?: { resourcesPath: string }
  ) {}

  static withDefaults(
    onEvent: (evt: GatewayEvent) => void,
    homedir: string,
    openExternal: (url: string) => void
  ): GatewayManager {
    return new GatewayManager(onEvent, process.env, defaultJarPath(homedir), openExternal)
  }

  getStatus(): GatewayStatus {
    return this.status
  }

  getLogs(): string[] {
    return [...this.logs]
  }

  private setStatus(s: GatewayStatus): void {
    this.status = s
    this.onEvent({ kind: 'status', status: s })
  }

  private pushLog(line: string): void {
    this.logs.push(line)
    if (this.logs.length > MAX_LOG_LINES) this.logs.shift()
  }

  /** 启动常驻网关。已在运行则忽略。 */
  start(): void {
    if (this.daemon) return
    this.stopping = false
    const { cmd, args } = resolveGatewayCommand(this.env, this.jarPath, this.packaged)
    this.setStatus({ state: 'starting' })

    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams
    } catch (e) {
      this.setStatus({ state: 'error', message: '启动失败: ' + (e as Error).message })
      return
    }
    this.daemon = proc

    // 进程起来 = starting(连接中);真·running 由 WS 的 connected 标记点亮(F-4)。
    proc.on('spawn', () => {
      if (this.daemon === proc) this.setStatus({ state: 'starting' })
    })

    let lastErr: string | null = null
    // stdout:先落日志,再看是否是机读连接状态标记 → 驱动状态灯。
    readline.createInterface({ input: proc.stdout }).on('line', (l) => {
      this.pushLog(l)
      const st = classifyGatewayStatusLine(l)
      if (st && this.daemon === proc && !this.stopping) {
        if (st.state === 'error' && st.message) lastErr = st.message // 让退出处理器沿用该文案
        this.setStatus(st)
      }
    })
    readline.createInterface({ input: proc.stderr }).on('line', (l) => {
      this.pushLog(l)
      const known = classifyGatewayStderr(l)
      if (known) lastErr = known
    })

    proc.on('exit', (code, signal) => {
      if (this.daemon !== proc) return
      this.daemon = null
      if (this.stopping) {
        this.setStatus({ state: 'stopped' })
      } else {
        const msg = lastErr ?? (signal ? `进程被信号 ${signal} 终止` : `进程退出(code=${code})——凭证可能失效,请检查密钥或日志`)
        this.setStatus({ state: 'error', message: msg })
      }
    })
  }

  /** 停止常驻网关(SIGTERM → 2s 后 SIGKILL)。 */
  stop(): void {
    this.stopping = true
    killGracefully(this.daemon)
    // exit 事件里再置 stopped;若进程已不在:
    if (!this.daemon) this.setStatus({ state: 'stopped' })
  }

  restart(): void {
    this.stop()
    // 稍等其退出后再起(exit 里已置 stopped);简单起见延迟一拍。
    setTimeout(() => this.start(), 300).unref?.()
  }

  /** 一次性扫码绑定。spawn `... gateway bind`,解析 connect URL 打开浏览器,按输出报进度。 */
  bindStart(): void {
    if (this.bindProc) return
    const { cmd, args } = resolveBindCommand(this.env, this.jarPath, this.packaged)

    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams
    } catch (e) {
      this.onEvent({ kind: 'bind', phase: 'failed', message: '启动绑定失败: ' + (e as Error).message })
      return
    }
    this.bindProc = proc

    let resolvedPhase: GatewayBindPhase | null = null
    let cancelled = false

    const handleLine = (l: string): void => {
      this.pushLog(l)
      const url = parseConnectUrl(l)
      if (url) {
        this.openExternal(url)
        this.onEvent({ kind: 'bind', phase: 'scanning' })
      }
      const phase = classifyBindLine(l)
      if (phase) resolvedPhase = phase
    }
    readline.createInterface({ input: proc.stdout }).on('line', handleLine)
    readline.createInterface({ input: proc.stderr }).on('line', handleLine)

    const markCancelled = (): void => {
      cancelled = true
    }
    this.cancelBindImpl = markCancelled

    proc.on('exit', (code) => {
      if (this.bindProc !== proc) return
      this.bindProc = null
      this.cancelBindImpl = null
      if (cancelled) {
        this.onEvent({ kind: 'bind', phase: 'cancelled' })
      } else if (resolvedPhase === 'bound') {
        this.onEvent({ kind: 'bind', phase: 'bound' })
      } else if (resolvedPhase === 'secret-invalid') {
        this.onEvent({
          kind: 'bind',
          phase: 'secret-invalid',
          message: 'openclaw 返回的密钥无法换取 token,请到 q.qq.com 后台复制机器人密钥手填'
        })
      } else {
        this.onEvent({
          kind: 'bind',
          phase: 'failed',
          message: resolvedPhase === 'failed' ? '绑定失败或超时,请重试' : `绑定进程退出(code=${code})`
        })
      }
    })
  }

  /** 一次性微信扫码绑定。spawn `... gateway bind-weixin`;二维码在输出(日志区可见),http 链接兜底打开。 */
  bindWeixinStart(workspace?: string): void {
    if (this.bindProc) return
    const { cmd, args } = resolveBindWeixinCommand(this.env, this.jarPath, this.packaged, workspace)

    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams
    } catch (e) {
      this.onEvent({ kind: 'bind', phase: 'failed', message: '启动微信绑定失败: ' + (e as Error).message })
      return
    }
    this.bindProc = proc

    let resolvedPhase: GatewayBindPhase | null = null
    let cancelled = false

    const handleLine = (l: string): void => {
      const qr = parseQrPngMarker(l)
      if (qr) {
        // 机读二维码标记:转成图片事件,且不落日志(base64 太长会刷屏日志区)
        this.onEvent({ kind: 'bind', phase: 'scanning', qr })
        return
      }
      this.pushLog(l)
      if (l.includes('请用目标微信扫描二维码')) {
        this.onEvent({ kind: 'bind', phase: 'scanning' })
      }
      const url = parseWeixinQrUrl(l)
      if (url) this.openExternal(url)
      const phase = classifyBindLine(l)
      if (phase) resolvedPhase = phase
    }
    readline.createInterface({ input: proc.stdout }).on('line', handleLine)
    readline.createInterface({ input: proc.stderr }).on('line', handleLine)

    this.cancelBindImpl = () => { cancelled = true }

    proc.on('exit', (code) => {
      if (this.bindProc !== proc) return
      this.bindProc = null
      this.cancelBindImpl = null
      if (cancelled) {
        this.onEvent({ kind: 'bind', phase: 'cancelled' })
      } else if (resolvedPhase === 'bound') {
        this.onEvent({ kind: 'bind', phase: 'bound' })
      } else {
        this.onEvent({
          kind: 'bind',
          phase: 'failed',
          message: resolvedPhase === 'failed' ? '绑定失败/超时/二维码过期,请重试' : `绑定进程退出(code=${code})`
        })
      }
    })
  }

  private cancelBindImpl: (() => void) | null = null

  cancelBind(): void {
    this.cancelBindImpl?.()
    killGracefully(this.bindProc)
  }

  /** app 退出时清理两个子进程。 */
  dispose(): void {
    this.stopping = true
    killGracefully(this.daemon)
    killGracefully(this.bindProc)
  }
}

function killGracefully(child: ChildProcessWithoutNullStreams | null): void {
  if (!child) return
  const alive = child.exitCode === null && child.signalCode === null
  if (!alive) return
  try {
    child.kill('SIGTERM')
  } catch {
    /* already dead */
  }
  const t = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already dead */
      }
    }
  }, SIGKILL_UPGRADE_MS)
  t.unref?.()
}
