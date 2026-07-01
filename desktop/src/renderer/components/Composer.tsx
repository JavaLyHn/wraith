import { useCallback } from 'react'
import { Switch } from './ui/switch'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './ui/tooltip'
import { baseName } from '../lib/paths'

interface ComposerProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onInterrupt: () => void
  running: boolean
  approvalAuto: boolean
  onToggleApproval: (auto: boolean) => void
  model: string
  workspace: string
  onSwitchWorkspace: () => void
  /** 欢迎态用居中窄版，对话态用贴底宽版。 */
  centered?: boolean
}

export default function Composer({
  value,
  onChange,
  onSubmit,
  onInterrupt,
  running,
  approvalAuto,
  onToggleApproval,
  model,
  workspace,
  onSwitchWorkspace,
  centered = false,
}: ComposerProps): JSX.Element {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onSubmit()
      }
    },
    [onSubmit],
  )

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={
          'w-full rounded-2xl border border-border bg-surface shadow-sm ' +
          (centered ? 'max-w-2xl mx-auto' : '')
        }
      >
        {/* text row */}
        <textarea
          data-testid="input"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          placeholder="给 Wraith 一个目标… (Enter 发送, Shift+Enter 换行)"
          rows={centered ? 3 : 2}
          className="w-full resize-none bg-transparent px-4 pt-3 text-sm text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
        />

        {/* control row */}
        <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
          {/* attach — disabled placeholder */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid="attach"
                disabled
                aria-label="附件"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-subtle opacity-50"
              >
                +
              </button>
            </TooltipTrigger>
            <TooltipContent>附件在后续阶段</TooltipContent>
          </Tooltip>

          {/* model chip — read only */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default rounded-lg border border-border px-2 py-1 text-xs text-fg-muted">
                {model || '—'}
              </span>
            </TooltipTrigger>
            <TooltipContent>模型/强度切换在后续阶段</TooltipContent>
          </Tooltip>

          {/* workspace switch — functional */}
          <button
            data-testid="workspace-switch"
            onClick={onSwitchWorkspace}
            disabled={running}
            title="重选工作目录"
            className="max-w-[180px] truncate rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-50"
          >
            📁 {baseName(workspace)}
          </button>

          <div className="flex-1" />

          {/* approve-mode toggle — functional */}
          <label className="flex select-none items-center gap-1.5 text-xs text-fg-muted">
            替我审批
            <Switch
              data-testid="approval-toggle"
              checked={approvalAuto}
              onCheckedChange={onToggleApproval}
            />
          </label>

          {running && (
            <button
              data-testid="interrupt"
              onClick={onInterrupt}
              className="rounded-lg border border-danger px-3 py-1 text-xs text-danger hover:bg-danger/10"
            >
              中断
            </button>
          )}

          <button
            onClick={onSubmit}
            disabled={running || !value.trim()}
            className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </TooltipProvider>
  )
}
