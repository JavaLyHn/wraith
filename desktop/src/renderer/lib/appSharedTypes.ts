import type { BackendEvent, RunMode } from '../../shared/types'
import type { RightPreview, ArtifactFile } from '../../shared/artifactSummary'
import type { EditorApp } from '../../shared/editors'
import type { Preview } from '../../shared/sessionPreview'
import type { Item } from '../../shared/transcriptReducer'
import type { PanelId } from './panelActions'
import type { GatewayState } from '../../shared/gateway'
import type { RenderNode } from './groupToolRuns'

// 共享类型:供 hooks 和组件之间传递 props 用

export interface TranscriptRenderProps {
  items: Item[]
  busy: boolean
  mode: RunMode
  editors: EditorApp[]
  workspace: string | null
  onEditMessage: (ordinal: number, newText: string) => void
  onDeleteMessage: (ordinal: number) => void
  onResendMessage: (ordinal: number, text: string) => void
  onPlanReview: (reviewId: string, decision: 'execute' | 'supplement' | 'cancel', feedback?: string) => void
  onOpenArtifact?: (filePath: string, content: string) => void
  onOpenDiff?: (filePath: string, before: string, after: string) => void
  onUndo?: (file: ArtifactFile) => Promise<{ ok: boolean; message?: string }>
  onOpenPanel: (id: PanelId) => void
  onImBound?: (platform: string, gatewayState: GatewayState | null) => void
  onBranch?: (msgIndex: number) => void
  branchingMsgIndex?: number | null
}
