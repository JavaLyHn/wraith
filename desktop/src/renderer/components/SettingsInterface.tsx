import { useCallback, useEffect, useState } from 'react'
import { useSettings } from '../settings/SettingsContext'
import { ACCENTS } from '../settings/theme'
import type { AccentKey, FontSize, ThemeMode } from '../settings/prefs'
import type { CloseMode } from '../../shared/types'

const THEME_OPTS: { key: ThemeMode; label: string; prev: string }[] = [
  { key: 'system', label: '系统', prev: 'linear-gradient(90deg,#f7f8fa 50%,#0f1419 50%)' },
  { key: 'light', label: '浅色', prev: '#f7f8fa' },
  { key: 'dark', label: '深色', prev: '#0f1419' },
]
const SIZE_OPTS: { key: FontSize; label: string }[] = [{ key: 'sm', label: '小' }, { key: 'md', label: '中' }, { key: 'lg', label: '大' }]

const CLOSE_MODE_LABEL: Record<CloseMode, string> = {
  ask: '每次询问',
  background: '挂后台',
  quit: '直接退出',
}

export default function SettingsInterface(): JSX.Element {
  const { prefs, setUi } = useSettings()
  const ui = prefs.ui
  const lbl = 'mb-2 text-3xs uppercase tracking-wider text-fg-subtle'
  const seg = 'inline-flex overflow-hidden rounded-lg border border-border'
  const segItem = (on: boolean): string =>
    'px-3 py-1.5 text-xs ' + (on ? 'bg-accent/15 font-semibold text-accent' : 'text-fg-muted hover:bg-surface')

  // 关闭行为:读当前 closeMode,非 ask 时可重置回「每次询问」
  const [closeMode, setCloseMode] = useState<CloseMode>('ask')
  useEffect(() => {
    let cancelled = false
    void window.wraith.closeBehavior.getMode().then((m) => {
      if (!cancelled) setCloseMode(m)
    }).catch(() => { /* best-effort */ })
    return () => { cancelled = true }
  }, [])

  const handleResetCloseMode = useCallback(async () => {
    try {
      await window.wraith.closeBehavior.resetMode()
      setCloseMode('ask')
    } catch {
      // best-effort
    }
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className={lbl}>主题</div>
        <div className="flex gap-2">
          {THEME_OPTS.map((t) => (
            <button key={t.key} data-testid={`theme-${t.key}`} onClick={() => setUi({ theme: t.key })}
              className={'w-24 overflow-hidden rounded-lg border text-center ' + (ui.theme === t.key ? 'border-accent' : 'border-border')}>
              <div style={{ height: 34, background: t.prev }} />
              <div className="py-1 text-2xs text-fg-muted">{t.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className={lbl}>强调色</div>
        <div className="flex gap-2.5">
          {(Object.keys(ACCENTS) as AccentKey[]).map((k) => (
            <button key={k} data-testid={`accent-${k}`} title={ACCENTS[k].label} onClick={() => setUi({ accent: k })}
              aria-label={ACCENTS[k].label}
              className={'h-6 w-6 rounded-full ' + (ui.accent === k ? 'ring-2 ring-offset-2 ring-offset-bg' : '')}
              style={{ background: ACCENTS[k].value, boxShadow: ui.accent === k ? `0 0 0 2px ${ACCENTS[k].value}` : 'inset 0 0 0 1px var(--border)' }} />
          ))}
        </div>
      </div>

      <div>
        <div className={lbl}>字号</div>
        <div className={seg}>
          {SIZE_OPTS.map((s) => (
            <button key={s.key} data-testid={`size-${s.key}`} onClick={() => setUi({ fontSize: s.key })}
              className={segItem(ui.fontSize === s.key) + ' border-r border-border last:border-r-0'}>{s.label}</button>
          ))}
        </div>
      </div>

      <div>
        <div className={lbl}>关闭窗口行为</div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-fg-muted">
            当前:{CLOSE_MODE_LABEL[closeMode]}
          </span>
          {closeMode !== 'ask' && (
            <button
              data-testid="close-mode-reset"
              onClick={handleResetCloseMode}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted hover:bg-muted hover:text-fg"
            >
              恢复询问
            </button>
          )}
        </div>
        {closeMode === 'ask' && (
          <div className="mt-1 text-2xs text-fg-subtle">关闭主窗时会询问挂后台还是退出</div>
        )}
      </div>
    </div>
  )
}
