import type { CSSProperties } from 'react'

export type PanelSide = 'left' | 'right' | 'bottom'

/**
 * Codex 式面板切换 glyph:静态窗口轮廓 + 会 translate 的分隔线 + 会 scale 的填充块。
 * open 变化时:分隔线从外边框滑到格内侧、对应格同步填实(线丝滑滑动 + 填充)。单色墨(currentColor)。
 * 填充块外缘严格对齐分隔线开态中心,避免视觉错位。
 */
type Geo = {
  fill: { x: number; y: number; width: number; height: number }
  fillOrigin: string
  fillOpen: string
  fillClosed: string
  divider: { x: number; y: number; width: number; height: number }
  dividerOpen: string
}

const GEO: Record<PanelSide, Geo> = {
  left: {
    fill: { x: 3.5, y: 5, width: 6, height: 14 }, // 右缘 9.5 = 分隔线开态中心
    fillOrigin: 'left center', fillOpen: 'scaleX(1)', fillClosed: 'scaleX(0)',
    divider: { x: 3.75, y: 5, width: 1.5, height: 14 }, // 关态中心 4.5
    dividerOpen: 'translateX(5px)', // → 中心 9.5
  },
  right: {
    fill: { x: 14.5, y: 5, width: 6, height: 14 }, // 左缘 14.5 = 分隔线开态中心
    fillOrigin: 'right center', fillOpen: 'scaleX(1)', fillClosed: 'scaleX(0)',
    divider: { x: 18.75, y: 5, width: 1.5, height: 14 }, // 关态中心 19.5
    dividerOpen: 'translateX(-5px)', // → 中心 14.5
  },
  bottom: {
    fill: { x: 5, y: 14.5, width: 14, height: 6 }, // 上缘 14.5 = 分隔线开态中心
    fillOrigin: 'center bottom', fillOpen: 'scaleY(1)', fillClosed: 'scaleY(0)',
    divider: { x: 5, y: 18.75, width: 14, height: 1.5 }, // 关态中心 19.5
    dividerOpen: 'translateY(-5px)', // → 中心 14.5
  },
}

// 复用 tokens.css 的 --ease-smooth;reduced-motion 关过渡(终态仍由内联 transform 立即生效)。
const ANIM = 'transition-transform duration-200 [transition-timing-function:var(--ease-smooth)] motion-reduce:transition-none'

export default function PanelToggleIcon({ side, open, className = 'h-4 w-4' }: {
  side: PanelSide
  open: boolean
  className?: string
}): JSX.Element {
  const g = GEO[side]
  const fillStyle: CSSProperties = {
    transformBox: 'fill-box',
    transformOrigin: g.fillOrigin,
    transform: open ? g.fillOpen : g.fillClosed,
  }
  const dividerStyle: CSSProperties = {
    transformBox: 'fill-box',
    transform: open ? g.dividerOpen : 'translate(0)',
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <rect x={3} y={3} width={18} height={18} rx={3} />
      <rect data-testid="panel-fill" data-open={String(open)} data-side={side}
        x={g.fill.x} y={g.fill.y} width={g.fill.width} height={g.fill.height}
        fill="currentColor" stroke="none" className={ANIM} style={fillStyle} />
      <rect data-testid="panel-divider" data-open={String(open)} data-side={side}
        x={g.divider.x} y={g.divider.y} width={g.divider.width} height={g.divider.height}
        fill="currentColor" stroke="none" className={ANIM} style={dividerStyle} />
    </svg>
  )
}
