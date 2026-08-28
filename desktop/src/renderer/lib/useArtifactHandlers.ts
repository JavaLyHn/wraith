import { useCallback } from 'react'
import { resolveWorkspacePath } from './paths'
import type { ArtifactFile, RightPreview } from '../../shared/artifactSummary'

/**
 * 产物预览/撤销 hook:封装 openArtifact/openDiff/handleUndo 回调。
 */
export function useArtifactHandlers(params: {
  workspace: string | null
  onRequestPreview: (preview: RightPreview | null) => void
  onDockPaneChange: (pane: 'artifact') => void
  onDockOpen: (open: boolean) => void
}) {
  const { workspace, onRequestPreview, onDockPaneChange, onDockOpen } = params

  const openArtifact = useCallback((filePath: string, content: string): void => {
    onRequestPreview({ kind: 'content', filePath, content })
    onDockPaneChange('artifact')
    onDockOpen(true)
  }, [onRequestPreview, onDockPaneChange, onDockOpen])

  const openDiff = useCallback((filePath: string, before: string, after: string): void => {
    onRequestPreview({ kind: 'diff', filePath, before, after })
    onDockPaneChange('artifact')
    onDockOpen(true)
  }, [onRequestPreview, onDockPaneChange, onDockOpen])

  const handleUndo = useCallback(async (file: ArtifactFile): Promise<{ ok: boolean; message?: string }> => {
    const abs = resolveWorkspacePath(file.path, workspace ?? null)
    try {
      return await window.wraith.undoFileEdit({ path: abs, before: file.before ?? '', kind: file.kind })
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }, [workspace])

  return { openArtifact, openDiff, handleUndo }
}
