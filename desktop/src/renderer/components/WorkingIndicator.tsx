import type { RunMode } from '../../shared/types'

// 轮次已开始但尚无任何输出到达时的"处理中"指示。长时间空白(尤其 plan 规划器 LLM
// 生成计划的数秒)会让用户以为死机——这里用跳动圆点 + 按模式区分的文案占位。
const WORKING_TEXT: Record<RunMode, string> = {
  react: '思考中',
  plan: '正在规划',
  team: '正在组建团队',
}

export default function WorkingIndicator({ mode }: { mode: RunMode }): JSX.Element {
  const text = WORKING_TEXT[mode] ?? '处理中'
  return (
    <div
      className="my-1.5 flex items-center gap-2 text-xs text-fg-muted"
      data-testid="working-indicator"
      aria-live="polite"
    >
      <span className="flex gap-0.5" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
      </span>
      <span>{text}…</span>
    </div>
  )
}
