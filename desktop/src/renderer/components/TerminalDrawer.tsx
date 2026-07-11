// desktop/src/renderer/components/TerminalDrawer.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import TerminalTab from './TerminalTab'
import { addTab, closeTab, setActive, shortTabLabel, type TabsState } from '../lib/terminalTabs'

const MIN_H = 120

/** 底部终端抽屉:多标签,顶边拖拽调高,全标签常挂 CSS 显隐(切标签保留 PTY)。 */
export default function TerminalDrawer({ cwd, onClose }: { cwd: string | null; onClose: () => void }): JSX.Element {
  const [state, setState] = useState<TabsState>({ tabs: [], activeId: null })
  const [height, setHeight] = useState(() => Math.round(window.innerHeight * 0.38))
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  const addNew = useCallback(async () => {
    try {
      const { id } = await window.wraith.ptyCreate({ cwd: cwd ?? undefined })
      if (!id) return
      setState(s => addTab(s, { id, label: shortTabLabel(cwd ?? '', s.tabs.length) }))
    } catch { /* 创建失败:忽略,用户可重试 */ }
  }, [cwd])

  // 打开时若无标签,自动建一个
  useEffect(() => { if (state.tabs.length === 0) void addNew() /* eslint-disable-next-line */ }, [])

  const close = (id: string): void => {
    void window.wraith.ptyKill(id)
    setState(s => {
      const ns = closeTab(s, id)
      if (ns.tabs.length === 0) onClose()
      return ns
    })
  }

  // 顶边拖拽调高
  const onDragStart = (e: React.PointerEvent): void => {
    dragRef.current = { startY: e.clientY, startH: height }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    const next = Math.min(window.innerHeight * 0.8, Math.max(MIN_H, d.startH + (d.startY - e.clientY)))
    setHeight(next)
  }
  const onDragEnd = (e: React.PointerEvent): void => {
    dragRef.current = null
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }

  return (
    <div data-testid="terminal-drawer" className="flex flex-col border-t border-border bg-bg" style={{ height }}>
      {/* 拖拽手柄 */}
      <div onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}
        className="h-1.5 shrink-0 cursor-ns-resize hover:bg-accent/30" />
      {/* 标签栏 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        {state.tabs.map(t => (
          <div key={t.id}
            className={'flex items-center gap-1 rounded px-2 py-1 text-2xs ' +
              (t.id === state.activeId ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
            <button data-testid="terminal-tab" onClick={() => setState(s => setActive(s, t.id))} className="max-w-[120px] truncate">{t.label}</button>
            <button data-testid="terminal-tab-close" onClick={() => close(t.id)} className="text-fg-subtle hover:text-danger">×</button>
          </div>
        ))}
        <button data-testid="terminal-add" onClick={() => void addNew()} className="rounded p-1 text-fg-muted hover:bg-surface/60" title="新建终端"><Plus className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        <button data-testid="terminal-drawer-close" onClick={onClose} className="ml-auto rounded p-1 text-fg-muted hover:bg-surface/60" title="收起"><X className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
      </div>
      {/* 全标签常挂,CSS 显隐 */}
      <div className="relative min-h-0 flex-1 px-2 py-1">
        {state.tabs.map(t => (
          <div key={t.id} className={'absolute inset-0 px-2 py-1 ' + (t.id === state.activeId ? '' : 'hidden')}>
            <TerminalTab id={t.id} active={t.id === state.activeId} />
          </div>
        ))}
      </div>
    </div>
  )
}
