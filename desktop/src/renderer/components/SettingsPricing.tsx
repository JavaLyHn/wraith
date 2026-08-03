import { useCallback, useEffect, useState } from 'react'
import { Coins, Plus, Trash2 } from 'lucide-react'
import type { PricingEntryView } from '../../shared/types'
import { currencySymbol, matchedModels, validateEntries } from '../lib/pricingView'

/**
 * 「设置 → 模型计价」。
 *
 * 计价按**模型前缀**索引，不按 provider —— 一个中转站 provider 上可以跑多个模型，
 * 每个模型的实付价不同。所以这里不是「每个 provider 一行」。
 *
 * 用户选择把表单放在设置里（而不是 Providers 面板里每个模型旁给「填价」），
 * 代价是模型名要手敲、敲错就静默不生效。两处补偿：
 *   1. 前缀框挂 datalist，候选是已配置的模型名（复用 model.list，不加 RPC）
 *   2. 每行实时显示「这条会命中：…」；命中 0 个时警示，但**不阻止保存**
 *      （用户可能在为一个还没配的模型预填价）
 *
 * 保存是**整表替换**（见后端 applyPricingEntries 的注释）：种子行只读、不回传。
 */
export default function SettingsPricing(): JSX.Element {
  const [rows, setRows] = useState<PricingEntryView[]>([])
  const [seeds, setSeeds] = useState<PricingEntryView[]>([])
  const [models, setModels] = useState<string[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await window.wraith.configGetPricing()
      setRows(r.entries.filter((e) => !e.seeded))
      setSeeds(r.entries.filter((e) => e.seeded))
    } catch (err) {
      setError((err as Error).message)
    }
    try {
      const m = await window.wraith.modelList()
      setModels(m.providers.map((p) => p.model).filter((s) => !!s && s.trim() !== ''))
    } catch {
      // 拿不到模型列表只是少了 datalist 候选与命中提示,不该让整个面板打不开
      setModels([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const patch = (i: number, over: Partial<PricingEntryView>): void =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...over } : r)))

  const num = (v: string): number => (v.trim() === '' ? 0 : Number(v))

  const save = async (): Promise<void> => {
    const invalid = validateEntries(rows)
    if (invalid) { setError(invalid); setNotice(''); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await window.wraith.configSetPricing(rows)
      if (r.ok) { setNotice('✅ 计价已保存，立即生效'); void load() } else { setError(r.error || '保存失败') }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const lbl = 'mb-1 block text-3xs uppercase tracking-wider text-fg-subtle'
  const inp = 'w-full rounded-lg border border-border bg-transparent px-2 py-1 text-xs outline-none placeholder:text-fg-subtle'

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-2 flex items-center gap-2 text-3xs uppercase tracking-wider text-fg-subtle">
          <Coins className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />模型计价
        </div>
        <p className="mb-3 text-2xs text-fg-muted">
          价格单位是「每百万 token」。<strong>模型前缀是前缀匹配</strong>：填 <code>glm</code> 会让
          所有 <code>glm-*</code> 套同一个价。官方牌价 ≠ 实付价，中转站的换算率只有你知道。
        </p>

        {error && <div data-testid="pricing-error" className="mb-2 text-xs text-danger">{error}</div>}
        {notice && <div className="mb-2 text-xs text-fg">{notice}</div>}

        <datalist id="pricing-model-options">
          {models.map((m) => <option key={m} value={m} />)}
        </datalist>

        {rows.map((r, i) => {
          const hits = matchedModels(r.modelPrefix, models)
          return (
            <div key={i} className="mb-3 rounded-lg border border-border p-2">
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-5">
                  <span className={lbl}>模型前缀</span>
                  <input data-testid={`pricing-prefix-${i}`} list="pricing-model-options" className={inp}
                    value={r.modelPrefix} placeholder="glm-4.7"
                    onChange={(e) => patch(i, { modelPrefix: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <span className={lbl}>缓存命中</span>
                  <input data-testid={`pricing-hit-${i}`} className={inp} value={String(r.cacheHitPerM)}
                    onChange={(e) => patch(i, { cacheHitPerM: num(e.target.value) })} />
                </div>
                <div className="col-span-2">
                  <span className={lbl}>缓存未中</span>
                  <input data-testid={`pricing-miss-${i}`} className={inp} value={String(r.cacheMissPerM)}
                    onChange={(e) => patch(i, { cacheMissPerM: num(e.target.value) })} />
                </div>
                <div className="col-span-2">
                  <span className={lbl}>输出</span>
                  <input data-testid={`pricing-output-${i}`} className={inp} value={String(r.outputPerM)}
                    onChange={(e) => patch(i, { outputPerM: num(e.target.value) })} />
                </div>
                <div className="col-span-1 flex items-end">
                  <button data-testid={`pricing-remove-${i}`} title="删除这条"
                    onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                    className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <select data-testid={`pricing-currency-${i}`} value={r.currency}
                  onChange={(e) => patch(i, { currency: e.target.value })}
                  className="rounded-lg border border-border bg-transparent px-2 py-1 text-xs outline-none">
                  <option value="CNY">CNY ¥</option>
                  <option value="USD">USD $</option>
                </select>
                <span data-testid={`pricing-hits-${i}`}
                  className={'text-2xs ' + (hits.length === 0 ? 'text-warn' : 'text-fg-muted')}>
                  {hits.length === 0
                    ? '⚠ 当前不命中任何已配置模型 —— 前缀写对了吗？（预填未来要用的模型也正常）'
                    : '会命中：' + hits.join('、')}
                </span>
              </div>
            </div>
          )
        })}

        <div className="flex items-center gap-2">
          <button data-testid="pricing-add"
            onClick={() => setRows([...rows, {
              modelPrefix: '', cacheHitPerM: 0, cacheMissPerM: 0, outputPerM: 0, currency: 'CNY',
            }])}
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:bg-surface">
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />添加一条
          </button>
          <button data-testid="pricing-save" disabled={busy} onClick={() => void save()}
            className="rounded-lg bg-accent/15 px-3 py-1 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50">
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {seeds.length > 0 && (
        <div>
          <div className={lbl}>内置牌价（不可改）</div>
          <p className="mb-2 text-2xs text-fg-muted">
            这些是实现时对官方 pricing 页核准过的<strong>确切</strong>模型标识符，精确匹配才命中。
            想覆盖某一条，在上面填一条同名的即可。
          </p>
          {seeds.map((s) => (
            <div key={s.modelPrefix} className="text-2xs text-fg-muted">
              {s.modelPrefix} — {currencySymbol(s.currency)}{s.cacheHitPerM} / {currencySymbol(s.currency)}{s.cacheMissPerM} / {currencySymbol(s.currency)}{s.outputPerM}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
