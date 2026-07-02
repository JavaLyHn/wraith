import { useCallback, useEffect, useState } from 'react'
import type { AutomationTask, ProjectView } from '../../shared/types'
import AutomationForm from './AutomationForm'
import AutomationRuns from './AutomationRuns'
import { computeNextRunLabel } from '../lib/automationLabels'

interface AutomationsPanelProps {
  projects: ProjectView[]
  onBack: () => void
  onOpenSession(projectPath: string, sessionId: string): void
  onApprove(runId: string): void
}

export default function AutomationsPanel({ projects, onBack, onOpenSession, onApprove }: AutomationsPanelProps): JSX.Element {
  const [tasks, setTasks] = useState<AutomationTask[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [tab, setTab] = useState<'def' | 'runs'>('def')
  const [removeConfirming, setRemoveConfirming] = useState(false)

  const fetchTasks = useCallback(async () => {
    try { const { tasks } = await window.wraith.automationList(); setTasks(tasks) }
    catch (err) { console.error('[wraith] automationList error:', err) }
  }, [])

  useEffect(() => {
    void fetchTasks()
    void window.wraith.automationPanelOpened() // 清红点(spec §3)
    // runs-changed 后 lastFiredAt 可能更新 → 刷左侧任务列表使 computeNextRunLabel 更新
    const unsub = window.wraith.onAutomationEvent(evt => { if (evt.kind === 'runs-changed') void fetchTasks() })
    return unsub
  }, [fetchTasks])

  useEffect(() => { setRemoveConfirming(false); setTab('def') }, [selectedId, creating])

  const current = creating ? null : tasks.find(t => t.id === selectedId) ?? tasks[0] ?? null

  const handleSave = useCallback(async (t: AutomationTask): Promise<boolean> => {
    try { await window.wraith.automationUpsert(t); await fetchTasks(); setCreating(false); setSelectedId(t.id); return true }
    catch (err) { console.error('[wraith] automationUpsert error:', err); return false }
  }, [fetchTasks])

  const handleRunNow = useCallback(async (t: AutomationTask) => {
    try { await window.wraith.automationRunNow(t.id); setTab('runs') }
    catch (err) { console.error('[wraith] automationRunNow error:', err) }
  }, [])

  const handleRemove = useCallback((id: string) => {
    if (!removeConfirming) { setRemoveConfirming(true); return }
    setRemoveConfirming(false)
    void window.wraith.automationRemove(id).then(() => { setSelectedId(null); void fetchTasks() })
  }, [removeConfirming, fetchTasks])

  const handleToggle = useCallback(async (t: AutomationTask) => {
    const now = Date.now()
    await window.wraith.automationUpsert({ ...t, enabled: !t.enabled, enabledAt: !t.enabled ? now : t.enabledAt })
    void fetchTasks()
  }, [fetchTasks])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="automations-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="text-sm font-bold text-fg">自动化</span>
        <span className="text-xs text-fg-subtle">定时任务</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-60 shrink-0 flex-col border-r border-border">
          <div className="flex-1 overflow-y-auto p-2">
            {tasks.length === 0 && <div className="px-2 py-3 text-xs text-fg-subtle">还没有任务</div>}
            {tasks.map(t => (
              <div key={t.id} className="mb-0.5 flex items-center gap-1">
                <button data-testid="automation-item" onClick={() => { setCreating(false); setSelectedId(t.id) }}
                  className={'flex-1 truncate rounded-lg px-2 py-2 text-left text-xs ' +
                    (current?.id === t.id && !creating ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
                  <div className="truncate">{t.name}</div>
                  <div className="text-[10px] text-fg-subtle">{t.enabled ? computeNextRunLabel(t) : '已停用'}</div>
                </button>
                <button data-testid="automation-toggle" title={t.enabled ? '停用' : '启用'}
                  onClick={() => void handleToggle(t)}
                  className={'shrink-0 rounded px-1.5 py-1 text-xs ' + (t.enabled ? 'text-success' : 'text-fg-subtle')}>
                  {t.enabled ? '●' : '○'}
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-border p-2">
            <button data-testid="automation-add" onClick={() => { setCreating(true); setSelectedId(null) }}
              className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60">
              ＋ 新建任务
            </button>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
          {!current && !creating ? (
            <div className="text-xs text-fg-subtle">选择或新建任务</div>
          ) : (
            <>
              <div className="mb-2 flex gap-1 border-b border-border">
                <button data-testid="automation-tab-def" onClick={() => setTab('def')}
                  className={'px-3 py-1.5 text-xs ' + (tab === 'def' ? 'border-b-2 border-accent text-fg' : 'text-fg-muted')}>定义</button>
                <button data-testid="automation-tab-runs" onClick={() => setTab('runs')} disabled={creating}
                  className={'px-3 py-1.5 text-xs disabled:opacity-40 ' + (tab === 'runs' ? 'border-b-2 border-accent text-fg' : 'text-fg-muted')}>运行历史</button>
              </div>
              {tab === 'def' ? (
                <AutomationForm key={creating ? 'new' : current!.id}
                  initial={creating ? null : current}
                  projects={projects}
                  onSave={handleSave} onRunNow={handleRunNow}
                  onRemove={handleRemove} removeConfirming={removeConfirming} />
              ) : (
                <AutomationRuns taskId={current!.id} projectPath={current!.projectPath} onOpenSession={onOpenSession} onApprove={onApprove} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
