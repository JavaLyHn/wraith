import { useCallback, useEffect, useRef } from 'react'
import type { BackendEvent, McpServerView } from '../../shared/types'
import { createThrottleLatest, type ThrottledPush } from '../../shared/throttleLatest'

/**
 * 主后端事件订阅:status 高频节流 + MCP 状态更新 + turn 事件副作用。
 *
 * 把 App.tsx L454-485 的主 onEvent effect 集中到这里。
 * 它负责:
 * - 高频 status 事件 100ms 窗口合并
 * - mcp.status → 更新 mcpServers + 触发资源刷新
 * - turn.completed/turn.failed → 刷新 git status + activity
 * - 其余事件原样 dispatch
 *
 * 为了避免每次依赖变化都重建订阅(会导致 onEvent 反复退订/再订阅),
 * 回调通过 ref 注入,始终读取最新版本。
 */
export interface UseBackendEventSubscriptionOptions {
  dispatch: (evt: BackendEvent) => void
  setMcpServers: React.Dispatch<React.SetStateAction<McpServerView[]>>
  onMcpReady: () => void
  onTurnCompleted: () => void
  onTurnFailed: () => void
}

export interface UseBackendEventSubscriptionReturn {
  statusThrottleRef: React.MutableRefObject<ThrottledPush<BackendEvent> | null>
}

export function useBackendEventSubscription(opts: UseBackendEventSubscriptionOptions): UseBackendEventSubscriptionReturn {
  const statusThrottleRef = useRef<ThrottledPush<BackendEvent> | null>(null)

  // 最新回调的 ref:让订阅体始终读到最新的 opts,又不会因为依赖变化重建订阅。
  const optsRef = useRef(opts)
  optsRef.current = opts

  const subscribe = useCallback(() => {
    const throttledStatus = createThrottleLatest<BackendEvent>(100, evt => optsRef.current.dispatch(evt))
    statusThrottleRef.current = throttledStatus
    const unsubscribe = window.wraith.onEvent((evt: BackendEvent) => {
      const current = optsRef.current
      if (evt.kind === 'notification' && evt.method === 'mcp.status') {
        const p = evt.params as { name: string; state: McpServerView['state']; error?: string }
        current.setMcpServers(prev => prev.map(s => (s.name === p.name ? { ...s, state: p.state, enabled: p.state !== 'disabled', error: p.error } : s)))
        if (p.state === 'ready') {
          current.onMcpReady()
        }
        return
      }
      if (evt.kind === 'notification' && evt.method === 'status') {
        throttledStatus(evt)
        return
      }
      if (evt.kind === 'notification'
          && (evt.method === 'turn.completed' || evt.method === 'turn.failed')) {
        // 原版 App.tsx 在 turn.completed / turn.failed 时只调一次副作用,
        // 这里 onTurnCompleted 承担「刷新 git + activity」的语义;
        // onTurnFailed 留给其它需要在失败时单独处理的场景(默认空实现)。
        current.onTurnCompleted()
      }
      current.dispatch(evt)
    })
    return () => {
      throttledStatus.cancel()
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const cleanup = subscribe()
    return cleanup
  }, [subscribe])

  return { statusThrottleRef }
}
