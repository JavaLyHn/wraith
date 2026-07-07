import { useEffect, useState } from 'react'
import { useSettings } from '../settings/SettingsContext'
import { userAvatarGlyph } from '../lib/chatIdentity'

export default function SettingsMe({ onOpenProviders }: { onOpenProviders: () => void }): JSX.Element {
  const { prefs, setProfile } = useSettings()
  const [dataDir, setDataDir] = useState('~/.wraith')
  const [model, setModel] = useState<string>('—')

  useEffect(() => {
    void window.wraith.appInfo().then((i) => setDataDir(i.dataDir)).catch(() => {})
    void window.wraith.modelList().then((r) => setModel(r.current?.model || '—')).catch(() => {})
  }, [])

  const lbl = 'mb-2 text-[10px] uppercase tracking-wider text-fg-subtle'
  const input = 'w-full rounded-lg border border-border bg-surface/40 px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent'
  const row = 'flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs'

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-xl text-fg">{userAvatarGlyph(prefs.profile)}</div>
        <div className="flex-1">
          <div className={lbl}>昵称(聊天里"我"的显示名)</div>
          <input data-testid="me-name" className={input} value={prefs.profile.name}
            onChange={(e) => setProfile({ name: e.target.value })} placeholder="我" />
        </div>
      </div>

      <div>
        <div className={lbl}>头像(一个 emoji 或字符;留空则用昵称首字)</div>
        <input data-testid="me-avatar" className={input + ' max-w-[120px]'} value={prefs.profile.avatar}
          onChange={(e) => setProfile({ avatar: e.target.value })} placeholder="🦊" />
      </div>

      <div>
        <div className={lbl}>配置速览</div>
        <div className="flex flex-col gap-2">
          <div className={row}><span className="text-fg-muted">当前模型</span><span className="truncate text-fg">{model}</span></div>
          <div className={row}>
            <span className="text-fg-muted">数据目录</span>
            <span className="flex items-center gap-2">
              <span className="truncate text-fg-subtle">{dataDir}</span>
              <button data-testid="me-open-dir" onClick={() => void window.wraith.openPath(dataDir)}
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-accent">打开</button>
            </span>
          </div>
          <button data-testid="me-manage-providers" onClick={onOpenProviders}
            className="self-start rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-accent">管理 Provider →</button>
        </div>
      </div>
    </div>
  )
}
