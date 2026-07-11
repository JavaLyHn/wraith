// desktop/src/renderer/components/TerminalDrawer.tsx
import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import TerminalPane from './TerminalPane'

const MIN_H = 120

/** 底部终端抽屉:高度 dock 壳(顶边拖拽调高 + open 高度动画)+ 内嵌 TerminalPane。
 * 常驻挂载;open=false → 高度过渡到 0(丝滑收起,PTY 不丢);拖拽期关过渡。 */
export default function TerminalDrawer({ open, cwd, onClose }: { open: boolean; cwd: string | null; onClose: () => void }): JSX.Element {
  const [height, setHeight] = useState(() => Math.round(window.innerHeight * 0.38))
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  const onDragStart = (e: React.PointerEvent): void => {
    dragRef.current = { startY: e.clientY, startH: height }
    setDragging(true)
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
    setDragging(false)
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }

  return (
    <div data-testid="terminal-drawer"
      className={'flex flex-col overflow-hidden bg-surface '
        + (open ? 'border-t border-border ' : '')
        + (dragging ? '' : 'transition-[height] duration-300 ease-out')}
      style={{ height: open ? height : 0 }}>
      <div onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
        className="h-1.5 shrink-0 cursor-ns-resize hover:bg-accent/30" />
      <TerminalPane
        active={open}
        cwd={cwd}
        onAllClosed={onClose}
        rightSlot={
          <button data-testid="terminal-drawer-close" onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-surface/60" title="收起"><X className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        }
      />
    </div>
  )
}
