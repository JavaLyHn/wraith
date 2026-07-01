import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import type { BackendEvent, SessionMeta } from '../shared/types'
import {
  initialState,
  reduce,
  clearApproval,
  setModel,
  markStarted,
  setApprovalMode,
  setWorkspace,
  resetSession,
  loadHistory,
  setSessionId,
  addUserItem,
  type TranscriptState,
  type Item,
} from '../shared/transcriptReducer'
import { messagesToItems } from '../shared/messagesToItems'
import Transcript from './components/Transcript'
import Composer from './components/Composer'
import ApprovalModal from './components/ApprovalModal'
import DisconnectedBanner from './components/DisconnectedBanner'
import WelcomeEmptyState from './components/WelcomeEmptyState'
import Sidebar from './components/Sidebar'

// ---------------------------------------------------------------------------
// Local action types (for non-BackendEvent dispatches)
// ---------------------------------------------------------------------------

type LocalAction =
  | { type: 'clearApproval' }
  | { type: 'setModel'; model: string }
  | { type: 'markStarted' }
  | { type: 'setApprovalMode'; mode: 'ask' | 'auto' }
  | { type: 'setWorkspace'; ws: string }
  | { type: 'resetSession'; ws: string }
  | { type: 'addUserItem'; text: string }
  | { type: 'loadHistory'; items: Item[] }
  | { type: 'setSessionId'; sessionId: string }

type Action = BackendEvent | LocalAction

// ---------------------------------------------------------------------------
// Reducer adapter that handles both BackendEvent and LocalAction
// ---------------------------------------------------------------------------

function reduceAdapter(state: TranscriptState, action: Action): TranscriptState {
  if ('type' in action && action.type === 'clearApproval') {
    return clearApproval(state)
  }
  if ('type' in action && action.type === 'setModel') {
    return setModel(state, action.model)
  }
  if ('type' in action && action.type === 'markStarted') {
    return markStarted(state)
  }
  if ('type' in action && action.type === 'setApprovalMode') {
    return setApprovalMode(state, action.mode)
  }
  if ('type' in action && action.type === 'setWorkspace') {
    return setWorkspace(state, action.ws)
  }
  if ('type' in action && action.type === 'resetSession') {
    return resetSession(state, action.ws)
  }
  if ('type' in action && action.type === 'addUserItem') {
    return addUserItem(state, action.text)
  }
  if ('type' in action && action.type === 'loadHistory') {
    return loadHistory(state, action.items)
  }
  if ('type' in action && action.type === 'setSessionId') {
    return setSessionId(state, action.sessionId)
  }
  // BackendEvent has 'kind' field
  return reduce(state, action as BackendEvent)
}

// Override initial state: treat initial connection as 'connected' to avoid
// a race where the connected event arrives before onEvent is registered.
const connectedInitialState: TranscriptState = {
  ...initialState,
  connection: 'connected',
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App(): JSX.Element {
  const [state, dispatch] = useReducer(reduceAdapter, connectedInitialState)
  const [inputValue, setInputValue] = useState('')
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const startedRef = useRef(false)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // ── subscribe to backend events on mount ──────────────────────────────────
  useEffect(() => {
    const unsubscribe = window.wraith.onEvent((evt: BackendEvent) => {
      dispatch(evt)
    })
    return unsubscribe
  }, [])

  // ── session list helpers ───────────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    try {
      const { sessions } = await window.wraith.listSessions()
      setSessions(sessions)
    } catch (err) {
      console.error('[wraith] listSessions error:', err)
    }
  }, [])

  const handleNewConversation = useCallback(async () => {
    if (state.turn === 'running') return
    try {
      await window.wraith.startSession(state.workspace || null)
      dispatch({ type: 'resetSession', ws: state.workspace })
      void fetchSessions()
    } catch (err) {
      console.error('[wraith] newConversation error:', err)
    }
  }, [state.turn, state.workspace, fetchSessions])

  const handleSelectSession = useCallback(async (id: string) => {
    if (state.turn === 'running') return
    try {
      const { sessionId, messages } = await window.wraith.resumeSession(id)
      dispatch({ type: 'loadHistory', items: messagesToItems(messages) })
      dispatch({ type: 'setSessionId', sessionId })
      dispatch({ type: 'markStarted' })
    } catch (err) {
      console.error('[wraith] resumeSession error:', err)
    }
  }, [state.turn])

  // ── startup flow (runs once) ───────────────────────────────────────────────
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    void (async () => {
      try {
        const ws = await window.wraith.getInitialWorkspace()
        dispatch({ type: 'setWorkspace', ws: ws ?? '' })
        const init = await window.wraith.initialize(ws)
        const initObj = init as { model?: string }
        if (initObj.model) {
          dispatch({ type: 'setModel', model: initObj.model })
        }
        await window.wraith.startSession(ws)
        void fetchSessions()
      } catch (err) {
        console.error('[wraith] startup error:', err)
      }
    })()
  }, [fetchSessions])

  // ── auto-scroll to bottom as items arrive ─────────────────────────────────
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.items])

  // ── refresh session list when a turn completes ────────────────────────────
  const prevTurnRef = useRef(state.turn)
  useEffect(() => {
    if (prevTurnRef.current === 'running' && state.turn === 'idle') {
      void fetchSessions()
    }
    prevTurnRef.current = state.turn
  }, [state.turn, fetchSessions])

  // ── input submit ──────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || state.turn === 'running') return
    setInputValue('')
    dispatch({ type: 'markStarted' })
    dispatch({ type: 'addUserItem', text })
    try {
      await window.wraith.submitTurn(text)
    } catch (err) {
      console.error('[wraith] submitTurn error:', err)
    }
  }, [inputValue, state.turn])

  // ── approval handlers ──────────────────────────────────────────────────────
  const handleApprove = useCallback(async () => {
    if (!state.pendingApproval) return
    try {
      await window.wraith.respondApproval(state.pendingApproval.approvalId, 'APPROVED')
    } finally {
      dispatch({ type: 'clearApproval' })
    }
  }, [state.pendingApproval])

  const handleReject = useCallback(async () => {
    if (!state.pendingApproval) return
    try {
      await window.wraith.respondApproval(state.pendingApproval.approvalId, 'REJECTED')
    } finally {
      dispatch({ type: 'clearApproval' })
    }
  }, [state.pendingApproval])

  // ── restart backend ────────────────────────────────────────────────────────
  const handleRestart = useCallback(async () => {
    try {
      await window.wraith.restartBackend()
    } catch (err) {
      console.error('[wraith] restartBackend error:', err)
    }
  }, [])

  // ── interrupt ─────────────────────────────────────────────────────────────
  const handleInterrupt = useCallback(async () => {
    try {
      await window.wraith.interrupt()
    } catch (err) {
      console.error('[wraith] interrupt error:', err)
    }
  }, [])

  // ── approval mode toggle ──────────────────────────────────────────────────
  const handleToggleApproval = useCallback(
    async (auto: boolean) => {
      const mode = auto ? 'auto' : 'ask'
      dispatch({ type: 'setApprovalMode', mode })
      try {
        await window.wraith.setApprovalMode(auto)
      } catch (err) {
        console.error('[wraith] setApprovalMode error:', err)
        dispatch({ type: 'setApprovalMode', mode: auto ? 'ask' : 'auto' }) // rollback
      }
    },
    [],
  )

  // ── workspace switch ───────────────────────────────────────────────────────
  const handleSwitchWorkspace = useCallback(async () => {
    if (state.turn === 'running') return
    try {
      const ws = await window.wraith.pickWorkspace()
      if (!ws || ws === state.workspace) return
      await window.wraith.startSession(ws)
      dispatch({ type: 'resetSession', ws })
    } catch (err) {
      console.error('[wraith] switchWorkspace error:', err)
    }
  }, [state.turn, state.workspace])

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
      <Sidebar
        workspace={state.workspace}
        sessions={sessions}
        activeSessionId={state.sessionId}
        onNewConversation={handleNewConversation}
        onSelectSession={handleSelectSession}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {state.connection === 'disconnected' && (
          <DisconnectedBanner onRestart={handleRestart} />
        )}

        {/* content: welcome ↔ transcript + composer （沿用 Task 6 的条件渲染块） */}
        {(() => {
          const composer = (
            <Composer
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              onInterrupt={handleInterrupt}
              running={state.turn === 'running'}
              approvalAuto={state.approvalMode === 'auto'}
              onToggleApproval={handleToggleApproval}
              model={state.model}
              workspace={state.workspace}
              onSwitchWorkspace={handleSwitchWorkspace}
              centered={!state.hasStarted}
            />
          )
          return state.hasStarted ? (
            <>
              <Transcript items={state.items} />
              <div ref={transcriptEndRef} />
              <div style={{ padding: '12px 16px', flexShrink: 0 }}>{composer}</div>
            </>
          ) : (
            <div className="min-h-0 flex-1">
              <WelcomeEmptyState>{composer}</WelcomeEmptyState>
            </div>
          )
        })()}
      </div>

      {/* Approval modal（Task 8 换 shadcn Dialog；此处结构不变） */}
      {state.pendingApproval && (
        <ApprovalModal
          approvalId={state.pendingApproval.approvalId}
          toolName={state.pendingApproval.toolName}
          argsJson={state.pendingApproval.argsJson}
          dangerLevel={state.pendingApproval.dangerLevel}
          riskDescription={state.pendingApproval.riskDescription}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </div>
  )
}
