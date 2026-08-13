import type { HTMLAttributes } from 'react'
import { cn } from '../lib/utils'

interface TaskDonePillProps extends HTMLAttributes<HTMLDivElement> {
  text: string
  ok: boolean
  onOpen: () => void
}

/**
 * 后台任务完成的静默药丸。对话流与首页空态共用同一个组件 —— 两处出现的必须长一样,
 * 否则同一件事在不同页面读起来像两回事。
 */
export default function TaskDonePill(
  { text, ok, onOpen, className: incomingClass, ...rest }: TaskDonePillProps,
): JSX.Element {
  return (
    <div className={cn(incomingClass, "self-center")} {...rest}>
      <button
        data-testid="task-done-pill"
        onClick={onOpen}
        title="打开后台任务面板查看结果"
        className={'max-w-[85%] truncate rounded-full border px-3 py-1 text-2xs transition-colors ' +
          (ok
            ? 'border-border bg-surface/60 text-fg-subtle hover:border-accent hover:text-accent'
            : 'border-danger/40 bg-danger/5 text-danger hover:border-danger')}
      >
        {ok ? '✓' : '✕'} {text} · 点击查看
      </button>
    </div>
  )
}
