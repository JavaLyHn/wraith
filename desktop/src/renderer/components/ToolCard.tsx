import type { ToolCard as ToolCardType } from '../../shared/transcriptReducer'

interface ToolCardProps {
  card: ToolCardType
}

export default function ToolCard({ card }: ToolCardProps): JSX.Element {
  const badgeClass = card.done
    ? card.ok === false
      ? 'bg-danger text-white'
      : 'bg-ok text-white'
    : 'bg-accent/15 text-accent'

  return (
    <div
      data-testid="tool-card"
      className="my-1.5 overflow-hidden rounded-xl border border-border bg-surface font-mono text-xs"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-1.5">
        <span className="font-semibold text-accent">{card.name}</span>
        <span className="flex-1 truncate text-fg-muted">{card.argsJson}</span>
        {card.done ? (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${badgeClass}`}>
            {card.ok === false ? `exit ${card.exitCode ?? 1}` : `exit ${card.exitCode ?? 0}`}
          </span>
        ) : (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${badgeClass}`}>running…</span>
        )}
      </div>
      <pre
        data-testid="tool-output"
        className="m-0 max-h-60 overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed text-fg-muted"
      >
        {card.output || ' '}
      </pre>
    </div>
  )
}
