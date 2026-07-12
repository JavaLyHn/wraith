// desktop/src/main/pty.ts
import { spawn as spawnPty, type IPty } from 'node-pty'
import { resolveShell } from './ptyHelpers'

export interface PtyCreateOpts { cwd?: string; cols?: number; rows?: number; theme?: 'light' | 'dark' }

/** 主进程 PTY 管理:开/写/resize/杀,数据与退出经构造回调转发给渲染。 */
export class PtyManager {
  private readonly ptys = new Map<string, IPty>()
  private seq = 0

  constructor(
    private readonly onData: (id: string, data: string) => void,
    private readonly onExit: (id: string, code: number) => void,
    private readonly env: NodeJS.ProcessEnv,
    private readonly homeDir: string,
  ) {}

  create(opts: PtyCreateOpts): { id: string } {
    const id = 'pty-' + (++this.seq)
    const shell = resolveShell(this.env, process.platform)
    const cwd = opts.cwd && opts.cwd.trim() ? opts.cwd : this.homeDir
    // 关掉 macOS Apple Terminal 的会话保存/恢复:dev 时从启动终端继承的
    // TERM_PROGRAM=Apple_Terminal 会让子 zsh source /etc/zshrc_Apple_Terminal,
    // 打印 "Restored session: <date>" 噪声。SHELL_SESSIONS_DISABLE=1 是官方 opt-out。
    const env = { ...this.env, SHELL_SESSIONS_DISABLE: '1', WRAITH_TERM_THEME: opts.theme ?? 'dark' } as { [key: string]: string }
    const p = spawnPty(shell, [], {
      // xterm-256color:与真终端一致、也是 xterm.js 模拟的类型。旧的 xterm-color 会让
      // JLine 等按受限 terminfo 发横线序列,xterm.js 认不出而显示成一排 q。
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd,
      env,
    })
    this.ptys.set(id, p)
    p.onData(d => this.onData(id, d))
    p.onExit(e => { this.ptys.delete(id); this.onExit(id, e.exitCode) })
    return { id }
  }

  write(id: string, data: string): void { this.ptys.get(id)?.write(data) }

  resize(id: string, cols: number, rows: number): void {
    const p = this.ptys.get(id)
    if (p) { try { p.resize(Math.max(1, cols), Math.max(1, rows)) } catch { /* pty 已退出 */ } }
  }

  kill(id: string): void {
    const p = this.ptys.get(id)
    if (p) { this.ptys.delete(id); try { p.kill() } catch { /* 已退出 */ } }
  }

  killAll(): void {
    for (const p of this.ptys.values()) { try { p.kill() } catch { /* 已退出 */ } }
    this.ptys.clear()
  }
}
