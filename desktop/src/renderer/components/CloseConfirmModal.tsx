import { useCallback, useState } from 'react'
import { Moon, Power, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import { useEventListener } from '../lib/useEventListener'

interface CloseConfirmModalProps {
  onRespond: (mode: 'background' | 'quit', remember: boolean) => void
  onCancel: () => void
}

/**
 * 关闭主窗确认对话框。
 * 选项:挂后台 / 直接退出;可勾选「下次别问」(勾了就持久化为对应 mode)。
 * 取消(ESC/点遮罩/X):什么都不做,主窗继续运行。
 */
export default function CloseConfirmModal({ onRespond, onCancel }: CloseConfirmModalProps): JSX.Element {
  const [remember, setRemember] = useState(false)
  const [highlighted, setHighlighted] = useState<0 | 1>(0)

  const onKey = useCallback((e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => (h === 0 ? 1 : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const mode: 'background' | 'quit' = highlighted === 0 ? 'background' : 'quit'
      onRespond(mode, remember)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }, [highlighted, remember, onRespond, onCancel])
  useEventListener('keydown', onKey)

  const options: { key: 'background' | 'quit'; label: string; desc: string; Icon: typeof Moon }[] = [
    {
      key: 'background',
      label: '挂后台',
      desc: '隐藏到任务栏,后端任务继续运行',
      Icon: Moon,
    },
    {
      key: 'quit',
      label: '直接退出',
      desc: '结束所有任务并退出 Wraith',
      Icon: Power,
    },
  ]

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <div className="flex items-center justify-between">
          <div>
            <DialogTitle>关闭窗口</DialogTitle>
            <DialogDescription>选择关闭方式(可记住选择)</DialogDescription>
          </div>
          <button
            data-testid="close-confirm-x"
            aria-label="取消"
            onClick={onCancel}
            className="rounded-md p-1 text-fg-muted hover:bg-muted hover:text-fg"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="mt-2 flex flex-col gap-2">
          {options.map((opt, i) => (
            <button
              key={opt.key}
              data-testid={`close-confirm-${opt.key}`}
              onClick={() => onRespond(opt.key, remember)}
              className={`flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
                i === highlighted
                  ? 'border-accent bg-accent/10 ring-1 ring-accent'
                  : 'border-border hover:bg-muted'
              }`}
            >
              <opt.Icon className="h-4 w-4 shrink-0 text-fg-muted" strokeWidth={1.5} />
              <div className="flex-1">
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="mt-0.5 text-xs text-fg-muted">{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <label
          data-testid="close-confirm-remember"
          className="mt-3 flex cursor-pointer select-none items-center gap-2 text-xs text-fg-muted"
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
          />
          下次别问了(按这次的选择直接执行)
        </label>

        <div className="mt-2 text-right">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 text-sm text-fg-muted hover:text-fg"
          >
            取消
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
