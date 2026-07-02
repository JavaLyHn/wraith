import { contextBridge, ipcRenderer } from 'electron'
import type { BackendEvent, SessionMeta, ResumedMessage } from '../shared/types'

/**
 * WraithApi — typed bridge exposed to the renderer as window.wraith.
 * All methods proxy to ipcMain handlers via ipcRenderer.invoke.
 * onEvent subscribes to server-push notifications forwarded from Main.
 * contextIsolation remains true; renderer has no Node access.
 */
export interface WraithApi {
  initialize(workspaceDir: string | null): Promise<unknown>
  startSession(workspaceDir: string | null): Promise<{ sessionId: string }>
  submitTurn(input: string): Promise<{ turnId: string; status: string }>
  respondApproval(
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED' | 'MODIFIED' | 'APPROVED_ALL',
    opts?: { modifiedArgs?: string; allowNetwork?: boolean }
  ): Promise<void>
  interrupt(): Promise<void>
  getInitialWorkspace(): Promise<string | null>
  pickWorkspace(): Promise<string | null>
  restartBackend(): Promise<void>
  setApprovalMode(auto: boolean): Promise<{ ok: boolean }>
  listSessions(): Promise<{ sessions: SessionMeta[] }>
  resumeSession(sessionId: string): Promise<{ sessionId: string; messages: ResumedMessage[] }>
  onEvent(cb: (evt: BackendEvent) => void): () => void
}

const wraith: WraithApi = {
  initialize(workspaceDir) {
    return ipcRenderer.invoke('wraith:initialize', workspaceDir)
  },

  startSession(workspaceDir) {
    return ipcRenderer.invoke('wraith:startSession', workspaceDir)
  },

  submitTurn(input) {
    return ipcRenderer.invoke('wraith:submitTurn', input)
  },

  respondApproval(approvalId, decision, opts) {
    return ipcRenderer.invoke('wraith:respondApproval', approvalId, decision, opts ?? null)
  },

  interrupt() {
    return ipcRenderer.invoke('wraith:interrupt')
  },

  getInitialWorkspace() {
    return ipcRenderer.invoke('wraith:getInitialWorkspace')
  },

  pickWorkspace() {
    return ipcRenderer.invoke('wraith:pickWorkspace')
  },

  restartBackend() {
    return ipcRenderer.invoke('wraith:restartBackend')
  },

  setApprovalMode(auto) {
    return ipcRenderer.invoke('wraith:setApprovalMode', auto) as Promise<{ ok: boolean }>
  },

  listSessions() {
    return ipcRenderer.invoke('wraith:listSessions') as Promise<{ sessions: SessionMeta[] }>
  },

  resumeSession(sessionId) {
    return ipcRenderer.invoke('wraith:resumeSession', sessionId) as Promise<{
      sessionId: string
      messages: ResumedMessage[]
    }>
  },

  onEvent(cb) {
    const listener = (_event: Electron.IpcRendererEvent, evt: BackendEvent) =>
      cb(evt)
    ipcRenderer.on('wraith:event', listener)
    return () => {
      ipcRenderer.removeListener('wraith:event', listener)
    }
  }
}

contextBridge.exposeInMainWorld('wraith', wraith)
