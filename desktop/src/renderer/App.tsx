import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import type { BackendEvent, SessionMeta, ProjectView, McpServerView, McpResourceView } from '../shared/types'
import type { McpFormValue } from './components/McpServerForm'
import type { ApprovalResponsePayload } from '../shared/buildApprovalResponse'
import { createThrottleLatest, type ThrottledPush } from '../shared/throttleLatest'
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
  setSandbox,
  addUserItem,
  truncateAtUserOrdinal,
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
import PluginsPanel from './components/PluginsPanel'
import AutomationsPanel from './components/AutomationsPanel'

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
  | { type: 'setSandbox'; sandbox: 'macos-seatbelt' | 'none' | 'unknown' }
  | { type: 'truncateAtUser'; ordinal: number }

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
  if ('type' in action && action.type === 'setSandbox') {
    return setSandbox(state, action.sandbox)
  }
  if ('type' in action && action.type === 'truncateAtUser') {
    return truncateAtUserOrdinal(state, action.ordinal)
  }
  // BackendEvent has 'kind' field
  return reduce(state, action as BackendEvent)
}

// ---------------------------------------------------------------------------
// Sandbox value normalizer
// ---------------------------------------------------------------------------

function normalizeSandbox(sb: string | undefined): 'macos-seatbelt' | 'none' | 'unknown' {
  return sb === 'none' ? 'none' : sb === 'macos-seatbelt' ? 'macos-seatbelt' : 'unknown'
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
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [view, setView] = useState<'chat' | 'plugins' | 'automations'>('chat')
  const [automationApproval, setAutomationApproval] = useState<{ runId: string; payload: Record<string, unknown> } | null>(null)
  const [automationBadge, setAutomationBadge] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpServerView[]>([])
  const [mcpConfigError, setMcpConfigError] = useState<string | null>(null)
  const [mcpResources, setMcpResources] = useState<McpResourceView[]>([])
  const startedRef = useRef(false)
  const statusThrottleRef = useRef<ThrottledPush<BackendEvent> | null>(null)

  // Define fetchMcpResources before onEvent effect so it can be referenced in deps
  const fetchMcpResources = useCallback(async () => {
    try {
      const { resources } = await window.wraith.mcpResources()
      setMcpResources(resources)
    } catch (err) {
      console.error('[wraith] mcpResources error:', err)
    }
  }, [])

  // ── subscribe to backend events on mount (status 高频 → 100ms 窗口合并) ────
  useEffect(() => {
    const throttledStatus = createThrottleLatest<BackendEvent>(100, evt => dispatch(evt))
    statusThrottleRef.current = throttledStatus
    const unsubscribe = window.wraith.onEvent((evt: BackendEvent) => {
      if (evt.kind === 'notification' && evt.method === 'mcp.status') {
        const p = evt.params as { name: string; state: McpServerView['state']; error?: string }
        setMcpServers(prev => prev.map(s => (s.name === p.name ? { ...s, state: p.state, enabled: p.state !== 'disabled', error: p.error } : s)))
        if (p.state === 'ready') {
          void fetchMcpResources()
          void fetchMcp() // ready 后工具清单才可用:真后端 starting 期 list 的 tools 为空
        }
        return
      }
      if (evt.kind === 'notification' && evt.method === 'status') {
        throttledStatus(evt)
        return
      }
      dispatch(evt)
    })
    return () => {
      throttledStatus.cancel()
      unsubscribe()
    }
  }, [fetchMcpResources])

  // ── automationApprovalRef:缓存最近一次 approval push(state 槽被 Esc 清掉后仍可从运行历史重弹) ──
  const automationApprovalRef = useRef<{ runId: string; payload: Record<string, unknown> } | null>(null)

  // ── subscribe to automation events on mount ───────────────────────────────
  useEffect(() => {
    const unsub = window.wraith.onAutomationEvent(evt => {
      if (evt.kind === 'badge') setAutomationBadge(evt.show)
      if (evt.kind === 'approval') {
        const entry = { runId: evt.runId, payload: evt.payload }
        automationApprovalRef.current = entry
        setAutomationApproval(entry)
      }
      if (evt.kind === 'open-panel') setView('automations')
      // 'runs-changed' 由面板自身拉取(Task 9),App 层不持 runs 态
    })
    return unsub
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

  const fetchProjects = useCallback(async () => {
    try {
      const { projects } = await window.wraith.listProjects()
      setProjects(projects)
    } catch (err) {
      console.error('[wraith] listProjects error:', err)
    }
  }, [])

  const fetchMcp = useCallback(async () => {
    try {
      const r = await window.wraith.mcpList()
      setMcpServers(r.servers)
      setMcpConfigError(r.configError ?? null)
    } catch (err) {
      console.error('[wraith] mcpList error:', err)
    }
  }, [])

  const handleNewConversation = useCallback(async () => {
    if (state.turn === 'running') return
    try {
      statusThrottleRef.current?.cancel()
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
      statusThrottleRef.current?.cancel()
      const { sessionId, messages } = await window.wraith.resumeSession(id)
      dispatch({ type: 'loadHistory', items: messagesToItems(messages) })
      dispatch({ type: 'setSessionId', sessionId })
      dispatch({ type: 'markStarted' })
      void fetchSessions()
    } catch (err) {
      console.error('[wraith] resumeSession error:', err)
    }
  }, [state.turn, fetchSessions])

  // ── startup flow (runs once) ───────────────────────────────────────────────
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    void (async () => {
      try {
        const ws = await window.wraith.getInitialWorkspace()
        dispatch({ type: 'setWorkspace', ws: ws ?? '' })
        const init = await window.wraith.initialize(ws)
        const initObj = init as { model?: string; capabilities?: { sandbox?: string } }
        if (initObj.model) {
          dispatch({ type: 'setModel', model: initObj.model })
        }
        dispatch({ type: 'setSandbox', sandbox: normalizeSandbox(initObj.capabilities?.sandbox) })
        await window.wraith.startSession(ws)
        void fetchSessions()
        void fetchProjects()
        void fetchMcp()
        void fetchMcpResources()
      } catch (err) {
        console.error('[wraith] startup error:', err)
      }
    })()
  }, [fetchSessions, fetchProjects, fetchMcp, fetchMcpResources])

  // ── reconnect effect (fires on disconnected→connected, skips first connect) ──
  const reconnectRef = useRef(false)
  useEffect(() => {
    if (state.connection === 'disconnected') {
      reconnectRef.current = true
      return
    }
    // connected
    if (!reconnectRef.current) return // first connect is handled by startup effect
    reconnectRef.current = false
    const activeId = state.sessionId
    void (async () => {
      try {
        const ws = state.workspace || null
        const init = await window.wraith.initialize(ws)
        const sb = (init as { capabilities?: { sandbox?: string } }).capabilities?.sandbox
        dispatch({ type: 'setSandbox', sandbox: normalizeSandbox(sb) })
        await window.wraith.startSession(ws)
        if (activeId) {
          const { messages } = await window.wraith.resumeSession(activeId)
          dispatch({ type: 'loadHistory', items: messagesToItems(messages) })
        }
        void fetchSessions()
      } catch (err) {
        console.error('[wraith] reconnect error:', err)
      }
    })()
  }, [state.connection, state.workspace, fetchSessions])

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
  const handleApprovalRespond = useCallback(
    async (payload: ApprovalResponsePayload) => {
      if (!state.pendingApproval) return
      try {
        await window.wraith.respondApproval(state.pendingApproval.approvalId, payload.decision, {
          ...(payload.modifiedArgs ? { modifiedArgs: payload.modifiedArgs } : {}),
          ...(payload.allowNetwork ? { allowNetwork: true } : {}),
        })
      } finally {
        dispatch({ type: 'clearApproval' })
      }
    },
    [state.pendingApproval],
  )

  const handleReject = useCallback(async () => {
    if (!state.pendingApproval) return
    try {
      await window.wraith.respondApproval(state.pendingApproval.approvalId, 'REJECTED')
    } finally {
      dispatch({ type: 'clearApproval' })
    }
  }, [state.pendingApproval])

  // ── automation approval handler ────────────────────────────────────────────
  const handleAutomationApprovalRespond = useCallback(async (payload: ApprovalResponsePayload) => {
    const cur = automationApproval
    if (!cur) return
    setAutomationApproval(null)
    try {
      await window.wraith.automationRespondApproval(
        cur.runId,
        String(cur.payload['approvalId']),
        payload.decision,
        {
          ...(payload.modifiedArgs ? { modifiedArgs: payload.modifiedArgs } : {}),
          ...(payload.allowNetwork ? { allowNetwork: true } : {}),
        },
      )
    } catch (err) { console.error('[wraith] automation respond error:', err) }
  }, [automationApproval])

  const handleAutomationApprovalReject = useCallback(async () => {
    const cur = automationApproval
    if (!cur) return
    setAutomationApproval(null)
    try {
      await window.wraith.automationRespondApproval(cur.runId, String(cur.payload['approvalId']), 'REJECTED')
    } catch (err) { console.error('[wraith] automation reject error:', err) }
  }, [automationApproval])

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

  // ── Esc = 停止(running 且无审批弹窗时;弹窗打开时 Esc 归弹窗语义) ────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (state.turn !== 'running' || state.pendingApproval || automationApproval) return
      void window.wraith.interrupt().catch(err => console.error('[wraith] interrupt error:', err))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.turn, state.pendingApproval, automationApproval])

  // ── 消息编辑/删除(真回溯:后端裁剪 → 本地裁剪 → 编辑则重发) ─────────────────
  const handleEditMessage = useCallback(
    async (ordinal: number, newText: string) => {
      if (state.turn === 'running') return
      try {
        await window.wraith.rewindSession(ordinal)
        dispatch({ type: 'truncateAtUser', ordinal })
        dispatch({ type: 'addUserItem', text: newText })
        void fetchSessions()
        await window.wraith.submitTurn(newText)
      } catch (err) {
        console.error('[wraith] editMessage error:', err)
      }
    },
    [state.turn, fetchSessions],
  )

  const handleDeleteMessage = useCallback(
    async (ordinal: number) => {
      if (state.turn === 'running') return
      try {
        await window.wraith.rewindSession(ordinal)
        dispatch({ type: 'truncateAtUser', ordinal })
        void fetchSessions()
      } catch (err) {
        console.error('[wraith] deleteMessage error:', err)
      }
    },
    [state.turn, fetchSessions],
  )

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

  // ── project switch(激活 + 自动恢复最近会话)─────────────────────────────
  const switchToProject = useCallback(
    async (projectPath: string) => {
      if (state.turn === 'running') return
      try {
        const { ok } = await window.wraith.activateProject(projectPath)
        if (!ok) {
          void fetchProjects() // 目录失踪 → 条目置灰,状态不变
          return
        }
        statusThrottleRef.current?.cancel()
        await window.wraith.startSession(projectPath)
        dispatch({ type: 'resetSession', ws: projectPath })
        const { sessions } = await window.wraith.listSessions()
        setSessions(sessions)
        if (sessions.length > 0) {
          // session.list 按 updatedAt 倒序:第一条即最近会话
          const { sessionId, messages } = await window.wraith.resumeSession(sessions[0]!.id)
          dispatch({ type: 'loadHistory', items: messagesToItems(messages) })
          dispatch({ type: 'setSessionId', sessionId })
          dispatch({ type: 'markStarted' })
        }
        void fetchProjects() // lastUsedAt 刷新 → 浮顶
        void fetchMcp()
        void fetchMcpResources()
      } catch (err) {
        console.error('[wraith] switchToProject error:', err)
        void fetchProjects()
      }
    },
    [state.turn, fetchProjects, fetchMcp, fetchMcpResources],
  )

  // 添加项目(=Composer 重选目录汇流入口):选目录 → 入列表 → 切换
  const handleAddProject = useCallback(async () => {
    if (state.turn === 'running') return
    try {
      const picked = await window.wraith.addProject()
      if (!picked) return
      void fetchProjects() // addProject 已 upsert;先刷列表
      if (picked !== state.workspace) await switchToProject(picked)
    } catch (err) {
      console.error('[wraith] addProject error:', err)
    }
  }, [state.turn, state.workspace, fetchProjects, switchToProject])

  const handleRemoveProject = useCallback(
    async (projectPath: string) => {
      try {
        await window.wraith.removeProject(projectPath)
        void fetchProjects()
      } catch (err) {
        console.error('[wraith] removeProject error:', err)
      }
    },
    [fetchProjects],
  )

  const handleRenameProject = useCallback(
    async (projectPath: string, name: string) => {
      try {
        await window.wraith.renameProject(projectPath, name)
        void fetchProjects()
      } catch (err) {
        console.error('[wraith] renameProject error:', err)
      }
    },
    [fetchProjects],
  )

  // ── 运行历史:跳转到对应会话 ─────────────────────────────────────────────────
  const handleOpenAutomationSession = useCallback(async (projectPath: string, sessionId: string) => {
    setView('chat')
    if (projectPath !== state.workspace) await switchToProject(projectPath)
    await handleSelectSession(sessionId)
  }, [state.workspace, switchToProject, handleSelectSession])

  // ── 运行历史:重弹已缓存的审批弹窗(state 槽被 Esc 清掉后兜底) ───────────────
  const handleReopenApproval = useCallback((runId: string) => {
    const cached = automationApprovalRef.current
    if (cached && cached.runId === runId) setAutomationApproval(cached)
  }, [])

  const handleMcpToggle = useCallback(async (name: string, enable: boolean) => {
    try { await (enable ? window.wraith.mcpEnable(name) : window.wraith.mcpDisable(name)); void fetchMcp() }
    catch (err) { console.error('[wraith] mcp toggle error:', err) }
  }, [fetchMcp])

  const handleMcpRestart = useCallback(async (name: string) => {
    try { await window.wraith.mcpRestart(name); void fetchMcp() }
    catch (err) { console.error('[wraith] mcp restart error:', err) }
  }, [fetchMcp])

  const handleMcpRemove = useCallback(async (scope: 'user' | 'project', name: string) => {
    try { await window.wraith.mcpConfigRemove(scope, name); void fetchMcp() }
    catch (err) { console.error('[wraith] mcp remove error:', err) }
  }, [fetchMcp])

  const handleMcpSubmitForm = useCallback(async (v: McpFormValue): Promise<boolean> => {
    try { await window.wraith.mcpConfigUpsert(v); void fetchMcp(); return true }
    catch (err) { console.error('[wraith] mcp upsert error:', err); return false }
  }, [fetchMcp])

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
      <Sidebar
        workspace={state.workspace}
        projects={projects}
        busy={state.turn === 'running'}
        sessions={sessions}
        activeSessionId={state.sessionId}
        onNewConversation={handleNewConversation}
        onSelectSession={handleSelectSession}
        onActivateProject={switchToProject}
        onAddProject={handleAddProject}
        onRemoveProject={handleRemoveProject}
        onRenameProject={handleRenameProject}
        sandbox={state.sandbox}
        activeNav={view === 'chat' ? null : view}
        onOpenPlugins={() => setView('plugins')}
        onOpenAutomations={() => setView('automations')}
        automationBadge={automationBadge}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {state.connection === 'disconnected' && (
          <DisconnectedBanner onRestart={handleRestart} />
        )}

        {view === 'plugins' ? (
          <PluginsPanel
            servers={mcpServers}
            configError={mcpConfigError}
            busy={state.turn === 'running'}
            onBack={() => setView('chat')}
            onRefresh={fetchMcp}
            onToggle={handleMcpToggle}
            onRestart={handleMcpRestart}
            onRemove={handleMcpRemove}
            onSubmitForm={handleMcpSubmitForm}
          />
        ) : view === 'automations' ? (
          <AutomationsPanel projects={projects} onBack={() => setView('chat')}
            onOpenSession={handleOpenAutomationSession} onApprove={handleReopenApproval} />
        ) : (
          /* 既有 welcome ↔ transcript+composer 条件块整体原样嵌此 else */
          (() => {
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
                onSwitchWorkspace={handleAddProject}
                centered={!state.hasStarted}
                status={state.status}
                resources={mcpResources}
              />
            )
            return state.hasStarted ? (
              <>
                <Transcript
                  items={state.items}
                  busy={state.turn === 'running'}
                  onEditMessage={handleEditMessage}
                  onDeleteMessage={handleDeleteMessage}
                />
                <div className="shrink-0 px-4 py-3">{composer}</div>
              </>
            ) : (
              <div className="min-h-0 flex-1">
                <WelcomeEmptyState>{composer}</WelcomeEmptyState>
              </div>
            )
          })()
        )}
      </div>

      {/* Approval modal（Task 8 换 shadcn Dialog；此处结构不变） */}
      {state.pendingApproval && (
        <ApprovalModal
          key={state.pendingApproval.approvalId}
          approvalId={state.pendingApproval.approvalId}
          toolName={state.pendingApproval.toolName}
          argsJson={state.pendingApproval.argsJson}
          dangerLevel={state.pendingApproval.dangerLevel}
          riskDescription={state.pendingApproval.riskDescription}
          suggestion={state.pendingApproval.suggestion}
          beforeContent={state.pendingApproval.beforeContent}
          onRespond={handleApprovalRespond}
          onReject={handleReject}
        />
      )}

      {/* Automation ApprovalModal — 独立状态槽,与主会话审批互不干扰 */}
      {/* 自动化 Modal 后挂载,Portal 层级在主会话 Modal 之上(计划语义:两弹窗不互斥,自动化在上可先处理) */}
      {automationApproval && (
        <ApprovalModal
          key={'auto-' + String(automationApproval.payload['approvalId'])}
          approvalId={String(automationApproval.payload['approvalId'])}
          toolName={String(automationApproval.payload['toolName'] ?? '')}
          argsJson={String(automationApproval.payload['argsJson'] ?? '')}
          dangerLevel={String(automationApproval.payload['dangerLevel'] ?? '')}
          riskDescription={String(automationApproval.payload['riskDescription'] ?? '')}
          suggestion={(automationApproval.payload['suggestion'] as string | null) ?? ''}
          beforeContent={(automationApproval.payload['beforeContent'] as string | null) ?? null}
          onRespond={handleAutomationApprovalRespond}
          onReject={handleAutomationApprovalReject}
        />
      )}
    </div>
  )
}
