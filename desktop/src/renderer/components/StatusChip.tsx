import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip'
import type { StatusData } from '../../shared/types'

/** Composer 里的 token 状态 chip:常显 context 占用 %,hover 展开明细。 */
export default function StatusChip({ status }: { status: StatusData | null | undefined }): JSX.Element | null {
  if (!status || status.contextWindow <= 0) return null
  const pct = Math.min(100, Math.round((status.totalTokens / status.contextWindow) * 100))
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="status-chip"
          className="cursor-default rounded-lg border border-border px-2 py-1 text-xs text-fg-muted"
        >
          ◓ {pct}%
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5 text-xs">
          <div>上下文: {status.totalTokens.toLocaleString()} / {status.contextWindow.toLocaleString()}</div>
          <div>
            输入 {status.inputTokens.toLocaleString()} · 输出 {status.outputTokens.toLocaleString()} · 缓存命中{' '}
            {status.cachedInputTokens.toLocaleString()}
          </div>
          {status.estimatedCost && <div>估算成本: {status.estimatedCost}</div>}
          {status.phase === 'running' && <div>运行中 {Math.round(status.elapsedMillis / 1000)}s</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
