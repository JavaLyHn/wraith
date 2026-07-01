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
      style={{
        margin: '6px 0',
        border: '1px solid #2a2d35',
        borderRadius: '4px',
        background: '#141618',
        fontFamily: 'JetBrains Mono, Consolas, monospace',
        fontSize: '12px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 10px',
          cursor: 'pointer',
          userSelect: 'none',
          color: '#5a6070',
        }}
        onClick={() => setOpen(o => !o)}
      >
        <button
          data-testid="thinking-toggle"
          onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          style={{
            background: 'none',
            border: 'none',
            color: '#5a6070',
            cursor: 'pointer',
            padding: '0',
            fontSize: '10px',
            lineHeight: 1,
          }}
          aria-expanded={open}
          aria-label="Toggle thinking block"
        >
          {open ? '▼' : '▶'}
        </button>
        <span style={{ color: '#3d8eff', fontSize: '11px', letterSpacing: '0.04em' }}>
          {done ? '✓' : '⟳'} {label || '思考中'}
        </span>
        {!done && (
          <span style={{ color: '#5a6070', fontStyle: 'italic', fontSize: '11px' }}>
            思考中…
          </span>
        )}
      </div>
      {open && (
        <pre
          style={{
            margin: 0,
            padding: '8px 12px',
            borderTop: '1px solid #2a2d35',
            color: '#6a7080',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: '12px',
            lineHeight: 1.6,
          }}
        >
          {text}
        </pre>
      )}
    </div>
  )
}
