import { useState, useRef } from 'react'
import type { AutomationTask, AutomationSchedule, ProjectView, ApprovalMode, ApprovalPolicy } from '../../shared/types'
import { isValidCronShape, approvalModeLabel, parseDeliverTo, buildDeliverTo, parseApproval, saveErrorText } from '../lib/automationLabels'
import Select from './ui/select'

/** 覆盖行含稳定 UI-only id,不写入 AutomationTask */
interface ToolOverrideRow { id: string; tool: string; mode: ApprovalMode }

/** 将 parseApproval 的结果附上稳定 id(从 1 开始顺序生成) */
function seedOverrides(rows: Array<{ tool: string; mode: ApprovalMode }>): ToolOverrideRow[] {
  return rows.map((r, i) => ({ ...r, id: String(i + 1) }))
}

interface AutomationFormProps {
  initial: AutomationTask | null            // null = 新建
  projects: ProjectView[]
  onSave: (t: AutomationTask) => Promise<void>   // 失败时抛;表单 catch 后透出权威原因
  onRunNow: (t: AutomationTask) => Promise<void>   // 先保存再跑(spec §6.2)
  onToggle: (t: AutomationTask) => Promise<void>   // 暂停/启用(翻转 enabled);仅编辑态出现
  onRemove: (id: string) => void                    // 仅编辑态出现;确认逻辑在面板层
  removeConfirming: boolean
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const APPROVAL_MODES: ApprovalMode[] = ['deny', 'auto-approve', 'ask']

export default function AutomationForm({ initial, projects, onSave, onRunNow, onToggle, onRemove, removeConfirming }: AutomationFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  // workspace 为规范字段(daemon 存的即此);projectPath 是旧别名,列表回来的任务已无它 —— 优先读 workspace 以在编辑时回显正确项目
  const [projectPath, setProjectPath] = useState(initial?.workspace ?? initial?.projectPath ?? projects[0]?.path ?? '')
  const [kind, setKind] = useState<AutomationSchedule['kind']>(initial?.schedule.kind ?? 'daily')
  const [minutes, setMinutes] = useState(initial?.schedule.kind === 'interval' ? String(initial.schedule.everyMinutes) : '60')
  const [time, setTime] = useState(
    initial && (initial.schedule.kind === 'daily' || initial.schedule.kind === 'weekly')
      ? initial.schedule.time
      : '09:00'
  )
  const [weekday, setWeekday] = useState(initial?.schedule.kind === 'weekly' ? initial.schedule.weekday : 1)
  const [cronExpr, setCronExpr] = useState(initial?.schedule.kind === 'cron' ? initial.schedule.expr : '')

  // deliverTo state
  const initialDeliverTo = parseDeliverTo(initial)
  const [deliverDesktop, setDeliverDesktop] = useState(initialDeliverTo.desktop)
  const [deliverQq, setDeliverQq] = useState(initialDeliverTo.qq)

  // approval state
  const initialApproval = parseApproval(initial)
  const [approvalDefault, setApprovalDefault] = useState<ApprovalMode>(initialApproval.defaultMode)
  const [toolOverrides, setToolOverrides] = useState<ToolOverrideRow[]>(() => seedOverrides(initialApproval.toolOverrides))
  const [askTimeoutMinutes, setAskTimeoutMinutes] = useState(initialApproval.askTimeoutMinutes)
  const nextIdRef = useRef(initialApproval.toolOverrides.length + 1)

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // tool overrides helpers
  const addToolOverride = (): void => {
    const id = String(nextIdRef.current++)
    setToolOverrides(prev => [...prev, { id, tool: '', mode: 'deny' }])
  }
  const removeToolOverride = (id: string): void => setToolOverrides(prev => prev.filter(r => r.id !== id))
  const updateToolOverride = (id: string, field: 'tool' | 'mode', value: string): void => {
    setToolOverrides(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  const hasAnyAsk = approvalDefault === 'ask' || toolOverrides.some(r => r.mode === 'ask')

  const buildTask = (): AutomationTask | null => {
    const n = name.trim(); const p = prompt.trim()
    if (!n || !p || !projectPath) { setError('name/prompt/项目 必填'); return null }
    let schedule: AutomationSchedule
    if (kind === 'interval') {
      const m = Number(minutes)
      if (!Number.isFinite(m) || m < 1) { setError('间隔最少 1 分钟'); return null }
      schedule = { kind: 'interval', everyMinutes: Math.floor(m) }
    } else if (kind === 'daily') {
      if (!/^\d{2}:\d{2}$/.test(time)) { setError('时间格式错误'); return null }
      schedule = { kind: 'daily', time }
    } else if (kind === 'weekly') {
      if (!/^\d{2}:\d{2}$/.test(time)) { setError('时间格式错误'); return null }
      schedule = { kind: 'weekly', weekday, time }
    } else {
      // cron
      if (!isValidCronShape(cronExpr)) { setError('cron 表达式需为 5 段(如 0 9 * * 1)'); return null }
      schedule = { kind: 'cron', expr: cronExpr.trim() }
    }

    // deliverTo — empty allowed (run-only)
    const deliverTo = buildDeliverTo(deliverDesktop, deliverQq)

    // approval policy (strip UI-only id)
    const tools: Record<string, ApprovalMode> = {}
    for (const row of toolOverrides) {
      const t = row.tool.trim()
      if (t) tools[t] = row.mode
    }
    const approval: ApprovalPolicy = { default: approvalDefault }
    if (Object.keys(tools).length > 0) approval.tools = tools
    if (hasAnyAsk && askTimeoutMinutes !== '') {
      const v = Number(askTimeoutMinutes)
      if (Number.isFinite(v) && v > 0) approval.askTimeoutMinutes = Math.floor(v)
    }

    const now = Date.now()
    return {
      id: initial?.id ?? crypto.randomUUID(),
      name: n, prompt: p, projectPath, schedule,
      workspace: projectPath,
      enabled: initial?.enabled ?? true,
      createdAt: initial?.createdAt ?? now,
      enabledAt: initial?.enabledAt ?? now,
      lastFiredAt: initial?.lastFiredAt ?? null,
      deliverTo,
      approval,
    }
  }

  // saveOnly: saves and clears saving when done (pure save button path)
  const saveOnly = async (): Promise<void> => {
    const t = buildTask()
    if (!t) return
    setSaving(true); setError(null)
    try {
      await onSave(t)
    } catch (err) {
      setError(saveErrorText(err))
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
      await onSave(t)
      return t
    } catch (err) { setError(saveErrorText(err)); setSaving(false); return null }
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
        <Select
          testId="automation-form-project"
          className="mt-1 w-full"
          value={projectPath}
          onChange={setProjectPath}
          options={projects.map(p => ({ value: p.path, label: p.name || p.path }))}
        />
      </label>

      {/* Schedule section */}
      <div className="flex items-end gap-2 text-xs text-fg-muted">
        <label>调度
          <Select
            testId="automation-form-schedule-kind"
            className="mt-1"
            value={kind}
            onChange={v => setKind(v as AutomationSchedule['kind'])}
            options={[
              { value: 'interval', label: '每隔 N 分钟' },
              { value: 'daily', label: '每天' },
              { value: 'weekly', label: '每周' },
              { value: 'cron', label: 'cron 表达式' },
            ]}
          />
        </label>
        {kind === 'interval' && (
          <label>分钟
            <input data-testid="automation-form-schedule-minutes" value={minutes} onChange={e => setMinutes(e.target.value)}
              className="mt-1 w-20 rounded-lg border border-border bg-bg px-2 py-2 text-xs text-fg outline-none" />
          </label>
        )}
        {kind === 'weekly' && (
          <label>星期
            <Select
              testId="automation-form-schedule-weekday"
              className="mt-1"
              value={String(weekday)}
              onChange={v => setWeekday(Number(v))}
              options={WEEKDAYS.map((w, i) => ({ value: String(i), label: w }))}
            />
          </label>
        )}
        {(kind === 'daily' || kind === 'weekly') && (
          <label>时刻
            <input data-testid="automation-form-schedule-time" type="time" value={time} onChange={e => setTime(e.target.value)}
              className="mt-1 rounded-lg border border-border bg-bg px-2 py-2 text-xs text-fg outline-none" />
          </label>
        )}
      </div>
      {kind === 'cron' && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-fg-muted">cron 表达式
            <input data-testid="automation-form-schedule-cron"
              value={cronExpr} onChange={e => setCronExpr(e.target.value)}
              placeholder="如: 0 9 * * 1"
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg font-mono outline-none focus:border-accent" />
          </label>
          <div className="text-3xs text-fg-subtle">
            5 段空格分隔: 分 时 日 月 周 (如 <code className="font-mono">0 9 * * 1</code> = 每周一 09:00)。守护进程做权威校验。
          </div>
        </div>
      )}

      {/* deliverTo multi-select */}
      <div className="text-xs text-fg-muted">
        <div className="mb-1">投递目标</div>
        <div className="flex gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input data-testid="automation-form-deliver-desktop" type="checkbox"
              checked={deliverDesktop} onChange={e => setDeliverDesktop(e.target.checked)}
              className="rounded border-border" />
            桌面通知
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input data-testid="automation-form-deliver-qq" type="checkbox"
              checked={deliverQq} onChange={e => setDeliverQq(e.target.checked)}
              className="rounded border-border" />
            QQ 消息
          </label>
        </div>
        {!deliverDesktop && !deliverQq && (
          <div className="mt-1 text-3xs text-fg-subtle">未选则仅执行,不推送结果</div>
        )}
      </div>

      {/* Approval config */}
      <div className="flex flex-col gap-2 text-xs text-fg-muted">
        <div>工具调用审批</div>
        <label className="flex items-center gap-2">
          默认模式
          <Select
            testId="automation-form-approval-default"
            value={approvalDefault}
            onChange={v => setApprovalDefault(v as ApprovalMode)}
            options={APPROVAL_MODES.map(m => ({ value: m, label: approvalModeLabel(m) }))}
          />
        </label>

        {/* per-tool overrides */}
        {toolOverrides.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-3xs text-fg-subtle">按工具覆盖</div>
            {toolOverrides.map((row, idx) => (
              <div key={row.id} className="flex items-center gap-1">
                <input data-testid={`automation-form-tool-override-name-${idx}`}
                  value={row.tool} onChange={e => updateToolOverride(row.id, 'tool', e.target.value)}
                  placeholder="工具名"
                  className="flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent" />
                <Select
                  testId={`automation-form-tool-override-mode-${idx}`}
                  value={row.mode}
                  onChange={v => updateToolOverride(row.id, 'mode', v)}
                  options={APPROVAL_MODES.map(m => ({ value: m, label: approvalModeLabel(m) }))}
                />
                <button data-testid={`automation-form-tool-override-remove-${idx}`}
                  type="button" onClick={() => removeToolOverride(row.id)}
                  className="rounded px-1.5 py-1 text-xs text-fg-muted hover:text-danger">×</button>
              </div>
            ))}
          </div>
        )}
        <button data-testid="automation-form-add-tool-override" type="button"
          onClick={addToolOverride}
          className="w-fit rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg">
          ＋ 添加工具覆盖
        </button>

        {/* askTimeoutMinutes — shown when any ask mode is in play */}
        {hasAnyAsk && (
          <label className="flex items-center gap-2">
            询问超时 (分钟)
            <input data-testid="automation-form-ask-timeout"
              type="number" min="1" value={askTimeoutMinutes}
              onChange={e => setAskTimeoutMinutes(e.target.value)}
              placeholder="不填=无限等待"
              className="w-28 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent" />
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
          <button data-testid="automation-toggle-form" title={initial.enabled ? '暂停后不再按时触发' : '启用后从现在起重新计时'}
            onClick={() => void onToggle(initial)}
            className={'ml-auto rounded-lg border px-4 py-2 text-xs ' +
              (initial.enabled ? 'border-border text-fg-muted hover:text-accent' : 'border-success text-success')}>
            {initial.enabled ? '⏸ 暂停' : '▶ 启用'}
          </button>
        )}
        {initial && (
          <button data-testid="automation-remove" onClick={() => onRemove(initial.id)}
            className={'rounded-lg border px-4 py-2 text-xs ' +
              (removeConfirming ? 'border-danger text-danger' : 'border-border text-fg-muted hover:text-danger')}>
            {removeConfirming ? '确认删除?' : '删除任务'}
          </button>
        )}
      </div>
    </div>
  )
}
