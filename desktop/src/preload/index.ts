import { contextBridge, ipcRenderer } from 'electron'
import type { BackendEvent, SessionMeta, ResumedMessage, ProjectView, McpListResult, McpResourceView, McpUpsertPayload, AutomationTask, AutomationRun, AutomationEvent, ModelListResult } from '../shared/types'
import type { GatewayConfigView, GatewayEvent, GatewayStatus } from '../shared/gateway'

/**
 * WraithApi — typed bridge exposed to the renderer as window.wraith.
 * All methods proxy to ipcMain handlers via ipcRenderer.invoke.
 * onEvent subscribes to server-push notifications forwarded from Main.
 * contextIsolation remains true; renderer has no Node access.
 */
export interface WraithApi {
  initialize(workspaceDir: string | null): Promise<unknown>
  startSession(workspaceDir: string | null): Promise<{ sessionId: string }>
  submitTurn(input: string, attachments?: { path: string; kind: string }[]): Promise<{ turnId: string; status: string }>
  pickAttachments(): Promise<{ path: string; name: string; kind: string }[]>
  respondApproval(
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED' | 'MODIFIED' | 'APPROVED_ALL',
    opts?: { modifiedArgs?: string; allowNetwork?: boolean }
  ): Promise<void>
  interrupt(): Promise<void>
  getInitialWorkspace(): Promise<string | null>
  listProjects(): Promise<{ projects: ProjectView[] }>
  activateProject(path: string): Promise<{ ok: boolean }>
  addProject(): Promise<string | null>
  removeProject(path: string): Promise<void>
  renameProject(path: string, name: string): Promise<void>
  restartBackend(): Promise<void>
  setApprovalMode(auto: boolean): Promise<{ ok: boolean }>
  listSessions(): Promise<{ sessions: SessionMeta[] }>
  resumeSession(sessionId: string): Promise<{ sessionId: string; messages: ResumedMessage[]; provider?: string; model?: string; modelFallback?: boolean }>
  rewindSession(userOrdinal: number): Promise<{ ok: boolean }>
  mcpList(): Promise<McpListResult>
  mcpEnable(name: string): Promise<{ ok: boolean }>
  mcpDisable(name: string): Promise<{ ok: boolean }>
  mcpRestart(name: string): Promise<{ ok: boolean }>
  mcpLogs(name: string): Promise<{ lines: string }>
  mcpResources(name?: string): Promise<{ resources: McpResourceView[] }>
  mcpPrompts(name: string): Promise<{ text: string }>
  mcpConfigUpsert(payload: McpUpsertPayload): Promise<{ ok: boolean }>
  mcpConfigRemove(scope: 'user' | 'project', name: string): Promise<{ ok: boolean }>
  onEvent(cb: (evt: BackendEvent) => void): () => void
  automationList(): Promise<{ tasks: AutomationTask[] }>
  automationUpsert(task: AutomationTask): Promise<{ ok: boolean }>
  automationRemove(id: string): Promise<{ ok: boolean }>
  automationRunNow(id: string): Promise<{ ok: boolean }>
  // v1: 定时任务为进程内回合,不可中断 — UI 层不再暴露 STOP 按钮;此方法仅保留为存根。
  automationStop(runId: string): Promise<{ ok: boolean }>
  automationRuns(): Promise<{ runs: AutomationRun[] }>
  /** Fix-B: aligned to Fix-A contract — forwards { approvalId, decision } */
  automationRespondApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<{ ok: boolean }>
  automationPanelOpened(): Promise<{ ok: boolean }>
  onAutomationEvent(cb: (evt: AutomationEvent) => void): () => void
  /** Task 16: 守护进程路由的 CRUD(plural 前缀,channel 对应 wraith:automations*) */
  automationsList(): Promise<{ tasks: AutomationTask[] }>
  automationsUpsert(task: AutomationTask): Promise<{ ok: boolean }>
  automationsRemove(id: string): Promise<{ ok: boolean }>
  automationsRuns(taskId?: string): Promise<{ runs: AutomationRun[] }>
  modelList(): Promise<ModelListResult>
  setModel(provider: string): Promise<{ provider: string; model: string }>
  setDefaultProvider(provider: string): Promise<{ ok: boolean }>
  gatewayGetConfig(): Promise<GatewayConfigView>
  gatewaySetSecret(secret: string): Promise<{ ok: boolean }>
  gatewaySetWorkspace(workspace: string): Promise<{ ok: boolean }>
  gatewayPickWorkspace(): Promise<string | null>
  gatewayStart(): Promise<{ ok: boolean }>
  gatewayStop(): Promise<{ ok: boolean }>
  gatewayRestart(): Promise<{ ok: boolean }>
  gatewayStatus(): Promise<GatewayStatus>
  gatewayLogs(): Promise<{ lines: string[] }>
  gatewayBindStart(): Promise<{ ok: boolean }>
  gatewayBindCancel(): Promise<{ ok: boolean }>
  onGatewayEvent(cb: (evt: GatewayEvent) => void): () => void
}

const wraith: WraithApi = {
  initialize(workspaceDir) {
    return ipcRenderer.invoke('wraith:initialize', workspaceDir)
  },

  startSession(workspaceDir) {
    return ipcRenderer.invoke('wraith:startSession', workspaceDir)
  },

  submitTurn(input, attachments) {
    return ipcRenderer.invoke('wraith:submitTurn', input, attachments)
  },

  pickAttachments() {
    return ipcRenderer.invoke('wraith:pickAttachments') as Promise<{ path: string; name: string; kind: string }[]>
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

  listProjects() {
    return ipcRenderer.invoke('wraith:listProjects') as Promise<{ projects: ProjectView[] }>
  },

  activateProject(path) {
    return ipcRenderer.invoke('wraith:activateProject', path) as Promise<{ ok: boolean }>
  },

  addProject() {
    return ipcRenderer.invoke('wraith:addProject') as Promise<string | null>
  },

  removeProject(path) {
    return ipcRenderer.invoke('wraith:removeProject', path) as Promise<void>
  },

  renameProject(path, name) {
    return ipcRenderer.invoke('wraith:renameProject', path, name) as Promise<void>
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
      provider?: string
      model?: string
      modelFallback?: boolean
    }>
  },

  rewindSession(userOrdinal) {
    return ipcRenderer.invoke('wraith:rewindSession', userOrdinal) as Promise<{ ok: boolean }>
  },

  mcpList() {
    return ipcRenderer.invoke('wraith:mcpList') as Promise<McpListResult>
  },

  mcpEnable(name) {
    return ipcRenderer.invoke('wraith:mcpEnable', name) as Promise<{ ok: boolean }>
  },

  mcpDisable(name) {
    return ipcRenderer.invoke('wraith:mcpDisable', name) as Promise<{ ok: boolean }>
  },

  mcpRestart(name) {
    return ipcRenderer.invoke('wraith:mcpRestart', name) as Promise<{ ok: boolean }>
  },

  mcpLogs(name) {
    return ipcRenderer.invoke('wraith:mcpLogs', name) as Promise<{ lines: string }>
  },

  mcpResources(name) {
    return ipcRenderer.invoke('wraith:mcpResources', name) as Promise<{ resources: McpResourceView[] }>
  },

  mcpPrompts(name) {
    return ipcRenderer.invoke('wraith:mcpPrompts', name) as Promise<{ text: string }>
  },

  mcpConfigUpsert(payload) {
    return ipcRenderer.invoke('wraith:mcpConfigUpsert', payload) as Promise<{ ok: boolean }>
  },

  mcpConfigRemove(scope, name) {
    return ipcRenderer.invoke('wraith:mcpConfigRemove', scope, name) as Promise<{ ok: boolean }>
  },

  onEvent(cb) {
    const listener = (_event: Electron.IpcRendererEvent, evt: BackendEvent) =>
      cb(evt)
    ipcRenderer.on('wraith:event', listener)
    return () => {
      ipcRenderer.removeListener('wraith:event', listener)
    }
  },

  automationList() {
    return ipcRenderer.invoke('wraith:automationList') as Promise<{ tasks: AutomationTask[] }>
  },

  automationUpsert(task) {
    return ipcRenderer.invoke('wraith:automationUpsert', task) as Promise<{ ok: boolean }>
  },

  automationRemove(id) {
    return ipcRenderer.invoke('wraith:automationRemove', id) as Promise<{ ok: boolean }>
  },

  automationRunNow(id) {
    return ipcRenderer.invoke('wraith:automationRunNow', id) as Promise<{ ok: boolean }>
  },

  automationStop(runId) {
    return ipcRenderer.invoke('wraith:automationStop', runId) as Promise<{ ok: boolean }>
  },

  automationRuns() {
    return ipcRenderer.invoke('wraith:automationRuns') as Promise<{ runs: AutomationRun[] }>
  },

  automationRespondApproval(approvalId, decision) {
    return ipcRenderer.invoke('wraith:automationRespondApproval', approvalId, decision) as Promise<{ ok: boolean }>
  },

  automationPanelOpened() {
    return ipcRenderer.invoke('wraith:automationPanelOpened') as Promise<{ ok: boolean }>
  },

  onAutomationEvent(cb) {
    const listener = (_e: Electron.IpcRendererEvent, evt: AutomationEvent) => cb(evt)
    ipcRenderer.on('wraith:automation-event', listener)
    return () => { ipcRenderer.removeListener('wraith:automation-event', listener) }
  },

  // Task 16: 守护进程路由的 CRUD(plural 前缀,main-process handlers 在 Task 18 接线)
  automationsList() {
    return ipcRenderer.invoke('wraith:automationsList') as Promise<{ tasks: AutomationTask[] }>
  },

  automationsUpsert(task) {
    return ipcRenderer.invoke('wraith:automationsUpsert', task) as Promise<{ ok: boolean }>
  },

  automationsRemove(id) {
    return ipcRenderer.invoke('wraith:automationsRemove', id) as Promise<{ ok: boolean }>
  },

  automationsRuns(taskId?) {
    return ipcRenderer.invoke('wraith:automationsRuns', taskId) as Promise<{ runs: AutomationRun[] }>
  },

  modelList() {
    return ipcRenderer.invoke('wraith:modelList') as Promise<ModelListResult>
  },

  setModel(provider) {
    return ipcRenderer.invoke('wraith:setModel', provider) as Promise<{ provider: string; model: string }>
  },

  setDefaultProvider(provider) {
    return ipcRenderer.invoke('wraith:setDefaultProvider', provider) as Promise<{ ok: boolean }>
  },

  gatewayGetConfig() {
    return ipcRenderer.invoke('wraith:gatewayGetConfig') as Promise<GatewayConfigView>
  },
  gatewaySetSecret(secret) {
    return ipcRenderer.invoke('wraith:gatewaySetSecret', secret) as Promise<{ ok: boolean }>
  },
  gatewaySetWorkspace(workspace) {
    return ipcRenderer.invoke('wraith:gatewaySetWorkspace', workspace) as Promise<{ ok: boolean }>
  },
  gatewayPickWorkspace() {
    return ipcRenderer.invoke('wraith:gatewayPickWorkspace') as Promise<string | null>
  },
  gatewayStart() {
    return ipcRenderer.invoke('wraith:gatewayStart') as Promise<{ ok: boolean }>
  },
  gatewayStop() {
    return ipcRenderer.invoke('wraith:gatewayStop') as Promise<{ ok: boolean }>
  },
  gatewayRestart() {
    return ipcRenderer.invoke('wraith:gatewayRestart') as Promise<{ ok: boolean }>
  },
  gatewayStatus() {
    return ipcRenderer.invoke('wraith:gatewayStatus') as Promise<GatewayStatus>
  },
  gatewayLogs() {
    return ipcRenderer.invoke('wraith:gatewayLogs') as Promise<{ lines: string[] }>
  },
  gatewayBindStart() {
    return ipcRenderer.invoke('wraith:gatewayBindStart') as Promise<{ ok: boolean }>
  },
  gatewayBindCancel() {
    return ipcRenderer.invoke('wraith:gatewayBindCancel') as Promise<{ ok: boolean }>
  },
  onGatewayEvent(cb) {
    const listener = (_e: Electron.IpcRendererEvent, evt: GatewayEvent) => cb(evt)
    ipcRenderer.on('wraith:gateway-event', listener)
    return () => { ipcRenderer.removeListener('wraith:gateway-event', listener) }
  },
}

contextBridge.exposeInMainWorld('wraith', wraith)
