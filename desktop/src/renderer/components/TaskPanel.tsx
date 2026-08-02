import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ListTodo, RefreshCw, Send, X, RotateCcw, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import type { DurableTaskView } from '../../shared/types'
import { taskStatusLabel, taskStatusTone, taskIsTerminal, taskCanRetry, taskCanDelete, formatDuration, taskPromptSummary, type TaskTone } from '../lib/taskView'

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

  const load = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setBusy(true)
    try {
      const r = await window.wraith.taskList(30)
      setTasks(r.tasks); setEnabled(r.enabled); setError(r.error ?? null)
    } catch (err) { setError((err as Error).message) }
    finally { if (!silent) setBusy(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  // 有未完成任务时自动轮询(静默,不闪 busy):任务在后台 worker 里跑,面板不轮询就会一直显示旧的
  // 「运行中」——即便任务早已完成(实测卡住的根因)。全部终态后停止轮询。
  useEffect(() => {
    if (!tasks.some(t => !taskIsTerminal(t.status))) return
    const timer = setInterval(() => { void load(true) }, 2000)
    return () => clearInterval(timer)
  }, [tasks, load])

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

  const remove = useCallback(async (id: string): Promise<void> => {
    setBusy(true); setError(null)
    try {
      const r = await window.wraith.taskDelete(id)
      // 先 load 再报错:load 内部会 setError(null) 清场,顺序反了错误提示会被自己刷掉。
      await load()
      if (!r.ok) setError(r.message || '删除失败')
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [load])

  // 重试 = 用同样的 prompt 新建一条,**并删掉原来那条**,列表里只留最新的。
  //
  // 先 add 再 delete,顺序不能反:先删的话一旦 add 失败,用户的 prompt 就随那条记录
  // 一起没了,连重打一遍的依据都不剩。所以 add 失败时原记录原地不动。
  // 反过来 delete 失败时不谎报「重试失败」—— 新任务确实已经进队列了,只是旧的没扫干净。
  const retry = useCallback(async (id: string, prompt: string): Promise<void> => {
    setBusy(true); setError(null)
    try {
      const r = await window.wraith.taskAdd(prompt)
      if (!r.ok) { setError(r.message || '重试提交失败'); return }
      const d = await window.wraith.taskDelete(id)
      await load()   // 同上:load 会清 error,报错必须在它之后
      if (!d.ok) setError(d.message || '原记录未能删除')
    } catch (err) { setError((err as Error).message) }
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
        <button data-testid="task-back" onClick={onBack} title="返回对话"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} /></button>
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
                    {taskCanRetry(t.status) && (
                      <button data-testid="task-retry" onClick={() => void retry(t.id, t.prompt)} disabled={busy}
                        title="用同样的指令再跑一次(这条记录会被新的顶替)"
                        className="shrink-0 rounded p-1 text-fg-subtle hover:text-accent disabled:opacity-40">
                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    )}
                    {taskCanDelete(t.status) && (
                      <button data-testid="task-delete" onClick={() => void remove(t.id)} disabled={busy}
                        title="删除这条记录"
                        className="shrink-0 rounded p-1 text-fg-subtle hover:text-danger disabled:opacity-40">
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
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
