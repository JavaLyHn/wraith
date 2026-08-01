import { useCallback, useEffect, useState } from 'react'
import type { AutomationRun } from '../../shared/types'

interface AutomationRunsProps {
  taskId: string
  onOpenSession(projectPath: string, sessionId: string): void
  projectPath: string
  onApprove(runId: string): void        // App 弹已缓存的审批(经 push 事件早已入槽;此钮兜底重弹)
}

/**
 * Inline handler: respond to a pending approval and immediately refresh runs.
 * ⚠ 必须看返回值:守护进程没运行时决定不会落地(后端已撤回请求,不会在网关启动后
 * 凭空生效)。此前这里把结果整个丢掉,用户点了「同意」却什么也没发生、且毫无提示。
 */
async function handleRespondApproval(
  approvalId: string,
  decision: 'approve' | 'reject',
  fetchRuns: () => Promise<void>,
  onNotDelivered?: (msg: string) => void
): Promise<void> {
  try {
    const res = await window.wraith.automationRespondApproval(approvalId, decision)
    if (res && res.ok === false) {
      onNotDelivered?.(res.reason === 'gateway-not-running'
        ? '网关守护进程未运行,这个决定没有生效。请先启动网关再操作。'
        : '决定未能送达,请重试。')
      return
    }
    await fetchRuns()
  } catch (err) {
    console.error('[wraith] automationRespondApproval error:', err)
    onNotDelivered?.('决定未能送达,请重试。')
  }
}

const STATUS_LABEL: Record<AutomationRun['status'], string> = {
  running: '运行中', waiting_approval: '等待审批', success: '成功', failed: '失败', interrupted: '中断',
}
const STATUS_COLOR: Record<AutomationRun['status'], string> = {
  running: 'text-warn', waiting_approval: 'text-warn', success: 'text-ok',
  failed: 'text-danger', interrupted: 'text-fg-subtle',
}

export default function AutomationRuns({ taskId, projectPath, onOpenSession, onApprove: _onApprove }: AutomationRunsProps): JSX.Element {
  // 审批未送达时的提示(守护进程没跑)。不提示的话用户点了「同意」毫无反馈。
  const [notDelivered, setNotDelivered] = useState<string | null>(null)
  const [runs, setRuns] = useState<AutomationRun[]>([])

  const fetchRuns = useCallback(async () => {
    try {
      const { runs } = await window.wraith.automationRuns()
      setRuns(runs.filter(r => r.taskId === taskId).sort((a, b) => b.startedAt - a.startedAt))
    } catch (err) { console.error('[wraith] automationRuns error:', err) }
  }, [taskId])

  useEffect(() => {
    void fetchRuns()
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const unsub = window.wraith.onAutomationEvent(evt => {
      if (evt.kind !== 'runs-changed') return
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => { debounceTimer = null; void fetchRuns() }, 80)
    })
    return () => { unsub(); if (debounceTimer !== null) clearTimeout(debounceTimer) }
  }, [fetchRuns])

  const fmt = (ts: number): string => {
    const d = new Date(ts); const p = (n: number): string => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  const dur = (r: AutomationRun): string =>
    r.endedAt ? `${Math.max(1, Math.round((r.endedAt - r.startedAt) / 1000))}s` : '—'

  return (
    <div className="flex flex-col gap-1">
      {notDelivered !== null && (
        <div data-testid="approval-not-delivered"
          className="mb-1 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {notDelivered}
        </div>
      )}
      {runs.length === 0 && <div className="text-xs text-fg-subtle">还没有运行记录</div>}
      {runs.map(r => (
        <div key={r.runId} data-testid="automation-run-item" className="rounded-lg bg-surface/60 px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className={STATUS_COLOR[r.status]}>{r.miss ? '错过(miss)' : STATUS_LABEL[r.status]}</span>
            <span className="text-fg-subtle">{fmt(r.startedAt)} · {dur(r)}</span>
            <span className="ml-auto flex gap-2">
              {r.sessionId && r.endedAt !== undefined && (
                <button data-testid="automation-run-open" onClick={() => onOpenSession(projectPath, r.sessionId!)}
                  className="rounded border border-border px-2 py-0.5 text-2xs text-fg-muted hover:text-accent">查看会话</button>
              )}
              {/* v1: 定时任务为进程内回合,不可中断 — STOP 按钮已移除,不暴露无效的终止操作 */}
            </span>
          </div>
          {r.status === 'waiting_approval' && r.approvalId && (
            <div data-testid="automation-run-approval" className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
              <div className="mb-1 text-2xs text-amber-700 dark:text-amber-400">
                等待审批工具调用{r.approvalTool ? <span className="ml-1 font-mono font-semibold">{r.approvalTool}</span> : null}
              </div>
              <div className="flex gap-1.5">
                <button
                  data-testid="automation-run-approve"
                  onClick={() => void handleRespondApproval(r.approvalId!, 'approve', fetchRuns, setNotDelivered)}
                  className="rounded border border-ok/60 bg-ok/10 px-2 py-0.5 text-2xs text-ok hover:bg-ok/20">
                  批准
                </button>
                <button
                  data-testid="automation-run-reject"
                  onClick={() => void handleRespondApproval(r.approvalId!, 'reject', fetchRuns, setNotDelivered)}
                  className="rounded border border-danger/60 bg-danger/10 px-2 py-0.5 text-2xs text-danger hover:bg-danger/20">
                  拒绝
                </button>
              </div>
            </div>
          )}
          {r.summary && <div className="mt-1 truncate text-xs text-fg-muted">{r.summary}</div>}
        </div>
      ))}
    </div>
  )
}
