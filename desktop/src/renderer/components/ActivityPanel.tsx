import { useState } from 'react'
import { AlertCircle, ArrowLeft, Ban, CheckCircle2, CircleDashed, Eye, LoaderCircle, OctagonAlert, PauseCircle, XCircle } from 'lucide-react'
import type { ActivityCancelResult, ActivityItem, ActivitySnapshot } from '../../shared/types'
import { activityGroups, activityStatusLabel, activityTargetLabel } from '../lib/activityView'

interface ActivityPanelProps {
  snapshot: ActivitySnapshot
  onBack(): void
  onOpenSession(item: ActivityItem): void
  onOpenTask(item: ActivityItem): void
  onOpenAutomation(item: ActivityItem): void
  onRefresh?(): void
  onCancel?(item: ActivityItem): Promise<ActivityCancelResult>
}

const groupDefinitions = [
  ['running', '正在运行'],
  ['waiting', '等待处理'],
  ['recent', '最近结果'],
] as const

function statusPresentation(status: ActivityItem['status']): { Icon: typeof CircleDashed; className: string } {
  switch (status) {
    case 'running': return { Icon: LoaderCircle, className: 'text-accent' }
    case 'waiting': return { Icon: PauseCircle, className: 'text-warn' }
    case 'completed': return { Icon: CheckCircle2, className: 'text-ok' }
    case 'failed': return { Icon: XCircle, className: 'text-danger' }
    case 'canceled': return { Icon: Ban, className: 'text-fg-muted' }
    case 'interrupted': return { Icon: OctagonAlert, className: 'text-warn' }
    case 'unknown': return { Icon: CircleDashed, className: 'text-fg-subtle' }
  }
}

function projectLabel(item: ActivityItem): string {
  return item.projectPath.trim() || '未关联项目'
}

function actionLabel(item: ActivityItem): string {
  return item.kind === 'session' ? '打开会话' : item.kind === 'task' ? '查看任务' : '查看自动化'
}

export default function ActivityPanel({
  snapshot,
  onBack,
  onOpenSession,
  onOpenTask,
  onOpenAutomation,
  onRefresh,
  onCancel,
}: ActivityPanelProps): JSX.Element {
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({})
  const groups = activityGroups(snapshot.activities)
  const hasActivities = snapshot.activities.length > 0
  const firstLoadError = !hasActivities && Boolean(snapshot.error)

  const open = (item: ActivityItem) => {
    switch (item.kind) {
      case 'session': onOpenSession(item); break
      case 'task': onOpenTask(item); break
      case 'automation': onOpenAutomation(item); break
    }
  }

  const cancel = async (item: ActivityItem) => {
    if (!onCancel) return
    setCancelErrors(errors => ({ ...errors, [item.activityId]: '' }))
    try {
      const result = await onCancel(item)
      if (!result.ok) {
        setCancelErrors(errors => ({ ...errors, [item.activityId]: result.message ?? '取消失败' }))
      }
    } catch (error) {
      setCancelErrors(errors => ({ ...errors, [item.activityId]: error instanceof Error ? error.message : String(error) }))
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="活动中心">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="activity-back" onClick={onBack} title="返回对话"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <div>
          <h1 className="text-sm font-bold text-fg">活动</h1>
          <p className="text-2xs text-fg-subtle">跨项目的运行与最近结果</p>
        </div>
        {onRefresh && (
          <button data-testid="activity-refresh" onClick={onRefresh}
            className="ml-auto rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface hover:text-fg">
            刷新
          </button>
        )}
      </header>

      {snapshot.stale && (
        <div data-testid="activity-stale" className="flex items-center gap-2 border-b border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn">
          <AlertCircle className="h-3.5 w-3.5" />数据可能已过期
        </div>
      )}

      {firstLoadError ? (
        <div data-testid="activity-first-load-error" className="m-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <p>{snapshot.error}</p>
          {onRefresh && <button data-testid="activity-retry" onClick={onRefresh} className="mt-2 rounded bg-surface px-2 py-1 text-xs text-fg hover:text-fg">重试</button>}
        </div>
      ) : !hasActivities ? (
        <div data-testid="activity-empty" className="m-4 rounded-lg border border-dashed border-border p-5 text-center text-sm text-fg-subtle">
          暂无活动
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {groupDefinitions.map(([key, heading]) => {
            const items = groups[key]
            if (items.length === 0) return null
            return (
              <section key={key} className="mb-5" aria-labelledby={`activity-group-${key}`}>
                <h2 id={`activity-group-${key}`} data-testid="activity-group-heading" className="mb-2 text-xs font-semibold text-fg-muted">{heading}</h2>
                <div className="space-y-2">
                  {items.map(item => {
                    const presentation = statusPresentation(item.status)
                    const active = item.status === 'running' || item.status === 'waiting'
                    const error = cancelErrors[item.activityId]
                    return (
                      <article key={item.activityId} data-testid={`activity-card-${item.activityId}`} tabIndex={0}
                        onKeyDown={event => {
                          if (event.currentTarget === event.target && (event.key === 'Enter' || event.key === ' ')) {
                            event.preventDefault()
                            open(item)
                          }
                        }}
                        className="rounded-lg border border-border bg-surface/30 p-3 outline-none focus-visible:ring-2 focus-visible:ring-accent">
                        <div className="flex items-start gap-2">
                          <presentation.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${presentation.className}`} aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <strong className="truncate text-sm text-fg">{activityTargetLabel(item)}</strong>
                              <span data-testid={`activity-status-${item.activityId}`} className={`shrink-0 text-2xs ${presentation.className}`}>{activityStatusLabel(item.status)}</span>
                            </div>
                            <p className="mt-1 truncate text-2xs text-fg-subtle" title={projectLabel(item)}>{projectLabel(item)}</p>
                            {item.summary && <p className="mt-1 text-xs text-fg-muted">{item.summary}</p>}
                            {(item.branch || item.worktree) && <p className="mt-1 text-2xs text-fg-subtle">{[item.branch, item.worktree].filter(Boolean).join(' · ')}</p>}
                            {item.error && <p className="mt-1 text-xs text-danger">{item.error}</p>}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button data-testid={`activity-open-${item.activityId}`} onClick={() => open(item)} className="inline-flex items-center gap-1 rounded bg-surface px-2 py-1 text-xs text-fg-muted hover:text-fg">
                            <Eye className="h-3.5 w-3.5" />{actionLabel(item)}
                          </button>
                          {active && onCancel && (
                            <button data-testid={`activity-cancel-${item.activityId}`} onClick={() => { void cancel(item) }} className="rounded px-2 py-1 text-xs text-danger hover:bg-danger/10">
                              取消
                            </button>
                          )}
                        </div>
                        {error && <p data-testid={`activity-cancel-error-${item.activityId}`} className="mt-2 text-xs text-danger">{error}</p>}
                      </article>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}
