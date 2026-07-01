import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './ui/tooltip'
import { baseName } from '../lib/paths'

interface SidebarProps {
  workspace: string
}

const NAV: { key: string; label: string; hint: string }[] = [
  { key: 'search', label: '搜索', hint: '搜索在后续阶段' },
  { key: 'plugins', label: '插件', hint: '插件在 Phase D' },
  { key: 'automation', label: '自动化', hint: '自动化在 Phase D' },
  { key: 'projects', label: '项目', hint: '多项目在 Phase C' },
]

export default function Sidebar({ workspace }: SidebarProps): JSX.Element {
  return (
    <TooltipProvider delayDuration={200}>
      <aside
        data-testid="sidebar"
        className="sidebar-gradient flex h-full w-60 flex-col border-r border-border"
      >
        {/* brand */}
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="text-accent">✦</span>
          <span className="text-sm font-bold tracking-wide text-fg">WRAITH</span>
        </div>

        {/* new conversation — disabled placeholder */}
        <div className="px-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid="nav-new"
                disabled
                className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-left text-xs text-fg-muted opacity-60"
              >
                ＋ 新对话
              </button>
            </TooltipTrigger>
            <TooltipContent>多会话在 Phase B</TooltipContent>
          </Tooltip>
        </div>

        {/* nav — disabled placeholders */}
        <nav className="mt-3 flex flex-col gap-0.5 px-3">
          {NAV.map(n => (
            <Tooltip key={n.key}>
              <TooltipTrigger asChild>
                <button
                  data-testid={`nav-${n.key}`}
                  disabled
                  className="rounded-lg px-3 py-1.5 text-left text-xs text-fg-muted opacity-60"
                >
                  {n.label}
                </button>
              </TooltipTrigger>
              <TooltipContent>{n.hint}</TooltipContent>
            </Tooltip>
          ))}
        </nav>

        {/* conversations — static single entry */}
        <div className="mt-4 px-3 text-[10px] uppercase tracking-wider text-fg-subtle">对话</div>
        <div className="px-3">
          <div className="truncate rounded-lg bg-surface px-3 py-2 text-xs text-fg">当前会话</div>
        </div>

        <div className="flex-1" />

        {/* footer: workspace + settings */}
        <div className="border-t border-border px-3 py-3">
          <div className="mb-2 truncate text-[11px] text-fg-subtle" title={workspace || '默认工作目录'}>
            📁 {baseName(workspace)}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid="nav-settings"
                disabled
                className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-fg-muted opacity-60"
              >
                设置
              </button>
            </TooltipTrigger>
            <TooltipContent>设置在后续阶段</TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  )
}
