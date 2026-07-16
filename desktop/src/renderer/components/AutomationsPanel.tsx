import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { AutomationTask, ProjectView, QqPendingItem } from '../../shared/types'
import AutomationForm from './AutomationForm'
import AutomationRuns from './AutomationRuns'
import QqPendingBlock from './QqPendingBlock'
import { computeNextRunLabel } from '../lib/automationLabels'
import { taskStatusLabel, gatewayPillView } from '../lib/gatewayGate'
import type { GatewayStatus } from '../../shared/gateway'

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
  const [runNowBusy, setRunNowBusy] = useState(false)
  const runNowBusyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [qqPending, setQqPending] = useState<QqPendingItem[]>([])
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>({ state: 'stopped' })
  const [flushToast, setFlushToast] = useState<number | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchQqPending = useCallback(async () => {
    try { const { items } = await window.wraith.qqPending(); setQqPending(items) }
    catch { setQqPending([]) } // 后端断连等:视为无积压,不打扰
  }, [])

  const fetchTasks = useCallback(async () => {
    try { const { tasks } = await window.wraith.automationList(); setTasks(tasks) }
    catch (err) { console.error('[wraith] automationList error:', err) }
  }, [])

  useEffect(() => {
    void fetchTasks()
    void fetchQqPending()
    void window.wraith.automationPanelOpened() // 清红点(spec §3)
    // runs-changed 后 lastFiredAt 可能更新 → 刷左侧任务列表使 computeNextRunLabel 更新
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const unsub = window.wraith.onAutomationEvent(evt => {
      if (evt.kind !== 'runs-changed') return
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void fetchTasks()
        void fetchQqPending()
        void window.wraith.automationPanelOpened()   // A4: 面板可见期间到达的终态即视为已读,红点不重亮
      }, 80)
    })
    return () => { unsub(); if (debounceTimer !== null) clearTimeout(debounceTimer) }
  }, [fetchTasks, fetchQqPending])

  // 网关状态感知 + QQ flush 即时反馈 + 轻轮询兜底
  useEffect(() => {
    void window.wraith.gatewayStatus().then(setGatewayStatus).catch(() => { /* 断连:保持 stopped */ })
    const unsub = window.wraith.onGatewayEvent(evt => {
      if (evt.kind === 'status') {
        setGatewayStatus(evt.status)
      } else if (evt.kind === 'qq-flushed') {
        void fetchQqPending()
        setFlushToast(evt.count)
        if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current)
        flushTimerRef.current = setTimeout(() => { setFlushToast(null); flushTimerRef.current = null }, 3000)
      }
    })
    // 兜底:面板打开期每 6s 拉一次(覆盖终端起的网关/漏标记;只刷新不弹提示)
    const poll = setInterval(() => { void fetchQqPending() }, 6000)
    return () => {
      unsub()
      clearInterval(poll)
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current)
    }
  }, [fetchQqPending])

  useEffect(() => { setRemoveConfirming(false); setTab('def') }, [selectedId, creating])

  // Cleanup runNow busy hint timer on unmount
  useEffect(() => {
    return () => { if (runNowBusyTimerRef.current !== null) clearTimeout(runNowBusyTimerRef.current) }
  }, [])

  const current = creating ? null : tasks.find(t => t.id === selectedId) ?? tasks[0] ?? null

  const pill = gatewayPillView(gatewayStatus)
  const pillToneCls = { ok: 'text-success', warn: 'text-warning', err: 'text-danger', muted: 'text-fg-subtle' }[pill.tone]
  const pillGlyph = { ok: '● ', warn: '⚠ ', err: '✕ ', muted: '' }[pill.tone]

  const handleSave = useCallback(async (t: AutomationTask): Promise<void> => {
    // upsert 失败(如非法 cron、后端断连)直接抛 —— 由 AutomationForm catch 后透出权威原因,不在此吞成布尔
    await window.wraith.automationUpsert(t)
    await fetchTasks(); setCreating(false); setSelectedId(t.id)
  }, [fetchTasks])

  const handleRunNow = useCallback(async (t: AutomationTask) => {
    try {
      const result = await window.wraith.automationRunNow(t.id)
      if (result.ok) {
        setTab('runs')
      } else {
        // Task is in settle window (B5) or already active — surface transient hint
        setRunNowBusy(true)
        if (runNowBusyTimerRef.current !== null) clearTimeout(runNowBusyTimerRef.current)
        runNowBusyTimerRef.current = setTimeout(() => {
          setRunNowBusy(false)
          runNowBusyTimerRef.current = null
        }, 3000)
      }
    }
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

  const handleQqRemove = useCallback(async (id: string) => {
    await window.wraith.qqPendingClear(id)
    setTimeout(() => { void fetchQqPending() }, 3500) // daemon poller 2-3s 消费,延后刷一次
  }, [fetchQqPending])
  const handleQqClearResults = useCallback(async () => {
    await window.wraith.qqPendingClear()
    setTimeout(() => { void fetchQqPending() }, 3500)
  }, [fetchQqPending])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="automations-back" onClick={onBack} title="返回对话"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} /></button>
        <span className="text-sm font-bold text-fg">自动化</span>
        <span className="text-xs text-fg-subtle">定时任务</span>
        {qqPending.length > 0 && (
          <span data-testid="qq-pending-badge"
            className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-2xs text-warning">
            QQ 待发 {qqPending.length}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-2xs">
          <span data-testid="gateway-pill" className={pillToneCls} title={pill.hint}>{pillGlyph}{pill.text}</span>
          {pill.action && (
            <button data-testid="gateway-pill-action" onClick={() => void window.wraith.gatewayStart()}
              className="rounded bg-accent px-2 py-0.5 text-white">
              {pill.action === 'start' ? '启动网关' : '重试'}
            </button>
          )}
        </span>
      </div>
      {flushToast !== null && (
        <div data-testid="qq-flush-toast"
          className="border-b border-border bg-success/10 px-4 py-1.5 text-2xs text-success">
          ✓ 已投递 {flushToast} 条到 QQ
        </div>
      )}
      <div className="flex min-h-0 flex-1 panel-content">
        <div className="flex w-60 shrink-0 flex-col border-r border-border">
          <div className="flex-1 overflow-y-auto p-2">
            {tasks.length === 0 && <div className="px-2 py-3 text-xs text-fg-subtle">还没有任务</div>}
            {tasks.map(t => (
              <div key={t.id} className="mb-0.5 flex items-center gap-1">
                <button data-testid="automation-item" onClick={() => { setCreating(false); setSelectedId(t.id) }}
                  className={'flex-1 truncate rounded-lg px-2 py-2 text-left text-xs ' +
                    (current?.id === t.id && !creating ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
                  <div className="truncate">{t.name}</div>
                  <div className="text-3xs text-fg-subtle">{t.enabled ? computeNextRunLabel(t) : '已暂停'}</div>
                </button>
                <button data-testid="automation-toggle" title={t.enabled ? '点击暂停' : '点击启用'}
                  onClick={() => void handleToggle(t)}
                  className={'shrink-0 rounded px-1.5 py-1 text-3xs whitespace-nowrap ' +
                    (t.enabled
                      ? (gatewayStatus.state === 'running' ? 'text-success hover:bg-surface/60' : 'text-fg-muted hover:bg-surface/60')
                      : 'text-fg-subtle hover:bg-surface/60')}>
                  {taskStatusLabel(t.enabled, gatewayStatus.state)}
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
          {runNowBusy && (
            <div data-testid="runnow-busy-hint"
              className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              任务正在收尾,稍后重试
            </div>
          )}
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
                  onSave={handleSave} onRunNow={handleRunNow} onToggle={handleToggle}
                  onRemove={handleRemove} removeConfirming={removeConfirming} />
              ) : (
                <AutomationRuns taskId={current!.id} projectPath={current!.workspace ?? current!.projectPath} onOpenSession={onOpenSession} onApprove={onApprove} />
              )}
            </>
          )}
          <QqPendingBlock items={qqPending} onRemove={id => { void handleQqRemove(id) }}
            onClearResults={() => { void handleQqClearResults() }} />
        </div>
      </div>
    </div>
  )
}
