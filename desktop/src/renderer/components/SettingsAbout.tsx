import { useEffect, useState } from 'react'
import { useSettings } from '../settings/SettingsContext'
import Logo from './Logo'
import type { AppInfo, UpdateResult } from '../../shared/types'

export default function SettingsAbout(): JSX.Element {
  const { prefs, setUpdate } = useSettings()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<UpdateResult | null>(null)

  useEffect(() => { void window.wraith.appInfo().then(setInfo).catch(() => {}) }, [])

  const check = async (): Promise<void> => {
    setChecking(true)
    try { setResult(await window.wraith.checkUpdate(prefs.update.beta)) }
    catch (e) { setResult({ current: info?.version ?? '', latest: null, hasUpdate: false, url: null, isPrerelease: false, error: (e as Error).message }) }
    finally { setChecking(false) }
  }

  const lbl = 'mb-2 text-3xs uppercase tracking-wider text-fg-subtle'
  const row = 'flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs'
  const toggle = (on: boolean): string =>
    'relative h-5 w-9 rounded-full transition-colors ' + (on ? 'bg-accent' : 'bg-border')
  const knob = (on: boolean): string =>
    'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ' + (on ? 'translate-x-4' : 'translate-x-0')

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Logo className="h-12 w-12 object-contain" />
        <div>
          <div className="text-sm font-bold text-fg">Wraith</div>
          <div className="text-xs text-fg-subtle">版本 {info?.version ?? '—'} · MIT License</div>
        </div>
      </div>

      <div>
        <div className={lbl}>信息</div>
        <div className="flex flex-col gap-2">
          <div className={row}><span className="text-fg-muted">版权</span><span className="text-fg">© 2026 LyHn</span></div>
          <div className={row}><span className="text-fg-muted">许可证</span><span className="text-fg">MIT License</span></div>
          <button data-testid="about-github" onClick={() => info && void window.wraith.openExternal(info.repoUrl)}
            className={row + ' hover:border-accent'}><span className="text-fg-muted">GitHub</span><span className="text-accent">↗ 打开仓库</span></button>
        </div>
      </div>

      <div>
        <div className={lbl}>更新</div>
        <div className="flex flex-col gap-2">
          <div className={row}>
            <span className="text-fg-muted">启动时自动检查更新</span>
            <button data-testid="about-autocheck" aria-label="自动检查更新" onClick={() => setUpdate({ autoCheck: !prefs.update.autoCheck })}
              className={toggle(prefs.update.autoCheck)}><span className={knob(prefs.update.autoCheck)} /></button>
          </div>
          <div className={row}>
            <span className="text-fg-muted">接受测试版更新</span>
            <button data-testid="about-beta" aria-label="接受测试版更新" onClick={() => setUpdate({ beta: !prefs.update.beta })}
              className={toggle(prefs.update.beta)}><span className={knob(prefs.update.beta)} /></button>
          </div>
          <div className="flex items-center gap-3">
            <button data-testid="about-check" onClick={() => void check()} disabled={checking}
              className="rounded-lg border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-50">
              {checking ? '检查中…' : '检查更新'}
            </button>
            {result && (
              <span className="text-xs">
                {result.error ? <span className="text-danger">检查失败:{result.error}</span>
                  : result.hasUpdate
                    ? <button className="text-accent" onClick={() => result.url && void window.wraith.openExternal(result.url)}>有新版 v{result.latest} · 打开下载 ↗</button>
                    : <span className="text-fg-subtle">已是最新(v{result.current})</span>}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
