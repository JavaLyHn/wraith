import { useState, useCallback, useEffect } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import type { ModelListResult } from '../../shared/types'
import { configuredProviders, providerOptionLabel } from '../lib/modelSwitcher'

interface ModelSwitcherProps {
  /** 初始显示值(session 携带的 model 字符串,切换后以内部 state 为准)。 */
  initialModel: string
  /** turn 运行中:触发器 disabled。 */
  running: boolean
  /** 切换成功后上报新模型串给父层(用于同步 state.model / 图片预检)。 */
  onSwitched?: (model: string) => void
}

export default function ModelSwitcher({ initialModel, running, onSwitched }: ModelSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [displayModel, setDisplayModel] = useState(initialModel)

  // Sync chip when the parent restores a different model (e.g. session resume).
  // This does NOT clobber an in-popover switch because handleSelect updates
  // displayModel without changing the parent's `state.model` / `initialModel`;
  // the effect only re-fires when initialModel itself changes (i.e. dispatch
  // setModel from App.tsx), not when the user picks inside the popover.
  useEffect(() => {
    setDisplayModel(initialModel)
  }, [initialModel])
  const [data, setData] = useState<ModelListResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingDefault, setSettingDefault] = useState(false)

  const handleOpen = useCallback(async (o: boolean) => {
    setOpen(o)
    if (o) {
      setError(null)
      try {
        const result = await window.wraith.modelList()
        setData(result)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[ModelSwitcher] model.list failed:', msg)
        setError('加载模型列表失败')
      }
    }
  }, [])

  const handleSelect = useCallback(async (providerName: string) => {
    setOpen(false)
    try {
      const result = await window.wraith.setModel(providerName)
      setDisplayModel(result.model)
      onSwitched?.(result.model)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[ModelSwitcher] session.setModel failed:', msg)
      setError('切换模型失败')
    }
  }, [onSwitched])

  const handleSetDefault = useCallback(async (providerName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSettingDefault(true)
    try {
      await window.wraith.setDefaultProvider(providerName)
      setData(prev => prev ? { ...prev, default: providerName } : prev)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[ModelSwitcher] config.setDefaultProvider failed:', msg)
      setError('设置默认 provider 失败')
    } finally {
      setSettingDefault(false)
    }
  }, [])

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="model-chip"
          disabled={running}
          className="min-w-0 max-w-[160px] truncate whitespace-nowrap rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {displayModel || '—'}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        {error && (
          <div className="mb-1 rounded-md bg-danger/10 px-2 py-1.5 text-xs text-danger">{error}</div>
        )}
        {!data && !error && (
          <div className="px-2 py-1.5 text-xs text-fg-subtle">加载中…</div>
        )}
        {data && !error && configuredProviders(data.providers).length === 0 && (
          <div className="px-2 py-1.5 text-xs text-fg-subtle">未配置任何 provider,请到「Provider 配置」添加</div>
        )}
        {data && configuredProviders(data.providers).map(p => {
          const isCurrent = data.current.provider === p.name
          const isDefault = data.default === p.name
          const label = providerOptionLabel(p)
          return (
            <div
              key={p.name}
              className="group mb-0.5 flex items-center gap-1"
            >
              <button
                data-testid="model-option"
                disabled={!p.hasKey}
                title={p.hasKey ? `${label} · ${p.model}` : `${label} — 未配置 API Key`}
                onClick={() => { if (p.hasKey) handleSelect(p.name) }}
                className={
                  'flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ' +
                  (isCurrent ? 'bg-surface text-fg' : 'text-fg-muted enabled:hover:bg-surface/60')
                }
              >
                <span className="shrink-0 font-medium">{label}</span>
                <span className="min-w-0 flex-1 truncate text-fg-subtle">{p.model}</span>
                {isCurrent && <span className="ml-auto shrink-0">✓</span>}
                {isDefault && !isCurrent && <span className="ml-auto shrink-0 text-fg-subtle text-3xs">默认</span>}
                {isDefault && isCurrent && <span className="ml-1 shrink-0 text-fg-subtle text-3xs">默认</span>}
              </button>
              {p.hasKey && !isDefault && (
                <button
                  data-testid="model-set-default"
                  disabled={settingDefault}
                  title="设为默认"
                  onClick={(e) => handleSetDefault(p.name, e)}
                  className="hidden shrink-0 rounded p-1 text-3xs text-fg-subtle hover:text-accent disabled:opacity-40 group-hover:block"
                >
                  默认
                </button>
              )}
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
