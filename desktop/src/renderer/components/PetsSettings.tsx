import { useCallback, useEffect, useRef, useState } from 'react'
import { Switch } from './ui/switch'
import { usePetConfig } from '../lib/usePetConfig'
import { selectedPet } from '../lib/petMotion'
import { isValidPetName, extractPetName, cleanInstallLog } from '../../shared/petInstall'
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
 * usePetConfig().setConfig 走 IPC 持久化到主进程(settings.json)——组件内
 * 不留第二份配置 state 影子,且与全局常驻宠物窗口共用同一份配置来源。
 * pets(库列表)与 error(本地导入错误文案)是纯 UI/IPC 派生状态,不是偏好。
 */
export default function PetsSettings(): JSX.Element {
  const { config, setConfig } = usePetConfig()
  const [pets, setLibrary] = useState<PetView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [importingImage, setImportingImage] = useState(false)
  const [importingPackage, setImportingPackage] = useState(false)
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(new Set())
  // 应用内 Petdex 安装:名字输入 + in-flight 守卫 + 流式日志(累积主进程推来的 stdout/stderr 原文)。
  const [installName, setInstallName] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installLog, setInstallLog] = useState('')
  const logRef = useRef<HTMLPreElement | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { pets: list } = await window.wraith.petsList()
      setLibrary(list)
    } catch {
      // IPC 失败时保留旧列表,不闪空
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // 订阅 Petdex 安装的流式输出,累积原文进日志区(展示时再 cleanInstallLog 清 ANSI/进度重绘噪声)。
  // 累积上限 100KB(超长输出只保留尾部),防极端情况下无限增长。
  useEffect(() => window.wraith.onPetInstallOutput((chunk) => setInstallLog((prev) => (prev + chunk).slice(-100_000))), [])

  // 日志更新后自动滚到底,始终看到最新进度。
  const prettyLog = cleanInstallLog(installLog)
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [prettyLog])

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

  // 既接受直接输入的名字(boxcat),也接受整条命令(npx petdex@latest install boxcat)——抽出名字。
  const installTarget = extractPetName(installName)
  const installPet = async (): Promise<void> => {
    if (installing || !isValidPetName(installTarget)) return
    setInstalling(true)
    setError(null)
    setInstallLog('')
    try {
      const result = await window.wraith.petsInstall(installTarget)
      if (result.error) setError(result.error)
      else { await refresh(); setInstallName('') }
    } catch (e) { setError((e as Error).message) }
    finally { setInstalling(false) }
  }

  const removePet = async (id: string, source: PetSource): Promise<void> => {
    if (removingIds.has(id)) return
    setRemovingIds(prev => new Set(prev).add(id))
    setError(null)
    try {
      await window.wraith.petsRemove(id, source)
      await refresh()
    } catch (e) { setError((e as Error).message) }
    finally { setRemovingIds(prev => { const next = new Set(prev); next.delete(id); return next }) }
  }

  const active = config ? selectedPet(pets, config.selectedId) : null
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

  // config 挂载后异步拉取,首帧尚未到达时渲染骨架/禁用态,不解引用 null。
  if (!config) {
    return (
      <div className="flex max-w-xl flex-col gap-6" data-testid="pets-settings-loading" aria-busy="true">
        <div className="h-16 animate-pulse rounded-lg border border-border bg-surface" />
        <div className="h-20 w-20 animate-pulse rounded-lg border border-border bg-surface" />
        <div className="h-24 animate-pulse rounded-lg border border-border bg-surface" />
      </div>
    )
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="rounded-lg border border-border px-3 py-2">
        <label className="flex cursor-pointer select-none items-center justify-between gap-3 text-xs font-semibold text-fg">
          启用桌面宠物
          <Switch data-testid="pet-enabled" checked={config.enabled} onCheckedChange={(checked) => setConfig({ enabled: checked })} />
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

        {/* 从 Petdex 直接安装:输入宠物名 → 应用内跑 npx,不必手动下载导入精灵包。 */}
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <input
              data-testid="pet-install-name"
              value={installName}
              onChange={(e) => setInstallName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void installPet() }}
              disabled={installing}
              placeholder="宠物名,如 scoop"
              className="flex-1 rounded-lg border border-border bg-transparent px-3 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none disabled:opacity-50"
            />
            <button
              data-testid="pet-install"
              disabled={installing || !isValidPetName(installTarget)}
              onClick={() => void installPet()}
              className="whitespace-nowrap rounded-lg border border-accent bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >{installing ? '安装中…' : '从 Petdex 安装'}</button>
          </div>
          <div className="mt-1 text-2xs text-fg-subtle">
            将执行:<code className="text-fg-muted">npx petdex@latest install {installTarget || '<名>'}</code>
            <span className="ml-1">(可直接粘贴整条命令,会自动取宠物名)</span>
          </div>
          {(installing || prettyLog) && (
            <pre ref={logRef} data-testid="pet-install-log" className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-2 text-2xs text-fg-muted">{prettyLog || '启动中…'}</pre>
          )}
        </div>

        {error && <div className="mb-2 text-xs text-danger">{error}</div>}
        <div data-testid="pet-library" className="grid grid-cols-2 gap-2">
          {pets.map((pet) => {
            const isSelected = pet.id === config.selectedId
            return (
              <div key={pet.id} className="relative">
                <button
                  data-testid={`pet-card-${pet.id}`}
                  disabled={!pet.available}
                  onClick={() => setConfig({ selectedId: pet.id })}
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
                    title={pet.source === 'petdex' ? '从本机 Petdex 库删除' : '删除已导入宠物'}
                    disabled={removingIds.has(pet.id)}
                    onClick={(e) => { e.stopPropagation(); void removePet(pet.id, pet.source) }}
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
            <button key={m.key} data-testid={`pet-motion-${m.key}`} aria-pressed={config.motion === m.key}
              onClick={() => setConfig({ motion: m.key })}
              className={'rounded-lg border px-3 py-1.5 text-xs ' + (config.motion === m.key ? 'border-accent bg-accent/10 font-semibold text-accent' : 'border-border text-fg-muted hover:bg-surface')}
            >{m.label}</button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border px-3 py-2">
        <label className="flex cursor-pointer select-none items-center justify-between gap-3 text-xs font-semibold text-fg">
          启用缩放
          <Switch data-testid="pet-scale-enabled" checked={config.scaleEnabled} onCheckedChange={(checked) => setConfig({ scaleEnabled: checked })} />
        </label>
        <div className="mt-1 text-2xs text-fg-subtle">默认关闭、宠物保持最小尺寸;开启后才能用下方滑块或在宠物身上滚轮 / 触控板捏合缩放</div>
        {/* 未启用时整块置灰不可交互(pointer-events-none),避免误拖滑块。 */}
        <div className={'mt-3 ' + (config.scaleEnabled ? '' : 'pointer-events-none opacity-50')}>
          <div className={lbl}>缩放 {config.scale.toFixed(2)}×</div>
          <input
            data-testid="pet-scale"
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={config.scale}
            disabled={!config.scaleEnabled}
            onChange={(e) => setConfig({ scale: Number(e.target.value) })}
            className="w-full"
          />
        </div>
      </div>
    </div>
  )
}
