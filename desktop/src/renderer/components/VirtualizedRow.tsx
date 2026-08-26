import { useCallback, useEffect, useRef } from 'react'

interface VirtualizedRowProps {
  index: number
  onMeasure: (index: number, height: number) => void
  children: React.ReactNode
  style: React.CSSProperties
}

/**
 * 虚拟行包装器:测量子元素的实际渲染高度并回报给 VariableSizeList。
 *
 * 使用 ResizeObserver 监听尺寸变化(流式内容增长、Markdown 重排等),
 * 当高度变化时通知列表重新计算滚动位置。
 */
export function VirtualizedRow({ index, onMeasure, children, style }: VirtualizedRowProps): JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null)
  const lastHeightRef = useRef(0)
  const roRef = useRef<ResizeObserver | null>(null)

  const measure = useCallback(() => {
    const el = rowRef.current
    if (!el) return
    const height = Math.ceil(el.getBoundingClientRect().height)
    if (height > 0 && height !== lastHeightRef.current) {
      lastHeightRef.current = height
      onMeasure(index, height)
    }
  }, [index, onMeasure])

  useEffect(() => {
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const el = rowRef.current
    if (!el) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    roRef.current = ro
    return () => {
      ro.disconnect()
      roRef.current = null
    }
  }, [measure])

  return (
    <div style={style} className="shrink-0">
      <div ref={rowRef}>{children}</div>
    </div>
  )
}
