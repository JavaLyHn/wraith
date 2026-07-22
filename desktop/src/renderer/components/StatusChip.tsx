import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip'
import type { StatusData } from '../../shared/types'
import { tierOf, TIER_TW } from '../../shared/contextTier'

/** watermark 口径:ratio/tier/estimated 必备;usedTokens/window 用于无 status 时的 tooltip 兜底。 */
export interface WatermarkView { ratio: number; tier: number; estimated: boolean; usedTokens?: number; window?: number }

/** 徽标口径(纯函数,可测):真实水位优先,估算带 ~。status 可为 null(Plan/Team 或新会话首轮无 status)。 */
export function chipView(
  status: Pick<StatusData, 'totalTokens' | 'contextWindow'> | null,
  watermark: WatermarkView | null,
): { pct: number; tw: string; suffix: '' | '~' } {
  if (watermark) {
    // 首轮前:仅有估算基线(系统提示词+工具 schema)、尚无真实回合读数 → 显 0%,避免"新会话就 3%"的反直觉。
    if (status === null && watermark.estimated) {
      return { pct: 0, tw: TIER_TW[0], suffix: '' }
    }
    const pct = Math.max(0, Math.min(100, Math.round(watermark.ratio * 100)))
    // 档位优先信后端算好的 watermark.tier(权威口径,可能有本地不掌握的防抖/滞回判定);
    // 但越界(后端异常给出 0~3 外的值)时不能钳到边界糊弄过去,回退用同一 payload 里的 ratio 重推——更诚实。
    const tier = (Number.isFinite(watermark.tier) && watermark.tier >= 0 && watermark.tier <= 3
      ? Math.trunc(watermark.tier)
      : tierOf(watermark.ratio)) as 0 | 1 | 2 | 3
    return { pct, tw: TIER_TW[tier], suffix: watermark.estimated ? '~' : '' }
  }
  const ratio = status && status.contextWindow > 0 ? status.totalTokens / status.contextWindow : 0
  return { pct: Math.min(100, Math.round(ratio * 100)), tw: TIER_TW[tierOf(ratio)], suffix: '~' }
}

/** Composer 里的 token 状态 chip:常显 context 占用 %(四档色),hover 展开明细,click 打开右侧上下文面板。 */
export default function StatusChip({ status, watermark, onOpenPanel }: {
  status: StatusData | null | undefined
  watermark: WatermarkView | null
  onOpenPanel?: () => void
}): JSX.Element | null {
  const hasStatus = !!status && status.contextWindow > 0
  // status 与 watermark 皆无才隐藏。Plan/Team(或新会话首轮)只有 watermark、没有 react 的 status,
  // 此前 `!status` 一刀切导致 chip 消失、右侧面板却显水位——两处口径必须一致。
  if (!hasStatus && !watermark) return null
  const v = chipView(hasStatus ? status! : null, watermark)
  // tooltip 分子/分母:live status 优先,否则回退 watermark 的 usedTokens/window。
  const used = hasStatus ? status!.totalTokens : (watermark?.usedTokens ?? 0)
  const window = hasStatus ? status!.contextWindow : (watermark?.window ?? 0)
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
          <div>上下文: {used.toLocaleString()} / {window.toLocaleString()}{!hasStatus && watermark?.estimated ? '(估算)' : ''}</div>
          {hasStatus && (
            <div>
              输入 {status!.inputTokens.toLocaleString()} · 输出 {status!.outputTokens.toLocaleString()} · 缓存命中{' '}
              {status!.cachedInputTokens.toLocaleString()}
            </div>
          )}
          {hasStatus && status!.estimatedCost && <div>估算成本: {status!.estimatedCost}</div>}
          {hasStatus && status!.phase === 'running' && <div>运行中 {Math.round(status!.elapsedMillis / 1000)}s</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
