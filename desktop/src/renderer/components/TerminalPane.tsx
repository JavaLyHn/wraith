// desktop/src/renderer/components/TerminalPane.tsx
import { useCallback, useEffect, useState } from 'react'
import { Plus, SquareTerminal } from 'lucide-react'
import TerminalTab from './TerminalTab'
import { addTab, closeTab, setActive, shortTabLabel, type TabsState } from '../lib/terminalTabs'

/** 终端面板:多标签 xterm + PTY 管理(不含任何 dock 特有的尺寸拖拽)。
 * 底部抽屉与右侧列都嵌它;active 控制自动建首标签与聚焦;rightSlot 供 dock 注入收起按钮。 */
export default function TerminalPane(
  { active, cwd, onAllClosed, rightSlot }:
  { active: boolean; cwd: string | null; onAllClosed?: () => void; rightSlot?: React.ReactNode },
): JSX.Element {
  const [state, setState] = useState<TabsState>({ tabs: [], activeId: null })

  const addNew = useCallback(async () => {
    try {
      const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'   // 异常值 fail-dark,与 CLI 缺省一致
      const { id } = await window.wraith.ptyCreate({ cwd: cwd ?? undefined, theme })
      if (!id) return
      setState(s => addTab(s, { id, label: shortTabLabel(cwd ?? '', s.tabs.length) }))
    } catch { /* 创建失败:忽略,用户可重试 */ }
  }, [cwd])

  // active 且无标签时自动建一个(deps [active];关到空不自动重建)
  useEffect(() => {
    if (active && state.tabs.length === 0) void addNew()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const close = (id: string): void => {
    void window.wraith.ptyKill(id)
    setState(s => {
      const ns = closeTab(s, id)
      if (ns.tabs.length === 0) onAllClosed?.()
      return ns
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 标签栏 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        {state.tabs.map(t => (
          <div key={t.id}
            className={'flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs ' +
              (t.id === state.activeId ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')}>
            <SquareTerminal className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <button data-testid="terminal-tab" onClick={() => setState(s => setActive(s, t.id))} className="max-w-[140px] truncate">{t.label}</button>
            <button data-testid="terminal-tab-close" onClick={() => close(t.id)} className="text-fg-subtle hover:text-danger">×</button>
          </div>
        ))}
        <button data-testid="terminal-add" onClick={() => void addNew()} className="rounded p-1 text-fg-muted hover:bg-surface/60" title="新建终端"><Plus className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
        {rightSlot && <div className="ml-auto flex items-center">{rightSlot}</div>}
      </div>
      {/* 全标签常挂,CSS 显隐 */}
      <div className="relative min-h-0 flex-1">
        {state.tabs.map(t => (
          <div key={t.id} className={'absolute inset-0 px-2 py-1 ' + (t.id === state.activeId ? '' : 'hidden')}>
            <TerminalTab id={t.id} active={t.id === state.activeId} />
          </div>
        ))}
      </div>
    </div>
  )
}
