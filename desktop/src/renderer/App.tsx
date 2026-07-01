import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import type { BackendEvent } from '../shared/types'
import {
  initialState,
  reduce,
  clearApproval,
  setModel,
  type TranscriptState,
} from '../shared/transcriptReducer'
import Transcript from './components/Transcript'
import ApprovalModal from './components/ApprovalModal'
import DisconnectedBanner from './components/DisconnectedBanner'

// ---------------------------------------------------------------------------
// Local action types (for non-BackendEvent dispatches)
// ---------------------------------------------------------------------------

type LocalAction =
  | { type: 'clearApproval' }
  | { type: 'setModel'; model: string }

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
    try {
      await window.wraith.submitTurn(text)
    } catch (err) {
      console.error('[wraith] submitTurn error:', err)
    }
  }, [inputValue, state.turn])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit],
  )

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

      {/* Input area */}
      <div
        style={{
          borderTop: '1px solid #1e2128',
          padding: '10px 16px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        {state.turn === 'running' && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              data-testid="interrupt"
              onClick={handleInterrupt}
              style={{
                background: 'none',
                border: '1px solid #5a1a1a',
                borderRadius: '4px',
                color: '#c0392b',
                padding: '3px 10px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '11px',
              }}
            >
              中断
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <textarea
            data-testid="input"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={state.turn === 'running'}
            placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"
            rows={2}
            style={{
              flexGrow: 1,
              background: '#0f1114',
              border: '1px solid #2a2d35',
              borderRadius: '4px',
              color: '#cdd6e0',
              padding: '8px 10px',
              fontFamily: 'inherit',
              fontSize: '13px',
              resize: 'none',
              outline: 'none',
              lineHeight: 1.5,
              opacity: state.turn === 'running' ? 0.5 : 1,
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={state.turn === 'running' || !inputValue.trim()}
            style={{
              background: state.turn === 'running' ? '#1a2030' : '#1a2e4a',
              border: '1px solid #3d8eff',
              borderRadius: '4px',
              color: '#3d8eff',
              padding: '8px 14px',
              cursor:
                state.turn === 'running' || !inputValue.trim()
                  ? 'not-allowed'
                  : 'pointer',
              fontFamily: 'inherit',
              fontSize: '12px',
              opacity:
                state.turn === 'running' || !inputValue.trim() ? 0.4 : 1,
              alignSelf: 'stretch',
            }}
          >
            发送
          </button>
        </div>
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
