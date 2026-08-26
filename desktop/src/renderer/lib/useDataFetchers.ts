import { useCallback, useState } from 'react'
import type { McpServerView, McpResourceView, ProjectView, GitStatusView } from '../../shared/types'

export interface UseDataFetchersReturn {
  projects: ProjectView[]
  setProjects: React.Dispatch<React.SetStateAction<ProjectView[]>>
  mcpServers: McpServerView[]
  setMcpServers: React.Dispatch<React.SetStateAction<McpServerView[]>>
  mcpConfigError: string | null
  setMcpConfigError: React.Dispatch<React.SetStateAction<string | null>>
  mcpResources: McpResourceView[]
  setMcpResources: React.Dispatch<React.SetStateAction<McpResourceView[]>>
  gitStatus: GitStatusView | null
  setGitStatus: React.Dispatch<React.SetStateAction<GitStatusView | null>>
  fetchProjects: () => Promise<void>
  fetchMcp: () => Promise<void>
  fetchMcpResources: () => Promise<void>
  fetchGitStatus: () => Promise<void>
}

export function useDataFetchers(): UseDataFetchersReturn {
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerView[]>([])
  const [mcpConfigError, setMcpConfigError] = useState<string | null>(null)
  const [mcpResources, setMcpResources] = useState<McpResourceView[]>([])
  const [gitStatus, setGitStatus] = useState<GitStatusView | null>(null)

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

  const fetchMcpResources = useCallback(async () => {
    try {
      const { resources } = await window.wraith.mcpResources()
      setMcpResources(resources)
    } catch (err) {
      console.error('[wraith] mcpResources error:', err)
    }
  }, [])

  const fetchGitStatus = useCallback(async (): Promise<void> => {
    try {
      setGitStatus(await window.wraith.gitStatus())
    } catch (e) {
      setGitStatus(prev => (prev ? { ...prev, error: String(e) } : null))
    }
  }, [])

  return {
    projects, setProjects,
    mcpServers, setMcpServers,
    mcpConfigError, setMcpConfigError,
    mcpResources, setMcpResources,
    gitStatus, setGitStatus,
    fetchProjects, fetchMcp, fetchMcpResources, fetchGitStatus,
  }
}