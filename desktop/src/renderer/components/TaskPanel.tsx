import { useCallback, useEffect, useState } from 'react'
import { ListTodo, RefreshCw, Send, X, ChevronDown, ChevronRight } from 'lucide-react'
import type { DurableTaskView } from '../../shared/types'
import { taskStatusLabel, taskStatusTone, taskIsTerminal, formatDuration, taskPromptSummary, type TaskTone } from '../lib/taskView'

const toneClass = (tone: TaskTone): string =>
  tone === 'running' ? 'bg-accent/12 text-accent'
    : tone === 'ok' ? 'bg-accent/10 text-accent'
      : tone === 'danger' ? 'bg-danger/10 text-danger'
        : 'bg-surface text-fg-subtle'

export default function TaskPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [tasks, setTasks] = useState<DurableTaskView[]>([])
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [expanded, setExpanded] = useState<Record<string, DurableTaskView>>({})

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.wraith.taskList(30)
      setTasks(r.tasks); setEnabled(r.enabled); setError(r.error ?? null)
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = useCallback(async (): Promise<void> => {
    const prompt = draft.trim()
    if (!prompt) return
    setBusy(true); setError(null)
    try {
      const r = await window.wraith.taskAdd(prompt)
      if (r.ok) { setDraft(''); await load() }
      else setError(r.message || '提交失败')
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [draft, load])

  const cancel = useCallback(async (id: string): Promise<void> => {
    setBusy(true)
    try { await window.wraith.taskCancel(id); await load() }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [load])

  const toggleExpand = useCallback(async (t: DurableTaskView): Promise<void> => {
    if (expanded[t.id]) { setExpanded(p => { const n = { ...p }; delete n[t.id]; return n }); return }
    try {
      const full = await window.wraith.taskGet(t.id)
      if (full.found) setExpanded(p => ({ ...p, [t.id]: full }))
    } catch (err) { setError((err as Error).message) }
  }, [expanded])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="task-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="flex items-center gap-2 text-sm font-bold text-fg">
          <ListTodo className="h-4 w-4 shrink-0" strokeWidth={1.5} />后台任务
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs text-fg-subtle">
          {enabled ? `共 ${tasks.length} 个` : '后台任务不可用'}
          <button onClick={() => void load()} title="刷新" className="rounded p-1 hover:bg-surface hover:text-fg">
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </span>
      </div>

      <div className="shrink-0 border-b border-border px-4 py-2 text-3xs leading-relaxed text-fg-subtle">
        丢一个指令给<span className="text-accent">独立的后台 Agent</span> 自主执行,不占用当前对话;跑完回来看结果。与终端 <span className="font-mono">/task</span> 共享同一队列。
      </div>

      {/* 提交框 */}
      <div className="flex shrink-0 items-end gap-2 border-b border-border px-4 py-3">
        <textarea
          data-testid="task-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() } }}
          rows={2}
          placeholder="例如:把 utils 目录重构并补测试(⌘/Ctrl+Enter 提交)"
          className="min-w-0 flex-1 resize-none rounded-lg border border-border bg-surface/60 px-2 py-1.5 text-xs text-fg outline-none placeholder:text-fg-subtle"
        />
        <button
          data-testid="task-submit"
          onClick={() => void submit()}
          disabled={busy || !draft.trim()}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" strokeWidth={1.5} />提交
        </button>
      </div>

      {error && <div className="shrink-0 px-4 py-2 text-xs text-danger">出错:{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 panel-content">
        {tasks.length === 0 ? (
          <div className="text-xs text-fg-subtle">还没有后台任务。提交一个试试。</div>
        ) : (
          <div className="flex flex-col">
            {tasks.map(t => {
              const ex = expanded[t.id]
              return (
                <div key={t.id} className="border-b border-border/60 py-2.5">
                  <div className="flex items-center gap-2">
                    <button onClick={() => void toggleExpand(t)} className="shrink-0 text-fg-subtle hover:text-fg">
                      {ex ? <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} /> : <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    </button>
                    <span className={'shrink-0 rounded px-1.5 py-0.5 text-3xs ' + toneClass(taskStatusTone(t.status))}>
                      {taskStatusLabel(t.status)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-fg" title={t.prompt}>{taskPromptSummary(t.prompt)}</span>
                    {formatDuration(t.durationMs) && <span className="shrink-0 text-3xs text-fg-subtle">{formatDuration(t.durationMs)}</span>}
                    {!taskIsTerminal(t.status) && (
                      <button data-testid="task-cancel" onClick={() => void cancel(t.id)} disabled={busy} title="取消任务"
                        className="shrink-0 rounded p-1 text-fg-subtle hover:text-danger disabled:opacity-40">
                        <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                  {ex && (
                    <div className="ml-6 mt-1.5 rounded-lg border border-border bg-bg px-2.5 py-2 text-3xs text-fg-muted">
                      {ex.error
                        ? <span className="text-danger whitespace-pre-wrap break-words">❌ {ex.error}</span>
                        : ex.result
                          ? <span className="whitespace-pre-wrap break-words">{ex.result}</span>
                          : <span className="text-fg-subtle">{taskIsTerminal(ex.status) ? '(无输出)' : '任务尚未完成…'}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
