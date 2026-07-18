import { useCallback, useEffect, useState } from 'react'
import { Switch } from './ui/switch'
import { useSettings } from '../settings/SettingsContext'
import { selectedPet } from '../lib/petMotion'
import type { PetMotionStyle, PetSource, PetView } from '../../shared/pets'

const MOTION_OPTS: { key: PetMotionStyle; label: string }[] = [
  { key: 'calm', label: '克制' },
  { key: 'float', label: '悬浮' },
  { key: 'lively', label: '活泼' },
  { key: 'static', label: '静态' },
]

function sourceLabel(source: PetSource): string {
  if (source === 'petdex') return 'Petdex'
  if (source === 'imported') return '已导入'
  return '内置'
}

/**
 * 设置页“宠物”分区。所有宠物偏好(开关/选中/缩放/动态风格)一律经
 * useSettings().setPets 持久化——组件内不留第二份配置 state 影子。
 * pets(库列表)与 error(本地导入错误文案)是纯 UI/IPC 派生状态,不是偏好。
 */
export default function PetsSettings(): JSX.Element {
  const { prefs, setPets } = useSettings()
  const [pets, setLibrary] = useState<PetView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [importingImage, setImportingImage] = useState(false)
  const [importingPackage, setImportingPackage] = useState(false)
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(new Set())

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { pets: list } = await window.wraith.petsList()
      setLibrary(list)
    } catch {
      // IPC 失败时保留旧列表,不闪空
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const importImage = async (): Promise<void> => {
    if (importingImage) return // in-flight 守卫:防快速双击开出两个并发对话框
    setImportingImage(true)
    setError(null)
    try {
      const result = await window.wraith.petsImportImage()
      if (result.error) setError(result.error)
      else await refresh()
    } catch (e) { setError((e as Error).message) }
    finally { setImportingImage(false) }
  }

  const importPackage = async (): Promise<void> => {
    if (importingPackage) return
    setImportingPackage(true)
    setError(null)
    try {
      const result = await window.wraith.petsImportPackage()
      if (result.error) setError(result.error)
      else await refresh()
    } catch (e) { setError((e as Error).message) }
    finally { setImportingPackage(false) }
  }

  const removePet = async (id: string): Promise<void> => {
    if (removingIds.has(id)) return
    setRemovingIds(prev => new Set(prev).add(id))
    setError(null)
    try {
      await window.wraith.petsRemove(id)
      await refresh()
    } catch (e) { setError((e as Error).message) }
    finally { setRemovingIds(prev => { const next = new Set(prev); next.delete(id); return next }) }
  }

  const active = selectedPet(pets, prefs.pets.selectedId)
  const activeId = active?.id ?? null

  useEffect(() => {
    let alive = true
    setPreviewUrl(null)
    if (!activeId) return
    void window.wraith.petsPreview(activeId).then((url) => { if (alive) setPreviewUrl(url) }).catch(() => {})
    return () => { alive = false }
  }, [activeId])

  const lbl = 'mb-2 text-3xs uppercase tracking-wider text-fg-subtle'
  const cardBase = 'flex w-full flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="rounded-lg border border-border px-3 py-2">
        <label className="flex cursor-pointer select-none items-center justify-between gap-3 text-xs font-semibold text-fg">
          启用桌面宠物
          <Switch data-testid="pet-enabled" checked={prefs.pets.enabled} onCheckedChange={(checked) => setPets({ enabled: checked })} />
        </label>
        <div className="mt-1 text-2xs text-fg-subtle">关闭后不挂载浮件、不解码宠物图片</div>
      </div>

      <div>
        <div className={lbl}>当前预览</div>
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface">
          {active
            ? previewUrl
              ? <img src={previewUrl} alt={active.displayName} className="h-full w-full object-contain" />
              : <span className="text-2xs text-fg-subtle">加载中…</span>
            : <span className="text-2xs text-fg-subtle">未选择</span>}
        </div>
      </div>

      <div>
        <div className={lbl}>宠物库</div>
        <div className="mb-3 flex items-center gap-2">
          <button data-testid="pet-import-image" disabled={importingImage} onClick={() => void importImage()}
            className="rounded-lg border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50">导入图片</button>
          <button data-testid="pet-import-package" disabled={importingPackage} onClick={() => void importPackage()}
            className="rounded-lg border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50">导入精灵包</button>
        </div>
        {error && <div className="mb-2 text-xs text-danger">{error}</div>}
        <div data-testid="pet-library" className="grid grid-cols-2 gap-2">
          {pets.map((pet) => {
            const isSelected = pet.id === prefs.pets.selectedId
            return (
              <div key={pet.id} className="relative">
                <button
                  data-testid={`pet-card-${pet.id}`}
                  disabled={!pet.available}
                  onClick={() => setPets({ selectedId: pet.id })}
                  className={cardBase + ' ' + (isSelected ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface')}
                >
                  <span className="text-xs font-semibold text-fg">{pet.displayName}</span>
                  <span className="text-2xs text-fg-subtle">{sourceLabel(pet.source)}</span>
                  {!pet.available && <span className="text-2xs text-fg-subtle">未安装</span>}
                </button>
                {pet.removable && (
                  <button
                    data-testid={`pet-remove-${pet.id}`}
                    aria-label={`删除${pet.displayName}`}
                    disabled={removingIds.has(pet.id)}
                    onClick={() => void removePet(pet.id)}
                    className="absolute right-1 top-1 rounded px-1 text-fg-subtle hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                  >×</button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <div className={lbl}>动态风格</div>
        <div className="flex gap-2">
          {MOTION_OPTS.map((m) => (
            <button key={m.key} data-testid={`pet-motion-${m.key}`} aria-pressed={prefs.pets.motion === m.key}
              onClick={() => setPets({ motion: m.key })}
              className={'rounded-lg border px-3 py-1.5 text-xs ' + (prefs.pets.motion === m.key ? 'border-accent bg-accent/10 font-semibold text-accent' : 'border-border text-fg-muted hover:bg-surface')}
            >{m.label}</button>
          ))}
        </div>
      </div>

      <label className="block">
        <div className={lbl}>缩放 {prefs.pets.scale.toFixed(2)}×</div>
        <input
          data-testid="pet-scale"
          type="range"
          min="0.75"
          max="1.5"
          step="0.05"
          value={prefs.pets.scale}
          onChange={(e) => setPets({ scale: Number(e.target.value) })}
          className="w-full"
        />
      </label>
    </div>
  )
}
