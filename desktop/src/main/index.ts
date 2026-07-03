import { app, BrowserWindow, ipcMain, dialog, Notification } from 'electron'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import readline from 'readline'
import { JsonRpcClient } from '../shared/jsonRpcClient'
import { resolveBackendCommand, defaultJarPath } from './backend'
import fs from 'fs'
import {
  resolvePersistedWorkspace,
  persistWorkspace,
  upsertProject,
  removeProject,
  renameProject,
  projectViews,
  seedProjectsIfEmpty,
  seedProjectsFromJson,
} from './settings'
import type { BackendEvent } from '../shared/types'
import {
  readTasks as autoReadTasks, removeTask as autoRemoveTask,
  readRuns as autoReadRuns, readLastPanelOpenedAt, writeLastPanelOpenedAt, badgeVisible,
  sweepNonTerminalRuns, upsertTaskFromRenderer as autoUpsertTaskFromRenderer,
} from './automationsStore'
import { AutomationScheduler } from './automationScheduler'
import type { AutomationTask, AutomationEvent } from '../shared/types'
import { resolveInterruptTurnId } from './interruptTurnId'
import { shouldForwardNotification } from './notificationFilter'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// E2E:userData 重定向到临时目录,settings 读写不污染真实应用数据
if (process.env['WRAITH_E2E_USERDATA']) {
  app.setPath('userData', process.env['WRAITH_E2E_USERDATA'])
}

// ---------------------------------------------------------------------------
// State — kept in module scope (single main process, single window)
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null
let child: ChildProcessWithoutNullStreams | null = null
let client: JsonRpcClient | null = null

/** Last sessionId returned by session.start. */
let currentSessionId: string | null = null
/** Last turnId returned by turn.submit. */
let currentTurnId: string | null = null

const defaultJar = defaultJarPath(os.homedir())

let automationScheduler: AutomationScheduler | null = null

function pushAutomation(evt: AutomationEvent): void {
  try {
    mainWindow?.webContents.send('wraith:automation-event', evt)
  } catch { /* window destroyed — 静默降级 */ }
}

function pushBadge(): void {
  try {
    const ud = app.getPath('userData')
    pushAutomation({ kind: 'badge', show: badgeVisible(autoReadRuns(ud), readLastPanelOpenedAt(ud)) })
  } catch { /* 降级 */ }
}

function notifyOS(title: string, body: string): void {
  // 通知权限被拒/不支持:静默降级(红点仍然工作,spec §7)
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body })
      n.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show()
          pushAutomation({ kind: 'open-panel' })
        }
      })
      n.show()
    }
  } catch { /* 降级 */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// C1 flake investigation: deterministic trace of notification forwarding.
// When WRAITH_E2E_DEBUG_LOG is set, append `<ts> FWD <method>` right before we
// forward each server-push notification to the renderer (synchronous append so
// nothing is lost to buffering under load).
const e2eDebugLogPath = process.env['WRAITH_E2E_DEBUG_LOG']
function e2eDebugLog(method: string): void {
  if (!e2eDebugLogPath) return
  try {
    fs.appendFileSync(e2eDebugLogPath, `${Date.now()} FWD ${method}\n`)
  } catch {
    /* ignore */
  }
}

function sendEvent(evt: BackendEvent): void {
  if (evt.kind === 'notification') e2eDebugLog(evt.method)
  mainWindow?.webContents.send('wraith:event', evt)
}

/**
 * Spawn (or re-spawn) the backend child process and wire JsonRpcClient to it.
 * Safe to call multiple times (previous child is killed first if alive).
 */
function spawnBackend(): void {
  // Kill previous child if any
  if (child) {
    try {
      child.kill()
    } catch {
      // ignore
    }
    child = null
    client = null
  }

  const { cmd, args } = resolveBackendCommand(process.env, defaultJar)

  const proc = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe']
  }) as ChildProcessWithoutNullStreams

  child = proc

  // Create a new client bound to this child's stdin.
  const rpcClient = new JsonRpcClient((line) => {
    if (!proc.killed && proc.stdin.writable) {
      proc.stdin.write(line + '\n')
    }
  })
  client = rpcClient

  // Forward server-push notifications to renderer.
  // T12 防御性会话过滤:params.sessionId 存在且不匹配当前活跃会话时丢弃通知。
  // 无 sessionId 的通知始终放行(兼容)。单会话 v1 下行为不变(see notificationFilter.ts)。
  rpcClient.onNotification((method, params) => {
    if (!shouldForwardNotification(currentSessionId, params)) return
    sendEvent({ kind: 'notification', method, params })
  })

  // Read child stdout line-by-line → JsonRpcClient.handleLine.
  const rl = readline.createInterface({ input: proc.stdout })
  rl.on('line', (line) => {
    rpcClient.handleLine(line)
  })

  // Route child stderr to main's stderr (never feed into handleLine).
  proc.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk)
  })

  // Announce connected.
  sendEvent({ kind: 'connection', state: 'connected' })

  // Disconnect handlers — all paths must reject pending + notify renderer.
  function handleDisconnect(): void {
    // Guard: only fire once per spawn.
    if (client !== rpcClient) return
    client = null
    child = null
    sendEvent({ kind: 'connection', state: 'disconnected' })
    rpcClient.rejectAll('backend disconnected')
  }

  proc.on('exit', handleDisconnect)
  proc.on('error', handleDisconnect)
  rl.on('close', handleDisconnect)
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createWindow(): void {
  const preloadPath = path.join(__dirname, '../preload/index.cjs')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // I-5: 重启后红点恢复——首帧加载完即按当前 runs 推一次 badge(pushBadge 内部已 try/catch)
  mainWindow.webContents.on('did-finish-load', () => pushBadge())

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('wraith:initialize', async (_e, workspaceDir: string | null) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('initialize', { clientInfo: 'wraith-desktop', workspaceDir })
})

ipcMain.handle('wraith:startSession', async (_e, workspaceDir: string | null) => {
  if (!client) throw new Error('Backend not connected')
  const result = await client.request('session.start', { workspaceDir })
  const r = result as { sessionId: string }
  currentSessionId = r.sessionId
  return r
})

ipcMain.handle('wraith:submitTurn', async (_e, input: string, attachments?: { path: string; kind: string }[]) => {
  if (!client) throw new Error('Backend not connected')
  // T11 硬化:进入早窗(submit 在途、尚未 resolve)前清零 currentTurnId,
  // 使此窗口内的 turn.interrupt 发送 null 而非陈旧的上一 turn id。
  // 后端按线程中断、不读 turnId,运行时行为不变(纯防御性)。
  currentTurnId = null
  const result = await client.request('turn.submit', {
    sessionId: currentSessionId,
    input,
    ...(attachments?.length ? { attachments: attachments.map(a => ({ path: a.path, kind: a.kind })) } : {})
  })
  const r = result as { turnId: string; status: string }
  currentTurnId = r.turnId
  return r
})

ipcMain.handle('wraith:pickAttachments', async () => {
  // E2E 分支:WRAITH_E2E_ATTACH 是 JSON 数组 of paths,直接返回注入值。照 WRAITH_E2E_PICK 先例。
  if (process.env['WRAITH_E2E'] === '1' && process.env['WRAITH_E2E_ATTACH']) {
    let paths: string[] = []
    try { paths = JSON.parse(process.env['WRAITH_E2E_ATTACH']) as string[] } catch { /* 坏 JSON → 空 */ }
    const { attachmentKind } = await import('../shared/attachmentKind.js')
    return paths.map(p => ({
      path: p,
      name: path.basename(p),
      kind: attachmentKind(p)
    }))
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
          { name: '文本 / 代码', extensions: ['txt', 'md', 'ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'sh', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
    : await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
          { name: '文本 / 代码', extensions: ['txt', 'md', 'ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'sh', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
  if (result.canceled || result.filePaths.length === 0) return []
  const { attachmentKind } = await import('../shared/attachmentKind.js')
  return result.filePaths.map(p => ({
    path: p,
    name: path.basename(p),
    kind: attachmentKind(p)
  }))
})

ipcMain.handle(
  'wraith:respondApproval',
  async (
    _e,
    approvalId: string,
    decision: string,
    opts: { modifiedArgs?: string; allowNetwork?: boolean } | null
  ) => {
    if (!client) throw new Error('Backend not connected')
    await client.request('approval.respond', {
      approvalId,
      decision,
      ...(opts?.modifiedArgs ? { modifiedArgs: opts.modifiedArgs } : {}),
      ...(opts?.allowNetwork ? { allowNetwork: true } : {})
    })
  }
)

ipcMain.handle('wraith:interrupt', async () => {
  if (!client) throw new Error('Backend not connected')
  // T11 硬化:resolveInterruptTurnId 确保早窗(currentTurnId 已清零)发 null,
  // 而非陈旧的上一 turn id。后端按线程中断不读 turnId,行为不变(纯防御性)。
  await client.request('turn.interrupt', {
    sessionId: currentSessionId,
    turnId: resolveInterruptTurnId(currentTurnId)
  })
})

/**
 * Startup workspace — NO dialog. Returns the persisted workspace (if it still
 * exists and is a directory), else the home directory. The user changes it via
 * the project switcher "添加项目" button or the composer's "重选目录" button
 * (both route to wraith:addProject), which is the only place a native dialog appears.
 */
ipcMain.handle('wraith:getInitialWorkspace', async () => {
  // E2E: startup workspace is injected directly (unset → null → backend default).
  if (process.env['WRAITH_E2E'] === '1') {
    return process.env['WRAITH_E2E_WORKSPACE'] ?? null
  }
  return resolvePersistedWorkspace(app.getPath('userData')) ?? os.homedir()
})

ipcMain.handle('wraith:listProjects', async () => {
  return { projects: projectViews(app.getPath('userData')) }
})

/** 激活项目:目录校验 → upsert 刷 lastUsedAt → 持久化为当前 workspace。 */
ipcMain.handle('wraith:activateProject', async (_e, projectPath: string) => {
  try {
    if (!fs.statSync(projectPath).isDirectory()) return { ok: false }
  } catch {
    return { ok: false } // 不存在/不可达 → 前端刷新列表置灰
  }
  const ud = app.getPath('userData')
  upsertProject(ud, projectPath, Date.now())
  persistWorkspace(ud, projectPath)
  return { ok: true }
})

/** 添加项目:弹目录选择框,选中即入列表并激活(取消返回 null)。 */
ipcMain.handle('wraith:addProject', async () => {
  const ud = app.getPath('userData')
  let picked: string | null
  if (process.env['WRAITH_E2E'] === '1') {
    picked = process.env['WRAITH_E2E_PICK'] ?? null // unset → null → 取消/no-op
  } else {
    const current = resolvePersistedWorkspace(ud) ?? os.homedir()
    // 模态:弹窗期间冻结渲染进程输入,防止 turn 运行中触发 session.start 换会话
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], defaultPath: current })
      : await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: current })
    picked = result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!
  }
  if (!picked) return null
  upsertProject(ud, picked, Date.now())
  persistWorkspace(ud, picked)
  return picked
})

ipcMain.handle('wraith:removeProject', async (_e, projectPath: string) => {
  removeProject(app.getPath('userData'), projectPath)
})

ipcMain.handle('wraith:renameProject', async (_e, projectPath: string, name: string) => {
  renameProject(app.getPath('userData'), projectPath, name)
})

ipcMain.handle('wraith:mcpList', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.list', {})
})

ipcMain.handle('wraith:mcpEnable', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.enable', { name })
})

ipcMain.handle('wraith:mcpDisable', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.disable', { name })
})

ipcMain.handle('wraith:mcpRestart', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.restart', { name })
})

ipcMain.handle('wraith:mcpLogs', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.logs', { name })
})

ipcMain.handle('wraith:mcpResources', async (_e, name: string | undefined) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.resources', name ? { name } : {})
})

ipcMain.handle('wraith:mcpPrompts', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.prompts', { name })
})

ipcMain.handle('wraith:mcpConfigUpsert', async (_e, payload: unknown) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.config.upsert', payload as Record<string, unknown>)
})

ipcMain.handle('wraith:mcpConfigRemove', async (_e, scope: string, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.config.remove', { scope, name })
})

ipcMain.handle('wraith:restartBackend', async () => {
  currentSessionId = null
  currentTurnId = null
  spawnBackend()
  // Renderer is responsible for re-running initialize/startSession after restart.
})

ipcMain.handle('wraith:modelList', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('model.list', {})
})

ipcMain.handle('wraith:setModel', async (_e, provider: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.setModel', { sessionId: currentSessionId, provider })
})

ipcMain.handle('wraith:setDefaultProvider', async (_e, provider: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('config.setDefaultProvider', { provider })
})

ipcMain.handle('wraith:setApprovalMode', async (_e, auto: boolean) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.setApprovalMode', {
    sessionId: currentSessionId,
    auto
  })
})

ipcMain.handle('wraith:listSessions', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.list', {})
})

ipcMain.handle('wraith:resumeSession', async (_e, sessionId: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.resume', { sessionId })
})

ipcMain.handle('wraith:rewindSession', async (_e, userOrdinal: number) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.rewind', { sessionId: currentSessionId, userOrdinal })
})

// ---------------------------------------------------------------------------
// Automation IPC handlers (Phase E-2)
// ---------------------------------------------------------------------------

ipcMain.handle('wraith:automationList', async () => ({ tasks: autoReadTasks(app.getPath('userData')) }))
ipcMain.handle('wraith:automationUpsert', async (_e, task: AutomationTask) => {
  autoUpsertTaskFromRenderer(app.getPath('userData'), task)
  return { ok: true }
})
ipcMain.handle('wraith:automationRemove', async (_e, id: string) => {
  autoRemoveTask(app.getPath('userData'), id)
  pushBadge()
  return { ok: true }
})
ipcMain.handle('wraith:automationRunNow', async (_e, id: string) => automationScheduler?.runNow(id) ?? { ok: false })
ipcMain.handle('wraith:automationStop', async (_e, runId: string) => automationScheduler?.stopRun(runId) ?? { ok: false })
ipcMain.handle('wraith:automationRuns', async () => ({ runs: autoReadRuns(app.getPath('userData')) }))
ipcMain.handle('wraith:automationRespondApproval', async (_e, runId: string, approvalId: string, decision: string,
    opts: { modifiedArgs?: string; allowNetwork?: boolean } | null) =>
  automationScheduler?.respondApproval(runId, approvalId, decision, opts) ?? { ok: false })
ipcMain.handle('wraith:automationPanelOpened', async () => {
  writeLastPanelOpenedAt(app.getPath('userData'), Date.now())
  pushBadge()
  return { ok: true }
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  const ud = app.getPath('userData')
  const injected = process.env['WRAITH_E2E_PROJECTS']
  if (process.env['WRAITH_E2E'] === '1') {
    // E2E 只认注入,不跑迁移(未注入 USERDATA 的旧用例不该写真实 userData)
    if (injected) seedProjectsFromJson(ud, injected, Date.now())
  } else {
    seedProjectsIfEmpty(ud, Date.now())
  }
  // I-1: 崩溃/退出残留的非终态 run 启动即清扫为 interrupted(scheduler 实例化之前;best-effort)
  try {
    sweepNonTerminalRuns(app.getPath('userData'))
  } catch { /* best-effort:清扫失败不阻塞启动 */ }
  automationScheduler = new AutomationScheduler({
    userDataDir: app.getPath('userData'),
    env: process.env,
    homedir: os.homedir(),
    onRunsChanged: () => {
      try {
        pushAutomation({ kind: 'runs-changed' })
        pushBadge()
      } catch { /* window destroyed — 静默降级 */ }
    },
    onApproval: (runId, payload) => {
      try {
        pushAutomation({ kind: 'approval', runId, payload })
        pushBadge()
        notifyOS('Wraith 自动化等待审批', '有任务挂起等待你的审批')
      } catch { /* 降级 */ }
    },
    onTerminal: run => {
      // runs-changed 与 badge 已由 finishRun 先行调用的 onRunsChanged 推送,
      // 此处只负责系统通知——依赖调度器 finishRun 内 onRunsChanged→onTerminal 的调用顺序
      try {
        const label = run.status === 'success' ? '完成' : run.status === 'failed' ? '失败' : '中断'
        notifyOS('Wraith 自动化任务' + label, run.summary ?? '')
      } catch { /* 降级 */ }
    },
  })
  automationScheduler.start()

  createWindow()
  spawnBackend()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Kill the backend child on actual quit so it doesn't linger.
// 'will-quit' fires on all platforms (unlike 'window-all-closed' which is
// skipped on macOS); this guarantees cleanup regardless of how the app exits.
app.on('will-quit', () => {
  try {
    child?.kill()
  } catch {
    // ignore — child may already be gone
  }
  // stopAll: interrupted 落盘同步完成;子进程信号回收 best-effort(异步,不 await)
  try {
    automationScheduler?.stopAll()
  } catch {
    // best-effort
  }
})
