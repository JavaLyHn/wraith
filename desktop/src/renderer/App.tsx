import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import CommandPalette from './components/CommandPalette'
import type { BackendEvent, SessionMeta, ProjectView, McpServerView, McpResourceView, RunMode, SandboxKindWire, SandboxState as SandboxStateWire } from '../shared/types'
import type { RightPreview, ArtifactFile } from '../shared/artifactSummary'
import type { EditorApp } from '../shared/editors'
import type { McpFormValue } from './components/McpServerForm'
import type { ApprovalResponsePayload } from '../shared/buildApprovalResponse'
import { createThrottleLatest, type ThrottledPush } from '../shared/throttleLatest'
import {
  initialState,
  reduce,
  clearApproval,
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
} from '../shared/transcriptReducer'
import { messagesToItems } from '../shared/messagesToItems'
import { spliceCards } from '../shared/spliceCards'
import type { GatewayState } from '../shared/gateway'
import { makeSystemEvent } from '../shared/systemEvent'
import { imBoundEventText } from './lib/gatewayLabels'
import { useSystemEventQueue } from './lib/useSystemEventQueue'
import { useBackgroundTasks } from './lib/useBackgroundTasks'
import { taskDoneLabel } from '../shared/taskWatch'
import { PROMPT_CATEGORIES } from './lib/welcomePrompts'
import { lastUserMessage } from './lib/resend'
import { resolveWorkspacePath, baseName } from './lib/paths'
import { sessionDisplayName } from './lib/sessionView'
import { pendingModeAfterSubmit } from './lib/nextPendingMode'
import { shouldBlockImageSend } from '../shared/modelVision'
import { transcriptToMarkdown } from './lib/transcriptMarkdown'
import { compactionNotice } from './lib/compactView'
import { Download, Wand2 } from 'lucide-react'
import Transcript from './components/Transcript'
import Composer, { type AttachmentItem } from './components/Composer'
import ApprovalModal from './components/ApprovalModal'
import DisconnectedBanner from './components/DisconnectedBanner'
import ModelFallbackBanner from './components/ModelFallbackBanner'
import SubmitErrorBanner from './components/SubmitErrorBanner'
import WelcomeEmptyState from './components/WelcomeEmptyState'
import TaskDonePill from './components/TaskDonePill'
import NoModelNotice from './components/NoModelNotice'
import { needsModelSetup, showNoModelNotice } from './lib/modelReady'
import Sidebar from './components/Sidebar'
import SidebarDock from './components/SidebarDock'
import TopBar from './components/TopBar'
import PreviewBanner from './components/PreviewBanner'
import { selectAction, resolveOnIdle, deriveView, type Preview } from '../shared/sessionPreview'
import PluginsPanel from './components/PluginsPanel'
import AutomationsPanel from './components/AutomationsPanel'
import ImGatewayPanel from './components/ImGatewayPanel'
import ProvidersPanel from './components/ProvidersPanel'
import SkillsPanel from './components/SkillsPanel'
import MemoryPanel from './components/MemoryPanel'
import SnapshotPanel from './components/SnapshotPanel'
import TaskPanel from './components/TaskPanel'
import PolicyPanel from './components/PolicyPanel'
import BrowserPanel from './components/BrowserPanel'
import RagPanel from './components/RagPanel'
import DocumentsPanel from './components/DocumentsPanel'
import ProjectsPanel from './components/ProjectsPanel'
import SettingsPanel from './components/SettingsPanel'
import TerminalDrawer from './components/TerminalDrawer'
import RightDock, { type RightDockPane } from './components/RightDock'
import SummaryPopover from './components/SummaryPopover'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog'
import { useSettings } from './settings/SettingsContext'

// ---------------------------------------------------------------------------
// Local action types (for non-BackendEvent dispatches)
// ---------------------------------------------------------------------------

type LocalAction =
  | { type: 'clearApproval' }
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
  if ('type' in action && action.type === 'markResumed') {
    return markResumed(state)
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
    return addUserItem(state, action.text, action.attachments)
  }
  if ('type' in action && action.type === 'addSystemEvent') {
    return addSystemEventItem(state, action.text)
  }
  if ('type' in action && action.type === 'addTaskDone') {
    return addTaskDoneItem(state, action.taskId, action.text, action.ok)
  }
  if ('type' in action && action.type === 'loadHistory') {
    return loadHistory(state, action.items)
  }
  if ('type' in action && action.type === 'setSessionId') {
    return setSessionId(state, action.sessionId)
  }
  if ('type' in action && action.type === 'setSandbox') {
    return setSandbox(state, action.sandbox, action.networkAllowed)
  }
  if ('type' in action && action.type === 'truncateAtUser') {
    return truncateAtUserOrdinal(state, action.ordinal)
  }
  if ('type' in action && action.type === 'markPlanReviewResolved') {
    return markPlanReviewResolved(state, action.reviewId)
  }
  // BackendEvent has 'kind' field
  return reduce(state, action as BackendEvent)
}

// ---------------------------------------------------------------------------
// Sandbox value normalizer
// ---------------------------------------------------------------------------

function normalizeSandbox(sb: string | undefined): SandboxKindWire {
  if (sb === 'none') return 'none'
  if (sb === 'macos-seatbelt') return 'macos-seatbelt'
  if (sb === 'windows-appcontainer') return 'windows-appcontainer'
  // 认不出的值一律 unknown 而不是 none —— 前者是灰盾「状态未知」,
  // 后者是红盾「未启用」。老后端 / 新前端组合下把未知说成异常是误报。
  return 'unknown'
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
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [view, setView] = useState<'chat' | 'projects' | 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills' | 'memory' | 'snapshots' | 'policy' | 'browser' | 'rag' | 'tasks' | 'documents' | 'settings'>('chat')
  const [automationApproval, setAutomationApproval] = useState<{ runId: string; payload: Record<string, unknown> } | null>(null)
  const [automationBadge, setAutomationBadge] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpServerView[]>([])
  const [mcpConfigError, setMcpConfigError] = useState<string | null>(null)
  const [mcpResources, setMcpResources] = useState<McpResourceView[]>([])
  const [modelFallbackNotice, setModelFallbackNotice] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { prefs: appPrefs } = useSettings()
  const [updateNotice, setUpdateNotice] = useState<{ latest: string; url: string } | null>(null)
  const [pendingMode, setPendingMode] = useState<RunMode>('react')
  // 类别是固定四组、不随机 —— 随机会让同一个人每次打开看到不同入口,反而记不住有什么能做
  const [composerFocus, setComposerFocus] = useState(0)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [rightDockOpen, setRightDockOpen] = useState(false)
  const [rightDockPane, setRightDockPane] = useState<RightDockPane>('browser')
  const [rightPreview, setRightPreview] = useState<RightPreview | null>(null)
  const openArtifact = useCallback((filePath: string, content: string): void => {
    setRightPreview({ kind: 'content', filePath, content })
    setRightDockPane('artifact')
    setRightDockOpen(true)
  }, [])
  const openDiff = useCallback((filePath: string, before: string, after: string): void => {
    setRightPreview({ kind: 'diff', filePath, before, after })
    setRightDockPane('artifact')
    setRightDockOpen(true)
  }, [])
  const handleUndo = useCallback(async (file: ArtifactFile): Promise<{ ok: boolean; message?: string }> => {
    const abs = resolveWorkspacePath(file.path, state.workspace ?? null)
    try {
      return await window.wraith.undoFileEdit({ path: abs, before: file.before ?? '', kind: file.kind })
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }, [state.workspace])
  const [editors, setEditors] = useState<EditorApp[]>([])
  useEffect(() => { void window.wraith.listEditors().then(setEditors).catch(() => {}) }, [])
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** 后端起来了但一个模型都没配 —— 全新装机的常态,需要在空态给出引导。 */
  const [noModel, setNoModel] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('wraith.sidebar.collapsed') === '1' } catch { return false }
  })
  const [sidebarPeek, setSidebarPeek] = useState(false)
  const startedRef = useRef(false)
  const statusThrottleRef = useRef<ThrottledPush<BackendEvent> | null>(null)
  // turnRef:与 state.turn 同步的即时快照,供 handleAddProject / switchToProject 的 running 守卫读取。
  // 消除「dispatch(markStarted) → 组件重渲染」之间的闭包陈旧:markStarted 已在提交瞬间置 running,
  // 但用旧 state.turn 闭包的回调直到下次重渲染前读到的仍是 'idle',守卫会漏放行;改读 ref 即时可见。
  const turnRef = useRef(state.turn)
  useEffect(() => {
    turnRef.current = state.turn
  }, [state.turn])

  // 折叠状态持久化
  useEffect(() => {
    try { localStorage.setItem('wraith.sidebar.collapsed', sidebarCollapsed ? '1' : '0') } catch { /* localStorage 不可用:忽略 */ }
  }, [sidebarCollapsed])

  // 预览覆盖态:running 时只读显示另一会话或空白新会话页
  const [preview, setPreview] = useState<Preview>(null)
  const previewRef = useRef<Preview>(null)
  useEffect(() => { previewRef.current = preview }, [preview])

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

  // ── session list helpers ───────────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    try {
      const { sessions } = await window.wraith.listSessions()
      setSessions(sessions)
    } catch (err) {
      console.error('[wraith] listSessions error:', err)
    }
  }, [])

  // sessionId 变化即刷新侧栏:新会话在 turn.started 时后端已落桩并带回真实 id,
  // 这里拉一次 listSessions,使会话「发送即出现」在左侧(不必等 turn 结束)。
  useEffect(() => {
    if (state.sessionId) void fetchSessions()
  }, [state.sessionId, fetchSessions])

  // ── automationApprovalRef:缓存最近一次 approval push(唯一弹窗入口是运行历史「处理审批」钮) ──
  const automationApprovalRef = useRef<{ runId: string; payload: Record<string, unknown> } | null>(null)

  // ── subscribe to automation events on mount ───────────────────────────────
  useEffect(() => {
    const unsub = window.wraith.onAutomationEvent(evt => {
      if (evt.kind === 'badge') setAutomationBadge(evt.show)
      if (evt.kind === 'approval') {
        // I-4: 审批 push 只缓存 payload,不强弹(spec §1.1-4/§6.2:通知+红点+运行历史「处理审批」,
        // 用户在面板主动点开 ApprovalModal)。badge 与 OS 通知已由 main 侧推送,renderer 无需动作。
        automationApprovalRef.current = { runId: evt.runId, payload: evt.payload }
      }
      if (evt.kind === 'open-panel') setView('automations')
      if (evt.kind === 'runs-changed') void fetchSessions()
    })
    return unsub
  }, [fetchSessions])

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
    if (turnRef.current === 'running') { setPreview({ kind: 'new' }); setView('chat'); return }
    setView('chat')
    try {
      await window.wraith.startSession(state.workspace || null)
      statusThrottleRef.current?.cancel()
      dispatch({ type: 'resetSession', ws: state.workspace })
      setModelFallbackNotice(false)
      setSubmitError(null)
      setPreview(null)
      void fetchSessions()
    } catch (err) {
      console.error('[wraith] newConversation error:', err)
    }
  }, [state.workspace, fetchSessions])

  // 完整切换到某会话(仅 idle 安全调用):真实 resume 同步后端 agent+currentId + 前端载入。
  const commitSwitchTo = useCallback(async (id: string) => {
    const { sessionId, messages, model, modelFallback, cards } = await window.wraith.resumeSession(id)
    statusThrottleRef.current?.cancel()
    dispatch({ type: 'loadHistory', items: spliceCards(messagesToItems(messages), cards) })
    dispatch({ kind: 'notification', method: 'context.reset', params: {} } as BackendEvent)
    dispatch({ type: 'setSessionId', sessionId })
    dispatch({ type: 'markResumed' })
    if (model) dispatch({ type: 'setModel', model })
    setModelFallbackNotice(modelFallback === true)
    try {
      const snap = await window.wraith.contextState()
      dispatch({ kind: 'notification', method: 'status', params: { status: snap } } as BackendEvent)
      dispatch({ kind: 'notification', method: 'context.snapshot', params: snap } as BackendEvent)
    } catch { /* 后端未就绪时静默:首条消息的 status 通知会补上 */ }
    void fetchSessions()
  }, [fetchSessions])

  const handleSelectSession = useCallback(async (id: string) => {
    const act = selectAction(turnRef.current, id, state.sessionId)
    setView('chat')
    if (act.mode === 'preview-return') { setPreview(null); return }
    if (act.mode === 'preview-open') {
      try {
        const { messages, cards } = await window.wraith.peekSession(id)   // 纯读,后台 turn 不受扰
        setPreview({ kind: 'session', sessionId: id, items: spliceCards(messagesToItems(messages), cards ?? []) })
      } catch (err) {
        console.error('[wraith] peekSession error:', err)                 // 失败则不进预览,留在 live
      }
      return
    }
    // full-switch(idle)
    try { setPreview(null); await commitSwitchTo(id) }
    catch (err) { console.error('[wraith] resumeSession error:', err) }
  }, [state.sessionId, commitSwitchTo])

  const handleToggleStar = useCallback(async (id: string, starred: boolean) => {
    await window.wraith.setSessionStarred(id, starred)
    void fetchSessions()
  }, [fetchSessions])

  const handleRenameSession = useCallback(async (id: string, name: string) => {
    await window.wraith.renameSession(id, name)
    void fetchSessions()
  }, [fetchSessions])

  const handleDeleteSession = useCallback(async (id: string) => {
    await window.wraith.deleteSession(id)
    if (id === state.sessionId) {
      // 删除的是当前会话:复用 handleNewConversation 做完整状态重置
      // (startSession + statusThrottle.cancel + resetSession + 清横幅 + fetchSessions)
      await handleNewConversation()
    } else {
      void fetchSessions()
    }
    // 删除边界:删的是当前预览目标则回 live
    const pv = previewRef.current
    if (pv && pv.kind === 'session' && pv.sessionId === id) setPreview(null)
  }, [fetchSessions, state.sessionId, handleNewConversation])

  // ── 沙箱状态:App 是唯一真相源 ────────────────────────────────────────────
  // 此前顶栏那枚盾只在 initialize 时被写过一次,面板里 sandbox.set 的结果只落在
  // PolicyPanel 的局部 state —— 用户拨了开关,盾纹丝不动。把状态提到这里,
  // 面板变成一个「上报 + 展示」的哑组件,两边就不可能再分叉。
  const applySandbox = useCallback((s: SandboxStateWire | null | undefined): void => {
    if (!s) return
    dispatch({
      type: 'setSandbox',
      sandbox: normalizeSandbox(s.kind),
      networkAllowed: s.networkAllowed === true,
    })
  }, [])

  // sandbox.get 挂在 SessionRunner 上,会话建立前一律 "no session" —— 只在 startSession 之后调。
  // 失败时**保留现有值**:把已知状态打回 unknown 等于用灰盾盖掉真相。
  const refreshSandbox = useCallback(async (): Promise<void> => {
    try { applySandbox(await window.wraith.sandboxGet()) } catch { /* 见上 */ }
  }, [applySandbox])

  // ── startup flow (runs once) ───────────────────────────────────────────────
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    void (async () => {
      try {
        const ws = await window.wraith.getInitialWorkspace()
        dispatch({ type: 'setWorkspace', ws: ws ?? '' })
        const init = await window.wraith.initialize(ws)
        const initObj = init as { model?: string; capabilities?: { sandbox?: string; modelConfigured?: boolean } }
        if (initObj.model) {
          dispatch({ type: 'setModel', model: initObj.model })
        }
        // 先用 initialize 播种种类(免得盾先闪一下「未知」);联网位要等会话起来后问 sandbox.get。
        dispatch({
          type: 'setSandbox',
          sandbox: normalizeSandbox(initObj.capabilities?.sandbox),
          networkAllowed: false,
        })
        // 全新装机:后端以「无模型」状态起来了(能配置、发不出对话)。这个状态在界面上
        // 必须有出口 —— 否则用户只看到一个打字没反应的空壳,那句 `未找到可用 API Key`
        // 只在控制台里,他看不到。
        setNoModel(needsModelSetup({ modelConfigured: initObj.capabilities?.modelConfigured }))
        await window.wraith.startSession(ws)
        try {
          const snap = await window.wraith.contextState()
          dispatch({ kind: 'notification', method: 'status', params: { status: snap } } as BackendEvent)
          dispatch({ kind: 'notification', method: 'context.snapshot', params: snap } as BackendEvent)
        } catch { /* 后端未就绪时静默:首条消息的 status 通知会补上 */ }
        void refreshSandbox()
        void fetchSessions()
        void fetchProjects()
        void fetchMcp()
        void fetchMcpResources()
      } catch (err) {
        console.error('[wraith] startup error:', err)
      }
    })()
  }, [fetchSessions, fetchProjects, fetchMcp, fetchMcpResources, refreshSandbox])

  useEffect(() => {
    if (!appPrefs.update.autoCheck) return
    void window.wraith.checkUpdate(appPrefs.update.beta)
      .then((r) => { if (r.hasUpdate && r.latest && r.url) setUpdateNotice({ latest: r.latest, url: r.url }) })
      .catch(() => {})
  }, [])  // 仅启动一次

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
        dispatch({ type: 'setSandbox', sandbox: normalizeSandbox(sb), networkAllowed: false })
        await window.wraith.startSession(ws)
        void refreshSandbox()   // 重连后后端是全新进程,联网位回到默认值,必须重新问
        if (activeId) {
          const { messages, model, cards } = await window.wraith.resumeSession(activeId)
          dispatch({ type: 'loadHistory', items: spliceCards(messagesToItems(messages), cards) })
          if (model) {
            dispatch({ type: 'setModel', model })
          }
        }
        try {
          const snap = await window.wraith.contextState()
          dispatch({ kind: 'notification', method: 'status', params: { status: snap } } as BackendEvent)
          dispatch({ kind: 'notification', method: 'context.snapshot', params: snap } as BackendEvent)
        } catch { /* 后端未就绪时静默:首条消息的 status 通知会补上 */ }
        void fetchSessions()
      } catch (err) {
        console.error('[wraith] reconnect error:', err)
      }
    })()
  }, [state.connection, state.workspace, fetchSessions, refreshSandbox])

  // ── refresh session list when a turn completes ────────────
  const prevTurnRef = useRef(state.turn)
  useEffect(() => {
    if (prevTurnRef.current === 'running' && state.turn === 'idle') {
      void fetchSessions()
    }
    prevTurnRef.current = state.turn
  }, [state.turn, fetchSessions])

  // ── 落定 preview:处于 idle 且有挂着的 preview 时,执行被推迟的真实切换。
  // 覆盖两种情形:(a) turn 正常跑完;(b) 点会话与 turn 结束擦肩——peek 的 async
  // setPreview 落在 turn→idle 之后、边沿已过,靠本 effect 的 idle+preview 条件兜住,
  // 否则会留下"idle 悬挂预览"导致续聊打到错的后端会话。
  useEffect(() => {
    if (state.turn !== 'idle' || preview === null) return
    const r = resolveOnIdle(preview)
    if (r.action === 'resume') { setPreview(null); void commitSwitchTo(r.sessionId) }
    else if (r.action === 'new') { void handleNewConversation() }   // 其内部走 idle 分支并清 preview
  }, [preview, state.turn, commitSwitchTo, handleNewConversation])

  // ── pick attachments ──────────────────────────────────────────────────────
  const handlePickAttachments = useCallback(async () => {
    try {
      const picked = await window.wraith.pickAttachments()
      if (picked.length > 0) {
        setAttachments(prev => [...prev, ...picked])
      }
    } catch (err) {
      console.error('[wraith] pickAttachments error:', err)
    }
  }, [])

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleAddAttachments = useCallback((items: AttachmentItem[]) => {
    if (items.length > 0) setAttachments(prev => [...prev, ...items])
  }, [])

  // 全窗兜底:拖文件到 Composer 之外的空白处时,阻止 Electron 默认导航到 file://。
  useEffect(() => {
    const prevent = (e: DragEvent): void => { e.preventDefault() }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  // ── input submit ──────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || state.turn === 'running') return
    // 发送前预检:确定不支持图片的模型 + 带图 → 就地拦下报错,保留输入与附件供切模型后重发
    if (attachments.some(a => a.kind === 'image') && shouldBlockImageSend(state.model)) {
      // 不点名具体模型:这里曾硬写「如 glm-5v-turbo」,而用户可能根本没有 GLM。
      // 哪些模型支持视觉由 shared/modelVision.ts 判定,与 provider 无关。
      setSubmitError(`当前模型「${state.model}」不支持图片。请切到支持视觉的模型,或移除图片后再发。`)
      return
    }
    setInputValue('')
    setSubmitError(null) // 新提交:清除上次遗留的错误横幅
    const pendingAttachments = attachments
    setAttachments([])
    dispatch({ type: 'markStarted' })
    dispatch({ type: 'addUserItem', text, attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined })
    try {
      await window.wraith.submitTurn(text, pendingAttachments.length > 0 ? pendingAttachments.map(a => ({ path: a.path, kind: a.kind })) : undefined, pendingMode)
      setPendingMode(pendingModeAfterSubmit(pendingMode))
    } catch (err) {
      console.error('[wraith] submitTurn error:', err)
      // 失败路径:markStarted 已提前置 turn='running',但本地 RPC 失败(后端死/拒绝)时
      // 不会再有 turn.started/turn.completed/turn.failed 通知到达来清 turn,会永久卡 running。
      // 复用现有 turn.failed reducer 动作把 turn 归 idle(不新造事件类型,与现有风格一致)。
      dispatch({ kind: 'notification', method: 'turn.failed', params: {} })
      const reason = err instanceof Error ? err.message : String(err)
      // 只取 reason 的前 80 字符,避免泄露过长内部路径或 URL;不含 apiKey/secret。
      const short = reason.replace(/https?:\/\/\S+/g, '').replace(/sk-\S+/g, '').slice(0, 80).trim()
      setSubmitError(short ? `消息发送失败,请重试(${short})` : '消息发送失败,请重试')
    }
  }, [inputValue, state.turn, state.model, attachments, pendingMode])

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
  const handleAutomationApprovalRespond = useCallback(async (_payload: ApprovalResponsePayload) => {
    const cur = automationApproval
    if (!cur) return
    setAutomationApproval(null)
    automationApprovalRef.current = null
    try {
      // daemon contract: only the exact lowercase string "approve" approves; map all approve variants.
      await window.wraith.automationRespondApproval(
        String(cur.payload['approvalId']),
        'approve',
      )
    } catch (err) { console.error('[wraith] automation respond error:', err) }
  }, [automationApproval])

  const handleAutomationApprovalReject = useCallback(async () => {
    const cur = automationApproval
    if (!cur) return
    setAutomationApproval(null)
    automationApprovalRef.current = null
    try {
      await window.wraith.automationRespondApproval(String(cur.payload['approvalId']), 'reject')
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

  // ── 全局真快捷键:⌘K 开/关命令面板、⌘N 新对话、⌘, 设置 ────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey) return
      if (e.key === 'k') { e.preventDefault(); setPaletteOpen(v => !v) }
      else if (e.key === 'n') { e.preventDefault(); void handleNewConversation() }
      else if (e.key === ',') { e.preventDefault(); setView('settings') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleNewConversation])

  // ── 消息编辑/重发/删除(真回溯:后端裁剪 → 本地裁剪 → 重发) ─────────────────
  const rewindAndResubmit = useCallback(
    async (ordinal: number, text: string) => {
      if (turnRef.current === 'running') return // 读即时快照,避免闭包陈旧漏放行
      setSubmitError(null) // 重发:清除上次遗留的错误横幅
      try {
        await window.wraith.rewindSession(ordinal)
        dispatch({ type: 'truncateAtUser', ordinal })
        dispatch({ type: 'addUserItem', text })
        void fetchSessions()
        // 与主 submit 路径对称:submitTurn 前即置 running,从源头关闭 submit→turn.started 竞态窗。
        dispatch({ type: 'markStarted' })
        await window.wraith.submitTurn(text)
      } catch (err) {
        console.error('[wraith] rewindAndResubmit error:', err)
        // 失败兜底:markStarted 已提前置 running,本地 RPC 失败时不会再有 turn.* 通知清 turn。
        dispatch({ kind: 'notification', method: 'turn.failed', params: {} })
        const reason = err instanceof Error ? err.message : String(err)
        const short = reason.replace(/https?:\/\/\S+/g, '').replace(/sk-\S+/g, '').slice(0, 80).trim()
        setSubmitError(short ? `消息发送失败,请重试(${short})` : '消息发送失败,请重试')
      }
    },
    [fetchSessions], // running 守卫读 turnRef,不依赖 state.turn
  )

  // ── IM 绑定成功 → 补一轮「系统事件」,让 agent 知情并向用户确认 ──────────────
  // 只能走普通 turn.submit:app-server 没有旁路往历史塞一条的 RPC(见 shared/systemEvent
  // 里对前缀的说明)。文本带 ⊙系统事件⊙ 前缀,会话恢复时由 messagesToItems 还原成
  // 系统事件气泡,而不是一句用户从没说过的话。
  const emitSystemEvent = useCallback((text: string) => {
    dispatch({ type: 'addSystemEvent', text })
    // 与主 submit 路径对称:submitTurn 前即置 running,从源头关掉 submit→turn.started 竞态窗。
    dispatch({ type: 'markStarted' })
    void window.wraith.submitTurn(makeSystemEvent(text)).catch((err: unknown) => {
      console.error('[wraith] system event submit failed:', err)
      // markStarted 已提前置 running,RPC 失败后不会再有 turn.* 通知来清,必须自己清。
      dispatch({ kind: 'notification', method: 'turn.failed', params: {} })
    })
  }, [])

  // 绑定完成的时机由用户扫码决定,撞上正在跑的轮次是常态;排队器负责忙时压住、闲时补发。
  const enqueueSystemEvent = useSystemEventQueue(state.turn === 'running', emitSystemEvent)

  const handleImBound = useCallback((platform: string, gatewayState: GatewayState | null) => {
    enqueueSystemEvent(imBoundEventText(platform, gatewayState))
  }, [enqueueSystemEvent])

  // 后台任务:队列是全局的(与终端 /task 共享),不属于任何会话 —— 这里只回答两件事:
  // 「现在有几个在跑」(侧栏计数)和「刚才那个跑完了」(对话里的静默药丸,点开看结果)。
  // 后端不推送任务事件,只能轮询;首轮静默播种,免得开机把历史完成项灌进对话(见 taskWatch)。
  const listTasks = useCallback((limit: number) => window.wraith.taskList(limit), [])
  const taskActiveCount = useBackgroundTasks(listTasks, useCallback((finished) => {
    for (const t of finished) {
      dispatch({ type: 'addTaskDone', taskId: t.id, text: taskDoneLabel(t), ok: t.status === 'completed' })
    }
  }, []))

  const handleEditMessage = useCallback(
    (ordinal: number, newText: string) => { void rewindAndResubmit(ordinal, newText) },
    [rewindAndResubmit],
  )

  const handleResendMessage = useCallback(
    (ordinal: number, text: string) => { void rewindAndResubmit(ordinal, text) },
    [rewindAndResubmit],
  )

  const handleDeleteMessage = useCallback(
    async (ordinal: number) => {
      if (turnRef.current === 'running') return // 读即时快照,避免闭包陈旧漏放行
      try {
        await window.wraith.rewindSession(ordinal)
        dispatch({ type: 'truncateAtUser', ordinal })
        void fetchSessions()
      } catch (err) {
        console.error('[wraith] deleteMessage error:', err)
      }
    },
    [fetchSessions], // running 守卫改读 turnRef,不再依赖 state.turn
  )

  // ── plan review response ──────────────────────────────────────────────────
  const handlePlanReview = useCallback(
    (reviewId: string, decision: 'execute' | 'supplement' | 'cancel', feedback?: string) => {
      void window.wraith.respondPlanReview(reviewId, decision, feedback)
      dispatch({ type: 'markPlanReviewResolved', reviewId })
    },
    [],
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
    async (projectPath: string): Promise<boolean> => {
      if (turnRef.current === 'running') return false // 读即时快照,避免闭包陈旧漏放行
      try {
        const { ok } = await window.wraith.activateProject(projectPath)
        if (!ok) {
          void fetchProjects() // 目录失踪 → 条目置灰,状态不变
          return false
        }
        await window.wraith.startSession(projectPath)
        statusThrottleRef.current?.cancel() // 紧贴 resetSession:消 await 期间 status 尾巴重新入窗
        dispatch({ type: 'resetSession', ws: projectPath })
        setModelFallbackNotice(false) // 切项目:先清残余回退通知,自动恢复后按会话重置
        const { sessions } = await window.wraith.listSessions()
        setSessions(sessions)
        if (sessions.length > 0) {
          // session.list 按 updatedAt 倒序:第一条即最近会话
          const { sessionId, messages, model, modelFallback, cards } = await window.wraith.resumeSession(sessions[0]!.id)
          dispatch({ type: 'loadHistory', items: spliceCards(messagesToItems(messages), cards) })
          dispatch({ type: 'setSessionId', sessionId })
          dispatch({ type: 'markResumed' }) // resume 是静态回放,不是 turn 在跑,turn 保持 idle
          if (model) {
            dispatch({ type: 'setModel', model }) // 自动恢复路径同 handleSelectSession:消费 provider/model
          }
          if (modelFallback === true) {
            setModelFallbackNotice(true) // key 失效回退也要在切项目自动恢复时提示
          }
        }
        try {
          const snap = await window.wraith.contextState()
          dispatch({ kind: 'notification', method: 'status', params: { status: snap } } as BackendEvent)
          dispatch({ kind: 'notification', method: 'context.snapshot', params: snap } as BackendEvent)
        } catch { /* 后端未就绪时静默:首条消息的 status 通知会补上 */ }
        void fetchProjects() // lastUsedAt 刷新 → 浮顶
        void fetchMcp()
        void fetchMcpResources()
        return true
      } catch (err) {
        console.error('[wraith] switchToProject error:', err)
        void fetchProjects()
        return false
      }
    },
    [fetchProjects, fetchMcp, fetchMcpResources], // running 守卫改读 turnRef,不再依赖 state.turn
  )

  // 添加项目(=Composer 重选目录汇流入口):选目录 → 入列表 → 切换
  const handleAddProject = useCallback(async () => {
    if (turnRef.current === 'running') return // 读即时快照,避免闭包陈旧漏放行
    try {
      const picked = await window.wraith.addProject()
      if (!picked) return
      void fetchProjects() // addProject 已 upsert;先刷列表
      if (picked !== state.workspace) await switchToProject(picked)
    } catch (err) {
      console.error('[wraith] addProject error:', err)
    }
  }, [state.workspace, fetchProjects, switchToProject]) // running 守卫改读 turnRef,不再依赖 state.turn

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

  // ── 项目面板:点行 = 切项目 + 恢复最近会话 + 回聊天页 ──────────────────────────
  const handleOpenProject = useCallback(async (projectPath: string) => {
    if (turnRef.current === 'running') return
    const ok = projectPath === state.workspace ? true : await switchToProject(projectPath)
    if (ok) setView('chat')
  }, [state.workspace, switchToProject])

  // ── 项目面板:✎ = 切项目 + 新会话 + 回聊天页 ────────────────────────────────
  const handleProjectNewConversation = useCallback(async (projectPath: string) => {
    if (turnRef.current === 'running') return
    if (projectPath !== state.workspace) {
      const ok = await switchToProject(projectPath)
      if (!ok) return
    }
    setView('chat')
    await handleNewConversation()
  }, [state.workspace, switchToProject, handleNewConversation])

  // ── 项目面板:展开里点会话 = 切项目 + resume + 回聊天页 ──────────────────────
  const handleOpenProjectSession = useCallback(async (projectPath: string, sessionId: string) => {
    if (turnRef.current === 'running') return
    if (projectPath !== state.workspace) {
      const ok = await switchToProject(projectPath)
      if (!ok) return
    }
    setView('chat')
    await handleSelectSession(sessionId)
  }, [state.workspace, switchToProject, handleSelectSession])

  // ── 项目面板:重点 ─────────────────────────────────────────────────────────
  const handleToggleProjectStar = useCallback(async (projectPath: string, starred: boolean) => {
    try {
      await window.wraith.setProjectStarred(projectPath, starred)
      void fetchProjects()   // 侧栏快切下拉的前 5 名也要跟着变
    } catch (err) {
      console.error('[wraith] setProjectStarred error:', err)
    }
  }, [fetchProjects])

  // 批量归档确认:null=没有待确认项
  const [archiveConfirm, setArchiveConfirm] = useState<{ path: string; label: string; count: number } | null>(null)

  // ── 项目面板:批量归档某项目的聊天(破坏性,先确认) ────────────────────────────
  const handleArchiveProjectChats = useCallback(async (projectPath: string, count: number) => {
    const entry = projects.find(p => p.path === projectPath)
    const label = entry?.name || baseName(projectPath)
    // 批量归档是破坏性动作,用受控 Dialog 确认(本仓库不用原生 confirm/prompt)
    setArchiveConfirm({ path: projectPath, label, count })
  }, [projects])

  // ── 运行历史:跳转到对应会话 ─────────────────────────────────────────────────
  const handleOpenAutomationSession = useCallback(async (projectPath: string, sessionId: string) => {
    if (turnRef.current === 'running') return // 读即时快照,避免闭包陈旧漏放行
    setView('chat')
    if (projectPath !== state.workspace) {
      const ok = await switchToProject(projectPath)
      if (!ok) return
    }
    await handleSelectSession(sessionId)
  }, [state.workspace, switchToProject, handleSelectSession]) // running 守卫改读 turnRef,不再依赖 state.turn

  // ── 运行历史:重弹已缓存的审批弹窗(先验证 run 仍在 waiting_approval,再重弹) ──
  const handleReopenApproval = useCallback(async (runId: string) => {
    const cached = automationApprovalRef.current
    if (!cached || cached.runId !== runId) return
    try {
      const { runs } = await window.wraith.automationRuns()
      const run = runs.find(r => r.runId === runId)
      if (run?.status === 'waiting_approval') {
        setAutomationApproval(cached)
      } else {
        automationApprovalRef.current = null
      }
    } catch (err) {
      console.error('[wraith] handleReopenApproval error:', err)
    }
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

  // 派生视图模型:由 preview 覆盖态 + live 状态计算展示层数据(命名 pv,避开已有面板态 view)
  const pv = deriveView(preview, {
    sessionId: state.sessionId,
    items: state.items,
    hasStarted: state.hasStarted,
    turn: state.turn,
  })

  // 空态没有 Transcript,药丸得单独取出来喂给 WelcomeEmptyState。
  // 只在空态用得上,故不做记忆化 —— items 本来就每轮在变。
  const taskDoneNotices = pv.showWelcome
    ? state.items.filter((i): i is Extract<Item, { type: 'task-done' }> => i.type === 'task-done')
    : []

  // 引导条不能只看 noModel 那个**快照** —— 它只在 initialize 和「存完 provider 回查」
  // 两处采样。重启后从 config 读到模型、在别处设默认、切模型、后端热装,都不经过采样点,
  // 快照就一直停在「没有模型」,于是出现「composer 上明明显示着模型,条子还挂在上面」。
  // 与活信号 state.model 取交集:任何一处拿到了模型,条子立刻消失。
  const showNoModel = showNoModelNotice(noModel, state.model)

  // 折叠态下导航目标变化(切会话/切视图)→ 自动收浮层
  useEffect(() => {
    if (sidebarCollapsed) setSidebarPeek(false)
  }, [pv.activeSessionId, view, sidebarCollapsed])

  // 手动压缩上下文(压缩当前对话历史,释放上下文窗口;可见 transcript 不变)
  const [compactBusy, setCompactBusy] = useState(false)
  const [compactNotice, setCompactNotice] = useState<string | null>(null)
  const compactNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 压缩提示是「压缩」这一动作的瞬时确认,不是常驻横幅:设置后 6s 自动消失,且清掉上一枚定时器。
  const flashCompactNotice = useCallback((msg: string | null): void => {
    if (compactNoticeTimer.current) { clearTimeout(compactNoticeTimer.current); compactNoticeTimer.current = null }
    setCompactNotice(msg)
    if (msg) compactNoticeTimer.current = setTimeout(() => {
      setCompactNotice(null); compactNoticeTimer.current = null
    }, 6000)
  }, [])
  // 切/建会话即清:否则上一会话的「已压缩…」会泄漏到新会话顶部(sessionId 变化覆盖新建 resetSession 与切换 commitSwitchTo)。
  useEffect(() => {
    if (compactNoticeTimer.current) { clearTimeout(compactNoticeTimer.current); compactNoticeTimer.current = null }
    setCompactNotice(null)
    setRightPreview(null)
  }, [state.sessionId])
  const handleCompact = useCallback(async (): Promise<void> => {
    if (state.turn === 'running') return
    setCompactBusy(true); flashCompactNotice(null)
    try {
      flashCompactNotice(compactionNotice(await window.wraith.compactHistory()))
    } catch (err) {
      flashCompactNotice('❌ 压缩失败:' + ((err as Error).message || '未知错误'))
    } finally {
      setCompactBusy(false)
    }
  }, [state.turn, flashCompactNotice])
  // 压缩按钮共享禁用态:忙碌中/回合运行中/无消息可压——工具栏按钮与 ContextPanel 面板按钮两处复用同一表达式
  const compactDisabled = compactBusy || state.turn === 'running' || !pv.items.length

  // 导出当前对话为 Markdown(纯前端序列化 + Electron 保存对话框,不经 Java 后端)
  const handleExport = useCallback(async (): Promise<void> => {
    const items = pv.items
    if (!items.length) return
    const firstUser = items.find((i) => i.type === 'user') as { text: string } | undefined
    const rawTitle = (firstUser?.text ?? 'Wraith 对话').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Wraith 对话'
    const d = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    const md = transcriptToMarkdown(items, { title: rawTitle, model: state.model, workspace: state.workspace, exportedAt: stamp })
    const safeName = rawTitle.replace(/[/\\:*?"<>|]/g, '_').slice(0, 30) || 'wraith-对话'
    const fileStamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
    await window.wraith.saveTextFile(`${safeName}-${fileStamp}.md`, md)
  }, [pv.items, state.model, state.workspace])

  return (
    <div className="flex h-screen flex-col overflow-hidden text-fg">
      <TopBar
        platform={window.wraith.platform}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(v => !v)}
        showChat={view === 'chat'}
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen(v => !v)}
        rightDockOpen={rightDockOpen}
        onToggleRightDock={() => setRightDockOpen(v => !v)}
        sandbox={state.sandbox}
        sandboxNet={state.sandboxNet}
        onOpenPolicy={() => setView('policy')}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <SidebarDock collapsed={sidebarCollapsed} peek={sidebarPeek} onPeekChange={setSidebarPeek}>
        <Sidebar
          workspace={state.workspace}
          projects={projects}
          busy={state.turn === 'running'}
          sessions={sessions}
          activeSessionId={pv.activeSessionId}
          runningSessionId={pv.runningSessionId}
          newDraftActive={!pv.activeSessionId}
          onNewConversation={handleNewConversation}
          onSelectSession={handleSelectSession}
          onToggleStar={handleToggleStar}
          onRenameSession={handleRenameSession}
          onDeleteSession={handleDeleteSession}
          onActivateProject={switchToProject}
          onAddProject={handleAddProject}
          onOpenAllProjects={() => setView('projects')}
          profile={appPrefs.profile}
          taskActiveCount={taskActiveCount}
          activeNav={view === 'chat' ? null : view}
          onOpenPlugins={() => setView('plugins')}
          onOpenAutomations={() => setView('automations')}
          onOpenImGateway={() => setView('im-gateway')}
          onOpenProviders={() => setView('providers')}
          onOpenSkills={() => setView('skills')}
          onOpenMemory={() => setView('memory')}
          onOpenSnapshots={() => setView('snapshots')}
          onOpenTasks={() => setView('tasks')}
          onOpenPolicy={() => setView('policy')}
          onOpenBrowser={() => setView('browser')}
          onOpenRag={() => setView('rag')}
          onOpenDocuments={() => setView('documents')}
          onOpenSettings={() => setView('settings')}
          automationBadge={automationBadge}
          onOpenSearch={() => setPaletteOpen(true)}
        />
      </SidebarDock>

      <div className="flex min-w-0 flex-1 flex-row">
      <div className={'relative flex min-w-0 flex-1 flex-col ' + (view === 'chat' ? 'bg-surface' : 'bg-bg')}>
        {state.connection === 'disconnected' && (
          <DisconnectedBanner onRestart={handleRestart} />
        )}
        {modelFallbackNotice && (
          <ModelFallbackBanner onDismiss={() => setModelFallbackNotice(false)} />
        )}
        {submitError && (() => {
          const lu = lastUserMessage(state.items)
          return (
            <SubmitErrorBanner
              message={submitError}
              onDismiss={() => setSubmitError(null)}
              onResend={lu ? () => handleResendMessage(lu.ordinal, lu.text) : undefined}
            />
          )
        })()}
        {updateNotice && (
          <div data-testid="update-banner" className="flex items-center gap-3 border-b border-border bg-accent/10 px-4 py-2 text-xs text-fg">
            <span>有新版 v{updateNotice.latest}</span>
            <button className="text-accent" onClick={() => void window.wraith.openExternal(updateNotice.url)}>打开下载 ↗</button>
            <button className="ml-auto text-fg-subtle hover:text-fg" onClick={() => setUpdateNotice(null)}>✕</button>
          </div>
        )}

        {view === 'chat' && pv.showReturnBanner && (
          <PreviewBanner onReturn={() => setPreview(null)} />
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
        ) : view === 'im-gateway' ? (
          <ImGatewayPanel onBack={() => setView('chat')} />
        ) : view === 'providers' ? (
          <ProvidersPanel
            onBack={() => setView('chat')}
            onSaved={() => {
              // 存完不能盲目认为「配好了」—— 后端要真的热装上 client 才算。
              // 回问一次 model.list:current.provider 非空才收起引导条。
              void (async () => {
                try {
                  const m = await window.wraith.modelList()
                  const cur = (m as { current?: { provider?: string; model?: string } }).current
                  setNoModel(needsModelSetup({ currentProvider: cur?.provider ?? '' }))
                  if (cur?.model) dispatch({ type: 'setModel', model: cur.model })
                } catch { /* 拿不到就维持原状,不擅自收起 */ }
              })()
            }}
          />
        ) : view === 'skills' ? (
          <SkillsPanel onBack={() => setView('chat')} />
        ) : view === 'memory' ? (
          <MemoryPanel onBack={() => setView('chat')} />
        ) : view === 'snapshots' ? (
          <SnapshotPanel onBack={() => setView('chat')} />
        ) : view === 'tasks' ? (
          <TaskPanel onBack={() => setView('chat')} />
        ) : view === 'policy' ? (
          <PolicyPanel onBack={() => setView('chat')} onSandboxChange={applySandbox} />
        ) : view === 'browser' ? (
          <BrowserPanel onBack={() => setView('chat')} />
        ) : view === 'rag' ? (
          <RagPanel onBack={() => setView('chat')} />
        ) : view === 'documents' ? (
          <DocumentsPanel onBack={() => setView('chat')} />
        ) : view === 'projects' ? (
          <ProjectsPanel
            projects={projects}
            activePath={state.workspace ?? ''}
            busy={state.turn === 'running'}
            onOpen={handleOpenProject}
            onNewConversation={handleProjectNewConversation}
            onToggleStar={handleToggleProjectStar}
            onOpenSession={handleOpenProjectSession}
            onRename={handleRenameProject}
            onArchiveChats={handleArchiveProjectChats}
            onRemove={handleRemoveProject}
            onAdd={handleAddProject}
          />
        ) : view === 'settings' ? (
          <SettingsPanel onBack={() => setView('chat')} onOpenProviders={() => setView('providers')} />
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
                centered={pv.showWelcome}
                status={state.status}
                watermark={state.context.watermark}
                onOpenContextPanel={() => { setRightDockPane('context'); setRightDockOpen(true) }}
                resources={mcpResources}
                attachments={attachments}
                onPickAttachments={handlePickAttachments}
                onRemoveAttachment={handleRemoveAttachment}
                onAddAttachments={handleAddAttachments}
                onModelSwitched={(m) => dispatch({ type: 'setModel', model: m })}
                mode={pendingMode}
                onModeChange={setPendingMode}
                focusSignal={composerFocus}
              />
            )
            return (
              <>
                {/* 顶部工具条:压缩/导出仅活跃对话显示;终端/右侧面板键在内容列顶行右簇 */}
                {!pv.showWelcome && (
                  <div className="flex shrink-0 items-center justify-end gap-2 px-4 py-1.5">
                    {compactNotice && (
                      <span data-testid="compact-notice" className="mr-auto truncate text-2xs text-fg-subtle">{compactNotice}</span>
                    )}
                    <SummaryPopover items={state.items} workspace={state.workspace ?? null} onOpenArtifact={openArtifact} />
                    <button
                      data-testid="chat-compact"
                      onClick={() => void handleCompact()}
                      disabled={compactDisabled}
                      title="压缩上下文:把较早的对话压成摘要,释放上下文窗口(不改可见记录)"
                      className={'flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40'}
                    >
                      <Wand2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />{compactBusy ? '压缩中…' : '压缩'}
                    </button>
                    <button
                      data-testid="chat-export"
                      onClick={() => void handleExport()}
                      disabled={!pv.items.length}
                      title="导出当前对话为 Markdown"
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-fg/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />导出
                    </button>
                  </div>
                )}
                {!pv.showWelcome ? (
                  <>
                    <Transcript
                      items={pv.items}
                      busy={pv.transcriptBusy}
                      onEditMessage={handleEditMessage}
                      onDeleteMessage={handleDeleteMessage}
                      onResendMessage={handleResendMessage}
                      onPlanReview={handlePlanReview}
                      mode={pendingMode}
                      onOpenArtifact={openArtifact}
                      onOpenDiff={openDiff}
                      onUndo={handleUndo}
                      editors={editors}
                      workspace={state.workspace ?? null}
                      onOpenPanel={(id) => setView(id)}
                      onImBound={handleImBound}
                    />
                    <div className="shrink-0 px-4 py-3">{composer}</div>
                  </>
                ) : (
                  <div className="min-h-0 flex-1">
                    {/* 空态也要能显后台任务完成:从面板提交任务后回到新会话时,
                        Transcript 不渲染(showWelcome),通知否则就丢了。 */}
                    <WelcomeEmptyState
                      categories={PROMPT_CATEGORIES}
                      onPickExample={(t) => { setInputValue(t); setComposerFocus(n => n + 1) }}
                      notices={(showNoModel || taskDoneNotices.length > 0) ? (
                        <>
                          {showNoModel && <NoModelNotice onConfigure={() => setView('providers')} />}
                          {taskDoneNotices.map((n) => (
                            <TaskDonePill key={n.taskId} text={n.text} ok={n.ok} onOpen={() => setView('tasks')} />
                          ))}
                        </>
                      ) : undefined}
                    >{composer}</WelcomeEmptyState>
                  </div>
                )}
                {/* 终端抽屉:最底部(Composer 下方),常驻挂载,由 open 控制丝滑展开/收起 */}
                <TerminalDrawer open={terminalOpen} cwd={state.workspace ?? null} onClose={() => setTerminalOpen(false)} />
              </>
            )
          })()
        )}
      </div>
      <RightDock
        open={rightDockOpen}
        cwd={state.workspace ?? null}
        pane={rightDockPane}
        onPaneChange={setRightDockPane}
        onClose={() => setRightDockOpen(false)}
        context={state.context}
        status={state.status}
        onCompact={() => void handleCompact()}
        compactDisabled={compactDisabled}
        preview={rightPreview}
      />
      </div>
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

      {/* 命令面板:⌘K 开/关,覆盖最顶层 */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        sessions={sessions.map(s => ({ id: s.id, title: sessionDisplayName(s) }))}
        projects={projects}
        actions={{
          selectSession: handleSelectSession,
          activateProject: switchToProject,
          newConversation: handleNewConversation,
          openSettings: () => setView('settings'),
          openView: (v) => setView(v as typeof view),
        }}
      />

      {/* 项目面板:批量归档确认框(破坏性操作,需知项目名与真实数量,故在 App 弹) */}
      <Dialog open={archiveConfirm !== null} onOpenChange={o => { if (!o) setArchiveConfirm(null) }}>
        <DialogContent data-testid="archive-project-confirm" className="w-96">
          <DialogTitle>归档 {archiveConfirm?.label} 的聊天？</DialogTitle>
          <DialogDescription>
            这个项目的 {archiveConfirm?.count} 个聊天会从侧栏隐藏，可在「设置 › 归档」中找回。不删除任何内容。
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setArchiveConfirm(null)}
              className="rounded-lg px-3 py-1.5 text-xs text-fg-muted hover:bg-fg/5"
            >
              取消
            </button>
            <button
              data-testid="archive-project-confirm-ok"
              onClick={async () => {
                const target = archiveConfirm
                setArchiveConfirm(null)
                if (!target) return
                try {
                  await window.wraith.archiveProjectSessions(target.path)
                  // 归档的若是当前项目,侧栏会话列表要立刻重拉
                  if (target.path === state.workspace) void fetchSessions()
                } catch (err) {
                  console.error('[wraith] archiveProjectSessions error:', err)
                }
              }}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
            >
              归档
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
