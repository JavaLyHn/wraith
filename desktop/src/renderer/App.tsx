import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import CommandPalette from './components/CommandPalette'
import type { ActivityItem, BackendEvent, SessionMeta, ProjectView, McpServerView, McpResourceView, RunMode, SandboxKindWire, GitStatusView } from '../shared/types'
import type { RightPreview, ArtifactFile } from '../shared/artifactSummary'
import type { EditorApp } from '../shared/editors'
import type { McpFormValue } from './components/McpServerForm'
import type { ApprovalResponsePayload } from '../shared/buildApprovalResponse'

import {
  initialState,
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
} from '../shared/transcriptReducer'
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
import ChoiceModal from './components/ChoiceModal'
import CloseConfirmModal from './components/CloseConfirmModal'
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
import { deriveView, type Preview } from '../shared/sessionPreview'
import PluginsPanel from './components/PluginsPanel'
import AutomationsPanel from './components/AutomationsPanel'
import ImGatewayPanel from './components/ImGatewayPanel'
import ProvidersPanel from './components/ProvidersPanel'
import SkillsPanel from './components/SkillsPanel'
import MemoryPanel from './components/MemoryPanel'
import SnapshotPanel from './components/SnapshotPanel'
import TaskPanel from './components/TaskPanel'
import ActivityPanel from './components/ActivityPanel'
import PolicyPanel from './components/PolicyPanel'
import BrowserPanel from './components/BrowserPanel'
import RagPanel from './components/RagPanel'
import DocumentsPanel from './components/DocumentsPanel'
import ProjectsPanel from './components/ProjectsPanel'
import SettingsPanel from './components/SettingsPanel'
import WorkbenchTabBar from './components/WorkbenchTabBar'
import FileTreePanel from './components/FileTreePanel'
import FilePreviewPanel from './components/FilePreviewPanel'
import TerminalDrawer from './components/TerminalDrawer'
import RightDock, { type RightDockPane } from './components/RightDock'
import SummaryPopover from './components/SummaryPopover'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog'
import { useSettings } from './settings/SettingsContext'
import { activityBadgeCount } from './lib/activityView'
import { useWorkbench } from './lib/useWorkbench'
import { useSidebarCollapse } from './lib/useSidebarCollapse'
import { useSessionFailureTracking } from './lib/useSessionFailureTracking'
import { useActivityManager } from './lib/useActivityManager'
import { useSessionListManager } from './lib/useSessionListManager'
import { useBackendEventSubscription } from './lib/useBackendEventSubscription'
import { useSessionManager } from './lib/useSessionManager'
import { useStartup } from './lib/useStartup'

// ---------------------------------------------------------------------------
// Local action types (for non-BackendEvent dispatches)
// ---------------------------------------------------------------------------

type LocalAction =
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

type Action = BackendEvent | LocalAction

// ---------------------------------------------------------------------------
// Reducer adapter that handles both BackendEvent and LocalAction
// ---------------------------------------------------------------------------

function reduceAdapter(state: TranscriptState, action: Action): TranscriptState {
  if ('type' in action && action.type === 'clearApproval') {
    return clearApproval(state)
  }
  if ('type' in action && action.type === 'clearChoice') {
    return clearChoice(state)
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
  // 异常中断(LLM 失败/后端断开等)的会话 id 集合 → 侧栏会话行右侧显示感叹号。
  // 只跟踪本桌面会话内的故障,不落盘:后端在 turn.failed/进程死亡时不持久化,重启后 ! 消失。
  const { failedSessions, setFailedSessions, sessionIdRef } = useSessionFailureTracking()
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [view, setView] = useState<'chat' | 'projects' | 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills' | 'memory' | 'snapshots' | 'policy' | 'browser' | 'rag' | 'tasks' | 'documents' | 'activity' | 'settings'>('chat')
  const { activitySnapshot, loadActivities } = useActivityManager()
  const [automationApproval, setAutomationApproval] = useState<{ runId: string; payload: Record<string, unknown> } | null>(null)
  const [automationBadge, setAutomationBadge] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpServerView[]>([])
  const [mcpConfigError, setMcpConfigError] = useState<string | null>(null)
  const [mcpResources, setMcpResources] = useState<McpResourceView[]>([])
  const [modelFallbackNotice, setModelFallbackNotice] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  /** 分支操作正在执行的消息 index(用于禁用按钮,防重复点击)。 */
  const [branchingMsgIndex, setBranchingMsgIndex] = useState<number | null>(null)
  const { prefs: appPrefs } = useSettings()
  const [updateNotice, setUpdateNotice] = useState<{ latest: string; url: string } | null>(null)
  const [pendingMode, setPendingMode] = useState<RunMode>('react')
  // 类别是固定四组、不随机 —— 随机会让同一个人每次打开看到不同入口,反而记不住有什么能做
  const [composerFocus, setComposerFocus] = useState(0)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [rightDockOpen, setRightDockOpen] = useState(false)
  const [rightDockPane, setRightDockPane] = useState<RightDockPane>('browser')
  const [rightPreview, setRightPreview] = useState<RightPreview | null>(null)
  // 关闭确认对话框:主进程发 'wraith:close:request' 时弹出
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)

  // ── Workbench 工作台(文件浏览器 + 聊天 Tab 混排) ──────────────────────────
  const workbench = useWorkbench(state.workspace)
  const { tabs, activeTabId,
    fileTreeVisible, setFileTreeVisible,
    fileTreeWidth, resizingRef,
    handleOpenWorkspaceFile, handleCloseTab, handleActivateTab,
    handleOpenWorkspace: handleOpenWorkspaceBase, onResizeMouseDown } = workbench
  // 补充:原 handleOpenWorkspace 还会把视图切到「聊天」
  const handleOpenWorkspace = useCallback(() => {
    setView('chat')
    handleOpenWorkspaceBase()
  }, [handleOpenWorkspaceBase])

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

  // 关闭确认:监听主进程 'wraith:close:request'。
  // 若已记住 closeMode≠'ask',直接 execute;否则弹 CloseConfirmModal。
  useEffect(() => {
    let cancelled = false
    const off = window.wraith.closeBehavior.onRequest(async () => {
      if (cancelled) return
      try {
        const mode = await window.wraith.closeBehavior.getMode()
        if (mode === 'background' || mode === 'quit') {
          // 已记住:直接执行
          await window.wraith.closeBehavior.execute({ mode, remember: null })
        } else {
          // ask:弹 modal
          setCloseConfirmOpen(true)
        }
      } catch {
        // 读 mode 失败 → 兜底弹 modal
        setCloseConfirmOpen(true)
      }
    })
    return () => { cancelled = true; off() }
  }, [])

  const handleCloseConfirm = useCallback(async (mode: 'background' | 'quit', remember: boolean) => {
    setCloseConfirmOpen(false)
    try {
      await window.wraith.closeBehavior.execute({ mode, remember: remember ? mode : null })
    } catch {
      // best-effort
    }
  }, [])

  const handleCloseConfirmCancel = useCallback(() => {
    setCloseConfirmOpen(false)
    // 不调 execute,主窗继续运行
  }, [])
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** 后端起来了但一个模型都没配 —— 全新装机的常态,需要在空态给出引导。 */
  const [noModel, setNoModel] = useState(false)
  // 用户真实仓库的只读状态。null = 还没拉回来 / 不是仓库,顶栏 pill 整块不渲染。
  const [gitStatus, setGitStatus] = useState<GitStatusView | null>(null)
  const { sidebarCollapsed, setSidebarCollapsed, sidebarPeek, setSidebarPeek } = useSidebarCollapse()

  // 注:statusThrottleRef 由 useBackendEventSubscription 生成,见下文
  // turnRef:与 state.turn 同步的即时快照,供 handleAddProject / switchToProject 的 running 守卫读取。
  // 消除「dispatch(markStarted) → 组件重渲染」之间的闭包陈旧:markStarted 已在提交瞬间置 running,
  // 但用旧 state.turn 闭包的回调直到下次重渲染前读到的仍是 'idle',守卫会漏放行;改读 ref 即时可见。
  const turnRef = useRef(state.turn)
  useEffect(() => {
    turnRef.current = state.turn
  }, [state.turn])

  // sessionIdRef 由 useSessionFailureTracking 提供,这里让它随 state.sessionId 同步
  useEffect(() => {
    sessionIdRef.current = state.sessionId
  }, [state.sessionId])

  // 折叠状态持久化(由 useSidebarCollapse 内部处理)

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

  // 取数失败时**保留上一次成功的值**,只把 error 换上 —— 静默拿旧数据当新的是不允许的
  // (与上下文治理「绝不静默」同一条规矩),所以 error 会在弹出层里明写出来。
  // 声明在 onEvent effect 之前,以便后者在 deps 里引用(同 fetchMcpResources 的处理)。
  const fetchGitStatus = useCallback(async (): Promise<void> => {
    try {
      setGitStatus(await window.wraith.gitStatus())
    } catch (e) {
      setGitStatus(prev => (prev ? { ...prev, error: String(e) } : null))
    }
  }, [])

  // 活动中心已由 useActivityManager 负责加载 / 订阅 (loadActivities 来自该 hook)。

  // ── subscribe to backend events on mount (status 高频 → 100ms 窗口合并) ────
  // (由 useBackendEventSubscription 集中处理;statusThrottleRef 从此处导出,供外部 .cancel() 使用)
  const { statusThrottleRef } = useBackendEventSubscription({
    dispatch,
    setMcpServers,
    onMcpReady: () => { void fetchMcpResources(); void fetchMcp() },
    onTurnCompleted: () => { void fetchGitStatus(); void loadActivities(true) },
    onTurnFailed: () => { void fetchGitStatus(); void loadActivities(true) },
  })

  // ── 会话异常标记:由 useSessionFailureTracking 订阅。
  // 这里保留“切会话时清感叹号”的逻辑(写 hook 导出的 setter)。
  useEffect(() => {
    setFailedSessions(prev => (prev.has(state.sessionId) ? (() => {
      const next = new Set(prev); next.delete(state.sessionId); return next
    })() : prev))
  }, [state.sessionId, setFailedSessions])

  // ── session list helpers(由 useSessionListManager 集中管理) ──────────────
  const { sessions, setSessions, fetchSessions, handleReorderSession } = useSessionListManager(
    async (id, starred) => { await window.wraith.setSessionStarred(id, starred) },
  )

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
      if (evt.kind === 'runs-changed') {
        void fetchSessions()
        void loadActivities(true)
      }
    })
    return unsub
  }, [fetchSessions, loadActivities])

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

  // ── useSessionManager wiring ──────────────────────────────────────────
  const getTurn = useCallback(() => state.turn, [state.turn])
  const getSessionId = useCallback(() => state.sessionId, [state.sessionId])
  const getWorkspace = useCallback(() => state.workspace, [state.workspace])
  const getProjects = useCallback(() => projects, [projects])

  const sessionManager = useSessionManager({
    preview,
    setPreview,
    getTurn,
    getSessionId,
    getWorkspace,
    getProjects,
    setView: (v: string) => setView(v as typeof view),
    setModelFallbackNotice,
    setSubmitError,
    setBranchingMsgIndex,
    setProjects,
    setSessions,
    dispatch: (action) => dispatch(action as Action),
    statusThrottleRef,
    fetchSessions,
    fetchProjects,
    fetchMcp,
    fetchMcpResources,
    loadActivities,
    model: state.model,
    pendingMode,
    setPendingMode: (m) => setPendingMode(m as RunMode),
  })

  // ── useStartup wiring ────────────────────────────────────────────────
  const { applySandbox, refreshSandbox } = useStartup({
    dispatch: (action) => dispatch(action as Action),
    setModelFallbackNotice,
    setNoModel,
    setUpdateNotice,
    statusThrottleRef,
    fetchSessions,
    fetchProjects,
    fetchMcp,
    fetchMcpResources,
    fetchGitStatus,
    connection: state.connection,
    workspace: state.workspace,
    getSessionId,
    autoCheck: appPrefs.update.autoCheck,
    beta: appPrefs.update.beta,
  })

  // ── 会话级操作:由 useSessionManager 提供 ────────────────────────────────
  const handleNewConversation = sessionManager.handleNewConversation
  const commitSwitchTo = sessionManager.commitSwitchTo
  const handleBranchConversation = sessionManager.handleBranchConversation
  const handleSelectSession = sessionManager.handleSelectSession
  const handleToggleStar = sessionManager.handleToggleStar
  const handleRenameSession = sessionManager.handleRenameSession
  const handleDeleteSession = sessionManager.handleDeleteSession
  const handleArchiveSession = sessionManager.handleArchiveSession
  const switchToProject = sessionManager.switchToProject
  const handleToggleProjectStar = sessionManager.handleToggleProjectStar
  const handleMoveProject = sessionManager.handleMoveProject
  const handleArchiveProjectChats = sessionManager.handleArchiveProjectChats
  const handleOpenAutomationSession = sessionManager.handleOpenAutomationSession
  const handleOpenActivitySession = sessionManager.handleOpenActivitySession
  const archiveConfirm = sessionManager.archiveConfirm
  const setArchiveConfirm = sessionManager.setArchiveConfirm
  // setPreview 由 useSessionManager 内部持有 setter,这里回传给 App
  // (App 其他地方也用到 setPreview,直接用 hook 回传的即可)

  // ── refresh session list when a turn completes ────────────
  const prevTurnRef = useRef(state.turn)
  useEffect(() => {
    if (prevTurnRef.current === 'running' && state.turn === 'idle') {
      void fetchSessions()
    }
    prevTurnRef.current = state.turn
  }, [state.turn, fetchSessions])

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

  // ── choice handlers ───────────────────────────────────────────────────────
  const handleChoiceRespond = useCallback(
    async (selectedIndex: number) => {
      if (!state.pendingChoice) return
      try {
        await window.wraith.respondChoice(state.pendingChoice.choiceId, false, selectedIndex)
      } finally {
        dispatch({ type: 'clearChoice' })
      }
    },
    [state.pendingChoice],
  )

  const handleChoiceReject = useCallback(async () => {
    if (!state.pendingChoice) return
    try {
      await window.wraith.respondChoice(state.pendingChoice.choiceId, true, -1)
    } finally {
      dispatch({ type: 'clearChoice' })
    }
  }, [state.pendingChoice])

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
      if (state.turn !== 'running' || state.pendingApproval || state.pendingChoice || automationApproval) return
      void window.wraith.interrupt().catch(err => console.error('[wraith] interrupt error:', err))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.turn, state.pendingApproval, state.pendingChoice, automationApproval])

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

  const handleOpenActivityTask = useCallback((_item: ActivityItem) => {
    setView('tasks')
  }, [])

  const handleOpenActivityAutomation = useCallback((item: ActivityItem) => {
    // 自动化面板本身已有运行历史和会话回跳入口；不要用 runId 拼出不存在的
    // session RPC。有关联 session 时仍由面板的既有路径决定何时恢复。
    void item
    setView('automations')
  }, [])

  const handleCancelActivity = useCallback(async (item: ActivityItem) => {
    const id = item.kind === 'session' ? item.sessionId : item.kind === 'task' ? item.taskId : item.runId
    if (!id) return { ok: false, message: '活动缺少可取消的来源标识' }
    const result = await window.wraith.activityCancel({ kind: item.kind, id })
    if (result.ok) void loadActivities(true)
    return result
  }, [loadActivities])

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
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        showChat={view === 'chat'}
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen(v => !v)}
        rightDockOpen={rightDockOpen}
        onToggleRightDock={() => setRightDockOpen(v => !v)}
        sandbox={state.sandbox}
        sandboxNet={state.sandboxNet}
        onOpenPolicy={() => setView('policy')}
        gitStatus={gitStatus}
        onRefreshGit={() => void fetchGitStatus()}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <SidebarDock collapsed={sidebarCollapsed} peek={sidebarPeek} onPeekChange={setSidebarPeek}>
        <Sidebar
          workspace={state.workspace}
          projects={projects}
          busy={state.turn === 'running'}
          sessions={sessions}
          failedSessions={failedSessions}
          activeSessionId={pv.activeSessionId}
          runningSessionId={pv.runningSessionId}
          newDraftActive={!pv.activeSessionId}
          onNewConversation={handleNewConversation}
          onSelectSession={handleSelectSession}
          onToggleStar={handleToggleStar}
          onRenameSession={handleRenameSession}
          onArchiveSession={handleArchiveSession}
          onReorderSession={handleReorderSession}
          onActivateProject={switchToProject}
          onAddProject={handleAddProject}
          onOpenAllProjects={() => setView('projects')}
          profile={appPrefs.profile}
          taskActiveCount={taskActiveCount}
          activityCount={activityBadgeCount(activitySnapshot.activities)}
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
          onOpenWorkspace={handleOpenWorkspace}
          onOpenActivity={() => setView('activity')}
          onOpenSettings={() => setView('settings')}
          automationBadge={automationBadge}
          onOpenSearch={() => setPaletteOpen(true)}
        />
      </SidebarDock>

      <div className="flex min-w-0 flex-1 flex-row">
      {view === 'chat' ? (
        <div className="flex min-w-0 flex-1 flex-col bg-surface">
          <WorkbenchTabBar tabs={tabs} activeId={activeTabId} onActivate={handleActivateTab} onClose={handleCloseTab}
            fileTreeVisible={fileTreeVisible} onToggleFileTree={() => setFileTreeVisible(!fileTreeVisible)}>
            {/* 右上角动作簇(文件树开关右侧,与最初布局一致):产物/压缩/导出常驻 tab 栏,
                文件 tab 激活或欢迎页时也可见 —— 它们作用于聊天会话本身,与当前激活 tab 无关 */}
            <SummaryPopover items={state.items} workspace={state.workspace ?? null} onOpenArtifact={openArtifact} />
            <button
              data-testid="chat-compact"
              onClick={() => void handleCompact()}
              disabled={compactDisabled}
              title="压缩上下文:把较早的对话压成摘要,释放上下文窗口(不改可见记录)"
              className="flex items-center gap-1.5 border-l border-border px-2.5 text-xs text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Wand2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />{compactBusy ? '压缩中…' : '压缩'}
            </button>
            <button
              data-testid="chat-export"
              onClick={() => void handleExport()}
              disabled={!pv.items.length}
              title="导出当前对话为 Markdown"
              className="flex items-center gap-1.5 border-l border-border px-2.5 text-xs text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />导出
            </button>
          </WorkbenchTabBar>
          <div className="flex min-h-0 flex-1">
            {fileTreeVisible && (
              <>
                <div style={{ width: fileTreeWidth }} className="shrink-0 border-r border-border bg-bg">
                  <FileTreePanel rootPath={state.workspace || undefined} onOpenFile={handleOpenWorkspaceFile} />
                </div>
                <div
                  onMouseDown={onResizeMouseDown}
                  className="w-1 shrink-0 cursor-col-resize select-none bg-border/0 hover:bg-accent/40 transition-colors"
                  title="拖动调整宽度"
                  role="separator"
                  aria-orientation="vertical"
                />
              </>
            )}
            <div className="relative flex min-w-0 flex-1 flex-col">
              {activeTabId === 'chat' ? (
                <>
                  {state.connection === 'disconnected' && <DisconnectedBanner onRestart={handleRestart} />}
                  {modelFallbackNotice && <ModelFallbackBanner onDismiss={() => setModelFallbackNotice(false)} />}
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
                  {pv.showReturnBanner && <PreviewBanner onReturn={() => setPreview(null)} />}
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
                    return !pv.showWelcome ? (
                      <>
                        {/* 产物/压缩/导出已上移 WorkbenchTabBar 右上角;此行仅在压缩提示存在时渲染 */}
                        {compactNotice && (
                          <div className="flex shrink-0 items-center px-4 py-1.5">
                            <span data-testid="compact-notice" className="truncate text-2xs text-fg-subtle">{compactNotice}</span>
                          </div>
                        )}
                        <Transcript items={pv.items} busy={pv.transcriptBusy}
                          onEditMessage={handleEditMessage} onDeleteMessage={handleDeleteMessage}
                          onResendMessage={handleResendMessage} onPlanReview={handlePlanReview}
                          mode={pendingMode} onOpenArtifact={openArtifact} onOpenDiff={openDiff} onUndo={handleUndo}
                          editors={editors} workspace={state.workspace ?? null}
                          onOpenPanel={(id) => setView(id)} onImBound={handleImBound}
                          onBranch={handleBranchConversation} branchingMsgIndex={branchingMsgIndex}
                        />
                        <div className="shrink-0 px-4 py-3">{composer}</div>
                        <TerminalDrawer open={terminalOpen} cwd={state.workspace ?? null} onClose={() => setTerminalOpen(false)} />
                      </>
                    ) : (
                      <div className="min-h-0 flex-1">
                        <WelcomeEmptyState categories={PROMPT_CATEGORIES}
                          onPickExample={(t) => { setInputValue(t); setComposerFocus(n => n + 1) }}
                          notices={(showNoModel || taskDoneNotices.length > 0) ? (
                            <>
                              {showNoModel && <NoModelNotice onConfigure={() => setView('providers')} />}
                              {taskDoneNotices.map((n) => (
                                <TaskDonePill key={n.taskId} text={n.text} ok={n.ok} onOpen={() => setView('tasks')} />
                              ))}
                            </>
                          ) : undefined}>
                          {composer}
                        </WelcomeEmptyState>
                      </div>
                    )
                  })()}
                </>
              ) : (
                (() => {
                  const tab = tabs.find(t => t.id === activeTabId)
                  if (!tab || tab.id === 'chat') return null
                  return <FilePreviewPanel path={tab.path} kind={tab.kind} />
                })()
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex min-w-0 flex-1 flex-col bg-bg">
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
          {view === 'activity' ? (
            <ActivityPanel
              snapshot={activitySnapshot}
              onBack={() => setView('chat')}
              onOpenSession={item => { void handleOpenActivitySession(item) }}
              onOpenTask={handleOpenActivityTask}
              onOpenAutomation={handleOpenActivityAutomation}
              onRefresh={() => { void loadActivities(false) }}
              onCancel={handleCancelActivity}
            />
          ) : view === 'plugins' ? (
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
              onMove={handleMoveProject}
            />
          ) : view === 'settings' ? (
            <SettingsPanel onBack={() => setView('chat')} onOpenProviders={() => setView('providers')} onArchiveChanged={() => void fetchSessions()} />
          ) : null}
        </div>
      )}
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

      {state.pendingChoice && (
        <ChoiceModal
          key={state.pendingChoice.choiceId}
          title={state.pendingChoice.title}
          options={state.pendingChoice.options}
          allowCancel={state.pendingChoice.allowCancel}
          hint={state.pendingChoice.hint}
          onRespond={handleChoiceRespond}
          onReject={handleChoiceReject}
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

      {/* 关闭确认对话框:点 X 时弹出,选择挂后台或退出 */}
      {closeConfirmOpen && (
        <CloseConfirmModal
          onRespond={handleCloseConfirm}
          onCancel={handleCloseConfirmCancel}
        />
      )}

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
