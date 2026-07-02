import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import readline from 'readline'
import { JsonRpcClient } from '../shared/jsonRpcClient'
import { resolveBackendCommand, defaultJarPath } from './backend'
import { initialRunState, applyRunEvent, type RunState, type RunEvent } from './automationRunState'

const INIT_TIMEOUT_MS = 30_000

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
        this.dispatch({ type: 'notification', method, params: p })
        if (method === 'approval.requested') {
          this.cb.onApproval(String(p['approvalId']), p)
        }
        if (method === 'turn.completed' || method === 'turn.failed') {
          this.killChild() // 终态即回收子进程
        }
      })

      void (async () => {
        try {
          const to = setTimeout(() => { this.failEarly('initialize 超时'); }, INIT_TIMEOUT_MS)
          await client.request('initialize', { clientInfo: 'wraith-automation' })
          const started = await client.request('session.start', { workspaceDir: projectPath }) as { sessionId: string }
          clearTimeout(to)
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
    setTimeout(() => this.killChild(), 500) // 给 interrupt 半秒,随后强杀;exit 回调补 'stopped'
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
    try { this.child?.kill() } catch { /* 已死 */ }
    this.client?.rejectAll('automation run ended')
  }
}
