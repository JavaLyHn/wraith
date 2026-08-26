import { useState } from 'react'
import type { RightPreview } from '../../shared/artifactSummary'
import type { RightDockPane } from '../components/RightDock'

/**
 * 右侧预览面板状态 hook:集中管理 RightDock 的开关、标签页和预览内容。
 */
export function useRightDockPreview() {
  const [rightDockOpen, setRightDockOpen] = useState(false)
  const [rightDockPane, setRightDockPane] = useState<RightDockPane>('browser')
  const [rightPreview, setRightPreview] = useState<RightPreview | null>(null)

  return {
    rightDockOpen, setRightDockOpen,
    rightDockPane, setRightDockPane,
    rightPreview, setRightPreview,
  }
}
