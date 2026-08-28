import { useCallback } from 'react'
import { logger } from './logger'
import { makeSystemEvent } from '../../shared/systemEvent'
import { imBoundEventText } from './gatewayLabels'
import { useSystemEventQueue } from './useSystemEventQueue'
import type { GatewayState } from '../../shared/gateway'

export interface UseSystemEventsOptions {
  dispatch: (action: { type: string; [key: string]: unknown } | { kind: string; method: string; params: Record<string, unknown> }) => void
  getTurn: () => 'idle' | 'running'
}

export interface UseSystemEventsReturn {
  emitSystemEvent: (text: string) => void
  handleImBound: (platform: string, gatewayState: GatewayState | null) => void
}

export function useSystemEvents(opts: UseSystemEventsOptions): UseSystemEventsReturn {
  const emitSystemEvent = useCallback((text: string) => {
    opts.dispatch({ type: 'addSystemEvent', text })
    opts.dispatch({ type: 'markStarted' })
    void window.wraith.submitTurn(makeSystemEvent(text)).catch((err: unknown) => {
      logger.error('wraith', 'system event submit failed:', err)
      opts.dispatch({ kind: 'notification', method: 'turn.failed', params: {} })
    })
  }, [])

  const enqueueSystemEvent = useSystemEventQueue(opts.getTurn() === 'running', emitSystemEvent)

  const handleImBound = useCallback((platform: string, gatewayState: GatewayState | null) => {
    enqueueSystemEvent(imBoundEventText(platform, gatewayState))
  }, [enqueueSystemEvent])

  return { emitSystemEvent, handleImBound }
}