import { useState } from 'react'

interface ThinkingBlockProps {
  label: string
  text: string
  done: boolean
}

export default function ThinkingBlock({ label, text, done }: ThinkingBlockProps): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div
      data-testid="thinking"
      className="my-1.5 overflow-hidden rounded-xl border border-border bg-surface font-mono text-xs"
    >
      <div
        className="flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-fg-muted"
        onClick={() => setOpen(o => !o)}
      >
        <button
          data-testid="thinking-toggle"
          onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          aria-expanded={open}
          aria-label="Toggle thinking block"
          className="p-0 text-[10px] leading-none text-fg-subtle"
        >
          {open ? '▼' : '▶'}
        </button>
        <span className="text-[11px] tracking-wide text-accent">
          {done ? '✓' : '⟳'} {label || '思考中'}
        </span>
        {!done && <span className="text-[11px] italic text-fg-subtle">思考中…</span>}
      </div>
      {open && (
        <pre className="m-0 whitespace-pre-wrap break-words border-t border-border px-3 py-2 text-xs leading-relaxed text-fg-muted">
          {text}
        </pre>
      )}
    </div>
  )
}
