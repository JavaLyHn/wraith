import { useCallback, useState } from 'react'

/** 会话列表拖拽排序状态:记录当前被拖的 id 和目标位置 id。 */
export interface SessionDragState {
  draggingId: string | null
  overId: string | null
}

export interface UseSessionDragOptions {
  /** drop 时触发的排序回调。section 标识目标分区(跨分区拖拽会自动星标切换)。 */
  onReorder?: (sourceId: string, targetId: string, targetSection?: 'starred' | 'rest') => void
}

export interface UseSessionDragReturn {
  dragState: SessionDragState
  beginDrag: (id: string) => void
  updateOver: (id: string) => void
  endDrag: () => void
  /** 完整 drop:拖拽源释放到目标位置 */
  completeDrop: (targetId: string, targetSection?: 'starred' | 'rest') => void
}

/** 会话列表拖拽排序 hook。负责维护 dragging/over 状态和触发 drop 回调。 */
export function useSessionDrag(opts: UseSessionDragOptions = {}): UseSessionDragReturn {
  const [dragState, setDragState] = useState<SessionDragState>({ draggingId: null, overId: null })

  const beginDrag = useCallback((id: string) => {
    setDragState({ draggingId: id, overId: null })
  }, [])

  const updateOver = useCallback((id: string) => {
    setDragState(prev => prev.draggingId ? { ...prev, overId: id } : prev)
  }, [])

  const endDrag = useCallback(() => {
    setDragState({ draggingId: null, overId: null })
  }, [])

  const completeDrop = useCallback((targetId: string, targetSection?: 'starred' | 'rest') => {
    const sourceId = dragState.draggingId
    if (sourceId && sourceId !== targetId) {
      opts.onReorder?.(sourceId, targetId, targetSection)
    }
    setDragState({ draggingId: null, overId: null })
  }, [dragState.draggingId, opts.onReorder])

  return { dragState, beginDrag, updateOver, endDrag, completeDrop }
}
