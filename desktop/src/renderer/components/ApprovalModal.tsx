import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'

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
  const dangerText =
    dangerLevel.includes('高危') ? 'text-danger'
    : dangerLevel.includes('中危') ? 'text-warn'
    : 'text-accent'
  const dangerBg =
    dangerLevel.includes('高危') ? 'bg-danger'
    : dangerLevel.includes('中危') ? 'bg-warn'
    : 'bg-accent'

  return (
    <Dialog open>
      <DialogContent>
        <div className="mb-4">
          <DialogTitle className={dangerText}>⚠ 审批请求</DialogTitle>
          <div className="mt-1 text-sm font-semibold text-fg">{toolName}</div>
        </div>

        <pre className="mb-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-black/[0.03] px-3 py-2 font-mono text-xs text-fg-muted">
          {argsJson}
        </pre>

        <div className="mb-5">
          <span className={`mb-2 inline-block rounded px-2 py-0.5 text-[11px] font-bold text-white ${dangerBg}`}>
            {dangerLevel}
          </span>
          <DialogDescription className="leading-relaxed">{riskDescription}</DialogDescription>
        </div>

        <div className="flex justify-end gap-2.5">
          <button
            data-testid="reject"
            onClick={onReject}
            className="rounded-lg border border-border px-4 py-1.5 text-xs text-fg-muted hover:bg-black/[0.03]"
          >
            拒绝
          </button>
          <button
            data-testid="approve"
            onClick={onApprove}
            className="rounded-lg bg-ok px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            允许
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
