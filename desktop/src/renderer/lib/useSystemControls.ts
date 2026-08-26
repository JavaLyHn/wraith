import { useCallback } from 'react'

export interface UseSystemControlsReturn {
  handleRestart: () => Promise<void>
  handleInterrupt: () => Promise<void>
}

export function useSystemControls(): UseSystemControlsReturn {
  const handleRestart = useCallback(async () => {
    try {
      await window.wraith.restartBackend()
    } catch (err) {
      console.error('[wraith] restartBackend error:', err)
    }
  }, [])

  const handleInterrupt = useCallback(async () => {
    try {
      await window.wraith.interrupt()
    } catch (err) {
      console.error('[wraith] interrupt error:', err)
    }
  }, [])

  return { handleRestart, handleInterrupt }
}