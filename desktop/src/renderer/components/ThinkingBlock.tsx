import { useState } from 'react'

interface ThinkingBlockProps {
  label: string
  text: string
  done: boolean
}

export default function ThinkingBlock({ label, text, done }: ThinkingBlockProps): JSX.Element {
  // 手动开合优先;未手动时流式中展开(实时看思考)、完成后自动折叠
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? !done
  const toggle = (): void => setManual(!open)

  return (
    <div
      data-testid="thinking"
      className="my-1.5 overflow-hidden rounded-xl border border-border bg-surface font-mono text-xs"
    >
      <div
        className="flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-fg-muted"
        onClick={toggle}
        title={label || undefined}
      >
        <button
          data-testid="thinking-toggle"
          onClick={e => { e.stopPropagation(); toggle() }}
          aria-expanded={open}
          aria-label="Toggle thinking block"
          className="p-0 text-[10px] leading-none text-fg-subtle"
        >
          {open ? '▼' : '▶'}
        </button>
        <span className="text-[11px] tracking-wide text-accent">
          {done ? '✓ 思考过程' : '⟳ 思考中…'}
        </span>
      </div>
      {open && (
        <pre className="m-0 whitespace-pre-wrap break-words border-t border-border px-3 py-2 text-xs leading-relaxed text-fg-muted">
          {text}
        </pre>
      )}
    </div>
  )
}
