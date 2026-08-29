import { useEventListener } from './useEventListener'

/**
 * 全局拖拽拦截 hook:阻止 Electron 默认拖文件导航行为。
 *
 * 全窗兜底 —— 拖文件到 Composer 之外的空白处时,
 * 阻止默认导航到 file://,避免误操作。
 */
export function useGlobalDragPrevent(): void {
  useEventListener('dragover', e => e.preventDefault())
  useEventListener('drop', e => e.preventDefault())
}
