import { useCallback } from 'react'

export interface UseChoiceHandlersOptions {
  getPendingChoice: () => { choiceId: string } | null
  dispatch: (action: { type: string }) => void
}

export interface UseChoiceHandlersReturn {
  handleChoiceRespond: (selectedIndex: number) => Promise<void>
  handleChoiceReject: () => Promise<void>
}

export function useChoiceHandlers(opts: UseChoiceHandlersOptions): UseChoiceHandlersReturn {
  const handleChoiceRespond = useCallback(async (selectedIndex: number) => {
    const cur = opts.getPendingChoice()
    if (!cur) return
    try {
      await window.wraith.respondChoice(cur.choiceId, false, selectedIndex)
    } finally {
      opts.dispatch({ type: 'clearChoice' })
    }
  }, [])

  const handleChoiceReject = useCallback(async () => {
    const cur = opts.getPendingChoice()
    if (!cur) return
    try {
      await window.wraith.respondChoice(cur.choiceId, true, -1)
    } finally {
      opts.dispatch({ type: 'clearChoice' })
    }
  }, [])

  return { handleChoiceRespond, handleChoiceReject }
}