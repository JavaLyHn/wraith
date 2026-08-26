import { useCallback } from 'react'
import type { TranscriptState } from '../../shared/transcriptReducer'

/**
 * State getter 工厂 hook:为 TranscriptState 的各个字段创建稳定的 getter 回调。
 */
export function useStateGetters(state: Pick<TranscriptState, 'turn' | 'sessionId' | 'workspace' | 'items'>) {
  const getTurn = useCallback(() => state.turn, [state.turn])
  const getSessionId = useCallback(() => state.sessionId, [state.sessionId])
  const getWorkspace = useCallback(() => state.workspace, [state.workspace])

  return { getTurn, getSessionId, getWorkspace }
}
