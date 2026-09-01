// desktop/src/renderer/lib/useImGateway.ts
// IM 网关全局状态 + IPC 调用 + 事件订阅。
//
// 负责:
//   - 网关 status/bind/logs 的单一数据源
//   - onGatewayEvent 订阅 + cleanup
//   - 所有 gateway* IPC 方法(QQ/飞书/企微/微信 共用)
//   - anyBound / boundByPlatform 汇总

import { useCallback, useEffect, useState } from 'react'
import { logger } from './logger'
import type { GatewayBindPhase, GatewayConfigView, GatewayStatus } from '../../shared/gateway'
import { applyBindEvent } from './imBind'

export interface UseImGatewayState {
  config: GatewayConfigView | null
  status: GatewayStatus
  bind: { phase: GatewayBindPhase; message?: string; qr?: string; url?: string } | null
  logs: string[]
  showLogs: boolean
  anyBound: boolean
  boundByPlatform: Record<string, boolean>
  hint: string | null
  selectedPlatform: string
}

export interface UseImGatewayActions {
  refreshConfig: () => Promise<void>
  refreshStatus: () => Promise<void>
  handleBind: () => void
  handleBindCancel: () => void
  handleSaveSecret: (secret: string) => Promise<boolean>
  handlePickWorkspace: () => Promise<void>
  handleSetWorkspace: (dir: string) => Promise<void>
  handleToggleDaemon: () => void
  handleShowLogs: () => Promise<void>
  handleRefreshLogs: () => Promise<void>
  handleSetFeishuConfig: (payload: Parameters<typeof window.wraith.gatewaySetFeishuConfig>[0]) => Promise<void>
  handleSetWecomConfig: (payload: Parameters<typeof window.wraith.gatewaySetWecomConfig>[0]) => Promise<void>
  handleBindWeixin: (workspace?: string) => void
  handleSetWeixinConfig: (payload: Parameters<typeof window.wraith.gatewaySetWeixinConfig>[0]) => Promise<void>
  setHint: (hint: string | null) => void
  setConfig: React.Dispatch<React.SetStateAction<GatewayConfigView | null>>
  setBind: React.Dispatch<React.SetStateAction<UseImGatewayState['bind']>>
  setLogs: React.Dispatch<React.SetStateAction<string[]>>
  setShowLogs: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedPlatform: React.Dispatch<React.SetStateAction<string>>
}

export function useImGateway(initialPlatform: string): UseImGatewayState & UseImGatewayActions {
  const [config, setConfig] = useState<GatewayConfigView | null>(null)
  const [status, setStatus] = useState<GatewayStatus>({ state: 'stopped' })
  const [bind, setBind] = useState<{ phase: GatewayBindPhase; message?: string; qr?: string; url?: string } | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [anyBound, setAnyBound] = useState(false)
  const [boundByPlatform, setBoundByPlatform] = useState<Record<string, boolean>>({})
  const [hint, setHint] = useState<string | null>(null)
  const [selectedPlatform, setSelectedPlatform] = useState(initialPlatform)

  const refreshConfig = useCallback(async () => {
    setConfig(null)
    try {
      const cfg = await window.wraith.gatewayGetConfig(selectedPlatform)
      setConfig(cfg)
    } catch (err) {
      logger.error('wraith', 'gatewayGetConfig error:', err)
    }
    // 网关是全局进程:汇总所有平台绑定态,决定「启动网关」是否可点(与当前选中平台无关)。
    try {
      const [qq, fs, wc, wx] = await Promise.all([
        window.wraith.gatewayGetConfig('qq'),
        window.wraith.gatewayGetConfig('feishu'),
        window.wraith.gatewayGetConfig('wecom'),
        window.wraith.gatewayGetConfig('weixin'),
      ])
      setAnyBound(!!qq?.bound || !!fs?.bound || !!wc?.bound || !!wx?.bound)
      setBoundByPlatform({ qq: !!qq?.bound, feishu: !!fs?.bound, wecom: !!wc?.bound, weixin: !!wx?.bound })
    } catch {
      /* 忽略:失败则按钮保持禁用 */
    }
  }, [selectedPlatform])

  const refreshStatus = useCallback(async () => {
    try { setStatus(await window.wraith.gatewayStatus()) }
    catch (err) { logger.error('wraith', 'gatewayStatus error:', err) }
  }, [])

  // 事件订阅 + 初始拉取
  useEffect(() => {
    void refreshConfig()
    void refreshStatus()
    const unsub = window.wraith.onGatewayEvent(evt => {
      if (evt.kind === 'status') setStatus(evt.status)
      else if (evt.kind === 'bind') {
        setBind(prev => applyBindEvent(prev, evt))
        if (evt.phase === 'bound' || evt.phase === 'secret-invalid') void refreshConfig()
      }
    })
    return () => { unsub() }
  }, [refreshConfig, refreshStatus])

  // 微信扫码绑定期间,若用户展开了日志则每 2s 刷新
  useEffect(() => {
    if (selectedPlatform !== 'weixin' || bind?.phase !== 'scanning' || !showLogs) return
    const t = setInterval(async () => {
      try { const { lines } = await window.wraith.gatewayLogs(); setLogs(lines) }
      catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(t)
  }, [selectedPlatform, bind?.phase, showLogs])

  const handleBind = useCallback(() => {
    setBind({ phase: 'scanning' })
    void window.wraith.gatewayBindStart()
  }, [])

  const handleBindCancel = useCallback(() => {
    void window.wraith.gatewayBindCancel()
  }, [])

  const handleSaveSecret = useCallback(async (secret: string): Promise<boolean> => {
    const s = secret.trim()
    if (!s) return false
    try {
      await window.wraith.gatewaySetSecret(s)
      setHint('机器人密钥已保存')
      setBind(null)
      await refreshConfig()
      return true
    } catch (err) {
      setHint('保存失败: ' + (err as Error).message)
      return false
    }
  }, [refreshConfig])

  const handlePickWorkspace = useCallback(async () => {
    const dir = await window.wraith.gatewayPickWorkspace()
    if (dir) {
      await window.wraith.gatewaySetWorkspace(dir)
      await refreshConfig()
      setHint('工作目录已更新')
    }
  }, [refreshConfig])

  const handleSetWorkspace = useCallback(async (dir: string) => {
    await window.wraith.gatewaySetWorkspace(dir)
    await refreshConfig()
    setHint('工作目录已更新')
  }, [refreshConfig])

  const handleToggleDaemon = useCallback(() => {
    if (status.state === 'running' || status.state === 'starting') void window.wraith.gatewayStop()
    else void window.wraith.gatewayStart()
  }, [status.state])

  const handleRefreshLogs = useCallback(async () => {
    try { const { lines } = await window.wraith.gatewayLogs(); setLogs(lines) }
    catch (err) { logger.error('wraith', 'gatewayLogs error:', err) }
  }, [])

  const handleShowLogs = useCallback(async () => {
    const next = !showLogs
    setShowLogs(next)
    if (next) await handleRefreshLogs()
  }, [showLogs, handleRefreshLogs])

  const handleSetFeishuConfig = useCallback(async (payload: Parameters<typeof window.wraith.gatewaySetFeishuConfig>[0]) => {
    await window.wraith.gatewaySetFeishuConfig(payload)
    await refreshConfig()
  }, [refreshConfig])

  const handleSetWecomConfig = useCallback(async (payload: Parameters<typeof window.wraith.gatewaySetWecomConfig>[0]) => {
    await window.wraith.gatewaySetWecomConfig(payload)
    await refreshConfig()
  }, [refreshConfig])

  const handleBindWeixin = useCallback((workspace?: string) => {
    setBind({ phase: 'scanning' })
    void window.wraith.gatewayBindWeixinStart(workspace)
  }, [])

  const handleSetWeixinConfig = useCallback(async (payload: Parameters<typeof window.wraith.gatewaySetWeixinConfig>[0]) => {
    await window.wraith.gatewaySetWeixinConfig(payload)
    await refreshConfig()
  }, [refreshConfig])

  return {
    // state
    config, status, bind, logs, showLogs, anyBound, boundByPlatform, hint,
    // actions
    refreshConfig, refreshStatus,
    handleBind, handleBindCancel, handleSaveSecret,
    handlePickWorkspace, handleSetWorkspace, handleToggleDaemon,
    handleShowLogs, handleRefreshLogs,
    handleSetFeishuConfig, handleSetWecomConfig,
    handleBindWeixin, handleSetWeixinConfig,
    setHint, setConfig, setBind, setLogs, setShowLogs,
    selectedPlatform, setSelectedPlatform,
  }
}
