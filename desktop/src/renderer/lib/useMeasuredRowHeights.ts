import { useCallback, useRef, useState } from 'react'

const ESTIMATED_ROW_HEIGHT = 80

/**
 * 可变行高测量缓存:为 react-window 的 VariableSizeList 提供高度估算和实际测量。
 *
 * 首次渲染用估算值,渲染完成后用 ResizeObserver/offsetHeight 测量真实高度,
 * 下次渲染时使用真实值。当行数变化时自动重置。
 */
export function useMeasuredRowHeights(rowCount: number): {
  estimate: (index: number) => number
  measure: (index: number, height: number) => void
  invalidate: (index: number) => void
  clear: () => void
  getHeight: (index: number) => number | undefined
} {
  const heightsRef = useRef<Map<number, number>>(new Map())
  const versionRef = useRef(0)
  const [, forceRender] = useState(0)

  // 当行数大幅缩减时(如删除消息),清理超出范围的缓存
  useCallback(() => {
    const heights = heightsRef.current
    if (heights.size > rowCount) {
      heights.clear()
    }
    // 标记需要重新渲染以更新列表
    versionRef.current++
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowCount])

  const estimate = useCallback((index: number): number => {
    return heightsRef.current.get(index) ?? ESTIMATED_ROW_HEIGHT
  }, [])

  const measure = useCallback((index: number, height: number): void => {
    const heights = heightsRef.current
    const prev = heights.get(index)
    if (prev !== height) {
      heights.set(index, height)
      // 触发列表重新计算(仅当高度变化时)
      forceRender(v => v + 1)
    }
  }, [])

  const invalidate = useCallback((index: number): void => {
    heightsRef.current.delete(index)
  }, [])

  const clear = useCallback((): void => {
    heightsRef.current.clear()
  }, [])

  const getHeight = useCallback((index: number): number | undefined => {
    return heightsRef.current.get(index)
  }, [])

  return { estimate, measure, invalidate, clear, getHeight }
}
