import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import type { BackendEvent } from '../shared/types'
import {
  initialState,
  reduce,
  clearApproval,
  setModel,
  markStarted,
  setApprovalMode,
  setWorkspace,
  resetSession,
  type TranscriptState,
} from '../shared/transcriptReducer'
import Transcript from './components/Transcript'
import Composer from './components/Composer'
import ApprovalModal from './components/ApprovalModal'
import DisconnectedBanner from './components/DisconnectedBanner'

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
  const startedRef = useRef(false)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // ── subscribe to backend events on mount ──────────────────────────────────
  useEffect(() => {
    const unsubscribe = window.wraith.onEvent((evt: BackendEvent) => {
      dispatch(evt)
    })
    return unsubscribe
  }, [])

  // ── startup flow (runs once) ───────────────────────────────────────────────
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    void (async () => {
      try {
        const ws = await window.wraith.pickWorkspace()
        dispatch({ type: 'setWorkspace', ws: ws ?? '' })
        const init = await window.wraith.initialize(ws)
        const initObj = init as { model?: string }
        if (initObj.model) {
          dispatch({ type: 'setModel', model: initObj.model })
        }
        await window.wraith.startSession(ws)
      } catch (err) {
        console.error('[wraith] startup error:', err)
      }
    })()
  }, [])

  // ── auto-scroll to bottom as items arrive ─────────────────────────────────
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.items])

  // ── input submit ──────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || state.turn === 'running') return
    setInputValue('')
    dispatch({ type: 'markStarted' })
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#0d0f12',
        color: '#cdd6e0',
        fontFamily: 'JetBrains Mono, Consolas, monospace',
        overflow: 'hidden',
      }}
    >
      {/* Disconnected banner — rendered above header */}
      {state.connection === 'disconnected' && (
        <DisconnectedBanner onRestart={handleRestart} />
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid #1e2128',
          flexShrink: 0,
          marginTop: state.connection === 'disconnected' ? '38px' : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              color: '#3d8eff',
              fontWeight: 700,
              fontSize: '14px',
              letterSpacing: '0.06em',
            }}
          >
            WRAITH
          </span>
          {state.model && (
            <span style={{ color: '#3a4050', fontSize: '11px' }}>
              {state.model}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background:
                state.connection === 'connected' ? '#27ae60' : '#c0392b',
              display: 'inline-block',
            }}
          />
          <span style={{ color: '#3a4050', fontSize: '11px' }}>
            {state.turn === 'running' ? '运行中' : '就绪'}
          </span>
        </div>
      </div>

      {/* Transcript */}
      <Transcript items={state.items} />
      <div ref={transcriptEndRef} />

      {/* Composer */}
      <div style={{ padding: '12px 16px', flexShrink: 0 }}>
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
        />
      </div>

      {/* Approval modal */}
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
