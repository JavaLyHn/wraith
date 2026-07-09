import type { Item } from './transcriptReducer'

/** 只读预览覆盖态(App 层,不进 reducer)。 */
export type Preview =
  | null
  | { kind: 'session'; sessionId: string; items: Item[] }
  | { kind: 'new' }

export type Turn = 'idle' | 'running'

/** 点侧栏会话行的决策。running→预览覆盖;idle→完整切换。 */
export function selectAction(
  turn: Turn,
  clickedId: string,
  liveSessionId: string,
):
  | { mode: 'preview-return' }
  | { mode: 'preview-open'; sessionId: string }
  | { mode: 'full-switch'; sessionId: string } {
  if (turn === 'running') {
    return clickedId === liveSessionId
      ? { mode: 'preview-return' }
      : { mode: 'preview-open', sessionId: clickedId }
  }
  return { mode: 'full-switch', sessionId: clickedId }
}

/** turn 跑完时如何落定挂着的 preview(执行被推迟的真实切换)。 */
export function resolveOnIdle(
  preview: Preview,
): { action: 'resume'; sessionId: string } | { action: 'new' } | { action: 'none' } {
  if (preview === null) return { action: 'none' }
  if (preview.kind === 'session') return { action: 'resume', sessionId: preview.sessionId }
  return { action: 'new' }
}

/** 由 preview + live 状态派生视图模型,保持 App 渲染分支瘦。 */
export function deriveView(
  preview: Preview,
  live: { sessionId: string; items: Item[]; hasStarted: boolean; turn: Turn },
): {
  items: Item[]
  activeSessionId: string
  runningSessionId: string
  showWelcome: boolean
  transcriptBusy: boolean
  showReturnBanner: boolean
} {
  const runningSessionId = live.turn === 'running' ? live.sessionId : ''
  if (preview !== null && preview.kind === 'session') {
    return {
      items: preview.items,
      activeSessionId: preview.sessionId,
      runningSessionId,
      showWelcome: false,
      transcriptBusy: false,
      showReturnBanner: live.turn === 'running',
    }
  }
  if (preview !== null && preview.kind === 'new') {
    return {
      items: [],
      activeSessionId: '',
      runningSessionId,
      showWelcome: true,
      transcriptBusy: false,
      showReturnBanner: live.turn === 'running',
    }
  }
  // 看 live
  return {
    items: live.items,
    activeSessionId: live.sessionId,
    runningSessionId,
    showWelcome: !live.hasStarted,
    transcriptBusy: live.turn === 'running',
    showReturnBanner: false,
  }
}
