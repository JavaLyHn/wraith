import { app, BrowserWindow, ipcMain, dialog, Notification, shell, session } from 'electron'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import readline from 'readline'
import { JsonRpcClient } from '../shared/jsonRpcClient'
import { resolveBackendCommand, defaultJarPath } from './backend'
import { computeUpdate, describeHttpError, type GhRelease } from './updateCheck'
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
  readTasks as autoReadTasks,
  readRuns as autoReadRuns, readLastPanelOpenedAt, writeLastPanelOpenedAt, badgeVisible,
  sweepNonTerminalRuns,
} from './automationsStore'
import { mapLegacyTask, needsMigration } from './automationMigration'
import type { LegacyAutomationTask } from './automationMigration'
import type { AutomationTask, AutomationRun, AutomationEvent } from '../shared/types'
import type { SkillUpsertPayload } from '../shared/types'
import { resolveInterruptTurnId } from './interruptTurnId'
import { shouldForwardNotification, MULTI_SESSION_FILTER_ENABLED } from './notificationFilter'
import { GatewayManager } from './gatewayManager'
import type { GatewayEvent } from '../shared/gateway'
import { shouldDismissSplash, buildSplashHtml, SPLASH_EXIT_MS, SPLASH_SIZE } from './splash'
import { SPLASH_LOGO_DATA_URI } from './splashLogo'

// T12 多会话过滤门控 MULTI_SESSION_FILTER_ENABLED 现由 notificationFilter.ts 导出
// (v1 必须保持 false;单测锁定其值防误翻)。

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Dock 提示/菜单栏/关于面板显示 "Wraith"(dev 下 app.name 否则回落为 "Electron";
// 打包版由 electron-builder productName 处理)。
// 注意:app.setName() 会改变默认 userData 目录(→ …/Application Support/Wraith),
// 从而丢失原有 settings(workspace/projects 等,dev 原本在 …/wraith-desktop)。
// 因此先捕获 setName 前的真实 userData,setName 后再显式钉回,保证数据连续性。
const preservedUserData = app.getPath('userData')
app.setName('Wraith')
app.setPath('userData', preservedUserData)

// E2E:userData 重定向到临时目录,settings 读写不污染真实应用数据(晚于上面,故覆盖生效)
if (process.env['WRAITH_E2E_USERDATA']) {
  app.setPath('userData', process.env['WRAITH_E2E_USERDATA'])
}

// ---------------------------------------------------------------------------
// State — kept in module scope (single main process, single window)
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let backendConnected = false
let child: ChildProcessWithoutNullStreams | null = null
let client: JsonRpcClient | null = null

/** Last sessionId returned by session.start. */
let currentSessionId: string | null = null
/** Last turnId returned by turn.submit. */
let currentTurnId: string | null = null

const defaultJar = defaultJarPath(os.homedir())

/** In-memory high-water mark for desktop-notify polling (Part D). */
// only notify runs that complete after app-open; avoids re-notifying历史 runs on cold start
let notifyPollLastSeen = Date.now()
let notifyPollTimer: ReturnType<typeof setInterval> | null = null

let gatewayManager: GatewayManager | null = null

function pushGateway(evt: GatewayEvent): void {
  try {
    mainWindow?.webContents.send('wraith:gateway-event', evt)
  } catch { /* window destroyed — 静默降级 */ }
}

function pushAutomation(evt: AutomationEvent): void {
  try {
    mainWindow?.webContents.send('wraith:automation-event', evt)
  } catch { /* window destroyed — 静默降级 */ }
}

function pushBadge(): void {
  // Best-effort: ask daemon for current runs; fall back to local legacy file if client not ready.
  const ud = app.getPath('userData')
  const lastPanelOpenedAt = readLastPanelOpenedAt(ud)
  if (client) {
    client.request('automations.runs', {}).then((res) => {
      const r = res as { runs?: AutomationRun[] }
      const runs = r.runs ?? []
      pushAutomation({ kind: 'badge', show: badgeVisible(runs, lastPanelOpenedAt) })
    }).catch(() => {
      // daemon not ready yet — fall back to local legacy file
      try {
        pushAutomation({ kind: 'badge', show: badgeVisible(autoReadRuns(ud), lastPanelOpenedAt) })
      } catch { /* 降级 */ }
    })
  } else {
    try {
      pushAutomation({ kind: 'badge', show: badgeVisible(autoReadRuns(ud), lastPanelOpenedAt) })
    } catch { /* 降级 */ }
  }
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

  const { cmd, args } = resolveBackendCommand(process.env, defaultJarPath(os.homedir()), app.isPackaged ? { resourcesPath: process.resourcesPath } : undefined)

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
  // T12 防御性会话过滤:MULTI_SESSION_FILTER_ENABLED = false 时始终放行(v1 byte-identical)。
  // v1 会话 id 于 turn.completed 时从 sess_… 换为持久化 id(20260703T…),
  // 若门控开启将误丢弃 turn.completed 导致 turn 永卡 running。
  // 启用前须先在 turn.completed / resumeSession 处同步 currentSessionId 为持久化 id。
  // TODO(resume-sync): wraith:resumeSession 也需要在启用前将 currentSessionId 同步为持久化 id。
  rpcClient.onNotification((method, params) => {
    if (!shouldForwardNotification(currentSessionId, params, MULTI_SESSION_FILTER_ENABLED)) return
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
  backendConnected = true

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
    show: false,
    // dev: show WR icon instead of Electron atom; packaged macOS: dock icon comes from .icns
    icon: app.isPackaged ? undefined : path.join(__dirname, '../../build/icon-512.png'),
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

/** 显示主窗(幂等):splash 散去后调用。 */
function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show()
  }
}

/** 创建透明无边框启动窗;失败返回 null(绝不阻塞启动)。 */
function createSplash(): BrowserWindow | null {
  try {
    const win = new BrowserWindow({
      width: SPLASH_SIZE, height: SPLASH_SIZE, center: true,
      transparent: true, frame: false, backgroundColor: '#00000000',
      alwaysOnTop: true, hasShadow: false, resizable: false, movable: false,
      skipTaskbar: true, focusable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildSplashHtml(SPLASH_LOGO_DATA_URI)))
    win.on('closed', () => { splashWindow = null })
    return win
  } catch {
    return null
  }
}

/** 散去 splash(幂等):触发页内淡出 → SPLASH_EXIT_MS 后关窗并显示主窗。 */
let splashDismissed = false
function dismissSplash(): void {
  if (splashDismissed) return
  splashDismissed = true
  const s = splashWindow
  if (s && !s.isDestroyed()) {
    s.webContents.executeJavaScript('window.__dismiss && window.__dismiss()').catch(() => {})
    setTimeout(() => {
      if (s && !s.isDestroyed()) s.close()
      showMainWindow()
    }, SPLASH_EXIT_MS)
  } else {
    showMainWindow()
  }
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

ipcMain.handle('wraith:submitTurn', async (_e, input: string, attachments?: { path: string; kind: string }[], mode?: 'react' | 'plan' | 'team') => {
  if (!client) throw new Error('Backend not connected')
  // T11 硬化:进入早窗(submit 在途、尚未 resolve)前清零 currentTurnId,
  // 使此窗口内的 turn.interrupt 发送 null 而非陈旧的上一 turn id。
  // 后端按线程中断、不读 turnId,运行时行为不变(纯防御性)。
  currentTurnId = null
  const result = await client.request('turn.submit', {
    sessionId: currentSessionId,
    input,
    ...(attachments?.length ? { attachments: attachments.map(a => ({ path: a.path, kind: a.kind })) } : {}),
    mode: mode ?? 'react',
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

// 粘贴图片:renderer 只有内存 blob、无磁盘路径,先落临时文件再走附件通道。
let pastedImageSeq = 0
ipcMain.handle('wraith:saveTempImage', async (_e, base64: string, ext: string) => {
  const { validImageExt, tempImageName } = await import('./tempImage.js')
  const safeExt = validImageExt(ext)
  if (!safeExt) throw new Error('不支持的图片格式(支持 png/jpg/jpeg/gif/webp)')
  if (!base64 || typeof base64 !== 'string') throw new Error('剪贴板图片为空')
  const buf = Buffer.from(base64, 'base64')
  if (buf.length === 0) throw new Error('剪贴板图片解码为空')
  if (buf.length > 20 * 1024 * 1024) throw new Error('粘贴图片过大(超 20MB)')
  const dir = path.join(os.tmpdir(), 'wraith-paste')
  await fs.promises.mkdir(dir, { recursive: true })
  const name = tempImageName(safeExt, pastedImageSeq++, Date.now())
  const filePath = path.join(dir, name)
  await fs.promises.writeFile(filePath, buf)
  return { path: filePath, name, kind: 'image' }
})

// 附件缩略图:把磁盘图片读成 data: URL 供 renderer <img> 直接显示(无 CSP,data: 可用)。
ipcMain.handle('wraith:readImageDataUrl', async (_e, filePath: string) => {
  const { validImageExt } = await import('./tempImage.js')
  const ext = validImageExt(path.extname(filePath))
  if (!ext) return null
  try {
    const buf = await fs.promises.readFile(filePath)
    if (buf.length === 0 || buf.length > 20 * 1024 * 1024) return null
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
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

// Plan mode 审批响应:将用户决策(execute/supplement/cancel)透传给后端 plan.review.respond。
ipcMain.handle('wraith:respondPlanReview', async (_e, reviewId: string, decision: string, feedback: string | null) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('plan.review.respond', { reviewId, decision, ...(feedback ? { feedback } : {}) })
})

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

ipcMain.handle('wraith:mcpTest', async (_e, payload: unknown) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('mcp.test', payload as Record<string, unknown>)
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

ipcMain.handle('wraith:setProvider', async (_e, p: { id: string; apiKey: string; model?: string; baseUrl?: string; protocol?: string; label?: string }) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('config.setProvider', p)
})

ipcMain.handle('wraith:removeProvider', async (_e, id: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('config.removeProvider', { id })
})

ipcMain.handle('wraith:testProvider', async (_e, p: { id: string; apiKey?: string; model?: string; baseUrl?: string; protocol?: string }) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('config.testProvider', p)
})

ipcMain.handle('wraith:skillsList', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.list', {})
})

// 长期记忆查看/管理(转发 AppServer memory.* RPC)
ipcMain.handle('wraith:memoryList', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('memory.list', {})
})
ipcMain.handle('wraith:memorySearch', async (_e, query: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('memory.search', { query })
})
ipcMain.handle('wraith:memoryDelete', async (_e, id: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('memory.delete', { id })
})
ipcMain.handle('wraith:memorySave', async (_e, fact: string, scope: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('memory.save', { fact, scope })
})
ipcMain.handle('wraith:memoryInitProject', async (_e, force: boolean) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('memory.initProject', { force: !!force })
})
ipcMain.handle('wraith:memoryClear', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('memory.clear', {})
})

// side-git 快照时间线 + 恢复(转发 AppServer snapshot.* RPC)
ipcMain.handle('wraith:snapshotList', async (_e, limit?: number) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('snapshot.list', { limit: limit ?? 0 })
})
ipcMain.handle('wraith:snapshotRestore', async (_e, offset: number) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('snapshot.restore', { offset })
})
ipcMain.handle('wraith:snapshotRestoreCommit', async (_e, commitId: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('snapshot.restoreCommit', { commitId })
})
ipcMain.handle('wraith:snapshotClean', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('snapshot.clean', {})
})

// 手动压缩当前对话历史(转发 AppServer session.compact,后端后台线程跑)
ipcMain.handle('wraith:compactHistory', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.compact', {})
})

// 后台任务(转发 AppServer task.*;与 CLI /task 共享 ~/.wraith/tasks/tasks.db)
ipcMain.handle('wraith:taskList', async (_e, limit: number) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('task.list', { limit: limit ?? 20 })
})
ipcMain.handle('wraith:taskAdd', async (_e, prompt: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('task.add', { prompt })
})
ipcMain.handle('wraith:taskGet', async (_e, id: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('task.get', { id })
})
ipcMain.handle('wraith:taskCancel', async (_e, id: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('task.cancel', { id })
})

// 安全策略状态 + 危险工具审计(只读,转发 AppServer policy.status / audit.list)
ipcMain.handle('wraith:policyStatus', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('policy.status', {})
})
ipcMain.handle('wraith:auditList', async (_e, limit?: number) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('audit.list', { limit: limit ?? 20 })
})
ipcMain.handle('wraith:sandboxGet', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('sandbox.get', {})
})
ipcMain.handle('wraith:sandboxSet', async (_e, networkAllowed: boolean) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('sandbox.set', { networkAllowed: !!networkAllowed })
})

// 浏览器会话管理(转发 AppServer browser.* RPC;文本直通)
ipcMain.handle('wraith:browserStatus', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('browser.status', {})
})
ipcMain.handle('wraith:browserConnect', async (_e, port?: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('browser.connect', { port: port ?? null })
})
ipcMain.handle('wraith:browserDisconnect', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('browser.disconnect', {})
})
ipcMain.handle('wraith:browserTabs', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('browser.tabs', {})
})

// Embedding 后端配置 + RAG 检索 / 代码图谱(转发 config.*Embedding / rag.* RPC)
ipcMain.handle('wraith:configGetEmbedding', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('config.getEmbedding', {})
})
ipcMain.handle('wraith:configSetEmbedding', async (_e, cfg: { provider: string; model: string; baseUrl: string; apiKey: string }) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('config.setEmbedding', cfg)
})
ipcMain.handle('wraith:ragStatus', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('rag.status', {})
})
ipcMain.handle('wraith:ragIndex', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('rag.index', {})
})
ipcMain.handle('wraith:ragSearch', async (_e, query: string, topK?: number) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('rag.search', { query, topK: topK ?? 8 })
})
ipcMain.handle('wraith:ragGraph', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('rag.graph', { name })
})

ipcMain.handle('wraith:setSkillEnabled', async (_e, name: string, enabled: boolean) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.setEnabled', { name, enabled })
})

ipcMain.handle('wraith:getSkill', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.get', { name })
})

ipcMain.handle('wraith:upsertSkill', async (_e, payload: SkillUpsertPayload) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.upsert', payload)
})

ipcMain.handle('wraith:deleteSkill', async (_e, scope: 'user' | 'project', name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.delete', { scope, name })
})

ipcMain.handle('wraith:skillExistsInScope', async (_e, scope: 'user' | 'project', name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.existsInScope', { scope, name })
})

ipcMain.handle('wraith:transcribe', async (_e, audioBase64: string, mime: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('stt.transcribe', { audioBase64, mime })
})

ipcMain.handle('wraith:forkSkill', async (_e, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('skills.fork', { name })
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

ipcMain.handle('wraith:listBuiltinTools', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('tools.list', {})
})

ipcMain.handle('wraith:resumeSession', async (_e, sessionId: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.resume', { sessionId })
})

ipcMain.handle('wraith:peekSession', async (_e, sessionId: string) => {
  if (!client) throw new Error('Backend not connected')
  // 只读预览:不更新 currentSessionId(这是运行中会话的活跃指针)。
  return client.request('session.peek', { sessionId })
})

ipcMain.handle('wraith:rewindSession', async (_e, userOrdinal: number) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.rewind', { sessionId: currentSessionId, userOrdinal })
})

ipcMain.handle('wraith:setSessionStarred', async (_e, sessionId: string, starred: boolean) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.setStarred', { sessionId, starred })
})

ipcMain.handle('wraith:renameSession', async (_e, sessionId: string, name: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.rename', { sessionId, name })
})

ipcMain.handle('wraith:deleteSession', async (_e, sessionId: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('session.delete', { sessionId })
})

// ---------------------------------------------------------------------------
// Automation IPC handlers (Task 18: 全部路由到 daemon RPC)
// ---------------------------------------------------------------------------
// singular 前缀(automationList/Upsert/Remove/Runs)和 plural 前缀(automationsList/Upsert/Remove/Runs)
// 均代理到 client.request('automations.*')。renderer 继续调 singular 方法;
// Task 16 的 preload plural 方法也全部就绪。两套方法合一到同一 RPC 实现,无死代码。

/** 如果 task 携带旧 projectPath 但无 workspace,补填 workspace 后再发给 daemon。 */
function ensureWorkspace(task: AutomationTask): AutomationTask {
  if (!task.workspace && task.projectPath) {
    return { ...task, workspace: task.projectPath }
  }
  return task
}

// --- singular (renderer-facing, backward-compat) ---
ipcMain.handle('wraith:automationList', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.list', {})
})
ipcMain.handle('wraith:automationUpsert', async (_e, task: AutomationTask) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.upsert', ensureWorkspace(task))
})
ipcMain.handle('wraith:automationRemove', async (_e, id: string) => {
  if (!client) throw new Error('Backend not connected')
  const res = await client.request('automations.remove', { id })
  pushBadge()
  return res
})
ipcMain.handle('wraith:automationRunNow', async (_e, id: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.runNow', { id })
})
// v1: 定时任务为进程内回合,不可中断 — UI 层不再暴露 STOP 按钮;此 handler 仅保留为存根。
ipcMain.handle('wraith:automationStop', async (_e, runId: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.stop', { runId })
})
ipcMain.handle('wraith:automationRuns', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.runs', {})
})
// Fix-B: param contract aligned to Fix-A — forwards { approvalId, decision } to daemon.
ipcMain.handle('wraith:automationRespondApproval', async (_e, approvalId: string, decision: 'approve' | 'reject') => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.respondApproval', { approvalId, decision })
})
ipcMain.handle('wraith:automationPanelOpened', async () => {
  writeLastPanelOpenedAt(app.getPath('userData'), Date.now())
  pushBadge()
  return { ok: true }
})

// --- plural (Task 16 preload channels) ---
ipcMain.handle('wraith:automationsList', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.list', {})
})
ipcMain.handle('wraith:automationsUpsert', async (_e, task: AutomationTask) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.upsert', ensureWorkspace(task))
})
ipcMain.handle('wraith:automationsRemove', async (_e, id: string) => {
  if (!client) throw new Error('Backend not connected')
  const res = await client.request('automations.remove', { id })
  pushBadge()
  return res
})
ipcMain.handle('wraith:automationsRuns', async (_e, taskId?: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.runs', taskId ? { taskId } : {})
})

// ---------------------------------------------------------------------------
// IM 网关(QQ)—— Phase F
// ---------------------------------------------------------------------------
ipcMain.handle('wraith:gatewayGetConfig', async (_e, platform?: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('gateway.config.get', platform ? { platform } : {})
})
ipcMain.handle('wraith:gatewaySetFeishuConfig', async (_e, fields: Record<string, string | undefined>) => {
  if (!client) throw new Error('Backend not connected')
  await client.request('gateway.config.set', { platform: 'feishu', ...fields })
  return { ok: true }
})
ipcMain.handle('wraith:gatewaySetWecomConfig', async (_e, fields: Record<string, string | undefined>) => {
  if (!client) throw new Error('Backend not connected')
  await client.request('gateway.config.set', { platform: 'wecom', ...fields })
  return { ok: true }
})
ipcMain.handle('wraith:gatewayBindWeixinStart', (_e, workspace?: string) => {
  gatewayManager?.bindWeixinStart(workspace)
})
ipcMain.handle('wraith:gatewaySetWeixinConfig', async (_e, fields: Record<string, string | undefined>) => {
  if (!client) throw new Error('Backend not connected')
  await client.request('gateway.config.set', { platform: 'weixin', ...fields })
  return { ok: true }
})
ipcMain.handle('wraith:gatewaySetSecret', async (_e, secret: string) => {
  if (!client) throw new Error('Backend not connected')
  await client.request('gateway.config.set', { clientSecret: secret })
  return { ok: true }
})
ipcMain.handle('wraith:gatewaySetWorkspace', async (_e, workspace: string) => {
  if (!client) throw new Error('Backend not connected')
  await client.request('gateway.config.set', { workspace })
  return { ok: true }
})
ipcMain.handle('wraith:gatewayPickWorkspace', async () => {
  const res = mainWindow
    ? await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    : await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (res.canceled || res.filePaths.length === 0) return null
  return res.filePaths[0]
})
ipcMain.handle('wraith:gatewayStart', async () => { gatewayManager?.start(); return { ok: true } })
ipcMain.handle('wraith:gatewayStop', async () => { gatewayManager?.stop(); return { ok: true } })
ipcMain.handle('wraith:gatewayRestart', async () => { gatewayManager?.restart(); return { ok: true } })
ipcMain.handle('wraith:gatewayStatus', async () => gatewayManager?.getStatus() ?? { state: 'stopped' })
ipcMain.handle('wraith:gatewayLogs', async () => ({ lines: gatewayManager?.getLogs() ?? [] }))
ipcMain.handle('wraith:gatewayBindStart', async () => { gatewayManager?.bindStart(); return { ok: true } })
ipcMain.handle('wraith:gatewayBindCancel', async () => { gatewayManager?.cancelBind(); return { ok: true } })

ipcMain.handle('wraith:appInfo', () => ({
  version: app.getVersion(),
  repoUrl: 'https://github.com/JavaLyHn/wraith',
  dataDir: path.join(os.homedir(), '.wraith'),
}))

const RELEASES_URL = 'https://github.com/JavaLyHn/wraith/releases'
ipcMain.handle('wraith:checkUpdate', async (_e, beta: boolean) => {
  const current = app.getVersion()
  try {
    const res = await fetch('https://api.github.com/repos/JavaLyHn/wraith/releases', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wraith-desktop' },
    })
    if (!res.ok) {
      const error = describeHttpError(res.status, res.headers.get('x-ratelimit-remaining'), res.headers.get('x-ratelimit-reset'), Date.now())
      // 失败时给 Releases 页兜底,渲染层可让用户手动去看
      return { current, latest: null, hasUpdate: false, url: RELEASES_URL, isPrerelease: false, error }
    }
    const releases = (await res.json()) as GhRelease[]
    return computeUpdate(current, releases, !!beta)
  } catch (e) {
    return { current, latest: null, hasUpdate: false, url: RELEASES_URL, isPrerelease: false, error: (e as Error).message }
  }
})

ipcMain.handle('wraith:openExternal', (_e, url: string) => { void shell.openExternal(url) })
ipcMain.handle('wraith:openPath', (_e, p: string) => shell.openPath(p))

// 导出对话:渲染层把序列化好的 Markdown 传来,弹保存对话框写盘(纯 Electron 主进程,不经 Java 后端)
ipcMain.handle('wraith:saveTextFile', async (_e, defaultName: string, content: string) => {
  const opts = {
    defaultPath: defaultName,
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: '所有文件', extensions: ['*'] }],
  }
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, opts) : await dialog.showSaveDialog(opts)
  if (result.canceled || !result.filePath) return { ok: false }
  await fs.promises.writeFile(result.filePath, content, 'utf8')
  return { ok: true, path: result.filePath }
})

// ---------------------------------------------------------------------------
// Part C: 启动一次性迁移(legacy automations.json → daemon)
// ---------------------------------------------------------------------------

/** Marker file path for "migration already done". */
function migrationFlagPath(ud: string): string {
  return path.join(ud, 'automations-migrated')
}

async function runStartupMigration(ud: string): Promise<void> {
  if (!client) return  // daemon not ready; caller retries are not implemented — skip gracefully

  try {
    const flagFile = migrationFlagPath(ud)
    const alreadyMigrated = fs.existsSync(flagFile)

    // Read legacy tasks from the old local store (automations.json in userData)
    const legacyTasks = autoReadTasks(ud) as LegacyAutomationTask[]

    // Ask daemon for current task list
    const daemonRes = await client.request('automations.list', {}) as { tasks?: AutomationTask[] }
    const daemonTasks = daemonRes.tasks ?? []

    if (!needsMigration(daemonTasks, legacyTasks, alreadyMigrated)) return

    // Migrate each legacy task
    for (const legacy of legacyTasks) {
      try {
        await client.request('automations.upsert', mapLegacyTask(legacy))
      } catch (err) {
        console.warn('[automations] 迁移任务失败,跳过:', legacy.id, err)
      }
    }

    // Set the persistent migration flag (touch the marker file; keep legacy file intact as backup)
    try {
      fs.writeFileSync(flagFile, String(Date.now()), 'utf8')
    } catch (err) {
      console.warn('[automations] 迁移标志写入失败:', err)
    }

    console.info('[automations] 一次性迁移完成,已迁移', legacyTasks.length, '条任务')
  } catch (err) {
    // best-effort: migration failure must not crash the app
    console.warn('[automations] 一次性迁移失败(best-effort,不影响启动):', err)
  }
}

// ---------------------------------------------------------------------------
// Part D: 桌面通知轮询(每 30s 检查新终态 run 且 notifyDesktop=true)
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set<string>(['success', 'failed', 'interrupted'])

async function pollAndNotify(): Promise<void> {
  if (!client) return

  try {
    const res = await client.request('automations.runs', {}) as { runs?: AutomationRun[] }
    const runs = res.runs ?? []

    let maxEndedAt = notifyPollLastSeen
    let sawNew = false

    for (const run of runs) {
      if (!TERMINAL_STATUSES.has(run.status)) continue
      const endedAt = run.endedAt ?? 0
      if (endedAt <= notifyPollLastSeen) continue
      sawNew = true
      if (run.notifyDesktop) {
        const label = run.status === 'success' ? '完成' : run.status === 'failed' ? '失败' : '中断'
        notifyOS('Wraith 自动化任务' + label, run.summary ?? '')
      }
      if (endedAt > maxEndedAt) maxEndedAt = endedAt
    }

    if (maxEndedAt > notifyPollLastSeen) {
      notifyPollLastSeen = maxEndedAt
      // Also refresh badge after finding new terminal runs
      pushBadge()
    }
    if (sawNew) pushAutomation({ kind: 'runs-changed' })   // 触发 renderer 刷新会话/运行历史
  } catch {
    // best-effort: poll failure is silent
  }
}

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
  // I-1: 崩溃/退出残留的非终态 run 清扫(本地 legacy 文件,best-effort)
  try {
    sweepNonTerminalRuns(app.getPath('userData'))
  } catch { /* best-effort:清扫失败不阻塞启动 */ }

  // dev: set WR dock icon to replace Electron atom (packaged macOS uses .icns)
  if (process.platform === 'darwin' && app.dock && !app.isPackaged) {
    try { app.dock.setIcon(path.join(__dirname, '../../build/icon-512.png')) } catch { /* ignore */ }
  }

  gatewayManager = new GatewayManager(
    (evt) => pushGateway(evt),
    process.env,
    defaultJar,
    (url) => { void shell.openExternal(url) },
    app.isPackaged ? { resourcesPath: process.resourcesPath } : undefined
  )

  // 仅放行麦克风(媒体)权限,供语音听写用
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  if (process.env['WRAITH_E2E'] === '1') {
    // E2E 绕过:不建 splash,立即显示主窗,避免 firstWindow() 拿到 splash 或窗口延迟显示干扰用例
    createWindow()
    showMainWindow()
    spawnBackend()
  } else {
    const splashStartedAt = Date.now()
    splashWindow = createSplash()
    try {
      createWindow()
      spawnBackend()

      if (!splashWindow) {
        // 无动画:直接显示主窗,不阻塞
        showMainWindow()
      } else {
        const splashTimer = setInterval(() => {
          if (shouldDismissSplash(Date.now() - splashStartedAt, backendConnected)) {
            clearInterval(splashTimer)
            dismissSplash()
          }
        }, 150)
      }
    } catch {
      // 启动编排异常安全:任何同步异常都必须保证主窗可见(splash 绝不阻塞启动)
      dismissSplash()
    }
  }

  // Part C: 启动一次性迁移(daemon 就绪后执行,defer 500ms 等 RPC 握手完成)
  if (process.env['WRAITH_E2E'] !== '1') {
    setTimeout(() => { void runStartupMigration(app.getPath('userData')) }, 500)
  }

  // Part D: 桌面通知轮询(30s,检查新终态 run 且 notifyDesktop=true)
  notifyPollTimer = setInterval(() => { void pollAndNotify() }, 30_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      showMainWindow()
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
  try {
    if (notifyPollTimer !== null) clearInterval(notifyPollTimer)
  } catch {
    // best-effort
  }
  try {
    gatewayManager?.dispose()
  } catch {
    // best-effort
  }
})
