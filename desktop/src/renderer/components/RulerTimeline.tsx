import { cn } from '../lib/utils'

export interface RulerTimelineProps {
  /** 每个对话轮次的 hid（一问一答/中断各算一轮）。数组长度 = 横线数量。 */
  turns: string[]
  activeHid: string | null
  onHover: (hid: string | null) => void
  /** 点击横线 → 滚动会话内容到对应轮次开头。 */
  onJump: (hid: string) => void
  className?: string
}

/**
 * 会话左侧固定横线列（独立于内容滚动区）：
 * - 横线数量 = 对话轮次数（一问一答一条、发完即中断也算一条），不随容器高度变化
 * - 列固定在左侧，内容滚动时横线不动
 * - 轮次超出可视高度时列内独立上下滚动，滚轮悬停在列上时不会滚动会话内容
 */
export default function RulerTimeline({
  turns,
  activeHid,
  onHover,
  onJump,
  className,
}: RulerTimelineProps): JSX.Element {
  return (
    <div
      className={cn('ruler-timeline', className)}
      data-testid="ruler-timeline"
      aria-label="对话轮次导航"
      // 列是独立的 overflow 容器：滚轮在其上时原生滚动列自身；
      // stopPropagation 阻断冒泡到外层 wheel 监听，确保会话内容不随之滚动
      onWheel={(e) => e.stopPropagation()}
    >
      {turns.map((hid, i) => (
        <div
          key={hid}
          className={cn('ruler-line', activeHid === hid && 'ruler-line--on')}
          role="button"
          tabIndex={-1}
          aria-label={`第 ${i + 1} 轮对话`}
          title={`第 ${i + 1} 轮`}
          onMouseEnter={() => { onHover(hid) }}
          onMouseLeave={() => { onHover(null) }}
          onClick={() => { onJump(hid) }}
        />
      ))}
    </div>
  )
}
