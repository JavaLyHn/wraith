import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from './logger'
import type { ActivityItem, BackendEvent, ProjectView, SessionMeta } from '../../shared/types'
import type { Preview } from '../../shared/sessionPreview'
import { selectAction, resolveOnIdle } from '../../shared/sessionPreview'
import { messagesToItems } from '../../shared/messagesToItems'
import { spliceCards } from '../../shared/spliceCards'
import { baseName } from './paths'

/**
 * 会话级操作集合:会话 CRUD、项目切换/星标/排序、活动跳转、批量归档确认、
 * 以及 preview 落定 effect。
 *
 * 设计要点:
 * - 本 hook 不拥有 preview 状态 —— App.tsx 持有 preview/setPreview 并通过参数传入。
 *   但内部会建立 previewRef 供闭包安全读取(删除会话时判定是否命中当前预览);
 *   同时基于传入的 preview prop 建立落定 effect,行为与 App.tsx 原实现完全一致。
 * - archiveConfirm 状态由本 hook 拥有,因为仅用于批量归档的受控 Dialog 流程。
 * - 所有 handler 走 useCallback,依赖全部通过参数注入,方便 App.tsx 组合。
 */

export interface UseSessionManagerOptions {
  // ── preview:由 App.tsx 持有,作为 prop 传入以便建立 resolution effect ──
  preview: Preview | null
  setPreview: React.Dispatch<React.SetStateAction<Preview | null>>

  // ── 状态读取(用 ref / getter 规避闭包陈旧) ──
  getTurn: () => 'idle' | 'running'
  getSessionId: () => string
  getWorkspace: () => string | null
  getProjects: () => ProjectView[]

  // ── 其他 state setter ──
  setView: (v: string) => void
  setModelFallbackNotice: (v: boolean) => void
  setSubmitError: (v: string | null) => void
  setBranchingMsgIndex: (v: number | null) => void
  setProjects: React.Dispatch<React.SetStateAction<ProjectView[]>>
  setSessions: React.Dispatch<React.SetStateAction<SessionMeta[]>>

  // ── transcript dispatch(reducer 动作 + BackendEvent) ──
  dispatch: (action: { type: string; [key: string]: unknown } | BackendEvent) => void

  // ── status throttle 取消器(resetSession 之前调用,清掉飞行中的 status 尾巴) ──
  statusThrottleRef: React.MutableRefObject<{ cancel: () => void } | null>

  // ── 拉取 helper ──
  fetchSessions: () => Promise<void>
  fetchProjects: () => Promise<void>
  fetchMcp: () => Promise<void>
  fetchMcpResources: () => Promise<void>
  loadActivities: (silent: boolean) => Promise<void>

  // ── 模型回退 / pendingMode(部分 handler 里可能需要,由 App 注入) ──
  model: string
  pendingMode: 'react' | 'plan' | 'team' | 'parallel'
  setPendingMode: (m: 'react' | 'plan' | 'team' | 'parallel') => void
}

export interface UseSessionManagerReturn {
  // Session CRUD
  handleNewConversation: () => Promise<void>
  commitSwitchTo: (id: string) => Promise<void>
  handleSelectSession: (id: string) => Promise<void>
  handleBranchConversation: (msgIndex: number) => Promise<void>
  handleToggleStar: (id: string, starred: boolean) => Promise<void>
  handleRenameSession: (id: string, name: string) => Promise<void>
  handleDeleteSession: (id: string) => Promise<void>
  handleArchiveSession: (id: string) => Promise<void>
  // Project operations
  switchToProject: (projectPath: string) => Promise<boolean>
  handleToggleProjectStar: (projectPath: string, starred: boolean) => Promise<void>
  handleMoveProject: (projectPath: string, targetIndex: number) => Promise<void>
  // Activity navigation
  handleOpenAutomationSession: (projectPath: string, sessionId: string) => Promise<void>
  handleOpenActivitySession: (item: { sessionId?: string; projectPath?: string }) => Promise<void>
  // Archive confirmation
  archiveConfirm: { path: string; label: string; count: number } | null
  setArchiveConfirm: React.Dispatch<React.SetStateAction<{ path: string; label: string; count: number } | null>>
  handleArchiveProjectChats: (projectPath: string, count: number) => void
  // Preview state setter(由 App.tsx 持有 state,这里仅回传 setter 便于 wiring)
  setPreview: React.Dispatch<React.SetStateAction<Preview | null>>
}

export function useSessionManager(opts: UseSessionManagerOptions): UseSessionManagerReturn {
  const {
    preview,
    setPreview,
    getTurn,
    getSessionId,
    getWorkspace,
    getProjects,
    setView,
    setModelFallbackNotice,
    setSubmitError,
    setBranchingMsgIndex,
    setProjects,
    setSessions,
    dispatch,
    statusThrottleRef,
    fetchSessions,
    fetchProjects,
    fetchMcp,
    fetchMcpResources,
  } = opts

  // previewRef:闭包安全读取当前 preview(删除会话时判定是否命中当前预览)。
  // 删除会话的回调可能在几帧之后才被调用,那时闭包里的 preview 可能已过期,
  // 所以用一个 ref 跟踪最新值。
  const previewRef = useRef<Preview>(null)
  useEffect(() => { previewRef.current = preview }, [preview])

  // 批量归档确认状态 —— 本 hook 独占,只服务于 Dialog 流程。
  const [archiveConfirm, setArchiveConfirm] = useState<{ path: string; label: string; count: number } | null>(null)

  // 供 preview 落定 effect 使用的 turn/sessionId/workspace 最新值读取器。
  // 用 ref 包一层 getTurn 的当前值,避免 effect 依赖不稳定。
  const getTurnRef = useRef(getTurn)
  useEffect(() => { getTurnRef.current = getTurn }, [getTurn])

  // ── commitSwitchTo:完整切换到某会话(仅 idle 安全调用) ────────────────────
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
  }, [dispatch, fetchSessions, setModelFallbackNotice, statusThrottleRef])

  // ── handleNewConversation ────────────────────────────────────────────────
  const handleNewConversation = useCallback(async () => {
    if (getTurn() === 'running') { setPreview({ kind: 'new' }); setView('chat'); return }
    setView('chat')
    try {
      await window.wraith.startSession(getWorkspace())
      statusThrottleRef.current?.cancel()
      dispatch({ type: 'resetSession', ws: getWorkspace() })
      setModelFallbackNotice(false)
      setSubmitError(null)
      setPreview(null)
      void fetchSessions()
    } catch (err) {
      logger.error('wraith', 'newConversation error:', err)
    }
  }, [dispatch, fetchSessions, getTurn, getWorkspace, setModelFallbackNotice, setPreview, setSubmitError, setView, statusThrottleRef])

  // ── handleBranchConversation ─────────────────────────────────────────────
  const handleBranchConversation = useCallback(async (msgIndex: number) => {
    if (getTurn() === 'running') return
    const srcId = getSessionId()
    if (!srcId) return
    setBranchingMsgIndex(msgIndex)
    try {
      const { sessionId: newId } = await window.wraith.branchSession(srcId)
      await commitSwitchTo(newId)
    } catch (err) {
      logger.error('wraith', 'branchSession error:', err)
      setSubmitError(err instanceof Error ? err.message : '创建分支失败')
    } finally {
      setBranchingMsgIndex(null)
    }
  }, [commitSwitchTo, getSessionId, getTurn, setBranchingMsgIndex, setSubmitError])

  // ── handleSelectSession ─────────────────────────────────────────────────
  const handleSelectSession = useCallback(async (id: string) => {
    const act = selectAction(getTurn(), id, getSessionId())
    setView('chat')
    if (act.mode === 'preview-return') { setPreview(null); return }
    if (act.mode === 'preview-open') {
      try {
        const { messages, cards } = await window.wraith.peekSession(id)
        setPreview({ kind: 'session', sessionId: id, items: spliceCards(messagesToItems(messages), cards ?? []) })
      } catch (err) {
        logger.error('wraith', 'peekSession error:', err)
      }
      return
    }
    // full-switch(idle)
    try { setPreview(null); await commitSwitchTo(id) }
    catch (err) { logger.error('wraith', 'resumeSession error:', err) }
  }, [commitSwitchTo, getSessionId, getTurn, setPreview, setView])

  // ── handleRenameSession ─────────────────────────────────────────────────
  const handleRenameSession = useCallback(async (id: string, name: string) => {
    await window.wraith.renameSession(id, name)
    void fetchSessions()
  }, [fetchSessions])

  // ── handleDeleteSession ─────────────────────────────────────────────────
  const handleDeleteSession = useCallback(async (id: string) => {
    await window.wraith.deleteSession(id)
    if (id === getSessionId()) {
      await handleNewConversation()
    } else {
      void fetchSessions()
    }
    // 删除边界:删的是当前预览目标则回 live
    const pv = previewRef.current
    if (pv && pv.kind === 'session' && pv.sessionId === id) setPreview(null)
  }, [fetchSessions, getSessionId, handleNewConversation, setPreview])

  // ── handleArchiveSession ────────────────────────────────────────────────
  const handleArchiveSession = useCallback(async (sessionId: string) => {
    try {
      const { ok } = await window.wraith.setSessionArchived(sessionId, true)
      if (!ok) {
        logger.error('wraith', 'setSessionArchived returned ok:false for', sessionId)
        return
      }
      void fetchSessions()
    } catch (err) {
      logger.error('wraith', 'setSessionArchived error:', err)
    }
  }, [fetchSessions])

  // ── handleToggleStar(会话) ──────────────────────────────────────────────
  const handleToggleStar = useCallback(async (id: string, starred: boolean) => {
    await window.wraith.setSessionStarred(id, starred)
    void fetchSessions()
  }, [fetchSessions])

  // ── switchToProject ─────────────────────────────────────────────────────
  const switchToProject = useCallback(async (projectPath: string): Promise<boolean> => {
    if (getTurn() === 'running') return false
    try {
      const { ok } = await window.wraith.activateProject(projectPath)
      if (!ok) {
        void fetchProjects()
        return false
      }
      await window.wraith.startSession(projectPath)
      statusThrottleRef.current?.cancel()
      dispatch({ type: 'resetSession', ws: projectPath })
      setModelFallbackNotice(false)
      const { sessions } = await window.wraith.listSessions()
      setSessions(sessions)
      if (sessions.length > 0) {
        // session.list 按 updatedAt 倒序:第一条即最近会话
        const first = sessions[0]
        if (!first) return false
        const { sessionId, messages, model, modelFallback, cards } = await window.wraith.resumeSession(first.id)
        dispatch({ type: 'loadHistory', items: spliceCards(messagesToItems(messages), cards) })
        dispatch({ type: 'setSessionId', sessionId })
        dispatch({ type: 'markResumed' })
        if (model) {
          dispatch({ type: 'setModel', model })
        }
        if (modelFallback === true) {
          setModelFallbackNotice(true)
        }
      }
      try {
        const snap = await window.wraith.contextState()
        dispatch({ kind: 'notification', method: 'status', params: { status: snap } } as BackendEvent)
        dispatch({ kind: 'notification', method: 'context.snapshot', params: snap } as BackendEvent)
      } catch { /* 后端未就绪时静默 */ }
      void fetchProjects()
      void fetchMcp()
      void fetchMcpResources()
      return true
    } catch (err) {
      logger.error('wraith', 'switchToProject error:', err)
      void fetchProjects()
      return false
    }
  }, [dispatch, fetchMcp, fetchMcpResources, fetchProjects, getTurn, setModelFallbackNotice, setSessions, statusThrottleRef])

  // ── 项目面板:重点 / 排序 ────────────────────────────────────────────────
  const handleToggleProjectStar = useCallback(async (projectPath: string, starred: boolean) => {
    try {
      await window.wraith.setProjectStarred(projectPath, starred)
      void fetchProjects()
    } catch (err) {
      logger.error('wraith', 'setProjectStarred error:', err)
    }
  }, [fetchProjects])

  const handleMoveProject = useCallback(async (projectPath: string, targetIndex: number) => {
    try { await window.wraith.reorderProject(projectPath, targetIndex); await fetchProjects() }
    catch (err) { logger.error('wraith', 'reorderProject error:', err); await fetchProjects() }
  }, [fetchProjects])

  // ── 项目面板:批量归档某项目的聊天(破坏性,先确认) ────────────────────────
  const handleArchiveProjectChats = useCallback(async (projectPath: string, count: number) => {
    const projects = getProjects()
    const entry = projects.find(p => p.path === projectPath)
    const label = entry?.name || baseName(projectPath)
    setArchiveConfirm({ path: projectPath, label, count })
  }, [getProjects])

  // ── 运行历史:跳转到对应会话 ─────────────────────────────────────────────
  const handleOpenAutomationSession = useCallback(async (projectPath: string, sessionId: string) => {
    if (getTurn() === 'running') return
    setView('chat')
    if (projectPath !== getWorkspace()) {
      const ok = await switchToProject(projectPath)
      if (!ok) return
    }
    await handleSelectSession(sessionId)
  }, [getTurn, getWorkspace, handleSelectSession, setView, switchToProject])

  const handleOpenActivitySession = useCallback(async (item: { sessionId?: string; projectPath?: string }) => {
    if (!item.sessionId || getTurn() === 'running') return
    if (item.projectPath && item.projectPath !== getWorkspace()) {
      const ok = await switchToProject(item.projectPath)
      if (!ok) return
    }
    await handleSelectSession(item.sessionId)
  }, [getTurn, getWorkspace, handleSelectSession, switchToProject])

  // ── preview 落定 effect(完全等价于 App.tsx L653-658) ─────────────────────
  useEffect(() => {
    if (getTurnRef.current() !== 'idle' || preview === null) return
    const r = resolveOnIdle(preview)
    if (r.action === 'resume') { setPreview(null); void commitSwitchTo(r.sessionId) }
    else if (r.action === 'new') { void handleNewConversation() }
  }, [preview, commitSwitchTo, handleNewConversation, setPreview])

  return {
    handleNewConversation,
    commitSwitchTo,
    handleSelectSession,
    handleBranchConversation,
    handleToggleStar,
    handleRenameSession,
    handleDeleteSession,
    handleArchiveSession,
    switchToProject,
    handleToggleProjectStar,
    handleMoveProject,
    handleOpenAutomationSession,
    handleOpenActivitySession,
    archiveConfirm,
    setArchiveConfirm,
    handleArchiveProjectChats,
    setPreview,
  }
}

// 类型再导出,方便消费方(如 App.tsx、ActivityPanel)直接引用。
export type { ActivityItem, ProjectView, SessionMeta, Preview, BackendEvent }
