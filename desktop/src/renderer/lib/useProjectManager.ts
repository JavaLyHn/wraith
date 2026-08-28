import { useCallback } from 'react'
import { logger } from './logger'

export interface UseProjectManagerOptions {
  getTurn: () => 'idle' | 'running'
  getWorkspace: () => string | null
  setView: (v: string) => void
  fetchProjects: () => Promise<void>
  switchToProject: (projectPath: string) => Promise<boolean>
  handleNewConversation: () => Promise<void>
  handleSelectSession: (id: string) => Promise<void>
}

export interface UseProjectManagerReturn {
  handleAddProject: () => Promise<void>
  handleRemoveProject: (projectPath: string) => Promise<void>
  handleRenameProject: (projectPath: string, name: string) => Promise<void>
  handleOpenProject: (projectPath: string) => Promise<void>
  handleProjectNewConversation: (projectPath: string) => Promise<void>
  handleOpenProjectSession: (projectPath: string, sessionId: string) => Promise<void>
}

export function useProjectManager(
  opts: UseProjectManagerOptions,
): UseProjectManagerReturn {
  const { getTurn, getWorkspace, setView, fetchProjects, switchToProject, handleNewConversation, handleSelectSession } = opts

  const handleAddProject = useCallback(async () => {
    if (getTurn() === 'running') return
    try {
      const picked = await window.wraith.addProject()
      if (!picked) return
      void fetchProjects()
      if (picked !== getWorkspace()) await switchToProject(picked)
    } catch (err) {
      logger.error('wraith', 'addProject error:', err)
    }
  }, [getTurn, getWorkspace, fetchProjects, switchToProject])

  const handleRemoveProject = useCallback(
    async (projectPath: string) => {
      try {
        await window.wraith.removeProject(projectPath)
        void fetchProjects()
      } catch (err) {
        logger.error('wraith', 'removeProject error:', err)
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
        logger.error('wraith', 'renameProject error:', err)
      }
    },
    [fetchProjects],
  )

  const handleOpenProject = useCallback(async (projectPath: string) => {
    if (getTurn() === 'running') return
    const ok = projectPath === getWorkspace() ? true : await switchToProject(projectPath)
    if (ok) setView('chat')
  }, [getTurn, getWorkspace, switchToProject, setView])

  const handleProjectNewConversation = useCallback(async (projectPath: string) => {
    if (getTurn() === 'running') return
    if (projectPath !== getWorkspace()) {
      const ok = await switchToProject(projectPath)
      if (!ok) return
    }
    setView('chat')
    await handleNewConversation()
  }, [getTurn, getWorkspace, switchToProject, setView, handleNewConversation])

  const handleOpenProjectSession = useCallback(async (projectPath: string, sessionId: string) => {
    if (getTurn() === 'running') return
    if (projectPath !== getWorkspace()) {
      const ok = await switchToProject(projectPath)
      if (!ok) return
    }
    setView('chat')
    await handleSelectSession(sessionId)
  }, [getTurn, getWorkspace, switchToProject, setView, handleSelectSession])

  return { handleAddProject, handleRemoveProject, handleRenameProject, handleOpenProject, handleProjectNewConversation, handleOpenProjectSession }
}