import { useCallback, useEffect, useState } from 'react'
import type { AutomationRun } from '../../shared/types'

interface AutomationRunsProps {
  taskId: string
  onOpenSession(projectPath: string, sessionId: string): void
  projectPath: string
  onApprove(runId: string): void        // App 弹已缓存的审批(经 push 事件早已入槽;此钮兜底重弹)
}

const STATUS_LABEL: Record<AutomationRun['status'], string> = {
  running: '运行中', waiting_approval: '等待审批', success: '成功', failed: '失败', interrupted: '中断',
}
const STATUS_COLOR: Record<AutomationRun['status'], string> = {
  running: 'text-warning', waiting_approval: 'text-danger', success: 'text-success',
  failed: 'text-danger', interrupted: 'text-fg-subtle',
}

export default function AutomationRuns({ taskId, projectPath, onOpenSession, onApprove }: AutomationRunsProps): JSX.Element {
  const [runs, setRuns] = useState<AutomationRun[]>([])

  const fetchRuns = useCallback(async () => {
    try {
      const { runs } = await window.wraith.automationRuns()
      setRuns(runs.filter(r => r.taskId === taskId).sort((a, b) => b.startedAt - a.startedAt))
    } catch (err) { console.error('[wraith] automationRuns error:', err) }
  }, [taskId])

  useEffect(() => {
    void fetchRuns()
    return window.wraith.onAutomationEvent(evt => { if (evt.kind === 'runs-changed') void fetchRuns() })
  }, [fetchRuns])

  const fmt = (ts: number): string => {
    const d = new Date(ts); const p = (n: number): string => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  const dur = (r: AutomationRun): string =>
    r.endedAt ? `${Math.max(1, Math.round((r.endedAt - r.startedAt) / 1000))}s` : '—'

  return (
    <div className="flex flex-col gap-1">
      {runs.length === 0 && <div className="text-xs text-fg-subtle">还没有运行记录</div>}
      {runs.map(r => (
        <div key={r.runId} data-testid="automation-run-item" className="rounded-lg bg-surface/60 px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className={STATUS_COLOR[r.status]}>{r.miss ? '错过(miss)' : STATUS_LABEL[r.status]}</span>
            <span className="text-fg-subtle">{fmt(r.startedAt)} · {dur(r)}</span>
            <span className="ml-auto flex gap-2">
              {r.status === 'waiting_approval' && (
                <button data-testid="automation-run-approve" onClick={() => onApprove(r.runId)}
                  className="rounded border border-danger px-2 py-0.5 text-[11px] text-danger">处理审批</button>
              )}
              {(r.status === 'running' || r.status === 'waiting_approval') && (
                <button data-testid="automation-run-stop"
                  onClick={() => void window.wraith.automationStop(r.runId).then(() => void fetchRuns())}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-muted hover:text-danger">终止</button>
              )}
              {r.sessionId && r.endedAt !== undefined && (
                <button data-testid="automation-run-open" onClick={() => onOpenSession(projectPath, r.sessionId!)}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-muted hover:text-accent">查看会话</button>
              )}
            </span>
          </div>
          {r.summary && <div className="mt-1 truncate text-xs text-fg-muted">{r.summary}</div>}
        </div>
      ))}
    </div>
  )
}
