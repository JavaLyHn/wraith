import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import {
  PROVIDER_CATALOG, findCatalogEntry,
  baseProviderId, nextInstanceId, instanceDisplayName, prefillForm,
} from '../../shared/providerCatalog'
import ProviderIcon from './ProviderIcon'
import type { ModelListResult, ProviderView } from '../../shared/types'

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; msg?: string }

export default function ProvidersPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [data, setData] = useState<ModelListResult | null>(null)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null)   // 正在编辑的实例 id(可能是新铸造的)
  const [form, setForm] = useState({ apiKey: '', model: '', baseUrl: '', protocol: 'openai' as 'openai' | 'anthropic', label: '' })
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>({ status: 'idle' })

  const refresh = async (): Promise<void> => { try { setData(await window.wraith.modelList()) } catch { /* ignore */ } }
  useEffect(() => { void refresh() }, [])

  const configured = new Map<string, ProviderView>((data?.providers ?? []).map(p => [p.name, p]))
  const configuredIds = new Set(configured.keys())
  const defaultId = data?.default

  // 已配置实例(含动态 freellmapi-N):所有 hasKey 的条目
  const doneInstances = (data?.providers ?? []).filter(p => p.hasKey)

  // 编辑已存实例:用【已存值】兜底 catalog 默认(修回填 bug)
  const openEdit = (id: string): void => {
    const c = configured.get(id)
    const e = findCatalogEntry(baseProviderId(id))
    setForm({ apiKey: '', ...prefillForm(c, e) })
    setError(null); setTest({ status: 'idle' }); setEditing(id)
  }

  // 新增可重复 provider 的实例:铸造下一个 id,表单填 catalog 默认
  const openNew = (baseId: string): void => {
    const id = nextInstanceId(baseId, configuredIds)
    const e = findCatalogEntry(baseId)
    setForm({ apiKey: '', ...prefillForm(undefined, e) })
    setError(null); setTest({ status: 'idle' }); setEditing(id)
  }

  const patchForm = (patch: Partial<typeof form>): void => {
    setForm({ ...form, ...patch })
    if (test.status !== 'idle') setTest({ status: 'idle' })   // 改字段即清测试结果
  }

  const save = async (): Promise<void> => {
    if (!editing) return
    try {
      await window.wraith.setProvider({ id: editing, apiKey: form.apiKey, model: form.model, baseUrl: form.baseUrl, protocol: form.protocol, label: form.label })
      setEditing(null); void refresh()
    } catch (err) { setError((err as Error).message) }
  }
  const runTest = async (): Promise<void> => {
    if (!editing) return
    setTest({ status: 'testing' })
    try {
      const r = await window.wraith.testProvider({ id: editing, apiKey: form.apiKey, model: form.model, baseUrl: form.baseUrl, protocol: form.protocol })
      if (r.ok) setTest({ status: 'ok', msg: `连接成功 · ${r.model ?? form.model} · ${r.latencyMs ?? '?'}ms` })
      else setTest({ status: 'fail', msg: r.error || '连接失败' })
    } catch (err) { setTest({ status: 'fail', msg: (err as Error).message }) }
  }
  const remove = async (id: string): Promise<void> => {
    try { await window.wraith.removeProvider(id); setEditing(null); void refresh() }
    catch (err) { setError((err as Error).message) }
  }
  const setDefault = async (id: string): Promise<void> => {
    try { await window.wraith.setDefaultProvider(id); void refresh() }
    catch (err) { setError((err as Error).message) }
  }

  const matchQ = (id: string, name: string): boolean =>
    !q || name.toLowerCase().includes(q.toLowerCase()) || id.includes(q.toLowerCase())

  // 已配置组:每个 hasKey 实例一行(经 base entry 解析图标/显示名)
  const doneRows = doneInstances.filter(p => {
    const e = findCatalogEntry(baseProviderId(p.name))
    return matchQ(p.name, instanceDisplayName(p.name, p.label, e))
  })
  // 全部组:catalog 条目中 (未配置 或 repeatable) 的
  const restCatalog = PROVIDER_CATALOG.filter(e =>
    (!configured.get(e.id)?.hasKey || e.repeatable) && matchQ(e.id, e.displayName))
  const normalCatalog = restCatalog.filter(e => !e.codingPlan)
  const codingCatalog = restCatalog.filter(e => e.codingPlan)

  const renderDoneRow = (p: ProviderView): JSX.Element => {
    const e = findCatalogEntry(baseProviderId(p.name))
    const name = instanceDisplayName(p.name, p.label, e)
    return (
      <div key={p.name} className="mb-0.5 flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface/60">
        <ProviderIcon id={baseProviderId(p.name)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-fg">{name}{defaultId === p.name && <span className="ml-1 text-3xs text-accent">默认</span>}</div>
          <div className="truncate text-3xs text-fg-subtle">{p.model || '已配置'}</div>
        </div>
        {defaultId !== p.name &&
          <button data-testid="provider-setdefault" onClick={() => void setDefault(p.name)} className="text-3xs text-fg-muted hover:text-accent">设默认</button>}
        <button data-testid="provider-config" onClick={() => openEdit(p.name)} className="text-2xs text-fg-muted hover:text-accent">编辑</button>
      </div>
    )
  }
  const renderCatalogRow = (e: typeof PROVIDER_CATALOG[number]): JSX.Element => {
    const alreadyConfigured = configured.get(e.id)?.hasKey
    // repeatable 且已配置 → 显示"＋配置"(再加一个);未配置 → "＋配置";非 repeatable 已配置不会进本列表
    const onClick = e.repeatable ? () => openNew(e.id) : () => openEdit(e.id)
    return (
      <div key={e.id} className="mb-0.5 flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface/60">
        <ProviderIcon id={e.id} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-fg">{e.displayName}</div>
          <div className="truncate text-3xs text-fg-subtle">{e.repeatable && alreadyConfigured ? '可再加一个' : '未配置'}</div>
        </div>
        <button data-testid="provider-config" onClick={onClick} className="text-2xs text-fg-muted hover:text-accent">＋配置</button>
      </div>
    )
  }

  const editBase = editing ? findCatalogEntry(baseProviderId(editing)) : undefined
  const showLabelField = !!editBase?.repeatable
  const editHasKey = editing ? !!configured.get(editing)?.hasKey : false

  return (
    <div data-testid="providers-panel" className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <button data-testid="providers-back" onClick={onBack} title="返回对话" className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} /></button>
        <input data-testid="providers-search" value={q} onChange={e => setQ(e.target.value)} placeholder="搜索 provider…"
          className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-xs outline-none focus:border-accent" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto panel-content">
        {doneRows.length > 0 && <><div className="mt-2 px-2 text-3xs uppercase tracking-wider text-fg-subtle">已配置</div>{doneRows.map(renderDoneRow)}</>}
        {normalCatalog.length > 0 && <><div className="mt-3 px-2 text-3xs uppercase tracking-wider text-fg-subtle">普通 API</div>{normalCatalog.map(renderCatalogRow)}</>}
        {codingCatalog.length > 0 && <><div className="mt-3 px-2 text-3xs uppercase tracking-wider text-fg-subtle">Coding Plan</div>{codingCatalog.map(renderCatalogRow)}</>}
      </div>
      {editing && (() => { const e = editBase; return (
        <div className="mt-2 rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-fg"><ProviderIcon id={baseProviderId(editing)} /> {instanceDisplayName(editing, form.label, e)}
            {e?.consoleUrl && <a href={e.consoleUrl} target="_blank" rel="noreferrer" className="ml-auto text-3xs text-accent">获取密钥 →</a>}</div>
          {showLabelField && (
            <label className="block text-3xs text-fg-subtle">名称/备注
              <input data-testid="provider-label" value={form.label} onChange={ev => patchForm({ label: ev.target.value })} placeholder="可选,如:工作号"
                className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" /></label>
          )}
          <label className={`block text-3xs text-fg-subtle ${showLabelField ? 'mt-2' : ''}`}>API Key{editHasKey ? '(已配置 · 留空=不改)' : ''}
            <input data-testid="provider-apikey" type="password" value={form.apiKey} onChange={ev => patchForm({ apiKey: ev.target.value })}
              placeholder={editHasKey ? '已配置 · 留空=不改' : ''}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" /></label>
          <label className="mt-2 block text-3xs text-fg-subtle">模型
            <input data-testid="provider-model" list="pm-suggest" value={form.model} onChange={ev => patchForm({ model: ev.target.value })}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" />
            <datalist id="pm-suggest">{(e?.suggestedModels ?? []).map(m => <option key={m} value={m} />)}</datalist></label>
          <label className="mt-2 block text-3xs text-fg-subtle">Base URL
            <input data-testid="provider-baseurl" value={form.baseUrl} onChange={ev => patchForm({ baseUrl: ev.target.value })}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" /></label>
          {test.status !== 'idle' && (
            <div data-testid="provider-test-result" className={`mt-2 text-3xs ${test.status === 'ok' ? 'text-accent' : test.status === 'fail' ? 'text-danger' : 'text-fg-subtle'}`}>
              {test.status === 'testing' ? '测试中…' : test.status === 'ok' ? `✓ ${test.msg}` : `✗ ${test.msg}`}
            </div>
          )}
          {error && <div className="mt-2 text-3xs text-danger">{error}</div>}
          <div className="mt-3 flex gap-2">
            <button data-testid="provider-test" onClick={() => void runTest()} disabled={test.status === 'testing'}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-accent disabled:opacity-50">测试连接</button>
            <button data-testid="provider-save" onClick={() => void save()} className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white">保存</button>
            <button onClick={() => setEditing(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted">取消</button>
            {editHasKey &&
              <button data-testid="provider-remove" onClick={() => { void remove(editing) }} className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-danger">删除</button>}
          </div>
        </div>
      )})()}
    </div>
  )
}
