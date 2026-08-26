import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import CommandPalette from './components/CommandPalette'
import type { BackendEvent, SessionMeta, RunMode, SandboxKindWire } from '../shared/types'
import type { RightPreview, ArtifactFile } from '../shared/artifactSummary'
import type { EditorApp } from '../shared/editors'

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

import { useBackgroundTasks } from './lib/useBackgroundTasks'
import { taskDoneLabel } from '../shared/taskWatch'
import { PROMPT_CATEGORIES } from './lib/welcomePrompts'
import { lastUserMessage } from './lib/resend'
import { resolveWorkspacePath, baseName } from './lib/paths'
import { sessionDisplayName } from './lib/sessionView'

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
import { needsModelSetup } from './lib/modelReady'
import Sidebar from './components/Sidebar'
import SidebarDock from './components/SidebarDock'
import TopBar from './components/TopBar'
import PreviewBanner from './components/PreviewBanner'
import { type Preview } from '../shared/sessionPreview'
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
import { useMessageOperations } from './lib/useMessageOperations'
import { useProjectManager } from './lib/useProjectManager'
import { useMcpManager } from './lib/useMcpManager'
import { useApprovalHandlers } from './lib/useApprovalHandlers'
import { useChatSubmission } from './lib/useChatSubmission'
import { useChoiceHandlers } from './lib/useChoiceHandlers'
import { useDataFetchers } from './lib/useDataFetchers'
import { useActivityHandlers } from './lib/useActivityHandlers'
import { useKeyboardShortcuts } from './lib/useKeyboardShortcuts'
import { useSystemControls } from './lib/useSystemControls'
import { useExportAndCompact } from './lib/useExportAndCompact'
import { useSystemEvents } from './lib/useSystemEvents'
import { useDerivedViews } from './lib/useDerivedViews'

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
  const {
    projects, setProjects,
    mcpServers, setMcpServers,
    mcpConfigError, setMcpConfigError,
    mcpResources, setMcpResources,
    gitStatus, setGitStatus,
    fetchProjects, fetchMcp, fetchMcpResources, fetchGitStatus,
  } = useDataFetchers()
  const [view, setView] = useState<'chat' | 'projects' | 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills' | 'memory' | 'snapshots' | 'policy' | 'browser' | 'rag' | 'tasks' | 'documents' | 'activity' | 'settings'>('chat')
  const { activitySnapshot, loadActivities } = useActivityManager()
  const {
    automationApproval,
    setAutomationApproval,
    automationApprovalRef,
    handleAutomationApprovalRespond,
    handleAutomationApprovalReject,
    handleOpenActivityTask,
    handleOpenActivityAutomation,
    handleCancelActivity,
    handleReopenApproval,
  } = useActivityHandlers({ setView: (v) => setView(v as typeof view), loadActivities })
  const [automationBadge, setAutomationBadge] = useState(false)
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

  // ── useMessageOperations wiring ────────────────────────────────────
  const { rewindAndResubmit, handleEditMessage, handleResendMessage, handleDeleteMessage } = useMessageOperations({
    getTurn: () => turnRef.current,
    dispatch: (action) => dispatch(action as Action),
    fetchSessions,
    setSubmitError,
  })

  // ── useApprovalHandlers wiring ─────────────────────────────────────
  const { handleApprovalRespond, handleApprovalCancel, handlePlanReview, handleToggleApproval } = useApprovalHandlers({
    dispatch: (action) => dispatch(action as Action),
    getPendingApproval: () => state.pendingApproval,
  })

  // ── useProjectManager wiring ──────────────────────────────────────
  const { handleAddProject, handleRemoveProject, handleRenameProject, handleOpenProject, handleProjectNewConversation, handleOpenProjectSession } = useProjectManager({
    getTurn: () => turnRef.current,
    getWorkspace: () => state.workspace,
    setView: (v) => setView(v as typeof view),
    fetchProjects,
    switchToProject,
    handleNewConversation,
    handleSelectSession,
  })

  // ── useMcpManager wiring ──────────────────────────────────────────
  const { handleMcpToggle, handleMcpRestart, handleMcpRemove, handleMcpSubmitForm } = useMcpManager({
    fetchMcp,
  })

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

  const { handleSubmit } = useChatSubmission({
    getInputValue: () => inputValue,
    getAttachments: () => attachments,
    getTurn: () => turnRef.current,
    getModel: () => state.model,
    getPendingMode: () => pendingMode,
    setInputValue,
    setAttachments,
    setSubmitError,
    setPendingMode: (m) => setPendingMode(m as RunMode),
    dispatch: (action) => dispatch(action as Action),
  })

  const { handleChoiceRespond, handleChoiceReject } = useChoiceHandlers({
    getPendingChoice: () => state.pendingChoice,
    dispatch: (action) => dispatch(action as Action),
  })

  const { handleRestart, handleInterrupt } = useSystemControls()

  // ── 全局键盘快捷键 ────────────────────────────────────────────────────────
  useKeyboardShortcuts({
    getTurn: () => state.turn,
    onInterrupt: handleInterrupt,
    onNewConversation: handleNewConversation,
    onPaletteOpen: () => setPaletteOpen(v => !v),
    onToggleProviders: () => setView('settings'),
    getPendingApproval: () => !!state.pendingApproval,
    getPendingChoice: () => !!state.pendingChoice,
    getAutomationApproval: () => !!automationApproval,
  })

  const { handleImBound } = useSystemEvents({
    dispatch: (action) => dispatch(action as Action),
    getTurn: () => state.turn,
  })

  // 后台任务:队列是全局的(与终端 /task 共享),不属于任何会话 —— 这里只回答两件事:
  // 「现在有几个在跑」(侧栏计数)和「刚才那个跑完了」(对话里的静默药丸,点开看结果)。
  // 后端不推送任务事件,只能轮询;首轮静默播种,免得开机把历史完成项灌进对话(见 taskWatch)。
  const listTasks = useCallback((limit: number) => window.wraith.taskList(limit), [])
  const taskActiveCount = useBackgroundTasks(listTasks, useCallback((finished) => {
    for (const t of finished) {
      dispatch({ type: 'addTaskDone', taskId: t.id, text: taskDoneLabel(t), ok: t.status === 'completed' })
    }
  }, []))

  // 活动相关 handler 已由 useActivityHandlers 提供

  const { pv, taskDoneNotices, showNoModel } = useDerivedViews({
    preview,
    sessionId: state.sessionId,
    items: state.items,
    hasStarted: state.hasStarted,
    turn: state.turn,
    noModel,
    model: state.model,
  })

  // 折叠态下导航目标变化(切会话/切视图)→ 自动收浮层
  useEffect(() => {
    if (sidebarCollapsed) setSidebarPeek(false)
  }, [pv.activeSessionId, view, sidebarCollapsed])

  const {
    compactBusy,
    compactNotice,
    compactDisabled,
    handleCompact,
    handleExport,
    clearCompactNotice,
  } = useExportAndCompact({
    getItems: () => pv.items,
    getModel: () => state.model,
    getWorkspace: () => state.workspace,
    getTurn: () => state.turn,
  })

  useEffect(() => {
    clearCompactNotice()
    setRightPreview(null)
  }, [state.sessionId])

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
          onReject={handleApprovalCancel}
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
