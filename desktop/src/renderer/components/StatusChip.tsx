import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip'
import type { StatusData } from '../../shared/types'
import { tierOf, TIER_TW } from '../../shared/contextTier'

export interface WatermarkView { ratio: number; tier: number; estimated: boolean }

/** 徽标口径(纯函数,可测):真实水位优先,估算带 ~。 */
export function chipView(
  status: Pick<StatusData, 'totalTokens' | 'contextWindow'>,
  watermark: WatermarkView | null,
): { pct: number; tw: string; suffix: '' | '~' } {
  if (watermark) {
    const pct = Math.min(100, Math.round(watermark.ratio * 100))
    // 档位取后端算好的 watermark.tier(权威口径),不用本地 ratio 重推——后端可能有防抖/滞回等本地不掌握的判定。
    return { pct, tw: TIER_TW[watermark.tier as 0 | 1 | 2 | 3], suffix: watermark.estimated ? '~' : '' }
  }
  const ratio = status.contextWindow > 0 ? status.totalTokens / status.contextWindow : 0
  return { pct: Math.min(100, Math.round(ratio * 100)), tw: TIER_TW[tierOf(ratio)], suffix: '~' }
}

/** Composer 里的 token 状态 chip:常显 context 占用 %(四档色),hover 展开明细,click 打开右侧上下文面板。 */
export default function StatusChip({ status, watermark, onOpenPanel }: {
  status: StatusData | null | undefined
  watermark: WatermarkView | null
  onOpenPanel?: () => void
}): JSX.Element | null {
  if (!status || status.contextWindow <= 0) return null
  const v = chipView(status, watermark)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          data-testid="status-chip"
          onClick={onOpenPanel}
          className={`shrink-0 cursor-pointer whitespace-nowrap rounded-lg border border-border px-2 py-1 text-xs ${v.tw}`}
        >
          ◓ {v.pct}%{v.suffix}
        </button>
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
