// desktop/src/renderer/components/TerminalTab.tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/** 单个终端标签:挂 xterm,绑定到已存在的 pty id(由 Drawer 创建)。切标签用 active 控制显隐 + 重算尺寸。 */
export default function TerminalTab({ id, active }: { id: string; active: boolean }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // 主题感知:从 CSS 变量取色,浅/深随 app [data-theme] 自动匹配(CLI 侧配色经 WRAITH_TERM_THEME 同步)
    const cs = getComputedStyle(document.documentElement)
    const cssv = (name: string, fb: string): string => cs.getPropertyValue(name).trim() || fb
    const term = new Terminal({
      fontSize: 13, fontFamily: 'Menlo, Monaco, monospace', cursorBlink: true,
      theme: {
        background: cssv('--bg-elevated', '#ffffff'),
        foreground: cssv('--fg', '#1c2430'),
        cursor: cssv('--accent', '#0ea5b7'),
        cursorAccent: cssv('--bg-elevated', '#ffffff'),
        selectionBackground: 'rgba(14,165,183,0.22)',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try { fit.fit() } catch { /* 隐藏态 0 尺寸 */ }
    termRef.current = term; fitRef.current = fit
    void window.wraith.ptyResize(id, term.cols, term.rows)

    const offData = window.wraith.onPtyData(({ id: pid, data }) => { if (pid === id) term.write(data) })
    const offExit = window.wraith.onPtyExit(({ id: pid }) => { if (pid === id) term.write('\r\n\x1b[90m[进程已退出]\x1b[0m\r\n') })
    const dataSub = term.onData(d => { void window.wraith.ptyInput(id, d) })
    const ro = new ResizeObserver(() => {
      try { fit.fit(); void window.wraith.ptyResize(id, term.cols, term.rows) } catch { /* ignore */ }
    })
    ro.observe(host)

    return () => { offData(); offExit(); dataSub.dispose(); ro.disconnect(); term.dispose() }
  }, [id])

  // 从隐藏切回可见:容器恢复尺寸后重算 fit
  useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        const t = termRef.current
        if (t) { void window.wraith.ptyResize(id, t.cols, t.rows); t.focus() }
      } catch { /* ignore */ }
    })
    return () => cancelAnimationFrame(raf)
  }, [active, id])

  return <div ref={hostRef} className={'h-full w-full ' + (active ? '' : 'hidden')} />
}
