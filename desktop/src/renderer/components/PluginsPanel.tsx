import { useCallback, useEffect, useState } from 'react'
import type { McpServerView, McpResourceView, BuiltinToolView } from '../../shared/types'
import McpServerForm, { type McpFormValue, type McpPrefill } from './McpServerForm'
import { BUILTIN_CAPABILITIES, RECOMMENDED_MCP } from '../lib/pluginShowcase'
import { joinBuiltinTools, type BuiltinToolRow } from '../lib/builtinCapabilityDetail'

interface PluginsPanelProps {
  servers: McpServerView[]
  configError: string | null
  /** turn 运行中:工具集变更操作禁用(启停/重启/删除/表单提交),只读浏览不受限 */
  busy: boolean
  onBack: () => void
  onRefresh: () => void
  onToggle: (name: string, enable: boolean) => void
  onRestart: (name: string) => void
  onRemove: (scope: 'user' | 'project', name: string) => void
  onSubmitForm: (v: McpFormValue) => Promise<boolean>
}

const STATE_DOT: Record<string, string> = {
  starting: 'bg-warning animate-pulse',
  ready: 'bg-success',
  disabled: 'bg-fg-subtle',
  error: 'bg-danger',
}
const STATE_LABEL: Record<string, string> = {
  starting: '启动中…', ready: '就绪', disabled: '已停用', error: '错误',
}
const SCOPE_LABEL: Record<string, string> = { user: '用户', project: '本项目', builtin: '内置' }

type Tab = 'tools' | 'resources' | 'prompts' | 'logs'

/** 左列顶部「能力概览」的哨兵选中值(非某个 server)。 */
const OVERVIEW = '__overview__'

/** 内置工具的一行:真名 + 描述 + 可折叠参数(JSON schema);missing 则淡色标记。 */
function BuiltinToolRowView({ row }: { row: BuiltinToolRow }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const hasParams = row.parameters != null && typeof row.parameters === 'object'
    && Object.keys(row.parameters as object).length > 0
  return (
    <div className="rounded-lg bg-surface/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-fg">{row.name}</span>
        {row.missing && <span className="text-3xs text-fg-subtle">定义缺失 / 当前不可用</span>}
        {hasParams && (
          <button onClick={() => setExpanded(v => !v)}
            className="ml-auto shrink-0 text-3xs text-fg-subtle hover:text-fg-muted">
            {expanded ? '▼ 参数' : '▶ 参数'}
          </button>
        )}
      </div>
      {row.description && <div className="mt-0.5 text-xs text-fg-muted">{row.description}</div>}
      {hasParams && expanded && (
        <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg px-2 py-1 text-2xs text-fg-subtle">
{JSON.stringify(row.parameters, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function PluginsPanel(props: PluginsPanelProps): JSX.Element {
  const { servers, configError, busy, onBack, onRefresh } = props
  const [selected, setSelected] = useState<string>(OVERVIEW)   // 默认落在能力概览
  const [tab, setTab] = useState<Tab>('tools')
  const [formMode, setFormMode] = useState<'hidden' | 'add' | 'edit'>('hidden')
  const [addPrefill, setAddPrefill] = useState<McpPrefill | null>(null)  // 推荐 MCP 一键添加的预填
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [tabContent, setTabContent] = useState<{ resources: McpResourceView[]; prompts: string; logs: string }>({
    resources: [], prompts: '', logs: '',
  })

  // 内置能力目录状态:懒加载,builtinError 阻止失败后自旋。
  const [builtinCatalog, setBuiltinCatalog] = useState<BuiltinToolView[] | null>(null)
  const [builtinError, setBuiltinError] = useState(false)

  // 进入面板拉全量(spec §5.2)
  useEffect(() => { onRefresh() }, [onRefresh])

  const current = selected !== OVERVIEW ? (servers.find(s => s.name === selected) ?? null) : null

  // 选中值为 'builtin:<id>' 哨兵时,解析出对应内置能力(否则 null)。
  const selectedBuiltin = selected.startsWith('builtin:')
    ? (BUILTIN_CAPABILITIES.find(c => c.id === selected.slice('builtin:'.length)) ?? null)
    : null

  // 选中/换 tab 时拉取动态内容(工具列表在 servers 里,静态)
  useEffect(() => {
    if (!current) return
    let stale = false
    void (async () => {
      try {
        if (tab === 'resources') {
          const { resources } = await window.wraith.mcpResources(current.name)
          if (!stale) setTabContent(c => ({ ...c, resources }))
        } else if (tab === 'prompts') {
          const { text } = await window.wraith.mcpPrompts(current.name)
          if (!stale) setTabContent(c => ({ ...c, prompts: text }))
        } else if (tab === 'logs') {
          const { lines } = await window.wraith.mcpLogs(current.name)
          if (!stale) setTabContent(c => ({ ...c, logs: lines }))
        }
      } catch (err) {
        console.error('[wraith] mcp tab fetch error:', err)
      }
    })()
    return () => { stale = true }
  }, [current?.name, current?.state, tab])

  useEffect(() => { setConfirmingRemove(false); setFormMode('hidden') }, [current?.name])

  const fetchBuiltinCatalog = useCallback(async () => {
    try {
      const { tools } = await window.wraith.listBuiltinTools()
      setBuiltinCatalog(tools); setBuiltinError(false)
    } catch (err) {
      console.error('[wraith] listBuiltinTools error:', err); setBuiltinError(true)
    }
  }, [])

  // 首次进入任一能力详情时拉一次目录并缓存(builtinError 阻止失败后自旋)。
  useEffect(() => {
    if (selectedBuiltin && builtinCatalog === null && !builtinError) void fetchBuiltinCatalog()
  }, [selectedBuiltin, builtinCatalog, builtinError, fetchBuiltinCatalog])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="plugins-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="text-sm font-bold text-fg">MCP</span>
        <span className="text-xs text-fg-subtle">服务器 · 内置能力</span>
      </div>

      {configError && (
        <div data-testid="mcp-config-error" className="border-b border-border bg-danger/10 px-4 py-2 text-xs text-danger">
          配置文件解析失败:{configError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 左列 */}
        <div className="flex w-56 shrink-0 flex-col border-r border-border">
          <div className="flex-1 overflow-y-auto p-2">
            <button data-testid="mcp-overview-item"
              onClick={() => { setSelected(OVERVIEW); setFormMode('hidden') }}
              className={'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ' +
                (selected === OVERVIEW ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
              <span className="shrink-0 text-accent">✨</span>
              <span className="truncate">能力概览</span>
            </button>
            <div className="my-1 h-px bg-border" />
            {servers.length === 0 && (
              <div className="px-2 py-3 text-xs text-fg-subtle">还没有 MCP server</div>
            )}
            {servers.map(s => (
              <button key={s.name} data-testid="mcp-server-item"
                onClick={() => { setSelected(s.name); setTab('tools') }}
                className={'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ' +
                  (selected === s.name ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
                <span className={'h-2 w-2 shrink-0 rounded-full ' + (STATE_DOT[s.state] ?? 'bg-fg-subtle')} />
                <span className="truncate">{s.name}</span>
                <span className="ml-auto shrink-0 text-3xs text-fg-subtle">
                  {SCOPE_LABEL[s.scope]}{s.shadowed ? '·覆盖' : ''}
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-border p-2">
            <button data-testid="mcp-add" disabled={busy}
              onClick={() => { setAddPrefill(null); setFormMode('add'); setConfirmingRemove(false) }}
              className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface/60 disabled:opacity-60">
              ＋ 添加 server…
            </button>
          </div>
        </div>

        {/* 右详情 */}
        <div data-testid="mcp-detail" className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
          {formMode !== 'hidden' ? (
            <McpServerForm
              mode={formMode}
              initial={formMode === 'edit' && current ? current : null}
              prefill={formMode === 'add' ? addPrefill : null}
              busy={busy}
              onCancel={() => setFormMode('hidden')}
              onSubmit={async v => { const ok = await props.onSubmitForm(v); if (ok) setFormMode('hidden'); return ok }}
            />
          ) : selectedBuiltin ? (
            <div data-testid="mcp-builtin-detail" className="flex min-w-0 flex-1 flex-col gap-3">
              <button data-testid="mcp-builtin-back" onClick={() => setSelected(OVERVIEW)}
                className="self-start rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 概览</button>
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">{selectedBuiltin.icon}</span>
                <span className="text-sm font-bold text-fg">{selectedBuiltin.name}</span>
                <span className="text-2xs text-fg-subtle">{selectedBuiltin.desc}</span>
                <span className="ml-1 shrink-0 rounded bg-surface px-1.5 py-0.5 text-4xs text-fg-subtle">已内置</span>
              </div>
              {builtinError && (
                <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
                  无法加载内置工具定义
                  <button data-testid="mcp-builtin-retry"
                    onClick={() => { setBuiltinError(false); void fetchBuiltinCatalog() }}
                    className="ml-2 underline hover:no-underline">重试</button>
                </div>
              )}
              <div className="flex flex-col gap-1">
                {joinBuiltinTools(selectedBuiltin.tools, builtinCatalog ?? []).map(row => (
                  <BuiltinToolRowView key={row.name} row={row} />
                ))}
              </div>
            </div>
          ) : !current ? (
            <div data-testid="mcp-overview" className="flex flex-col gap-5">
              <section>
                <div className="mb-1 text-sm font-bold text-fg">内置能力 · 开箱即用</div>
                <div className="mb-3 text-2xs text-fg-subtle">Wraith 自带的能力,无需配置即可在对话中调用。</div>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  {BUILTIN_CAPABILITIES.map(c => (
                    <button key={c.id} type="button" data-testid="mcp-builtin-card"
                      onClick={() => setSelected('builtin:' + c.id)}
                      title={c.tools.join(' · ')}
                      className="rounded-lg border border-border bg-surface/40 p-3 text-left hover:border-accent">
                      <div className="flex items-center gap-2">
                        <span className="text-base leading-none">{c.icon}</span>
                        <span className="truncate text-xs font-medium text-fg">{c.name}</span>
                        <span className="ml-auto shrink-0 rounded bg-surface px-1.5 py-0.5 text-4xs text-fg-subtle">已内置</span>
                      </div>
                      <div className="mt-1 text-2xs text-fg-muted">{c.desc}</div>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <div className="mb-1 text-sm font-bold text-fg">推荐 MCP · 一键添加</div>
                <div className="mb-3 text-2xs text-fg-subtle">选一个 → 自动预填命令,补好路径 / 密钥再保存。</div>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  {RECOMMENDED_MCP.map(m => (
                    <div key={m.id} className="flex flex-col rounded-lg border border-border p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base leading-none">{m.icon}</span>
                        <span className="truncate text-xs font-medium text-fg">{m.name}</span>
                      </div>
                      <div className="mt-1 flex-1 text-2xs text-fg-muted">{m.desc}</div>
                      <button data-testid={`mcp-rec-add-${m.id}`} disabled={busy}
                        onClick={() => {
                          setAddPrefill({ name: m.id, command: m.command, args: m.args, envKeys: m.envKeys })
                          setConfirmingRemove(false); setFormMode('add')
                        }}
                        className="mt-2 self-start rounded-lg border border-border px-2 py-1 text-2xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-60">
                        ＋ 添加
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-3">
                <span className={'h-2.5 w-2.5 rounded-full ' + (STATE_DOT[current.state] ?? '')} />
                <span className="text-sm font-bold text-fg">{current.name}</span>
                <span className="text-xs text-fg-subtle">{STATE_LABEL[current.state]} · {current.transport} · {SCOPE_LABEL[current.scope]}</span>
              </div>
              {current.error && (
                <div className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{current.error}</div>
              )}
              <div className="mb-4 flex items-center gap-2">
                <button data-testid="mcp-toggle" disabled={busy || current.state === 'starting'}
                  onClick={() => props.onToggle(current.name, !current.enabled)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-60">
                  {current.enabled ? '停用' : '启用'}
                </button>
                <button data-testid="mcp-restart" disabled={busy || !current.enabled || current.state === 'starting'}
                  onClick={() => props.onRestart(current.name)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-60">
                  重启
                </button>
                {current.scope !== 'builtin' && (
                  <>
                    {current.transport === 'stdio' && (
                      <button data-testid="mcp-edit" disabled={busy}
                        onClick={() => { setFormMode('edit'); setConfirmingRemove(false) }}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-60">
                        编辑
                      </button>
                    )}
                    <button data-testid="mcp-remove" disabled={busy}
                      onClick={() => {
                        if (!confirmingRemove) { setConfirmingRemove(true); return }
                        setConfirmingRemove(false)
                        props.onRemove(current.scope as 'user' | 'project', current.name)
                      }}
                      onBlur={() => setConfirmingRemove(false)}
                      className={'rounded-lg border px-3 py-1.5 text-xs disabled:opacity-60 ' +
                        (confirmingRemove ? 'border-danger text-danger' : 'border-border text-fg-muted hover:text-danger')}>
                      {confirmingRemove ? '确认删除?' : '删除'}
                    </button>
                  </>
                )}
              </div>

              <div className="mb-2 flex gap-1 border-b border-border">
                {(['tools', 'resources', 'prompts', 'logs'] as Tab[]).map(t => (
                  <button key={t} data-testid={`mcp-tab-${t}`} onClick={() => setTab(t)}
                    className={'px-3 py-1.5 text-xs ' + (tab === t ? 'border-b-2 border-accent text-fg' : 'text-fg-muted')}>
                    {t === 'tools' ? `工具(${current.tools.length})` : t === 'resources' ? '资源' : t === 'prompts' ? '提示词' : '日志'}
                  </button>
                ))}
              </div>

              {tab === 'tools' && (
                <div className="flex flex-col gap-1">
                  {current.tools.length === 0 && <div className="text-xs text-fg-subtle">无工具(未就绪或空)</div>}
                  {current.tools.map(t => (
                    <div key={t.name} className="rounded-lg bg-surface/60 px-3 py-2">
                      <div className="font-mono text-xs text-fg">{t.name}</div>
                      {t.description && <div className="mt-0.5 text-xs text-fg-muted">{t.description}</div>}
                    </div>
                  ))}
                </div>
              )}
              {tab === 'resources' && (
                <div className="flex flex-col gap-1">
                  {tabContent.resources.length === 0 && <div className="text-xs text-fg-subtle">无资源</div>}
                  {tabContent.resources.map(r => (
                    <div key={r.uri} className="rounded-lg bg-surface/60 px-3 py-2">
                      <div className="font-mono text-xs text-fg">{r.uri}</div>
                      <div className="mt-0.5 text-xs text-fg-muted">{r.name}{r.description ? ` — ${r.description}` : ''}</div>
                    </div>
                  ))}
                </div>
              )}
              {tab === 'prompts' && (
                <pre className="whitespace-pre-wrap rounded-lg bg-surface/60 p-3 text-xs text-fg-muted">{tabContent.prompts || '无提示词'}</pre>
              )}
              {tab === 'logs' && (
                <>
                  <button
                    data-testid="mcp-logs-refresh"
                    className="mb-1 self-start rounded px-2 py-1 text-2xs text-fg-subtle hover:text-accent"
                    onClick={async () => {
                      try {
                        const { lines } = await window.wraith.mcpLogs(current.name)
                        setTabContent(c => ({ ...c, logs: lines }))
                      } catch (err) {
                        console.error('[wraith] mcp logs refresh error:', err)
                      }
                    }}>
                    ⟳ 刷新
                  </button>
                  <pre className="whitespace-pre-wrap rounded-lg bg-black/[0.04] p-3 font-mono text-2xs text-fg-muted">{tabContent.logs || '(空)'}</pre>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
