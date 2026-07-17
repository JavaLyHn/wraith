import { useEffect, useState } from 'react'
import type { McpServerView } from '../../shared/types'
import { buildFormValue, envRowsFromKeys, type EnvRow, type McpFormValue } from '../../shared/mcpFormValue'
import { formatMcpTestResult } from '../lib/mcpTestResultText'

export type { McpFormValue } from '../../shared/mcpFormValue'

/** add 模式下的预填值(推荐 MCP 一键添加用);edit 模式用 initial。 */
export interface McpPrefill {
  name?: string
  command?: string
  args?: string[]
  envKeys?: string[]
}

interface McpServerFormProps {
  mode: 'add' | 'edit'
  initial: McpServerView | null
  prefill?: McpPrefill | null
  busy: boolean
  onCancel: () => void
  onSubmit: (v: McpFormValue) => Promise<boolean>
}

export default function McpServerForm({ mode, initial, prefill, busy, onCancel, onSubmit }: McpServerFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? prefill?.name ?? '')
  const [command, setCommand] = useState(initial?.command ?? prefill?.command ?? '')
  const [argsText, setArgsText] = useState((initial?.args ?? prefill?.args)?.join('\n') ?? '')
  const [scope, setScope] = useState<'user' | 'project'>(initial && initial.scope !== 'builtin' ? initial.scope : 'user')
  const [envRows, setEnvRows] = useState<EnvRow[]>(
    initial ? envRowsFromKeys(initial.envKeys) : prefill?.envKeys ? envRowsFromKeys(prefill.envKeys) : [],
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // 任意字段变更 → 旧测试结果对新配置无效,清空
  useEffect(() => { setTestResult(null) }, [name, command, argsText, scope, envRows])

  const setRow = (i: number, patch: Partial<EnvRow>): void =>
    setEnvRows(rows => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const handleSubmit = async (): Promise<void> => {
    const v = buildFormValue(scope, name, command, argsText, envRows)
    if (!v.name || !v.command) { setError('name 与 command 必填'); return }
    setSubmitting(true); setError(null)
    const ok = await onSubmit(v)
    setSubmitting(false)
    if (!ok) setError('保存失败,查看控制台')
  }

  const handleTest = async (): Promise<void> => {
    const v = buildFormValue(scope, name, command, argsText, envRows)
    if (!v.name || !v.command) { setError('name 与 command 必填'); return }
    setTesting(true); setError(null); setTestResult(null)
    try {
      const r = await window.wraith.mcpTest(v)   // 临时进程探测,不落盘
      setTestResult(formatMcpTestResult(r))
    } catch (err) {
      console.error('[wraith] mcpTest error:', err)
      setTestResult({ kind: 'err', text: '❌ 连接失败:后端未连接或测试请求失败' })
    }
    setTesting(false)
  }

  return (
    <div data-testid="mcp-form" className="flex max-w-xl flex-col gap-3">
      <div className="text-sm font-bold text-fg">{mode === 'add' ? '添加 MCP server' : `编辑 ${initial?.name}`}</div>

      <label className="text-xs text-fg-muted">名称
        <input data-testid="mcp-form-name" value={name} disabled={mode === 'edit'}
          onChange={e => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-accent disabled:opacity-60" />
      </label>

      <label className="text-xs text-fg-muted">命令(stdio)
        <input data-testid="mcp-form-command" value={command} placeholder="npx"
          onChange={e => setCommand(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent" />
      </label>

      <label className="text-xs text-fg-muted">参数(每行一个)
        <textarea data-testid="mcp-form-args" value={argsText} rows={3}
          onChange={e => setArgsText(e.target.value)}
          className="mt-1 w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent" />
      </label>

      <div className="text-xs text-fg-muted">
        环境变量 <span className="text-fg-subtle">(值留空 = 保留原值,不回显密钥)</span>
        {envRows.map((r, i) => (
          <div key={i} className="mt-1 flex gap-2">
            <input data-testid="mcp-form-env-key" value={r.key} placeholder="KEY"
              onChange={e => setRow(i, { key: e.target.value })}
              className="w-40 rounded-lg border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent" />
            <input data-testid="mcp-form-env-value" type="password" value={r.value} placeholder="••••(留空保留)"
              autoComplete="new-password"
              onChange={e => setRow(i, { value: e.target.value })}
              className="flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent" />
          </div>
        ))}
        <button data-testid="mcp-form-env-add" onClick={() => setEnvRows(rows => [...rows, { key: '', value: '' }])}
          className="mt-1 rounded px-2 py-1 text-2xs text-fg-subtle hover:text-accent">＋ 加一行</button>
      </div>

      <div className="flex items-center gap-4 text-xs text-fg-muted">
        作用域:
        <label className="flex items-center gap-1">
          <input data-testid="mcp-form-scope-user" type="radio" checked={scope === 'user'} onChange={() => setScope('user')} disabled={mode === 'edit'} />
          用户级(所有项目)
        </label>
        <label className="flex items-center gap-1">
          <input data-testid="mcp-form-scope-project" type="radio" checked={scope === 'project'} onChange={() => setScope('project')} disabled={mode === 'edit'} />
          本项目
        </label>
      </div>

      {error && <div className="text-xs text-danger">{error}</div>}

      {testResult && (
        <div data-testid="mcp-form-test-result"
          className={'whitespace-pre-wrap break-words font-mono text-xs ' +
            (testResult.kind === 'ok' ? 'text-ok' : 'text-danger')}>
          {testResult.text}
        </div>
      )}

      <div className="flex gap-2">
        <button data-testid="mcp-form-submit" disabled={busy || submitting || testing} onClick={() => void handleSubmit()}
          className="rounded-lg bg-accent px-4 py-2 text-xs text-white disabled:opacity-60">
          {submitting ? '保存中…' : '保存'}
        </button>
        <button data-testid="mcp-form-test" disabled={busy || submitting || testing} onClick={() => void handleTest()}
          className="rounded-lg border border-border px-4 py-2 text-xs text-fg hover:border-accent disabled:opacity-60">
          {testing ? '测试中…' : '测试'}
        </button>
        <button data-testid="mcp-form-cancel" disabled={testing} onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-xs text-fg-muted disabled:opacity-60">取消</button>
      </div>
    </div>
  )
}
