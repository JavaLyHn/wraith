import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import readline from 'readline'
import { JsonRpcClient } from '../shared/jsonRpcClient'
import { resolveBackendCommand, defaultJarPath } from './backend'
import { initialRunState, applyRunEvent, type RunState, type RunEvent } from './automationRunState'

const INIT_TIMEOUT_MS = 30_000
const SIGKILL_UPGRADE_MS = 2_000

export interface RunnerCallbacks {
  onUpdate(state: RunState): void                        // 每次状态变化(含摘要增量后的终态)
  onApproval(approvalId: string, payload: Record<string, unknown>): void
}

/** 一次自动化运行的独立后台 app-server 子进程(spec §5)。主会话链路零触碰。 */
export class AutomationRunner {
  private child: ChildProcessWithoutNullStreams | null = null
  private client: JsonRpcClient | null = null
  private state: RunState = initialRunState()
  private sessionId: string | null = null
  private turnId: string | null = null
  private stopping = false
  private settle: ((s: RunState) => void) | null = null
  private initTimer: NodeJS.Timeout | null = null   // I-1: 提为字段统一清理
  private sigkillTimer: NodeJS.Timeout | null = null // I-2: SIGKILL 升级 timer

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly homedir: string,
    private readonly cb: RunnerCallbacks,
  ) {}

  run(projectPath: string, prompt: string): Promise<RunState> {
    return new Promise<RunState>(resolve => {
      this.settle = resolve
      const { cmd, args } = resolveBackendCommand(this.env, defaultJarPath(this.homedir))
      const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams
      this.child = proc
      const client = new JsonRpcClient(line => {
        if (!proc.killed && proc.stdin.writable) proc.stdin.write(line + '\n')
      })
      this.client = client
      readline.createInterface({ input: proc.stdout }).on('line', l => client.handleLine(l))
      proc.stderr.on('data', (c: Buffer) => process.stderr.write(`[automation] ${c}`))
      proc.on('exit', () => this.dispatch({ type: this.stopping ? 'stopped' : 'child-exit' }))
      proc.on('error', () => this.dispatch({ type: 'child-exit' }))

      client.onNotification((method, params) => {
        const p = (params ?? {}) as Record<string, unknown>
        const prevState = this.state
        this.dispatch({ type: 'notification', method, params: p })
        // Minor-1: 仅当 dispatch 真正推进到 waiting_approval 时才调 onApproval
        if (
          method === 'approval.requested' &&
          this.state !== prevState &&
          this.state.phase === 'waiting_approval'
        ) {
          this.cb.onApproval(String(p['approvalId']), p)
        }
        if (method === 'turn.completed' || method === 'turn.failed') {
          this.killChild() // 终态即回收子进程
        }
      })

      void (async () => {
        try {
          // I-1: initTimer 提为字段,所有路径均可统一清理
          this.initTimer = setTimeout(() => { this.failEarly('initialize 超时'); }, INIT_TIMEOUT_MS)
          this.initTimer.unref() // I-1: 不 pin 事件循环
          await client.request('initialize', { clientInfo: 'wraith-automation' })
          const started = await client.request('session.start', { workspaceDir: projectPath }) as { sessionId: string }
          // 初始化成功:清理 timer
          if (this.initTimer !== null) { clearTimeout(this.initTimer); this.initTimer = null }
          this.sessionId = started.sessionId
          const turn = await client.request('turn.submit', { sessionId: started.sessionId, input: prompt }) as { turnId: string }
          this.turnId = turn.turnId
          this.dispatch({ type: 'turn-submitted' })
        } catch (err) {
          this.failEarly(String(err))
        }
      })()
    })
  }

  stop(): void {
    this.stopping = true
    const c = this.client
    if (c && this.sessionId && this.turnId) {
      void c.request('turn.interrupt', { sessionId: this.sessionId, turnId: this.turnId }).catch(() => { /* 尽力 */ })
    }
    // I-1: 500ms 宽限 timer 加 unref
    const gracefulTimer = setTimeout(() => this.killChild(), 500)
    gracefulTimer.unref()
  }

  respondApproval(approvalId: string, decision: string, opts: { modifiedArgs?: string; allowNetwork?: boolean } | null): void {
    const c = this.client
    if (!c) return
    void c.request('approval.respond', {
      approvalId, decision,
      ...(opts?.modifiedArgs ? { modifiedArgs: opts.modifiedArgs } : {}),
      ...(opts?.allowNetwork ? { allowNetwork: true } : {}),
    }).then(() => this.dispatch({ type: 'approval-responded' }))
      .catch(() => { /* 子进程已死:exit 回调兜底 */ })
  }

  private dispatch(e: RunEvent): void {
    const prev = this.state
    this.state = applyRunEvent(prev, e)
    if (this.state !== prev) {
      this.cb.onUpdate(this.state)
      const terminal = this.state.phase === 'success' || this.state.phase === 'failed' || this.state.phase === 'interrupted'
      if (terminal && this.settle) {
        const s = this.settle
        this.settle = null
        this.killChild()
        s(this.state)
      }
    }
  }

  private failEarly(msg: string): void {
    // spawn/initialize 阶段失败:走 turn.failed 语义进终态
    this.dispatch({ type: 'notification', method: 'turn.failed', params: { error: msg } })
    this.killChild()
  }

  private killChild(): void {
    // I-1: 统一清理 initTimer
    if (this.initTimer !== null) { clearTimeout(this.initTimer); this.initTimer = null }

    // I-2: 清理已存在的升级 timer(防止重入时重复 SIGKILL)
    if (this.sigkillTimer !== null) { clearTimeout(this.sigkillTimer); this.sigkillTimer = null }

    const child = this.child
    if (child !== null && child.exitCode === null && !child.killed) {
      // I-2: 先 SIGTERM,2s 后若仍存活则 SIGKILL
      try { child.kill('SIGTERM') } catch { /* 已死 */ }
      this.sigkillTimer = setTimeout(() => {
        this.sigkillTimer = null
        if (child.exitCode === null && !child.killed) {
          try { child.kill('SIGKILL') } catch { /* 已死 */ }
        }
      }, SIGKILL_UPGRADE_MS)
      this.sigkillTimer.unref() // I-1/I-2: 不 pin 事件循环
    }

    this.client?.rejectAll('automation run ended')
  }
}
