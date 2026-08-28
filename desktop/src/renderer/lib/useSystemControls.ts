import { useCallback } from 'react'
import { logger } from './logger'

export interface UseSystemControlsReturn {
  handleRestart: () => Promise<void>
  handleInterrupt: () => Promise<void>
}

export function useSystemControls(): UseSystemControlsReturn {
  const handleRestart = useCallback(async () => {
    try {
      await window.wraith.restartBackend()
    } catch (err) {
      logger.error('wraith', 'restartBackend error:', err)
    }
  }, [])

  const handleInterrupt = useCallback(async () => {
    try {
      await window.wraith.interrupt()
    } catch (err) {
      logger.error('wraith', 'interrupt error:', err)
    }
  }, [])

  return { handleRestart, handleInterrupt }
}