import { useDynamicRowHeight } from 'react-window'

/**
 * 封装 react-window v2 的 useDynamicRowHeight。
 *
 * 为 Transcript 消息列表提供可变行高缓存,初始高度用估算值(80px),
 * 实际渲染后通过 observeRowElements 自动监听 DOM 尺寸变化。
 */
export function useTranscriptRowHeights(rowCount: number) {
  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: 80,
    key: `transcript-rows-${rowCount}`,
  })

  return {
    dynamicRowHeight,
    setRowHeight: (index: number, height: number) => dynamicRowHeight.setRowHeight(index, height),
  }
}
