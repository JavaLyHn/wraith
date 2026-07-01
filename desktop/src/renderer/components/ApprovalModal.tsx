interface ApprovalModalProps {
  approvalId: string
  toolName: string
  argsJson: string
  dangerLevel: string
  riskDescription: string
  onApprove: () => void
  onReject: () => void
}

export default function ApprovalModal({
  toolName,
  argsJson,
  dangerLevel,
  riskDescription,
  onApprove,
  onReject,
}: ApprovalModalProps): JSX.Element {
  const dangerColor =
    dangerLevel === 'HIGH' || dangerLevel === 'CRITICAL'
      ? '#c0392b'
      : dangerLevel === 'MEDIUM'
      ? '#e67e22'
      : '#3d8eff'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#13151a',
          border: '1px solid #2a2d35',
          borderRadius: '6px',
          padding: '24px 28px',
          maxWidth: '480px',
          width: '90vw',
          fontFamily: 'JetBrains Mono, Consolas, monospace',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: dangerColor, fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>
            ⚠ 审批请求
          </div>
          <div style={{ color: '#cdd6e0', fontSize: '14px', fontWeight: 600 }}>
            {toolName}
          </div>
        </div>

        <pre
          style={{
            background: '#0f1114',
            border: '1px solid #2a2d35',
            borderRadius: '4px',
            padding: '8px 12px',
            color: '#8090a0',
            fontSize: '12px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            marginBottom: '12px',
          }}
        >
          {argsJson}
        </pre>

        <div style={{ marginBottom: '20px' }}>
          <span
            style={{
              display: 'inline-block',
              background: dangerColor,
              color: '#fff',
              borderRadius: '3px',
              padding: '2px 8px',
              fontSize: '11px',
              fontWeight: 700,
              marginBottom: '8px',
            }}
          >
            {dangerLevel}
          </span>
          <div style={{ color: '#8090a0', fontSize: '12px', lineHeight: 1.6 }}>
            {riskDescription}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            data-testid="reject"
            onClick={onReject}
            style={{
              background: 'none',
              border: '1px solid #3a3d45',
              borderRadius: '4px',
              color: '#8090a0',
              padding: '6px 16px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '12px',
            }}
          >
            拒绝
          </button>
          <button
            data-testid="approve"
            onClick={onApprove}
            style={{
              background: '#1a2e1a',
              border: '1px solid #27ae60',
              borderRadius: '4px',
              color: '#27ae60',
              padding: '6px 16px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            允许
          </button>
        </div>
      </div>
    </div>
  )
}
