import { useCallback } from 'react'
import type { McpFormValue } from '../../shared/mcpFormValue'

export interface UseMcpManagerOptions {
  fetchMcp: () => Promise<void>
}

export interface UseMcpManagerReturn {
  handleMcpToggle: (name: string, enable: boolean) => Promise<void>
  handleMcpRestart: (name: string) => Promise<void>
  handleMcpRemove: (scope: 'user' | 'project', name: string) => Promise<void>
  handleMcpSubmitForm: (v: McpFormValue) => Promise<boolean>
}

export function useMcpManager(
  opts: UseMcpManagerOptions,
): UseMcpManagerReturn {
  const { fetchMcp } = opts

  const handleMcpToggle = useCallback(async (name: string, enable: boolean) => {
    try { await (enable ? window.wraith.mcpEnable(name) : window.wraith.mcpDisable(name)); void fetchMcp() }
    catch (err) { console.error('[wraith] mcp toggle error:', err) }
  }, [fetchMcp])

  const handleMcpRestart = useCallback(async (name: string) => {
    try { await window.wraith.mcpRestart(name); void fetchMcp() }
    catch (err) { console.error('[wraith] mcp restart error:', err) }
  }, [fetchMcp])

  const handleMcpRemove = useCallback(async (scope: 'user' | 'project', name: string) => {
    try { await window.wraith.mcpConfigRemove(scope, name); void fetchMcp() }
    catch (err) { console.error('[wraith] mcp remove error:', err) }
  }, [fetchMcp])

  const handleMcpSubmitForm = useCallback(async (v: McpFormValue): Promise<boolean> => {
    try { await window.wraith.mcpConfigUpsert(v); void fetchMcp(); return true }
    catch (err) { console.error('[wraith] mcp upsert error:', err); return false }
  }, [fetchMcp])

  return { handleMcpToggle, handleMcpRestart, handleMcpRemove, handleMcpSubmitForm }
}