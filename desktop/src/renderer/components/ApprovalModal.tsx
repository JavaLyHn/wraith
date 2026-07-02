// desktop/src/renderer/components/ApprovalModal.tsx
import { useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { Switch } from './ui/switch'
import DiffView from './DiffView'
import {
  buildApprovalResponse,
  validateArgsJson,
  type ApprovalResponsePayload,
} from '../../shared/buildApprovalResponse'

interface ApprovalModalProps {
  approvalId: string
  toolName: string
  argsJson: string
  dangerLevel: string
  riskDescription: string
  suggestion: string
  beforeContent: string | null
  onRespond: (payload: ApprovalResponsePayload) => void
  onReject: () => void
}

export default function ApprovalModal({
  toolName,
  argsJson,
  dangerLevel,
  riskDescription,
  suggestion,
  beforeContent,
  onRespond,
  onReject,
}: ApprovalModalProps): JSX.Element {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(argsJson) as Record<string, unknown>
    } catch {
      return null
    }
  }, [argsJson])

  const isCommand = toolName === 'execute_command'
  const isWrite = toolName === 'write_file'
  const originalCommand = isCommand && typeof parsed?.['command'] === 'string' ? (parsed['command'] as string) : ''
  const writeContent = isWrite && typeof parsed?.['content'] === 'string' ? (parsed['content'] as string) : ''
  const writePath = isWrite && typeof parsed?.['path'] === 'string' ? (parsed['path'] as string) : ''

  const [editedCommand, setEditedCommand] = useState<string | null>(null)
  const [allowNetwork, setAllowNetwork] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [editedJson, setEditedJson] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const jsonError = editedJson !== null ? validateArgsJson(editedJson) : null
  const modified =
    (isCommand && editedCommand !== null && editedCommand !== originalCommand) ||
    (!isCommand && editedJson !== null && jsonError === null && editedJson !== argsJson)

  const dangerText =
    dangerLevel.includes('高危') ? 'text-danger'
    : dangerLevel.includes('中危') ? 'text-warn'
    : 'text-accent'
  const dangerBg =
    dangerLevel.includes('高危') ? 'bg-danger'
    : dangerLevel.includes('中危') ? 'bg-warn'
    : 'bg-accent'

  const respond = (sessionAllowTool: boolean): void => {
    if (submitting) return
    setSubmitting(true)
    onRespond(
      buildApprovalResponse({
        toolName,
        originalArgsJson: argsJson,
        editedCommand: isCommand ? editedCommand : null,
        editedArgsJson: !isCommand && !isWrite ? editedJson : null,
        allowNetwork: isCommand && allowNetwork,
        sessionAllowTool,
      }),
    )
  }

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <div className="mb-3">
          <DialogTitle className={dangerText}>⚠ 审批请求</DialogTitle>
          <div className="mt-1 text-sm font-semibold text-fg">{toolName}</div>
        </div>

        {/* 主体:按工具分派 */}
        {isCommand ? (
          <div className="mb-3">
            <label className="mb-1 block text-[11px] text-fg-subtle">命令(可编辑)</label>
            <input
              data-testid="command-edit"
              value={editedCommand ?? originalCommand}
              onChange={e => setEditedCommand(e.target.value)}
              className="w-full rounded-lg border border-border bg-black/[0.03] px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent"
            />
            <label className="mt-2 flex select-none items-center gap-1.5 text-xs text-fg-muted">
              本次放行网络
              <Switch data-testid="allow-network" checked={allowNetwork} onCheckedChange={setAllowNetwork} />
              <span className="text-[11px] text-fg-subtle">(仅本条命令,其余沙箱限制不变)</span>
            </label>
          </div>
        ) : isWrite ? (
          <div className="mb-3">
            <div className="mb-1 font-mono text-[11px] text-fg-subtle" title={writePath}>
              {writePath}{beforeContent === null ? ' — 新文件(或无预览:文件过大/不可读)' : ''}
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              <DiffView filePath={writePath} before={beforeContent ?? ''} after={writeContent} />
            </div>
          </div>
        ) : (
          <div className="mb-3">
            {!jsonOpen && (
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-black/[0.03] px-3 py-2 font-mono text-xs text-fg-muted">
                {argsJson}
              </pre>
            )}
            {jsonOpen ? (
              <>
                <textarea
                  data-testid="json-edit"
                  value={editedJson ?? argsJson}
                  onChange={e => setEditedJson(e.target.value)}
                  rows={6}
                  className="mt-2 w-full rounded-lg border border-border bg-black/[0.03] px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent"
                />
                {jsonError && <div className="mt-1 text-[11px] text-danger">JSON 非法: {jsonError}</div>}
              </>
            ) : (
              <button
                data-testid="json-edit-open"
                onClick={() => setJsonOpen(true)}
                className="mt-2 text-[11px] text-accent hover:underline"
              >
                编辑参数
              </button>
            )}
          </div>
        )}

        <div className="mb-4">
          <span className={`mb-2 inline-block rounded px-2 py-0.5 text-[11px] font-bold text-white ${dangerBg}`}>
            {dangerLevel}
          </span>
          <DialogDescription className="leading-relaxed">{riskDescription}</DialogDescription>
          {suggestion && (
            <div className="mt-1.5 rounded-lg bg-black/[0.03] px-3 py-1.5 text-xs text-fg-muted">
              执行理由: {suggestion}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5">
          <button
            data-testid="reject"
            onClick={() => {
              if (submitting) return
              setSubmitting(true)
              onReject()
            }}
            disabled={submitting}
            className="rounded-lg border border-border px-4 py-1.5 text-xs text-fg-muted hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
          >
            拒绝
          </button>
          <button
            data-testid="approve-all"
            onClick={() => respond(true)}
            disabled={submitting || modified || Boolean(jsonError)}
            title="本会话内不再询问此工具"
            className="rounded-lg border border-border px-4 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            本会话放行此工具
          </button>
          <button
            data-testid="approve"
            onClick={() => respond(false)}
            disabled={submitting || Boolean(jsonError)}
            className="rounded-lg bg-ok px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {modified ? '批准修改' : '允许'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
