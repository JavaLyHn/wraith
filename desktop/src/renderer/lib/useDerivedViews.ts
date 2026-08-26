import { useMemo } from 'react'
import { deriveView, type Preview } from '../../shared/sessionPreview'
import { showNoModelNotice } from './modelReady'
import type { Item } from '../../shared/transcriptReducer'

export interface UseDerivedViewsOptions {
  preview: Preview | null
  sessionId: string
  items: Item[]
  hasStarted: boolean
  turn: 'idle' | 'running'
  noModel: boolean
  model: string
}

export interface UseDerivedViewsReturn {
  pv: ReturnType<typeof deriveView>
  taskDoneNotices: Extract<Item, { type: 'task-done' }>[]
  showNoModel: boolean
}

export function useDerivedViews(opts: UseDerivedViewsOptions): UseDerivedViewsReturn {
  const pv = useMemo(() => deriveView(opts.preview, {
    sessionId: opts.sessionId,
    items: opts.items,
    hasStarted: opts.hasStarted,
    turn: opts.turn,
  }), [opts.preview, opts.sessionId, opts.items, opts.hasStarted, opts.turn])

  const taskDoneNotices = useMemo(() => {
    if (!pv.showWelcome) return []
    return opts.items.filter((i): i is Extract<Item, { type: 'task-done' }> => i.type === 'task-done')
  }, [pv.showWelcome, opts.items])

  const showNoModel = useMemo(() => showNoModelNotice(opts.noModel, opts.model), [opts.noModel, opts.model])

  return { pv, taskDoneNotices, showNoModel }
}