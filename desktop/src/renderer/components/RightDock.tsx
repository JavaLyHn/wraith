import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import BrowserPane from './BrowserPane'
import TerminalPane from './TerminalPane'
import ContextPanel from './ContextPanel'
import ArtifactPreview from './ArtifactPreview'
import { clampColumnWidth } from '../lib/rightDock'
import type { ContextObservability } from '../../shared/transcriptReducer'
import type { StatusData } from '../../shared/types'

export type RightDockPane = 'browser' | 'terminal' | 'context' | 'artifact'

/** 右侧停靠列:分段切换 浏览器|终端|上下文|预览,常挂四面板 CSS 显隐;左边缘拖拽调宽;open 宽度动画。pane 受控(由 App 上提)。 */
export default function RightDock({ open, cwd, pane, onPaneChange, onClose, context, status, onCompact, compactDisabled, artifact }: {
  open: boolean
  cwd: string | null
  pane: RightDockPane
  onPaneChange: (pane: RightDockPane) => void
  onClose: () => void
  context: ContextObservability
  status: StatusData | null
  onCompact: () => void
  compactDisabled: boolean
  artifact: { filePath: string; content: string } | null
}): JSX.Element {
  const [width, setWidth] = useState(() => clampColumnWidth(Math.round(window.innerWidth * 0.4), window.innerWidth))
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const onDragStart = (e: React.PointerEvent): void => {
    dragRef.current = { startX: e.clientX, startW: width }
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    // 左边缘:向左拖变宽
    setWidth(clampColumnWidth(d.startW + (d.startX - e.clientX), window.innerWidth))
  }
  const onDragEnd = (e: React.PointerEvent): void => {
    dragRef.current = null
    setDragging(false)
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }

  const seg = (id: RightDockPane, label: string): JSX.Element => (
    <button data-testid={`rightdock-seg-${id}`} onClick={() => onPaneChange(id)}
      className={'rounded-md px-2 py-0.5 text-2xs ' + (pane === id ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>{label}</button>
  )

  return (
    <div data-testid="right-dock"
      className={'flex shrink-0 flex-row overflow-hidden bg-surface '
        + (open ? 'border-l border-border ' : '')
        + (dragging ? '' : 'transition-[width] duration-300 ease-out')}
      style={{ width: open ? width : 0 }}>
      {/* 左边缘拖拽手柄 */}
      <div onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
        className="w-1.5 shrink-0 cursor-ew-resize hover:bg-accent/30" />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 分段切换 + 收起 */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
          {seg('browser', '浏览器')}
          {seg('terminal', '终端')}
          {seg('context', '上下文')}
          {seg('artifact', '预览')}
          <button data-testid="right-dock-close" onClick={onClose} className="ml-auto rounded p-1 text-fg-muted hover:bg-surface/60" title="收起"><X className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        </div>
        {/* 四面板常挂,CSS 显隐 */}
        <div className="relative min-h-0 flex-1">
          <div className={'absolute inset-0 flex flex-col ' + (pane === 'browser' ? '' : 'hidden')}>
            <BrowserPane active={open && pane === 'browser'} />
          </div>
          <div className={'absolute inset-0 flex flex-col ' + (pane === 'terminal' ? '' : 'hidden')}>
            <TerminalPane active={open && pane === 'terminal'} cwd={cwd} />
          </div>
          <div className={'absolute inset-0 flex flex-col ' + (pane === 'context' ? '' : 'hidden')}>
            <ContextPanel context={context} status={status} onCompact={onCompact} compactDisabled={compactDisabled} />
          </div>
          <div className={'absolute inset-0 flex flex-col ' + (pane === 'artifact' ? '' : 'hidden')}>
            {artifact
              ? <ArtifactPreview filePath={artifact.filePath} content={artifact.content} />
              : <div className="p-3 text-xs text-fg-subtle">点击产物文件在此预览完整内容。</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
