import {
  reduce,
  clearApproval,
  clearChoice,
  setModel,
  markStarted,
  markResumed,
  setApprovalMode,
  setWorkspace,
  resetSession,
  loadHistory,
  setSessionId,
  setSandbox,
  addUserItem,
  addSystemEventItem,
  addTaskDoneItem,
  truncateAtUserOrdinal,
  markPlanReviewResolved,
  type TranscriptState,
  type Item,
  type AttachmentRef,
} from '../../shared/transcriptReducer'
import type { BackendEvent, SandboxKindWire } from '../../shared/types'

export type LocalAction =
  | { type: 'clearApproval' }
  | { type: 'clearChoice' }
  | { type: 'setModel'; model: string }
  | { type: 'markStarted' }
  | { type: 'markResumed' }
  | { type: 'setApprovalMode'; mode: 'ask' | 'auto' }
  | { type: 'setWorkspace'; ws: string }
  | { type: 'resetSession'; ws: string }
  | { type: 'addUserItem'; text: string; attachments?: AttachmentRef[] }
  | { type: 'addSystemEvent'; text: string }
  | { type: 'addTaskDone'; taskId: string; text: string; ok: boolean }
  | { type: 'loadHistory'; items: Item[] }
  | { type: 'setSessionId'; sessionId: string }
  | { type: 'setSandbox'; sandbox: SandboxKindWire; networkAllowed: boolean }
  | { type: 'truncateAtUser'; ordinal: number }
  | { type: 'markPlanReviewResolved'; reviewId: string }

export type AppAction = BackendEvent | LocalAction

export function reduceAdapter(state: TranscriptState, action: AppAction): TranscriptState {
  if ('type' in action && action.type === 'clearApproval') return clearApproval(state)
  if ('type' in action && action.type === 'clearChoice') return clearChoice(state)
  if ('type' in action && action.type === 'setModel') return setModel(state, action.model)
  if ('type' in action && action.type === 'markStarted') return markStarted(state)
  if ('type' in action && action.type === 'markResumed') return markResumed(state)
  if ('type' in action && action.type === 'setApprovalMode') return setApprovalMode(state, action.mode)
  if ('type' in action && action.type === 'setWorkspace') return setWorkspace(state, action.ws)
  if ('type' in action && action.type === 'resetSession') return resetSession(state, action.ws)
  if ('type' in action && action.type === 'addUserItem') return addUserItem(state, action.text, action.attachments)
  if ('type' in action && action.type === 'addSystemEvent') return addSystemEventItem(state, action.text)
  if ('type' in action && action.type === 'addTaskDone') return addTaskDoneItem(state, action.taskId, action.text, action.ok)
  if ('type' in action && action.type === 'loadHistory') return loadHistory(state, action.items)
  if ('type' in action && action.type === 'setSessionId') return setSessionId(state, action.sessionId)
  if ('type' in action && action.type === 'setSandbox') return setSandbox(state, action.sandbox, action.networkAllowed)
  if ('type' in action && action.type === 'truncateAtUser') return truncateAtUserOrdinal(state, action.ordinal)
  if ('type' in action && action.type === 'markPlanReviewResolved') return markPlanReviewResolved(state, action.reviewId)
  return reduce(state, action as BackendEvent)
}
