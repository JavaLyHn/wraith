import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BackendEvent, SessionMeta, ResumedMessage, ProjectView, ProjectSummary, McpListResult, McpResourceView, McpUpsertPayload, McpTestResult, AutomationTask, AutomationRun, AutomationEvent, ModelListResult, SkillListResult, SkillDetail, SkillUpsertPayload, AppInfo, UpdateResult, RunMode, BuiltinToolView, MemoryListResult, PendingListResult, ExtractNowResult, ProjectMemoryInitResult, SnapshotListResult, SnapshotRestoreResult, SnapshotSettingsView, PolicyStatusView, AuditListResult, SandboxState, BrowserCmdResult, EmbeddingConfigView, EmbeddingTestResult, RagScopeView, SearchStatusView, GitStatusView, SearchTestResult, PricingListResult, PricingEntryView, RagStatus, RagIndexResult, RagSearchResult, RagGraphResult, TaskListResult, DurableTaskView, QqPendingItem, DocEntry, DocAddResult, CloseMode, CloseExecutePayload, ActivityCancelRequest, ActivityCancelResult, ActivitySnapshot } from '../shared/types'
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
  respondChoice(choiceId: string, cancelled: boolean, selectedIndex: number): Promise<void>
  interrupt(): Promise<void>
  getInitialWorkspace(): Promise<string | null>
  listProjects(): Promise<{ projects: ProjectView[] }>
  activateProject(path: string): Promise<{ ok: boolean }>
  addProject(): Promise<string | null>
  removeProject(path: string): Promise<void>
  renameProject(path: string, name: string): Promise<void>
  setProjectStarred(path: string, starred: boolean): Promise<void>
  reorderProject(path: string, targetIndex: number): Promise<void>
  projectSummary(paths: string[]): Promise<{ summaries: ProjectSummary[] }>
  listSessionsForProject(path: string, limit?: number): Promise<{ sessions: SessionMeta[] }>
  setSessionArchived(sessionId: string, archived: boolean, path?: string): Promise<{ ok: boolean }>
  listArchivedSessions(paths: string[], limit?: number): Promise<{ sessions: SessionMeta[] }>
  archiveProjectSessions(path: string): Promise<{ archived: number }>
  restartBackend(): Promise<void>
  setApprovalMode(auto: boolean): Promise<{ ok: boolean }>
  listSessions(): Promise<{ sessions: SessionMeta[] }>
  resumeSession(sessionId: string): Promise<{ sessionId: string; messages: ResumedMessage[]; provider?: string; model?: string; modelFallback?: boolean; cards?: Array<{ turnOrdinal: number; events: Array<{ method: string; params: unknown }> }> }>
  peekSession(sessionId: string): Promise<{ sessionId: string; messages: ResumedMessage[]; cards?: Array<{ turnOrdinal: number; events: Array<{ method: string; params: unknown }> }> }>
  /** 从指定会话创建分支:复制全部消息到新会话,返回新 sessionId。 */
  branchSession(sessionId: string): Promise<{ sessionId: string }>
  rewindSession(userOrdinal: number): Promise<{ ok: boolean }>
  setSessionStarred(sessionId: string, starred: boolean): Promise<{ ok: boolean }>
  renameSession(sessionId: string, name: string): Promise<{ ok: boolean }>
  deleteSession(sessionId: string, path?: string): Promise<{ ok: boolean }>
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
  activityList(limit?: number): Promise<ActivitySnapshot>
  activityCancel(item: ActivityCancelRequest): Promise<ActivityCancelResult>
  onActivityEvent(cb: (snapshot: ActivitySnapshot) => void): () => void
  automationList(): Promise<{ tasks: AutomationTask[] }>
  automationUpsert(task: AutomationTask): Promise<{ ok: boolean }>
  automationRemove(id: string): Promise<{ ok: boolean }>
  /** ok=false 且 reason='gateway-not-running' 表示守护进程未运行、请求已撤回(不会补跑)。 */
  automationRunNow(id: string): Promise<{ ok: boolean; reason?: string }>
  // v1: 定时任务为进程内回合,不可中断 — UI 层不再暴露 STOP 按钮;此方法仅保留为存根。
  automationStop(runId: string): Promise<{ ok: boolean }>
  automationRuns(): Promise<{ runs: AutomationRun[] }>
  /** Fix-B: aligned to Fix-A contract — forwards { approvalId, decision } */
  /** 同 automationRunNow:ok=false + reason='gateway-not-running' = 守护进程未运行,决定未落地。 */
  automationRespondApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<{ ok: boolean; reason?: string }>
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
  memoryPendingList(): Promise<PendingListResult>
  memoryPendingApprove(id: string): Promise<{ ok: boolean }>
  memoryPendingApproveReplacing(id: string, oldId: string): Promise<{ ok: boolean }>
  memoryPendingReject(id: string): Promise<{ ok: boolean }>
  memoryPendingClear(): Promise<{ ok: boolean }>
  memoryExtractNow(): Promise<ExtractNowResult>
  snapshotList(limit?: number): Promise<SnapshotListResult>
  snapshotRestore(offset: number): Promise<SnapshotRestoreResult>
  snapshotRestoreCommit(commitId: string): Promise<SnapshotRestoreResult>
  snapshotClean(): Promise<{ ok: boolean; message?: string }>
  /** 快照开关状态(含「是谁决定的」,面板据此决定要不要如实置灰) */
  snapshotSettings(): Promise<SnapshotSettingsView>
  /** 开/关快照:写盘 + 立刻对本会话生效 */
  snapshotSetEnabled(enabled: boolean): Promise<{ ok: boolean; enabled?: boolean; warning?: string; message?: string }>
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
  /** 「测试连接」:用表单草稿发一次真实 embedding 请求。不写盘;apiKey 空=后端沿用已存 */
  configTestEmbedding(cfg: { provider: string; model: string; baseUrl: string; apiKey: string }): Promise<EmbeddingTestResult>
  /** 读索引范围设置 */
  configGetRagScope(): Promise<RagScopeView>
  /** 写索引范围设置。只写配置,不动索引 —— 改完要重建才生效 */
  configSetRagScope(scope: RagScopeView): Promise<{ ok: boolean }>
  /** 搜索后端实时状态(只读,不回 key)——「能力概览」角标 + 表单回显用 */
  configGetSearch(): Promise<SearchStatusView>
  /** 用户真实仓库的只读状态；renderer 不获得任意 RPC 调用能力。 */
  gitStatus(): Promise<GitStatusView>
  /** 写搜索后端配置。apiKey 空=后端沿用已存;**换了 provider 则不继承**(一个 key 字段服务两家) */
  configSetSearch(cfg: { provider: string; apiKey: string; baseUrl: string }): Promise<{ ok: boolean; error?: string }>
  /** 「测试连接」:用表单草稿发一次真实搜索。不写盘;apiKey 空=后端沿用已存 */
  configTestSearch(cfg: { provider: string; apiKey: string; baseUrl: string }): Promise<SearchTestResult>
  configGetPricing(): Promise<PricingListResult>
  configSetPricing(entries: PricingEntryView[]): Promise<{ ok: boolean; error?: string }>
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
  undoFileEdit(payload: { path: string; before: string; kind: 'created' | 'modified' }): Promise<{ ok: boolean; message?: string }>
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
  /** 删除一条终态任务。运行中/排队中会被后端拒绝并给出原因。 */
  taskDelete(id: string): Promise<{ ok: boolean; message?: string }>
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
  /** 「文档」资料库:~/.wraith/documents/ 扁平存放。入参是库内文件名,不是路径。 */
  documents: {
    list(): Promise<DocEntry[]>
    /** 无参 → 弹系统文件选择器;传 paths → 拖拽入库。 */
    add(paths?: string[]): Promise<DocAddResult>
    remove(name: string): Promise<void>
    open(name: string): Promise<void>
    reveal(name: string): Promise<void>
  }
  /** 工作区文件浏览器:只读,所有路径必经 main 侧 withinWorkspace 守卫。入参必须是绝对路径。 */
  fs: {
    tree(rootPath: string, opts?: { maxDepth?: number }): Promise<import('../shared/types').FsTreeResult>
    readText(absPath: string, maxBytes?: number): Promise<{ content: string; truncated: boolean; size: number }>
    stat(absPath: string): Promise<import('../shared/types').FsNode>
    reveal(absPath: string): Promise<void>
    openExternal(absPath: string): Promise<void>
  }
  /** 窗口控制:Windows 无边框自绘窗控用(最小/最大化切换/关闭 + 最大化状态订阅)。 */
  windowControls: WindowControlsApi
  /** 关闭行为:读已记住的 closeMode + 监听 close 请求 + 执行用户选择。 */
  closeBehavior: CloseBehaviorApi
  /** 输入历史:按会话持久化,供 Composer ↑/↓ 回显。 */
  inputHistory: InputHistoryApi
}

/** 输入历史 API:按 sessionId 持久化的输入历史,供 Composer ↑/↓ 回显。 */
export interface InputHistoryApi {
  get(sessionId: string): Promise<string[]>
  add(sessionId: string, text: string): Promise<void>
  clear(sessionId: string): Promise<void>
}

/** 窗口控制 API:最小化/切换最大化/关闭 + 最大化状态变更订阅。仅 Windows 渲染窗控 UI,其它平台调用无害。 */
export interface WindowControlsApi {
  minimize(): void
  toggleMaximize(): void
  close(): void
  isMaximized(): Promise<boolean>
  onMaximizeChange(cb: (max: boolean) => void): () => void
}

/** 关闭行为 API:读已记住的 closeMode + 监听主进程的 close 请求 + 执行用户选择 + 重置。 */
export interface CloseBehaviorApi {
  /** 读取已持久化的 closeMode('ask'|'background'|'quit')。 */
  getMode(): Promise<CloseMode>
  /** 监听主进程发来的 close 请求(用户点了 × 按钮)。 */
  onRequest(cb: () => void): () => void
  /** 回传用户选择:mode=挂后台或退出,remember=是否勾了「下次别问」。 */
  execute(payload: CloseExecutePayload): Promise<void>
  /** 重置 closeMode 为 'ask'(设置面板「恢复询问」按钮)。 */
  resetMode(): Promise<void>
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

  respondChoice(choiceId, cancelled, selectedIndex) {
    return ipcRenderer.invoke('wraith:respondChoice', choiceId, cancelled, selectedIndex)
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

  setProjectStarred(path, starred) {
    return ipcRenderer.invoke('wraith:setProjectStarred', path, starred) as Promise<void>
  },

  reorderProject(path, targetIndex) {
    return ipcRenderer.invoke('wraith:reorderProject', path, targetIndex) as Promise<void>
  },

  projectSummary(paths) {
    return ipcRenderer.invoke('wraith:projectSummary', paths) as Promise<{ summaries: ProjectSummary[] }>
  },

  listSessionsForProject(path, limit) {
    return ipcRenderer.invoke('wraith:listSessionsForProject', path, limit) as Promise<{ sessions: SessionMeta[] }>
  },

  setSessionArchived(sessionId, archived, path) {
    return ipcRenderer.invoke('wraith:setSessionArchived', sessionId, archived, path) as Promise<{ ok: boolean }>
  },

  listArchivedSessions(paths, limit) {
    return ipcRenderer.invoke('wraith:listArchivedSessions', paths, limit) as Promise<{ sessions: SessionMeta[] }>
  },

  archiveProjectSessions(path) {
    return ipcRenderer.invoke('wraith:archiveProjectSessions', path) as Promise<{ archived: number }>
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

  deleteSession(sessionId, path) {
    return ipcRenderer.invoke('wraith:deleteSession', sessionId, path) as Promise<{ ok: boolean }>
  },

  branchSession(sessionId) {
    return ipcRenderer.invoke('wraith:branchSession', sessionId) as Promise<{ sessionId: string }>
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

  activityList(limit) {
    return ipcRenderer.invoke('wraith:activityList', limit) as Promise<ActivitySnapshot>
  },

  activityCancel(item) {
    return ipcRenderer.invoke('wraith:activityCancel', item) as Promise<ActivityCancelResult>
  },

  onActivityEvent(cb) {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: ActivitySnapshot) => cb(snapshot)
    ipcRenderer.on('wraith:activity-event', listener)
    return () => { ipcRenderer.removeListener('wraith:activity-event', listener) }
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
    return ipcRenderer.invoke('wraith:automationRunNow', id) as Promise<{ ok: boolean; reason?: string }>
  },

  automationStop(runId) {
    return ipcRenderer.invoke('wraith:automationStop', runId) as Promise<{ ok: boolean }>
  },

  automationRuns() {
    return ipcRenderer.invoke('wraith:automationRuns') as Promise<{ runs: AutomationRun[] }>
  },

  automationRespondApproval(approvalId, decision) {
    return ipcRenderer.invoke('wraith:automationRespondApproval', approvalId, decision) as Promise<{ ok: boolean; reason?: string }>
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
  memoryPendingList() {
    return ipcRenderer.invoke('wraith:memoryPendingList') as Promise<PendingListResult>
  },
  memoryPendingApprove(id) {
    return ipcRenderer.invoke('wraith:memoryPendingApprove', id) as Promise<{ ok: boolean }>
  },
  memoryPendingApproveReplacing(id, oldId) {
    return ipcRenderer.invoke('wraith:memoryPendingApproveReplacing', id, oldId) as Promise<{ ok: boolean }>
  },
  memoryPendingReject(id) {
    return ipcRenderer.invoke('wraith:memoryPendingReject', id) as Promise<{ ok: boolean }>
  },
  memoryPendingClear() {
    return ipcRenderer.invoke('wraith:memoryPendingClear') as Promise<{ ok: boolean }>
  },
  memoryExtractNow() {
    return ipcRenderer.invoke('wraith:memoryExtractNow') as Promise<ExtractNowResult>
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
  snapshotSettings() {
    return ipcRenderer.invoke('wraith:snapshotSettings') as Promise<SnapshotSettingsView>
  },
  snapshotSetEnabled(enabled) {
    return ipcRenderer.invoke('wraith:snapshotSetEnabled', enabled) as Promise<{ ok: boolean; enabled?: boolean; warning?: string; message?: string }>
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
  configTestEmbedding(cfg) {
    return ipcRenderer.invoke('wraith:configTestEmbedding', cfg) as Promise<EmbeddingTestResult>
  },
  configGetRagScope() {
    return ipcRenderer.invoke('wraith:configGetRagScope') as Promise<RagScopeView>
  },
  configSetRagScope(scope) {
    return ipcRenderer.invoke('wraith:configSetRagScope', scope) as Promise<{ ok: boolean }>
  },
  configGetSearch() {
    return ipcRenderer.invoke('wraith:configGetSearch') as Promise<SearchStatusView>
  },
  gitStatus() {
    return ipcRenderer.invoke('wraith:gitStatus') as Promise<GitStatusView>
  },
  configSetSearch(cfg) {
    return ipcRenderer.invoke('wraith:configSetSearch', cfg) as Promise<{ ok: boolean; error?: string }>
  },
  configTestSearch(cfg) {
    return ipcRenderer.invoke('wraith:configTestSearch', cfg) as Promise<SearchTestResult>
  },
  configGetPricing() {
    return ipcRenderer.invoke('wraith:configGetPricing') as Promise<PricingListResult>
  },
  configSetPricing(entries) {
    return ipcRenderer.invoke('wraith:configSetPricing', entries) as Promise<{ ok: boolean; error?: string }>
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
  undoFileEdit(payload) { return ipcRenderer.invoke('wraith:undoFileEdit', payload) as Promise<{ ok: boolean; message?: string }> },
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
  taskDelete(id) {
    return ipcRenderer.invoke('wraith:taskDelete', id) as Promise<{ ok: boolean; message?: string }>
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

  documents: {
    list() { return ipcRenderer.invoke('wraith:documents:list') as Promise<DocEntry[]> },
    add(paths) { return ipcRenderer.invoke('wraith:documents:add', paths) as Promise<DocAddResult> },
    remove(name) { return ipcRenderer.invoke('wraith:documents:remove', name) as Promise<void> },
    open(name) { return ipcRenderer.invoke('wraith:documents:open', name) as Promise<void> },
    reveal(name) { return ipcRenderer.invoke('wraith:documents:reveal', name) as Promise<void> },
  },

  /** 工作区文件浏览器:只读,所有路径必经 main 侧 withinWorkspace 守卫。入参必须是绝对路径。 */
  fs: {
    tree(rootPath: string, opts?: { maxDepth?: number }) {
      return ipcRenderer.invoke('wraith:fs:tree', rootPath, opts) as ReturnType<typeof import('../main/fileExplorer').listTree>
    },
    readText(absPath: string, maxBytes?: number) {
      return ipcRenderer.invoke('wraith:fs:readText', absPath, maxBytes) as ReturnType<typeof import('../main/fileExplorer').readText>
    },
    stat(absPath: string) {
      return ipcRenderer.invoke('wraith:fs:stat', absPath) as Promise<import('../shared/types').FsNode>
    },
    reveal(absPath: string) {
      return ipcRenderer.invoke('wraith:fs:reveal', absPath) as Promise<void>
    },
    openExternal(absPath: string) {
      return ipcRenderer.invoke('wraith:fs:openExternal', absPath) as Promise<void>
    },
  },

  windowControls: {
    minimize() { void ipcRenderer.invoke('wraith:win:minimize') },
    toggleMaximize() { void ipcRenderer.invoke('wraith:win:toggleMaximize') },
    close() { void ipcRenderer.invoke('wraith:win:close') },
    isMaximized() { return ipcRenderer.invoke('wraith:win:isMaximized') as Promise<boolean> },
    onMaximizeChange(cb) {
      const listener = (_e: Electron.IpcRendererEvent, max: boolean) => cb(max)
      ipcRenderer.on('wraith:win:maximizeChanged', listener)
      return () => { ipcRenderer.removeListener('wraith:win:maximizeChanged', listener) }
    },
  },

  closeBehavior: {
    getMode() { return ipcRenderer.invoke('wraith:close:getMode') as Promise<CloseMode> },
    onRequest(cb) {
      const listener = (): void => cb()
      ipcRenderer.on('wraith:close:request', listener)
      return () => { ipcRenderer.removeListener('wraith:close:request', listener) }
    },
    execute(payload) { return ipcRenderer.invoke('wraith:close:execute', payload) as Promise<void> },
    resetMode() { return ipcRenderer.invoke('wraith:close:resetMode') as Promise<void> },
  },

  // 输入历史:按会话持久化,供 Composer ↑/↓ 回显
  inputHistory: {
    get(sessionId: string) { return ipcRenderer.invoke('wraith:inputHistory:get', sessionId) as Promise<string[]> },
    add(sessionId: string, text: string) { return ipcRenderer.invoke('wraith:inputHistory:add', sessionId, text) as Promise<void> },
    clear(sessionId: string) { return ipcRenderer.invoke('wraith:inputHistory:clear', sessionId) as Promise<void> },
  },
}

contextBridge.exposeInMainWorld('wraith', wraith)
