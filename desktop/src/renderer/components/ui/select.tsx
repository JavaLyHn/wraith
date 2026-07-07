import { useState } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from './popover'

export interface SelectOption { value: string; label: string }

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  testId?: string
  className?: string
  contentClassName?: string
}

/** 当前 value 对应 option 的 label;无匹配返 null。 */
export function selectedLabel(options: SelectOption[], value: string): string | null {
  const hit = options.find(o => o.value === value)
  return hit ? hit.label : null
}

export default function Select({
  value, options, onChange, disabled = false,
  placeholder = '请选择', testId, className = '', contentClassName = '',
}: SelectProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const label = selectedLabel(options, value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          data-testid={testId}
          disabled={disabled}
          className={
            'flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-fg ' +
            'hover:border-accent disabled:cursor-not-allowed disabled:opacity-50 ' + className
          }
        >
          <span className={'min-w-0 flex-1 truncate text-left ' + (label ? '' : 'text-fg-subtle')}>
            {label ?? placeholder}
          </span>
          <span className="shrink-0 text-fg-subtle">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent role="listbox" className={'min-w-[8rem] ' + contentClassName}>
        {options.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-fg-subtle">无可选项</div>
        )}
        {options.map(o => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={active}
              data-value={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={
                'mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs ' +
                (active ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')
              }
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {active && <span className="ml-auto shrink-0">✓</span>}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
