// desktop/src/main/pty.ts
import { spawn as spawnPty, type IPty } from 'node-pty'
import { resolveShell } from './ptyHelpers'

export interface PtyCreateOpts { cwd?: string; cols?: number; rows?: number }

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
    const p = spawnPty(shell, [], {
      name: 'xterm-color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd,
      env: this.env as { [key: string]: string },
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
