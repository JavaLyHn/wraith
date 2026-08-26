import { useState } from 'react'
import type { RunMode } from '../../shared/types'

type ViewName = 'chat' | 'projects' | 'plugins' | 'automations' | 'im-gateway' | 'providers' | 'skills' | 'memory' | 'snapshots' | 'policy' | 'browser' | 'rag' | 'tasks' | 'documents' | 'activity' | 'settings'

/**
 * App 级 UI 状态集合 hook:集中管理分散的 useState 声明。
 *
 * 包括:view 路由、Banner 状态、分支标记、运行模式、聚焦计数等。
 */
export function useAppUiState() {
  const [view, setView] = useState<ViewName>('chat')
  const [automationBadge, setAutomationBadge] = useState(false)
  const [modelFallbackNotice, setModelFallbackNotice] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [branchingMsgIndex, setBranchingMsgIndex] = useState<number | null>(null)
  const [updateNotice, setUpdateNotice] = useState<{ latest: string; url: string } | null>(null)
  const [pendingMode, setPendingMode] = useState<RunMode>('react')
  const [composerFocus, setComposerFocus] = useState(0)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [noModel, setNoModel] = useState(false)

  return {
    view, setView,
    automationBadge, setAutomationBadge,
    modelFallbackNotice, setModelFallbackNotice,
    submitError, setSubmitError,
    branchingMsgIndex, setBranchingMsgIndex,
    updateNotice, setUpdateNotice,
    pendingMode, setPendingMode,
    composerFocus, setComposerFocus,
    terminalOpen, setTerminalOpen,
    paletteOpen, setPaletteOpen,
    noModel, setNoModel,
  }
}

export type { ViewName }
