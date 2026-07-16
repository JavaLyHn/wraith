import { useState, useRef } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { AutomationTask, AutomationSchedule, ProjectView, ApprovalMode, ApprovalPolicy } from '../../shared/types'
import { isValidCronShape, approvalModeLabel, parseDeliverTo, buildDeliverTo, deliveryPlatformLabel, parseApproval, saveErrorText } from '../lib/automationLabels'
import { buildCron, parseCron, describeCron, CRON_MODE_OPTIONS, CRON_DEFAULT_STATE, type CronMode, type CronBuilderState } from '../lib/cronBuilder'
import { IM_PLATFORMS } from '../lib/imPlatforms'
import Select from './ui/select'
import { CARD, SECTION_TITLE, INPUT, BTN_PRIMARY, BTN_GHOST, BTN_DANGER_GHOST } from '../lib/formStyles'

// 投递平台:桌面通知(总是)+ 所有「可用」IM 平台(qq/weixin/wecom/feishu),顺序稳定。
// 后端 Deliverer 按 platform 路由到对应 adapter(投递给该平台绑定的主人)。
const DELIVER_PLATFORMS: string[] = ['desktop', ...IM_PLATFORMS.filter(p => p.status === 'available').map(p => p.id)]

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
  // cron 用「模式构建器」:反解已存表达式回显对应模式;新建默认 CRON_DEFAULT_STATE(工作日 09:00)
  const initCron = initial?.schedule.kind === 'cron' ? parseCron(initial.schedule.expr) : CRON_DEFAULT_STATE
  const [cronMode, setCronMode] = useState<CronMode>(initCron.mode)
  const [cronMinute, setCronMinute] = useState(String(initCron.minute))
  const [cronEveryN, setCronEveryN] = useState(String(initCron.everyN))
  const [cronMonthDay, setCronMonthDay] = useState(String(initCron.monthDay))
  const [cronTime, setCronTime] = useState(initCron.time)
  const [cronRaw, setCronRaw] = useState(initCron.raw)
  const cronState: CronBuilderState = {
    mode: cronMode, minute: Number(cronMinute), everyN: Number(cronEveryN),
    monthDay: Number(cronMonthDay), time: cronTime, raw: cronRaw,
  }

  // deliverTo state:已选平台 id 集合(desktop / qq / weixin / wecom / feishu)
  const [deliver, setDeliver] = useState<Set<string>>(() => parseDeliverTo(initial))
  const toggleDeliver = (id: string): void => setDeliver(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // approval state
  const initialApproval = parseApproval(initial)
  const [approvalDefault, setApprovalDefault] = useState<ApprovalMode>(initialApproval.defaultMode)
  const [toolOverrides, setToolOverrides] = useState<ToolOverrideRow[]>(() => seedOverrides(initialApproval.toolOverrides))
  const [askTimeoutMinutes, setAskTimeoutMinutes] = useState(initialApproval.askTimeoutMinutes)
  const nextIdRef = useRef(initialApproval.toolOverrides.length + 1)
  // 高级设置(工具审批)默认收起,减少主视觉杂乱;已有工具覆盖时自动展开,避免配置被藏。
  const [advancedOpen, setAdvancedOpen] = useState(initialApproval.toolOverrides.length > 0)

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
      // cron — 由模式构建器生成(raw 模式直接取手写值)
      const expr = buildCron(cronState)
      if (!isValidCronShape(expr)) { setError('cron 表达式需为 5 段(如 0 9 * * 1)'); return null }
      schedule = { kind: 'cron', expr }
    }

    // deliverTo — empty allowed (run-only);按 DELIVER_PLATFORMS 规范顺序输出
    const deliverTo = buildDeliverTo(DELIVER_PLATFORMS.filter(p => deliver.has(p)))

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

  const approvalSummary = `默认${approvalModeLabel(approvalDefault)}`
    + (toolOverrides.length > 0 ? ` · ${toolOverrides.length} 条工具覆盖` : '')
    + (hasAnyAsk && askTimeoutMinutes ? ` · 超时 ${askTimeoutMinutes} 分` : '')

  return (
    <div data-testid="automation-form" className="flex w-full max-w-2xl flex-col gap-4">
      {/* ── 基本 ───────────────────────────────────────────── */}
      <section className={CARD}>
        <div className={SECTION_TITLE}>基本</div>
        <label className="text-xs text-fg-muted">名称
          <input data-testid="automation-form-name" value={name} onChange={e => setName(e.target.value)}
            className={INPUT} />
        </label>
        <label className="text-xs text-fg-muted">Prompt(任务内容)
          <textarea data-testid="automation-form-prompt" value={prompt} rows={4} onChange={e => setPrompt(e.target.value)}
            className={INPUT + ' resize-none'} />
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
      </section>

      {/* ── 调度与投递 ─────────────────────────────────────── */}
      <section className={CARD}>
        <div className={SECTION_TITLE}>调度</div>
        <div className="flex flex-wrap items-end gap-2 text-xs text-fg-muted">
          <label>频率
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
                className="mt-1 w-20 rounded-lg border border-transparent bg-bg px-2 py-2 text-xs text-fg outline-none focus:border-accent" />
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
                className="mt-1 rounded-lg border border-transparent bg-bg px-2 py-2 text-xs text-fg outline-none focus:border-accent" />
            </label>
          )}
        </div>
        {kind === 'cron' && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-2 text-xs text-fg-muted">
              <label>重复方式
                <Select testId="automation-form-cron-mode" className="mt-1"
                  value={cronMode} onChange={v => setCronMode(v as CronMode)}
                  options={CRON_MODE_OPTIONS} />
              </label>
              {cronMode === 'hourly' && (
                <label>第 N 分
                  <input data-testid="automation-form-cron-minute" type="number" min="0" max="59"
                    value={cronMinute} onChange={e => setCronMinute(e.target.value)}
                    className="mt-1 w-20 rounded-lg border border-transparent bg-bg px-2 py-2 text-xs text-fg outline-none focus:border-accent" />
                </label>
              )}
              {cronMode === 'everyNHours' && (
                <label>每 N 小时
                  <input data-testid="automation-form-cron-everyn" type="number" min="1" max="23"
                    value={cronEveryN} onChange={e => setCronEveryN(e.target.value)}
                    className="mt-1 w-20 rounded-lg border border-transparent bg-bg px-2 py-2 text-xs text-fg outline-none focus:border-accent" />
                </label>
              )}
              {cronMode === 'monthly' && (
                <label>几号
                  <input data-testid="automation-form-cron-monthday" type="number" min="1" max="31"
                    value={cronMonthDay} onChange={e => setCronMonthDay(e.target.value)}
                    className="mt-1 w-20 rounded-lg border border-transparent bg-bg px-2 py-2 text-xs text-fg outline-none focus:border-accent" />
                </label>
              )}
              {(cronMode === 'monthly' || cronMode === 'weekdays') && (
                <label>时刻
                  <input data-testid="automation-form-cron-time" type="time" value={cronTime} onChange={e => setCronTime(e.target.value)}
                    className="mt-1 rounded-lg border border-transparent bg-bg px-2 py-2 text-xs text-fg outline-none focus:border-accent" />
                </label>
              )}
            </div>
            {cronMode === 'raw' ? (
              <div className="flex flex-col gap-1">
                <input data-testid="automation-form-schedule-cron"
                  value={cronRaw} onChange={e => setCronRaw(e.target.value)}
                  placeholder="如: 0 9 * * 1"
                  className="w-full rounded-lg border border-transparent bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent" />
                <div className="text-3xs text-fg-subtle">
                  5 段空格分隔: 分 时 日 月 周 (如 <code className="font-mono">0 9 * * 1</code> = 每周一 09:00)。守护进程做权威校验。
                </div>
              </div>
            ) : (
              <div data-testid="automation-form-cron-preview"
                className="rounded-lg bg-bg px-3 py-2 text-3xs text-fg-subtle">
                {describeCron(cronState)} · <code className="font-mono text-fg-muted">{buildCron(cronState)}</code>
              </div>
            )}
          </div>
        )}

        <div className="mt-1 border-t border-border pt-3">
          <div className="mb-1.5 text-xs text-fg-muted">结果投递</div>
          <div className="flex flex-wrap gap-2">
            {DELIVER_PLATFORMS.map(p => {
              const on = deliver.has(p)
              return (
                <button key={p} type="button" role="checkbox" aria-checked={on}
                  data-testid={`automation-form-deliver-${p}`}
                  onClick={() => toggleDeliver(p)}
                  className={'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors ' +
                    (on
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-fg-muted hover:border-fg-subtle hover:text-fg')}>
                  {on && <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} />}
                  {deliveryPlatformLabel(p)}
                </button>
              )
            })}
          </div>
          {deliver.size === 0
            ? <div className="mt-1.5 text-3xs text-fg-subtle">未选则仅执行,不推送结果</div>
            : deliver.size > (deliver.has('desktop') ? 1 : 0) && (
                <div className="mt-1.5 text-3xs text-fg-subtle">投递到 IM 需网关运行、且该平台已在「IM 网关」绑定</div>
              )}
        </div>
      </section>

      {/* ── 高级设置(折叠):工具调用审批 ──────────────────── */}
      <section className="rounded-xl bg-surface shadow-sm">
        <button type="button" data-testid="automation-form-advanced-toggle"
          onClick={() => setAdvancedOpen(v => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left">
          <span className={SECTION_TITLE}>高级 · 工具调用审批</span>
          {!advancedOpen && <span className="truncate text-3xs text-fg-subtle">{approvalSummary}</span>}
          <ChevronDown className={'ml-auto h-4 w-4 shrink-0 text-fg-subtle transition-transform ' + (advancedOpen ? '' : '-rotate-90')} strokeWidth={1.5} />
        </button>
        {advancedOpen && (
          <div className="flex flex-col gap-2 border-t border-border px-4 py-4 text-xs text-fg-muted">
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
                      className="flex-1 rounded-lg border border-transparent bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent" />
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
              className={'w-fit ' + BTN_GHOST + ' !py-1 !px-2'}>
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
                  className="w-28 rounded-lg border border-transparent bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent" />
              </label>
            )}
          </div>
        )}
      </section>

      {error && <div className="text-xs text-danger">{error}</div>}

      {/* ── 操作 ───────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <button data-testid="automation-save" disabled={saving} onClick={() => void saveOnly()}
          className={BTN_PRIMARY}>保存</button>
        <button data-testid="automation-run-now" disabled={saving}
          onClick={() => void handleRunNow()}
          className={BTN_GHOST}>
          立即运行
        </button>
        {initial && (
          <button data-testid="automation-toggle-form" title={initial.enabled ? '暂停后不再按时触发' : '启用后从现在起重新计时'}
            onClick={() => void onToggle(initial)}
            className={'ml-auto ' + BTN_GHOST + (initial.enabled ? '' : ' text-success hover:text-success')}>
            {initial.enabled ? '⏸ 暂停' : '▶ 启用'}
          </button>
        )}
        {initial && (
          <button data-testid="automation-remove" onClick={() => onRemove(initial.id)}
            className={BTN_DANGER_GHOST + (removeConfirming ? ' bg-danger/10' : '')}>
            {removeConfirming ? '确认删除?' : '删除任务'}
          </button>
        )}
      </div>
    </div>
  )
}
