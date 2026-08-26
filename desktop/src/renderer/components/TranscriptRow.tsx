import { useEffect, useRef } from 'react'
import type { DynamicRowHeight } from 'react-window'

interface TranscriptRowProps {
  index: number
  style: React.CSSProperties
  dynamicRowHeight: DynamicRowHeight
  children: React.ReactNode
}

/**
 * 虚拟行包装器:测量子元素的实际渲染高度并回报给 react-window 的 DynamicRowHeight。
 *
 * 使用 observeRowElements 让 react-window 自动监听尺寸变化(流式内容增长、Markdown 重排等),
 * 当高度变化时自动更新滚动位置。
 */
export function TranscriptRow({ index, style, dynamicRowHeight, children }: TranscriptRowProps): JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    // 初始测量
    const height = Math.ceil(el.getBoundingClientRect().height)
    if (height > 0) dynamicRowHeight.setRowHeight(index, height)
    // 观察尺寸变化(测试环境可能无 ResizeObserver,需守卫)
    if (typeof ResizeObserver !== 'undefined') {
      const cleanup = dynamicRowHeight.observeRowElements([el])
      return cleanup
    }
  }, [index, dynamicRowHeight])

  return (
    <div style={style} className="shrink-0 px-4 py-1">
      <div ref={rowRef}>{children}</div>
    </div>
  )
}
