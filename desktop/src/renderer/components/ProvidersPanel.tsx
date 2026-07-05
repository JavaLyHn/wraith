import { useEffect, useState } from 'react'
import { PROVIDER_CATALOG, findCatalogEntry } from '../../shared/providerCatalog'
import ProviderIcon from './ProviderIcon'
import type { ModelListResult } from '../../shared/types'

export default function ProvidersPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [data, setData] = useState<ModelListResult | null>(null)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null)      // provider id in edit form
  const [form, setForm] = useState({ apiKey: '', model: '', baseUrl: '', protocol: 'openai' as 'openai' | 'anthropic' })
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => { try { setData(await window.wraith.modelList()) } catch { /* ignore */ } }
  useEffect(() => { void refresh() }, [])

  const configured = new Map((data?.providers ?? []).map(p => [p.name, p]))
  const defaultId = data?.default

  const openEdit = (id: string): void => {
    const e = findCatalogEntry(id)
    setForm({ apiKey: '', model: configured.get(id)?.model || e?.suggestedModels[0] || '',
      baseUrl: e?.defaultBaseUrl || '', protocol: e?.protocol || 'openai' })
    setError(null); setEditing(id)
  }
  const save = async (): Promise<void> => {
    if (!editing) return
    try {
      await window.wraith.setProvider({ id: editing, apiKey: form.apiKey, model: form.model, baseUrl: form.baseUrl, protocol: form.protocol })
      setEditing(null); void refresh()
    } catch (err) { setError((err as Error).message) }
  }
  const remove = async (id: string): Promise<void> => {
    try {
      await window.wraith.removeProvider(id)
      setEditing(null)
      void refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  const setDefault = async (id: string): Promise<void> => {
    try {
      await window.wraith.setDefaultProvider(id)
      void refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const list = PROVIDER_CATALOG.filter(e =>
    !q || e.displayName.toLowerCase().includes(q.toLowerCase()) || e.id.includes(q.toLowerCase()))
  const done = list.filter(e => configured.get(e.id)?.hasKey)
  const rest = list.filter(e => !configured.get(e.id)?.hasKey)

  const renderRow = (e: typeof PROVIDER_CATALOG[number]): JSX.Element => (
    <div key={e.id} className="mb-0.5 flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface/60">
      <ProviderIcon id={e.id} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-fg">{e.displayName}{defaultId === e.id && <span className="ml-1 text-[10px] text-accent">默认</span>}</div>
        <div className="truncate text-[10px] text-fg-subtle">{configured.get(e.id)?.hasKey ? (configured.get(e.id)?.model || '已配置') : '未配置'}</div>
      </div>
      {configured.get(e.id)?.hasKey && defaultId !== e.id &&
        <button data-testid="provider-setdefault" onClick={() => void setDefault(e.id)} className="text-[10px] text-fg-muted hover:text-accent">设默认</button>}
      <button data-testid="provider-config" onClick={() => openEdit(e.id)} className="text-[11px] text-fg-muted hover:text-accent">{configured.get(e.id)?.hasKey ? '编辑' : '＋配置'}</button>
    </div>
  )

  return (
    <div data-testid="providers-panel" className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <button data-testid="providers-back" onClick={onBack} className="text-xs text-fg-muted">← 返回</button>
        <input data-testid="providers-search" value={q} onChange={e => setQ(e.target.value)} placeholder="搜索 provider…"
          className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-xs outline-none focus:border-accent" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {done.length > 0 && <><div className="mt-2 px-2 text-[10px] uppercase tracking-wider text-fg-subtle">已配置</div>{done.map(renderRow)}</>}
        <div className="mt-3 px-2 text-[10px] uppercase tracking-wider text-fg-subtle">全部</div>
        {rest.map(renderRow)}
      </div>
      {editing && (() => { const e = findCatalogEntry(editing); return (
        <div className="mt-2 rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-fg"><ProviderIcon id={editing} /> {e?.displayName ?? editing}
            {e?.consoleUrl && <a href={e.consoleUrl} target="_blank" rel="noreferrer" className="ml-auto text-[10px] text-accent">获取密钥 →</a>}</div>
          <label className="block text-[10px] text-fg-subtle">API Key(留空=不改)
            <input data-testid="provider-apikey" type="password" value={form.apiKey} onChange={ev => setForm({ ...form, apiKey: ev.target.value })}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" /></label>
          <label className="mt-2 block text-[10px] text-fg-subtle">模型
            <input data-testid="provider-model" list="pm-suggest" value={form.model} onChange={ev => setForm({ ...form, model: ev.target.value })}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" />
            <datalist id="pm-suggest">{(e?.suggestedModels ?? []).map(m => <option key={m} value={m} />)}</datalist></label>
          <label className="mt-2 block text-[10px] text-fg-subtle">Base URL
            <input data-testid="provider-baseurl" value={form.baseUrl} onChange={ev => setForm({ ...form, baseUrl: ev.target.value })}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent" /></label>
          {error && <div className="mt-2 text-[10px] text-danger">{error}</div>}
          <div className="mt-3 flex gap-2">
            <button data-testid="provider-save" onClick={() => void save()} className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white">保存</button>
            <button onClick={() => setEditing(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted">取消</button>
            {configured.get(editing)?.hasKey &&
              <button data-testid="provider-remove" onClick={() => { void remove(editing); setEditing(null) }} className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-danger">删除</button>}
          </div>
        </div>
      )})()}
    </div>
  )
}
