import { useState } from 'react'
import type { AutomationTask, AutomationSchedule, ProjectView } from '../../shared/types'

interface AutomationFormProps {
  initial: AutomationTask | null            // null = 新建
  projects: ProjectView[]
  onSave: (t: AutomationTask) => Promise<boolean>
  onRunNow: (t: AutomationTask) => Promise<void>   // 先保存再跑(spec §6.2)
  onRemove: (id: string) => void                    // 仅编辑态出现;确认逻辑在面板层
  removeConfirming: boolean
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export default function AutomationForm({ initial, projects, onSave, onRunNow, onRemove, removeConfirming }: AutomationFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [projectPath, setProjectPath] = useState(initial?.projectPath ?? projects[0]?.path ?? '')
  const [kind, setKind] = useState<AutomationSchedule['kind']>(initial?.schedule.kind ?? 'daily')
  const [minutes, setMinutes] = useState(initial?.schedule.kind === 'interval' ? String(initial.schedule.everyMinutes) : '60')
  const [time, setTime] = useState(initial?.schedule.kind !== 'interval' && initial ? initial.schedule.time : '09:00')
  const [weekday, setWeekday] = useState(initial?.schedule.kind === 'weekly' ? initial.schedule.weekday : 1)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const buildTask = (): AutomationTask | null => {
    const n = name.trim(); const p = prompt.trim()
    if (!n || !p || !projectPath) { setError('name/prompt/项目 必填'); return null }
    let schedule: AutomationSchedule
    if (kind === 'interval') {
      const m = Number(minutes)
      if (!Number.isFinite(m) || m < 5) { setError('间隔最少 5 分钟'); return null }
      schedule = { kind: 'interval', everyMinutes: Math.floor(m) }
    } else if (kind === 'daily') {
      if (!/^\d{2}:\d{2}$/.test(time)) { setError('时间格式错误'); return null }
      schedule = { kind: 'daily', time }
    } else {
      if (!/^\d{2}:\d{2}$/.test(time)) { setError('时间格式错误'); return null }
      schedule = { kind: 'weekly', weekday, time }
    }
    const now = Date.now()
    return {
      id: initial?.id ?? crypto.randomUUID(),
      name: n, prompt: p, projectPath, schedule,
      enabled: initial?.enabled ?? true,
      createdAt: initial?.createdAt ?? now,
      enabledAt: initial?.enabledAt ?? now,
      lastFiredAt: initial?.lastFiredAt ?? null,
    }
  }

  // saveOnly: saves and clears saving when done (pure save button path)
  const saveOnly = async (): Promise<void> => {
    const t = buildTask()
    if (!t) return
    setSaving(true); setError(null)
    try {
      const ok = await onSave(t)
      if (!ok) setError('保存失败')
    } finally {
      setSaving(false)
    }
  }

  // saveForRun: saves but does NOT clear saving; returns task or null (run-now path)
  const saveForRun = async (): Promise<AutomationTask | null> => {
    const t = buildTask()
    if (!t) return null
    setSaving(true); setError(null)
    try {
      const ok = await onSave(t)
      if (!ok) { setError('保存失败'); setSaving(false); return null }
      return t
    } catch (err) { console.error('[wraith] saveForRun error:', err); setError('保存失败'); setSaving(false); return null }
  }

  const handleRunNow = async (): Promise<void> => {
    const t = await saveForRun()
    if (!t) return
    try {
      await onRunNow(t)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="automation-form" className="flex max-w-xl flex-col gap-3">
      <label className="text-xs text-fg-muted">名称
        <input data-testid="automation-form-name" value={name} onChange={e => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent" />
      </label>
      <label className="text-xs text-fg-muted">Prompt(任务内容)
        <textarea data-testid="automation-form-prompt" value={prompt} rows={4} onChange={e => setPrompt(e.target.value)}
          className="mt-1 w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent" />
      </label>
      <label className="text-xs text-fg-muted">项目
        <select data-testid="automation-form-project" value={projectPath} onChange={e => setProjectPath(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg outline-none">
          {projects.map(p => <option key={p.path} value={p.path}>{p.name || p.path}</option>)}
        </select>
      </label>
      <div className="flex items-end gap-2 text-xs text-fg-muted">
        <label>调度
          <select data-testid="automation-form-schedule-kind" value={kind}
            onChange={e => setKind(e.target.value as AutomationSchedule['kind'])}
            className="mt-1 rounded-lg border border-border bg-bg px-2 py-2 text-xs text-fg outline-none">
            <option value="interval">每隔 N 分钟</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </select>
        </label>
        {kind === 'interval' && (
          <label>分钟
            <input data-testid="automation-form-schedule-minutes" value={minutes} onChange={e => setMinutes(e.target.value)}
              className="mt-1 w-20 rounded-lg border border-border bg-bg px-2 py-2 text-xs text-fg outline-none" />
          </label>
        )}
        {kind === 'weekly' && (
          <label>星期
            <select data-testid="automation-form-schedule-weekday" value={weekday} onChange={e => setWeekday(Number(e.target.value))}
              className="mt-1 rounded-lg border border-border bg-bg px-2 py-2 text-xs text-fg outline-none">
              {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
            </select>
          </label>
        )}
        {kind !== 'interval' && (
          <label>时刻
            <input data-testid="automation-form-schedule-time" type="time" value={time} onChange={e => setTime(e.target.value)}
              className="mt-1 rounded-lg border border-border bg-bg px-2 py-2 text-xs text-fg outline-none" />
          </label>
        )}
      </div>
      {error && <div className="text-xs text-danger">{error}</div>}
      <div className="flex gap-2">
        <button data-testid="automation-save" disabled={saving} onClick={() => void saveOnly()}
          className="rounded-lg bg-accent px-4 py-2 text-xs text-white disabled:opacity-60">保存</button>
        <button data-testid="automation-run-now" disabled={saving}
          onClick={() => void handleRunNow()}
          className="rounded-lg border border-border px-4 py-2 text-xs text-fg hover:border-accent disabled:opacity-60">
          立即运行
        </button>
        {initial && (
          <button data-testid="automation-remove" onClick={() => onRemove(initial.id)}
            className={'ml-auto rounded-lg border px-4 py-2 text-xs ' +
              (removeConfirming ? 'border-danger text-danger' : 'border-border text-fg-muted hover:text-danger')}>
            {removeConfirming ? '确认删除?' : '删除任务'}
          </button>
        )}
      </div>
    </div>
  )
}
