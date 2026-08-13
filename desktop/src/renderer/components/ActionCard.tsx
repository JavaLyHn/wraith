import type { HTMLAttributes } from 'react'
import { normalizePanel, PANEL_LABELS, type PanelId } from '../lib/panelActions'
import { cn } from '../lib/utils'

interface ActionCardProps extends HTMLAttributes<HTMLDivElement> {
  /** 后端 open_panel 工具传来的原始 panel id(可能是别名 mcp)。 */
  panel: string
  /** 打开面板(App.tsx 注入,内部 setView)。 */
  onOpenPanel: (id: PanelId) => void
}

/** 聊天内「打开某功能面板」动作卡。非法 panel 渲染 null(容错,不炸)。 */
export default function ActionCard({ panel, onOpenPanel, className: incomingClass, ...rest }: ActionCardProps): JSX.Element | null {
  const id = normalizePanel(panel)
  if (!id) return null
  return (
    <div className={cn(incomingClass, "self-start")} {...rest}>
      <button
        data-testid="action-card"
        onClick={() => onOpenPanel(id)}
        className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg hover:border-accent hover:text-accent transition-colors"
      >
        <span aria-hidden>🧭</span>
        <span>打开 {PANEL_LABELS[id]} 面板</span>
      </button>
    </div>
  )
}
