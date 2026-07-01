import type { ToolCard as ToolCardType } from '../../shared/transcriptReducer'

interface ToolCardProps {
  card: ToolCardType
}

export default function ToolCard({ card }: ToolCardProps): JSX.Element {
  const badgeColor = card.done
    ? card.ok === false
      ? '#c0392b'
      : '#27ae60'
    : '#3d8eff'

  return (
    <div
      data-testid="tool-card"
      style={{
        margin: '6px 0',
        border: '1px solid #2a2d35',
        borderRadius: '4px',
        background: '#0f1114',
        fontFamily: 'JetBrains Mono, Consolas, monospace',
        fontSize: '12px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '6px 10px',
          borderBottom: '1px solid #2a2d35',
        }}
      >
        <span style={{ color: '#3d8eff', fontWeight: 600 }}>{card.name}</span>
        <span
          style={{
            color: '#8090a0',
            flexGrow: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {card.argsJson}
        </span>
        {card.done && (
          <span
            style={{
              background: badgeColor,
              color: '#fff',
              borderRadius: '3px',
              padding: '1px 6px',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.03em',
              flexShrink: 0,
            }}
          >
            {card.ok === false
              ? `exit ${card.exitCode ?? 1}`
              : `exit ${card.exitCode ?? 0}`}
          </span>
        )}
        {!card.done && (
          <span
            style={{
              background: '#2a3040',
              color: '#3d8eff',
              borderRadius: '3px',
              padding: '1px 6px',
              fontSize: '11px',
              flexShrink: 0,
            }}
          >
            running…
          </span>
        )}
      </div>

      {/* Output */}
      <pre
        data-testid="tool-output"
        style={{
          margin: 0,
          padding: '8px 12px',
          color: '#7a8898',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: '12px',
          lineHeight: 1.5,
          maxHeight: '240px',
          overflowY: 'auto',
        }}
      >
        {card.output || ' '}
      </pre>
    </div>
  )
}
