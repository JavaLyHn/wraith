import { useState } from 'react'
import { ArrowLeft, User, Palette, Info, type LucideIcon } from 'lucide-react'
import SettingsInterface from './SettingsInterface'
import SettingsMe from './SettingsMe'
import SettingsAbout from './SettingsAbout'

type Section = 'me' | 'interface' | 'about'
const NAV: { key: Section; label: string; Icon: LucideIcon }[] = [
  { key: 'me', label: '我', Icon: User },
  { key: 'interface', label: '界面', Icon: Palette },
  { key: 'about', label: '关于', Icon: Info },
]

export default function SettingsPanel({ onBack, onOpenProviders }: { onBack: () => void; onOpenProviders: () => void }): JSX.Element {
  const [active, setActive] = useState<Section>('interface')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="settings-back" onClick={onBack} title="返回对话"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} /></button>
        <span className="text-sm font-bold text-fg">设置</span>
      </div>
      <div className="flex min-h-0 flex-1 panel-content">
        <div className="w-36 shrink-0 border-r border-border p-2">
          {NAV.map((n) => (
            <button key={n.key} data-testid={`settings-nav-${n.key}`} onClick={() => setActive(n.key)}
              className={'mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ' +
                (active === n.key ? 'bg-accent/12 font-semibold text-accent' : 'text-fg-muted hover:bg-surface')}>
              <n.Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />{n.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {active === 'interface' && <SettingsInterface />}
          {active === 'me' && <SettingsMe onOpenProviders={onOpenProviders} />}
          {active === 'about' && <SettingsAbout />}
        </div>
      </div>
    </div>
  )
}
