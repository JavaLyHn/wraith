import { useState } from 'react'
import SettingsInterface from './SettingsInterface'
import SettingsMe from './SettingsMe'

type Section = 'me' | 'interface' | 'about'
const NAV: { key: Section; label: string }[] = [
  { key: 'me', label: '👤 我' },
  { key: 'interface', label: '🎨 界面' },
  { key: 'about', label: 'ℹ️ 关于' },
]

export default function SettingsPanel({ onBack, onOpenProviders }: { onBack: () => void; onOpenProviders: () => void }): JSX.Element {
  const [active, setActive] = useState<Section>('interface')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="settings-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="text-sm font-bold text-fg">设置</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-36 shrink-0 border-r border-border p-2">
          {NAV.map((n) => (
            <button key={n.key} data-testid={`settings-nav-${n.key}`} onClick={() => setActive(n.key)}
              className={'mb-1 block w-full rounded-lg px-3 py-2 text-left text-xs ' +
                (active === n.key ? 'bg-accent/12 font-semibold text-accent' : 'text-fg-muted hover:bg-surface')}>
              {n.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {active === 'interface' && <SettingsInterface />}
          {active === 'me' && <SettingsMe onOpenProviders={onOpenProviders} />}
          {active === 'about' && <div className="text-xs text-fg-subtle">(关于 — Task 8)</div>}
        </div>
      </div>
    </div>
  )
}
