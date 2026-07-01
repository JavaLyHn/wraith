interface DisconnectedBannerProps {
  onRestart: () => void
}

export default function DisconnectedBanner({ onRestart }: DisconnectedBannerProps): JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        background: '#1a0e0e',
        borderBottom: '1px solid #5a1a1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        zIndex: 900,
        fontFamily: 'JetBrains Mono, Consolas, monospace',
        fontSize: '12px',
      }}
    >
      <span style={{ color: '#c0392b' }}>
        ⚡ 后端连接断开
      </span>
      <button
        data-testid="restart"
        onClick={onRestart}
        style={{
          background: 'none',
          border: '1px solid #c0392b',
          borderRadius: '4px',
          color: '#c0392b',
          padding: '4px 12px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: '12px',
        }}
      >
        重新连接
      </button>
    </div>
  )
}
