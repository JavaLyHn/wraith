import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BackendEvent, SessionMeta, ResumedMessage, ProjectView, McpListResult, McpResourceView, McpUpsertPayload, McpTestResult, AutomationTask, AutomationRun, AutomationEvent, ModelListResult, SkillListResult, SkillDetail, SkillUpsertPayload, AppInfo, UpdateResult, RunMode, BuiltinToolView, MemoryListResult, ProjectMemoryInitResult, SnapshotListResult, SnapshotRestoreResult, PolicyStatusView, AuditListResult, SandboxState, BrowserCmdResult, EmbeddingConfigView, RagStatus, RagIndexResult, RagSearchResult, RagGraphResult, TaskListResult, DurableTaskView, QqPendingItem } from '../shared/types'
import type { FeishuConfigFields, WecomConfigFields, WeixinConfigFields, GatewayConfigView, GatewayEvent, GatewayStatus } from '../shared/gateway'
import type { PetView, PetImportResult, PetInstallResult, PetSource } from '../shared/pets'
import type { PetConfig } from '../main/settings'
import type { EditorApp } from '../shared/editors'

/**
 * WraithApi — typed bridge exposed to the renderer as window.wraith.
 * All methods proxy to ipcMain handlers via ipcRenderer.invoke.
 * onEvent subscribes to server-push notifications forwarded from Main.
 * contextIsolation remains true; renderer has no Node access.
 */
export interface WraithApi {
  /** 运行平台('darwin' | 'win32' | 'linux' | ...);renderer 据此决定顶条交通灯留白 */
  platform: string
  initialize(workspaceDir: string | null): Promise<unknown>
  startSession(workspaceDir: string | null): Promise<{ sessionId: string }>
  submitTurn(input: string, attachments?: { path: string; kind: string }[], mode?: RunMode): Promise<{ turnId: string; status: string }>
  respondPlanReview(reviewId: string, decision: 'execute' | 'supplement' | 'cancel', feedback?: string): Promise<{ ok: boolean }>
  pickAttachments(): Promise<{ path: string; name: string; kind: string }[]>
  /** 粘贴图片:base64 落临时文件,返回附件条目。 */
  saveTempImage(base64: string, ext: string): Promise<{ path: string; name: string; kind: string }>
  /** 拖拽文件:取其磁盘路径(Electron 32 用 webUtils,File.path 已移除)。 */
  pathForFile(file: File): string
  /** 附件缩略图:磁盘图片 → data: URL(非图/读失败返回 null)。 */
  readImageDataUrl(path: string): Promise<string | null>
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
  resumeSession(sessionId: string): Promise<{ sessionId: string; messages: ResumedMessage[]; provider?: string; model?: string; modelFallback?: boolean; cards?: Array<{ turnOrdinal: number; events: Array<{ method: string; params: unknown }> }> }>
  peekSession(sessionId: string): Promise<{ sessionId: string; messages: ResumedMessage[]; cards?: Array<{ turnOrdinal: number; events: Array<{ method: string; params: unknown }> }> }>
  rewindSession(userOrdinal: number): Promise<{ ok: boolean }>
  setSessionStarred(sessionId: string, starred: boolean): Promise<{ ok: boolean }>
  renameSession(sessionId: string, name: string): Promise<{ ok: boolean }>
  deleteSession(sessionId: string): Promise<{ ok: boolean }>
  mcpList(): Promise<McpListResult>
  listBuiltinTools(): Promise<{ tools: BuiltinToolView[] }>
  mcpEnable(name: string): Promise<{ ok: boolean }>
  mcpDisable(name: string): Promise<{ ok: boolean }>
  mcpRestart(name: string): Promise<{ ok: boolean }>
  mcpLogs(name: string): Promise<{ lines: string }>
  mcpResources(name?: string): Promise<{ resources: McpResourceView[] }>
  mcpPrompts(name: string): Promise<{ text: string }>
  mcpConfigUpsert(payload: McpUpsertPayload): Promise<{ ok: boolean }>
  mcpTest(payload: McpUpsertPayload): Promise<McpTestResult>
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
  /** QQ 待发队列:快照读 + 删单条结果/清空结果(经 daemon,最终一致) */
  qqPending(): Promise<{ items: QqPendingItem[]; count: number }>
  qqPendingClear(id?: string): Promise<{ ok: boolean }>
  modelList(): Promise<ModelListResult>
  setModel(provider: string): Promise<{ provider: string; model: string }>
  setDefaultProvider(provider: string): Promise<{ ok: boolean }>
  setProvider(p: { id: string; apiKey: string; model?: string; baseUrl?: string; protocol?: string; label?: string }): Promise<{ ok: boolean }>
  removeProvider(id: string): Promise<{ ok: boolean }>
  testProvider(p: { id: string; apiKey?: string; model?: string; baseUrl?: string; protocol?: string }): Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }>
  skillsList(): Promise<SkillListResult>
  setSkillEnabled(name: string, enabled: boolean): Promise<{ ok: boolean }>
  getSkill(name: string): Promise<SkillDetail>
  memoryList(): Promise<MemoryListResult>
  memorySearch(query: string): Promise<MemoryListResult>
  memoryDelete(id: string): Promise<{ ok: boolean }>
  memorySave(fact: string, scope: string): Promise<{ ok: boolean }>
  memoryClear(): Promise<{ ok: boolean }>
  memoryInitProject(force: boolean): Promise<ProjectMemoryInitResult>
  snapshotList(limit?: number): Promise<SnapshotListResult>
  snapshotRestore(offset: number): Promise<SnapshotRestoreResult>
  snapshotRestoreCommit(commitId: string): Promise<SnapshotRestoreResult>
  snapshotClean(): Promise<{ ok: boolean; message?: string }>
  policyStatus(): Promise<PolicyStatusView>
  auditList(limit?: number): Promise<AuditListResult>
  sandboxGet(): Promise<SandboxState>
  sandboxSet(networkAllowed: boolean): Promise<SandboxState>
  browserStatus(): Promise<BrowserCmdResult>
  browserConnect(port?: string): Promise<BrowserCmdResult>
  browserDisconnect(): Promise<BrowserCmdResult>
  browserTabs(): Promise<BrowserCmdResult>
  configGetEmbedding(): Promise<EmbeddingConfigView>
  configSetEmbedding(cfg: { provider: string; model: string; baseUrl: string; apiKey: string }): Promise<{ ok: boolean }>
  ragStatus(): Promise<RagStatus>
  ragIndex(): Promise<RagIndexResult>
  ragSearch(query: string, topK?: number): Promise<RagSearchResult>
  ragGraph(name: string): Promise<RagGraphResult>
  upsertSkill(payload: SkillUpsertPayload): Promise<{ ok: boolean }>
  deleteSkill(scope: 'user' | 'project', name: string): Promise<{ ok: boolean }>
  skillExistsInScope(scope: 'user' | 'project', name: string): Promise<{ exists: boolean }>
  forkSkill(name: string): Promise<{ ok: boolean; name: string }>
  gatewayGetConfig(platform?: string): Promise<GatewayConfigView>
  gatewaySetFeishuConfig(fields: FeishuConfigFields): Promise<{ ok: boolean }>
  gatewaySetWecomConfig(fields: WecomConfigFields): Promise<{ ok: boolean }>
  gatewayBindWeixinStart(workspace?: string): Promise<void>
  gatewaySetWeixinConfig(fields: WeixinConfigFields): Promise<{ ok: boolean }>
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
  appInfo(): Promise<AppInfo>
  checkUpdate(beta: boolean): Promise<UpdateResult>
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<void>
  revealInFinder(path: string): Promise<void>
  openWithApp(path: string, appPath: string): Promise<void>
  downloadCopy(path: string): Promise<string>
  listEditors(): Promise<EditorApp[]>
  saveTextFile(defaultName: string, content: string): Promise<{ ok: boolean; path?: string }>
  transcribe(audioBase64: string, mime: string): Promise<{ text: string }>
  /** 手动压缩当前对话历史,释放上下文窗口。 */
  compactHistory(): Promise<{ compacted: boolean; beforeTokens: number; afterTokens: number; error?: string | null; summarized?: boolean; fallback?: string }>
  /** 上下文状态快照(context.state.get);启动/切会话时拉一次,修"发消息前空白"。 */
  contextState(): Promise<Record<string, unknown>>
  /** 后台任务:列表 / 提交 / 取详情 / 取消(与 CLI /task 共享 ~/.wraith/tasks/tasks.db)。 */
  taskList(limit?: number): Promise<TaskListResult>
  taskAdd(prompt: string): Promise<{ ok: boolean; id?: string; message?: string }>
  taskGet(id: string): Promise<DurableTaskView>
  taskCancel(id: string): Promise<{ ok: boolean }>
  ptyCreate(opts?: { cwd?: string; cols?: number; rows?: number; theme?: 'light' | 'dark' }): Promise<{ id: string }>
  ptyInput(id: string, data: string): Promise<void>
  ptyResize(id: string, cols: number, rows: number): Promise<void>
  ptyKill(id: string): Promise<void>
  onPtyData(cb: (p: { id: string; data: string }) => void): () => void
  onPtyExit(cb: (p: { id: string; code: number }) => void): () => void
  /** 宠物库:窄 IPC——只有这 5 个方法,没有任意文件读/目录列举/shell。 */
  petsList(): Promise<{ pets: PetView[] }>
  petsImportImage(): Promise<PetImportResult>
  petsImportPackage(): Promise<PetImportResult>
  petsRemove(id: string, source: PetSource): Promise<{ ok: boolean }>
  petsPreview(id: string): Promise<string | null>
  /** 应用内 Petdex 安装:执行 `npx petdex@latest install <名>`(名字白名单+定长参数+shell:false)。
   * 结果经 invoke 返回,过程中的 stdout/stderr 经 onPetInstallOutput 流式推来。 */
  petsInstall(name: string): Promise<PetInstallResult>
  onPetInstallOutput(cb: (chunk: string) => void): () => void
  /** 桌宠配置(全局常驻窗口):读/写 + 跨进程变更订阅(主窗与宠物窗共用同一份配置)。 */
  petGetConfig(): Promise<PetConfig>
  petSetConfig(patch: Partial<PetConfig>): Promise<PetConfig>
  onPetConfig(cb: (c: PetConfig) => void): () => void
}

const wraith: WraithApi = {
  platform: process.platform,
  initialize(workspaceDir) {
    return ipcRenderer.invoke('wraith:initialize', workspaceDir)
  },

  startSession(workspaceDir) {
    return ipcRenderer.invoke('wraith:startSession', workspaceDir)
  },

  submitTurn(input, attachments, mode) {
    return ipcRenderer.invoke('wraith:submitTurn', input, attachments, mode ?? 'react')
  },

  pickAttachments() {
    return ipcRenderer.invoke('wraith:pickAttachments') as Promise<{ path: string; name: string; kind: string }[]>
  },

  saveTempImage(base64, ext) {
    return ipcRenderer.invoke('wraith:saveTempImage', base64, ext) as Promise<{ path: string; name: string; kind: string }>
  },

  pathForFile(file) {
    return webUtils.getPathForFile(file)
  },

  readImageDataUrl(path) {
    return ipcRenderer.invoke('wraith:readImageDataUrl', path) as Promise<string | null>
  },

  respondApproval(approvalId, decision, opts) {
    return ipcRenderer.invoke('wraith:respondApproval', approvalId, decision, opts ?? null)
  },

  respondPlanReview(reviewId, decision, feedback) {
    return ipcRenderer.invoke('wraith:respondPlanReview', reviewId, decision, feedback ?? null) as Promise<{ ok: boolean }>
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
      cards?: Array<{ turnOrdinal: number; events: Array<{ method: string; params: unknown }> }>
    }>
  },

  peekSession(sessionId) {
    return ipcRenderer.invoke('wraith:peekSession', sessionId) as Promise<{
      sessionId: string
      messages: ResumedMessage[]
      cards?: Array<{ turnOrdinal: number; events: Array<{ method: string; params: unknown }> }>
    }>
  },

  rewindSession(userOrdinal) {
    return ipcRenderer.invoke('wraith:rewindSession', userOrdinal) as Promise<{ ok: boolean }>
  },

  setSessionStarred(sessionId, starred) {
    return ipcRenderer.invoke('wraith:setSessionStarred', sessionId, starred) as Promise<{ ok: boolean }>
  },

  renameSession(sessionId, name) {
    return ipcRenderer.invoke('wraith:renameSession', sessionId, name) as Promise<{ ok: boolean }>
  },

  deleteSession(sessionId) {
    return ipcRenderer.invoke('wraith:deleteSession', sessionId) as Promise<{ ok: boolean }>
  },

  mcpList() {
    return ipcRenderer.invoke('wraith:mcpList') as Promise<McpListResult>
  },

  listBuiltinTools() {
    return ipcRenderer.invoke('wraith:listBuiltinTools') as Promise<{ tools: BuiltinToolView[] }>
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

  mcpTest(payload) {
    return ipcRenderer.invoke('wraith:mcpTest', payload) as Promise<McpTestResult>
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

  qqPending() {
    return ipcRenderer.invoke('wraith:qqPending') as Promise<{ items: QqPendingItem[]; count: number }>
  },
  qqPendingClear(id) {
    return ipcRenderer.invoke('wraith:qqPendingClear', id) as Promise<{ ok: boolean }>
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

  setProvider(p) {
    return ipcRenderer.invoke('wraith:setProvider', p) as Promise<{ ok: boolean }>
  },

  removeProvider(id) {
    return ipcRenderer.invoke('wraith:removeProvider', id) as Promise<{ ok: boolean }>
  },
  testProvider(p) {
    return ipcRenderer.invoke('wraith:testProvider', p) as Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }>
  },

  skillsList() {
    return ipcRenderer.invoke('wraith:skillsList') as Promise<SkillListResult>
  },
  memoryList() {
    return ipcRenderer.invoke('wraith:memoryList') as Promise<MemoryListResult>
  },
  memorySearch(query) {
    return ipcRenderer.invoke('wraith:memorySearch', query) as Promise<MemoryListResult>
  },
  memoryDelete(id) {
    return ipcRenderer.invoke('wraith:memoryDelete', id) as Promise<{ ok: boolean }>
  },
  memorySave(fact, scope) {
    return ipcRenderer.invoke('wraith:memorySave', fact, scope) as Promise<{ ok: boolean }>
  },
  memoryClear() {
    return ipcRenderer.invoke('wraith:memoryClear') as Promise<{ ok: boolean }>
  },
  memoryInitProject(force) {
    return ipcRenderer.invoke('wraith:memoryInitProject', force) as Promise<ProjectMemoryInitResult>
  },
  snapshotList(limit) {
    return ipcRenderer.invoke('wraith:snapshotList', limit) as Promise<SnapshotListResult>
  },
  snapshotRestore(offset) {
    return ipcRenderer.invoke('wraith:snapshotRestore', offset) as Promise<SnapshotRestoreResult>
  },
  snapshotRestoreCommit(commitId) {
    return ipcRenderer.invoke('wraith:snapshotRestoreCommit', commitId) as Promise<SnapshotRestoreResult>
  },
  snapshotClean() {
    return ipcRenderer.invoke('wraith:snapshotClean') as Promise<{ ok: boolean; message?: string }>
  },
  policyStatus() {
    return ipcRenderer.invoke('wraith:policyStatus') as Promise<PolicyStatusView>
  },
  auditList(limit) {
    return ipcRenderer.invoke('wraith:auditList', limit) as Promise<AuditListResult>
  },
  sandboxGet() {
    return ipcRenderer.invoke('wraith:sandboxGet') as Promise<SandboxState>
  },
  sandboxSet(networkAllowed) {
    return ipcRenderer.invoke('wraith:sandboxSet', networkAllowed) as Promise<SandboxState>
  },
  browserStatus() {
    return ipcRenderer.invoke('wraith:browserStatus') as Promise<BrowserCmdResult>
  },
  browserConnect(port) {
    return ipcRenderer.invoke('wraith:browserConnect', port) as Promise<BrowserCmdResult>
  },
  browserDisconnect() {
    return ipcRenderer.invoke('wraith:browserDisconnect') as Promise<BrowserCmdResult>
  },
  browserTabs() {
    return ipcRenderer.invoke('wraith:browserTabs') as Promise<BrowserCmdResult>
  },
  configGetEmbedding() {
    return ipcRenderer.invoke('wraith:configGetEmbedding') as Promise<EmbeddingConfigView>
  },
  configSetEmbedding(cfg) {
    return ipcRenderer.invoke('wraith:configSetEmbedding', cfg) as Promise<{ ok: boolean }>
  },
  ragStatus() {
    return ipcRenderer.invoke('wraith:ragStatus') as Promise<RagStatus>
  },
  ragIndex() {
    return ipcRenderer.invoke('wraith:ragIndex') as Promise<RagIndexResult>
  },
  ragSearch(query, topK) {
    return ipcRenderer.invoke('wraith:ragSearch', query, topK) as Promise<RagSearchResult>
  },
  ragGraph(name) {
    return ipcRenderer.invoke('wraith:ragGraph', name) as Promise<RagGraphResult>
  },

  setSkillEnabled(name, enabled) {
    return ipcRenderer.invoke('wraith:setSkillEnabled', name, enabled) as Promise<{ ok: boolean }>
  },

  getSkill(name) {
    return ipcRenderer.invoke('wraith:getSkill', name) as Promise<SkillDetail>
  },
  upsertSkill(payload) {
    return ipcRenderer.invoke('wraith:upsertSkill', payload) as Promise<{ ok: boolean }>
  },
  deleteSkill(scope, name) {
    return ipcRenderer.invoke('wraith:deleteSkill', scope, name) as Promise<{ ok: boolean }>
  },
  skillExistsInScope(scope, name) {
    return ipcRenderer.invoke('wraith:skillExistsInScope', scope, name) as Promise<{ exists: boolean }>
  },
  forkSkill(name) {
    return ipcRenderer.invoke('wraith:forkSkill', name) as Promise<{ ok: boolean; name: string }>
  },

  gatewayGetConfig(platform?: string) {
    return ipcRenderer.invoke('wraith:gatewayGetConfig', platform) as Promise<GatewayConfigView>
  },
  gatewaySetFeishuConfig(fields: FeishuConfigFields) {
    return ipcRenderer.invoke('wraith:gatewaySetFeishuConfig', fields) as Promise<{ ok: boolean }>
  },
  gatewaySetWecomConfig(fields: WecomConfigFields) {
    return ipcRenderer.invoke('wraith:gatewaySetWecomConfig', fields) as Promise<{ ok: boolean }>
  },
  gatewayBindWeixinStart(workspace?: string) {
    return ipcRenderer.invoke('wraith:gatewayBindWeixinStart', workspace) as Promise<void>
  },
  gatewaySetWeixinConfig(fields: WeixinConfigFields) {
    return ipcRenderer.invoke('wraith:gatewaySetWeixinConfig', fields) as Promise<{ ok: boolean }>
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
  appInfo() {
    return ipcRenderer.invoke('wraith:appInfo') as Promise<AppInfo>
  },
  checkUpdate(beta) {
    return ipcRenderer.invoke('wraith:checkUpdate', beta) as Promise<UpdateResult>
  },
  openExternal(url) {
    return ipcRenderer.invoke('wraith:openExternal', url) as Promise<void>
  },
  openPath(path) {
    return ipcRenderer.invoke('wraith:openPath', path) as Promise<void>
  },
  revealInFinder(p) { return ipcRenderer.invoke('wraith:revealInFinder', p) as Promise<void> },
  openWithApp(p, appPath) { return ipcRenderer.invoke('wraith:openWithApp', p, appPath) as Promise<void> },
  downloadCopy(p) { return ipcRenderer.invoke('wraith:downloadCopy', p) as Promise<string> },
  listEditors() { return ipcRenderer.invoke('wraith:listEditors') as Promise<EditorApp[]> },
  saveTextFile(defaultName, content) {
    return ipcRenderer.invoke('wraith:saveTextFile', defaultName, content) as Promise<{ ok: boolean; path?: string }>
  },
  transcribe(audioBase64, mime) {
    return ipcRenderer.invoke('wraith:transcribe', audioBase64, mime) as Promise<{ text: string }>
  },
  compactHistory() {
    return ipcRenderer.invoke('wraith:compactHistory') as Promise<{ compacted: boolean; beforeTokens: number; afterTokens: number; error?: string | null; summarized?: boolean; fallback?: string }>
  },
  contextState() {
    return ipcRenderer.invoke('wraith:contextState') as Promise<Record<string, unknown>>
  },
  taskList(limit) {
    return ipcRenderer.invoke('wraith:taskList', limit ?? 20) as Promise<TaskListResult>
  },
  taskAdd(prompt) {
    return ipcRenderer.invoke('wraith:taskAdd', prompt) as Promise<{ ok: boolean; id?: string; message?: string }>
  },
  taskGet(id) {
    return ipcRenderer.invoke('wraith:taskGet', id) as Promise<DurableTaskView>
  },
  taskCancel(id) {
    return ipcRenderer.invoke('wraith:taskCancel', id) as Promise<{ ok: boolean }>
  },
  ptyCreate(opts) { return ipcRenderer.invoke('wraith:ptyCreate', opts) as Promise<{ id: string }> },
  ptyInput(id, data) { return ipcRenderer.invoke('wraith:ptyInput', id, data) as Promise<void> },
  ptyResize(id, cols, rows) { return ipcRenderer.invoke('wraith:ptyResize', id, cols, rows) as Promise<void> },
  ptyKill(id) { return ipcRenderer.invoke('wraith:ptyKill', id) as Promise<void> },
  onPtyData(cb) {
    const l = (_e: Electron.IpcRendererEvent, p: { id: string; data: string }) => cb(p)
    ipcRenderer.on('wraith:pty-data', l)
    return () => { ipcRenderer.removeListener('wraith:pty-data', l) }
  },
  onPtyExit(cb) {
    const l = (_e: Electron.IpcRendererEvent, p: { id: string; code: number }) => cb(p)
    ipcRenderer.on('wraith:pty-exit', l)
    return () => { ipcRenderer.removeListener('wraith:pty-exit', l) }
  },

  petsList() {
    return ipcRenderer.invoke('wraith:petsList') as Promise<{ pets: PetView[] }>
  },
  petsImportImage() {
    return ipcRenderer.invoke('wraith:petsImportImage') as Promise<PetImportResult>
  },
  petsImportPackage() {
    return ipcRenderer.invoke('wraith:petsImportPackage') as Promise<PetImportResult>
  },
  petsRemove(id, source) {
    return ipcRenderer.invoke('wraith:petsRemove', id, source) as Promise<{ ok: boolean }>
  },
  petsPreview(id) {
    return ipcRenderer.invoke('wraith:petsPreview', id) as Promise<string | null>
  },
  petsInstall(name) {
    return ipcRenderer.invoke('wraith:petsInstall', name) as Promise<PetInstallResult>
  },
  onPetInstallOutput(cb) {
    const l = (_e: Electron.IpcRendererEvent, chunk: string) => cb(chunk)
    ipcRenderer.on('wraith:petsInstall-output', l)
    return () => { ipcRenderer.removeListener('wraith:petsInstall-output', l) }
  },

  petGetConfig() {
    return ipcRenderer.invoke('pet:getConfig') as Promise<PetConfig>
  },
  petSetConfig(patch) {
    return ipcRenderer.invoke('pet:setConfig', patch) as Promise<PetConfig>
  },
  onPetConfig(cb) {
    const listener = (_e: Electron.IpcRendererEvent, c: PetConfig) => cb(c)
    ipcRenderer.on('pet:config', listener)
    return () => { ipcRenderer.removeListener('pet:config', listener) }
  },
}

contextBridge.exposeInMainWorld('wraith', wraith)
