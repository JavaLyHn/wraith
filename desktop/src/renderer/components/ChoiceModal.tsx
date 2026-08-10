import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import type { ChoiceOption } from '../../shared/types'

interface ChoiceModalProps {
  title: string
  options: ChoiceOption[]
  allowCancel: boolean
  hint: string | null
  onRespond: (selectedIndex: number) => void
  onReject: () => void
}

export default function ChoiceModal({
  title,
  options,
  allowCancel,
  hint,
  onRespond,
  onReject,
}: ChoiceModalProps): JSX.Element {
  const [highlighted, setHighlighted] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted(h => (h + 1) % options.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted(h => (h - 1 + options.length) % options.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onRespond(highlighted)
      } else if (e.key === 'Escape' && allowCancel) {
        e.preventDefault()
        onReject()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [options.length, highlighted, allowCancel, onRespond, onReject])

  const defaultHint = allowCancel
    ? '↑↓ 选择  Enter 确认  ESC 取消  或点击'
    : '↑↓ 选择  Enter 确认  或点击'

  return (
    <Dialog open onOpenChange={(open) => { if (!open && allowCancel) onReject() }}>
      <DialogContent className="max-w-md" onPointerDownOutside={(e) => { if (!allowCancel) e.preventDefault() }}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{hint ?? defaultHint}</DialogDescription>
        <div className="flex flex-col gap-1 mt-2">
          {options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onRespond(i)}
              className={`text-left px-3 py-2 rounded-md border transition-colors ${
                i === highlighted
                  ? 'border-accent bg-accent/10 ring-1 ring-accent'
                  : 'border-border hover:bg-muted'
              }`}
            >
              <div className="font-medium">{opt.label}</div>
              {opt.description && (
                <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
              )}
            </button>
          ))}
        </div>
        {allowCancel && (
          <div className="flex justify-end mt-3">
            <button
              type="button"
              onClick={onReject}
              className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              取消
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
