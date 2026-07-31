import { useState } from 'react'

interface ThinkingBlockProps {
  label: string
  text: string
  done: boolean
}

export default function ThinkingBlock({ label, text, done }: ThinkingBlockProps): JSX.Element {
  // 手动开合优先;未手动时流式中展开(实时看思考)、完成后自动折叠
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? !done
  const toggle = (): void => setManual(!open)

  return (
    // 无框:思考过程是低调旁注,不用实心边框卡(避免一排排带框横条与消息卡抢视觉)。
    <div data-testid="thinking" className="my-1.5 font-mono text-xs">
      <div
        className="flex w-fit cursor-pointer select-none items-center gap-2 py-1 text-fg-subtle transition-colors hover:text-fg-muted"
        onClick={toggle}
        title={label || undefined}
      >
        <button
          data-testid="thinking-toggle"
          onClick={e => { e.stopPropagation(); toggle() }}
          aria-expanded={open}
          aria-label="Toggle thinking block"
          className="p-0 text-3xs leading-none"
        >
          {open ? '▼' : '▶'}
        </button>
        <span className="text-2xs tracking-wide">
          {done ? '✓ 思考过程' : '⟳ 思考中…'}
        </span>
      </div>
      {open && (
        // 左侧细竖线 + 缩进 + 淡字,像引用旁注;去掉整框 / 顶边 / 底色。
        <pre className="m-0 whitespace-pre-wrap break-words border-l-2 border-border/60 pl-3 py-1 text-xs leading-relaxed text-fg-subtle">
          {text}
        </pre>
      )}
    </div>
  )
}
