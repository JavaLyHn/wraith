import { useCallback, useEffect, useRef } from 'react'
import { logger } from './logger'
import type { BackendEvent, SandboxKindWire, SandboxState as SandboxStateWire } from '../../shared/types'
import { messagesToItems } from '../../shared/messagesToItems'
import { spliceCards } from '../../shared/spliceCards'
import { needsModelSetup } from './modelReady'

/**
 * Sandbox 种类归一化:后端可能返回未知字符串,前端一律折叠到 4 态枚举。
 * - 'none' / 'macos-seatbelt' / 'windows-appcontainer' 直接透传
 * - 其他(含 undefined)一律 'unknown' —— 灰盾「状态未知」而非红盾「未启用」
 */
export function normalizeSandbox(sb: string | undefined): SandboxKindWire {
  if (sb === 'none') return 'none'
  if (sb === 'macos-seatbelt') return 'macos-seatbelt'
  if (sb === 'windows-appcontainer') return 'windows-appcontainer'
  return 'unknown'
}

export interface UseStartupOptions {
  /** transcript reducer dispatch(接受 LocalAction + BackendEvent)。 */
  dispatch: (action: { type: string; [key: string]: unknown } | BackendEvent) => void
  setModelFallbackNotice: (v: boolean) => void
  setNoModel: (v: boolean) => void
  setUpdateNotice: (v: { latest: string; url: string } | null) => void
  statusThrottleRef: React.MutableRefObject<{ cancel: () => void } | null>

  // ── 拉取 helper ──
  fetchSessions: () => Promise<void>
  fetchProjects: () => Promise<void>
  fetchMcp: () => Promise<void>
  fetchMcpResources: () => Promise<void>
  fetchGitStatus: () => Promise<void>

  // ── 状态值(直接传入,用作 effect 依赖) ──
  connection: string
  workspace: string | null
  // sessionId 用 getter,在 effect 体内读取
  getSessionId: () => string

  // ── 应用偏好 ──
  autoCheck: boolean
  beta: boolean

  // ── 可选回调 ──
  onModelReady?: (model: string) => void
  onModelFallback?: (fallback: boolean) => void
}

export interface UseStartupReturn {
  applySandbox: (s: SandboxStateWire | null | undefined) => void
  refreshSandbox: () => Promise<void>
}

/**
 * startup / reconnect / sandbox / auto-update 流程的封装 hook。
 *
 * 从 App.tsx 中抽离以下职责:
 *  - applySandbox / refreshSandbox(沙箱状态管理)
 *  - startup useEffect(一次性初始化 + 数据拉取)
 *  - reconnect useEffect(disconnected→connected 后重连会话)
 *  - auto-update check(启动时检查更新)
 *
 * 设计要点:
 *  - startedRef / reconnectRef 均为 hook 内部 useRef,生命周期与组件一致。
 *  - connection / workspace 以原始字符串形式传入,用作 effect 依赖;
 *    sessionId 以 getter 形式传入,仅在 effect 体内读取,不作为依赖。
 *  - fetch* 函数由 App.tsx 注入,保持稳定引用,不会误触 effect 重跑。
 */
export function useStartup(opts: UseStartupOptions): UseStartupReturn {
  const {
    dispatch,
    setNoModel,
    setUpdateNotice,
    fetchSessions,
    fetchProjects,
    fetchMcp,
    fetchMcpResources,
    fetchGitStatus,
    connection,
    workspace,
    getSessionId,
    autoCheck,
    beta,
    onModelReady,
  } = opts

  // ── applySandbox:把 SandboxState 写入 transcript reducer ──────────────
  const applySandbox = useCallback((s: SandboxStateWire | null | undefined): void => {
    if (!s) return
    dispatch({
      type: 'setSandbox',
      sandbox: normalizeSandbox(s.kind),
      networkAllowed: s.networkAllowed === true,
    })
  }, [dispatch])

  // ── refreshSandbox:调用 sandbox.get 并 apply ────────────────────────────
  const refreshSandbox = useCallback(async (): Promise<void> => {
    try { applySandbox(await window.wraith.sandboxGet()) } catch { /* 后端未就绪时静默 */ }
  }, [applySandbox])

  // ── startup flow(仅执行一次) ──────────────────────────────────────────
  const startedRef = useRef(false)
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
          onModelReady?.(initObj.model)
        }
        // 先用 initialize 播种种类(免得盾先闪一下「未知」);联网位要等会话起来后问 sandbox.get。
        dispatch({
          type: 'setSandbox',
          sandbox: normalizeSandbox(initObj.capabilities?.sandbox),
          networkAllowed: false,
        })
        // 全新装机:后端以「无模型」状态起来了(能配置、发不出对话)。
        setNoModel(needsModelSetup({ modelConfigured: initObj.capabilities?.modelConfigured }))
        await window.wraith.startSession(ws)
        try {
          const snap = await window.wraith.contextState()
          dispatch({ kind: 'notification', method: 'status', params: { status: snap } } as BackendEvent)
          dispatch({ kind: 'notification', method: 'context.snapshot', params: snap } as BackendEvent)
        } catch { /* 后端未就绪时静默 */ }
        void refreshSandbox()
        void fetchGitStatus()   // 会话起来后取一次,顶栏 pill 能在首条消息前就显示
        void fetchSessions()
        void fetchProjects()
        void fetchMcp()
        void fetchMcpResources()
      } catch (err) {
        logger.error('wraith', 'startup error:', err)
      }
    })()
  }, [dispatch, fetchSessions, fetchProjects, fetchMcp, fetchMcpResources, refreshSandbox, fetchGitStatus, setNoModel, onModelReady])

  // ── auto-update check(仅启动一次) ───────────────────────────────────────
  useEffect(() => {
    if (!autoCheck) return
    void window.wraith.checkUpdate(beta)
      .then((r) => { if (r.hasUpdate && r.latest && r.url) setUpdateNotice({ latest: r.latest, url: r.url }) })
      .catch(() => {})
  }, [autoCheck, beta, setUpdateNotice])

  // ── reconnect effect:disconnected→connected 后重连会话 ──────────────────
  const reconnectRef = useRef(false)
  useEffect(() => {
    if (connection === 'disconnected') {
      reconnectRef.current = true
      return
    }
    // connected
    if (!reconnectRef.current) return // first connect is handled by startup effect
    reconnectRef.current = false
    const activeId = getSessionId()
    void (async () => {
      try {
        const init = await window.wraith.initialize(workspace)
        const sb = (init as { capabilities?: { sandbox?: string } }).capabilities?.sandbox
        dispatch({ type: 'setSandbox', sandbox: normalizeSandbox(sb), networkAllowed: false })
        await window.wraith.startSession(workspace)
        void refreshSandbox()   // 重连后后端是全新进程,联网位回到默认值,必须重新问
        void fetchGitStatus()    // 重连后 git 状态也需重取
        if (activeId) {
          const { messages, model, cards } = await window.wraith.resumeSession(activeId)
          dispatch({ type: 'loadHistory', items: spliceCards(messagesToItems(messages), cards) })
          if (model) {
            dispatch({ type: 'setModel', model })
            onModelReady?.(model)
          }
        }
        try {
          const snap = await window.wraith.contextState()
          dispatch({ kind: 'notification', method: 'status', params: { status: snap } } as BackendEvent)
          dispatch({ kind: 'notification', method: 'context.snapshot', params: snap } as BackendEvent)
        } catch { /* 后端未就绪时静默 */ }
        void fetchSessions()
      } catch (err) {
        logger.error('wraith', 'reconnect error:', err)
      }
    })()
  }, [connection, workspace, fetchSessions, refreshSandbox, fetchGitStatus, dispatch, getSessionId, onModelReady])

  return { applySandbox, refreshSandbox }
}