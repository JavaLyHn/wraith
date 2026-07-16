import { useState, useCallback } from 'react'
import { Zap, ClipboardList, Users, type LucideIcon } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import type { RunMode } from '../../shared/types'

interface ModeSwitcherProps {
  /** 当前逐条执行模式(受控,发送后由父级复位为 react)。 */
  mode: RunMode
  /** 选择新模式。 */
  onModeChange?: (m: RunMode) => void
  /** turn 运行中:触发器 disabled。 */
  running?: boolean
}

interface ModeDef {
  id: RunMode
  Icon: LucideIcon
  label: string
  desc: string
}

// 可选模式(react / plan / team)。icon 用 lucide 线性图标,与工具条整体的克制风格一致。
const MODES: ModeDef[] = [
  { id: 'react', Icon: Zap, label: 'ReAct', desc: '边想边做 · 单 Agent 推理与工具调用的即时循环' },
  { id: 'plan', Icon: ClipboardList, label: 'Plan', desc: '先规划后执行 · 生成计划、复审,逐步推进' },
  { id: 'team', Icon: Users, label: 'Team', desc: '多 Agent 协作 · 规划-并行执行-复查' },
]

/**
 * 执行模式下拉选择器(替代分段按钮)。
 * 触发器显示当前模式(图标 + 名称);展开后每行 = 图标 + 名称 + 描述,
 * 当前项打勾。逐条语义:选择只改父级 pendingMode,发送后父级复位。
 */
export default function ModeSwitcher({ mode, onModeChange, running = false }: ModeSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const current = MODES.find(m => m.id === mode) ?? MODES[0]

  const handleSelect = useCallback((m: RunMode) => {
    setOpen(false)
    onModeChange?.(m)
  }, [onModeChange])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="mode-chip"
          disabled={running}
          title="执行模式"
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <current.Icon className="h-3 w-3 shrink-0" strokeWidth={1.5} />
          <span>{current.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        {MODES.map(m => {
          const isCurrent = m.id === mode
          return (
            <button
              key={m.id}
              data-testid={`mode-${m.id}`}
              onClick={() => handleSelect(m.id)}
              className={
                'mb-0.5 flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs ' +
                (isCurrent ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60')
              }
            >
              <m.Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  <span className="font-medium">{m.label}</span>
                  {isCurrent && <span className="ml-auto shrink-0">✓</span>}
                </span>
                <span className="mt-0.5 block text-3xs text-fg-subtle">{m.desc}</span>
              </span>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
