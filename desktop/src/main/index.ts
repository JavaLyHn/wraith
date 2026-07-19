import { app, BrowserWindow, ipcMain, dialog, Notification, shell, session, screen, Menu } from 'electron'
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
  readPetConfig,
  writePetConfig,
  type PetConfig,
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
import { PtyManager } from './pty'
import type { GatewayEvent } from '../shared/gateway'
import { shouldDismissSplash, buildSplashHtml, SPLASH_EXIT_MS } from './splash'
import { SPLASH_LOGO_DATA_URI } from './splashLogo'
import { listPets, importStaticImage, importPackage, removeImportedPet, previewDataUrl } from './petStore'
import type { PetImportResult } from '../shared/pets'
import { petStateFromEvent } from '../shared/petState'
import { buildPetMenuTemplate } from '../shared/petWindow'
import {
  initPetWindow, syncPetWindow, destroyPetWindow, getPetWindow,
  pushPetConfig, pushPetPreview, pushPetSignal, type PetPreviewPayload,
  petWindowMoveTo, petWindowResizeToScale, petWindowResetPosition, toElectronMenu,
} from './petWindow'

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
let ptyManager: PtyManager | null = null

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
  const sig = petStateFromEvent(evt)
  if (sig) pushPetSignal(sig)
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

  // 首页开局铺满主显示器工作区(菜单栏下、Dock 上),与 splash 一致的"满屏"观感;
  // 仍是普通可缩放/可移动窗口(保留窗口控制)。E2E 用固定尺寸,避免受运行环境屏幕影响。
  const isE2E = process.env['WRAITH_E2E'] === '1'
  const wa = screen.getPrimaryDisplay().workArea
  const bounds = isE2E
    ? { width: 1200, height: 800 }
    : { x: wa.x, y: wa.y, width: wa.width, height: wa.height }

  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    // dev: show WR icon instead of Electron atom; packaged macOS: dock icon comes from .icns
    icon: app.isPackaged ? undefined : path.join(__dirname, '../../build/icon-512.png'),
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 12, y: 11 },
          vibrancy: 'fullscreen-ui' as const,
          visualEffectState: 'active' as const,
          backgroundColor: '#00000000',
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      webviewTag: true
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

/**
 * 创建无边框启动窗:铺满主显示器工作区(菜单栏下、Dock 上),macOS 毛玻璃背景(vibrancy),
 * logo 居中。失败返回 null(绝不阻塞启动)。
 */
function createSplash(): BrowserWindow | null {
  try {
    const isMac = process.platform === 'darwin'
    const { x, y, width, height } = screen.getPrimaryDisplay().workArea
    const win = new BrowserWindow({
      x, y, width, height,
      frame: false, roundedCorners: true,
      alwaysOnTop: true, hasShadow: false, resizable: false, movable: false,
      skipTaskbar: true, focusable: false,
      // macOS:毛玻璃(能透出模糊桌面);其它平台退回透明 + CSS 淡色
      ...(isMac
        ? { vibrancy: 'fullscreen-ui' as const, visualEffectState: 'active' as const }
        : { transparent: true, backgroundColor: '#00000000' }),
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildSplashHtml(SPLASH_LOGO_DATA_URI)))
    win.on('closed', () => { splashWindow = null })
    return win
  } catch {
    return null
  }
}

/** 在 ms 内把整窗透明度 1→0(逐帧 ~16ms,顺滑),然后关闭并回调(毛玻璃整窗淡出)。 */
function fadeOutAndClose(win: BrowserWindow, ms: number, onDone: () => void): void {
  const stepMs = 16
  const steps = Math.max(1, Math.round(ms / stepMs))
  let i = 0
  const timer = setInterval(() => {
    i++
    // ease-in-out 感:用平滑曲线而非线性,淡出更自然
    const p = i / steps
    const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
    if (!win.isDestroyed()) win.setOpacity(Math.max(0, 1 - eased))
    if (i >= steps) {
      clearInterval(timer)
      if (!win.isDestroyed()) win.close()
      onDone()
    }
  }, stepMs)
}

/** 散去 splash(幂等):主窗先现身于 splash 之下 → logo 幽灵散去 + 整窗淡出 → 关闭。 */
let splashDismissed = false
function dismissSplash(): void {
  if (splashDismissed) return
  splashDismissed = true
  const s = splashWindow
  if (s && !s.isDestroyed()) {
    showMainWindow()   // 主窗在毛玻璃 splash 之下就位,随 splash 淡出被揭开
    s.webContents.executeJavaScript('window.__dismiss && window.__dismiss()').catch(() => {})
    fadeOutAndClose(s, SPLASH_EXIT_MS, () => {})
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

// 宠物库:Petdex(只读,~/.codex/pets)与导入副本(userData/pets/imported)的窄 IPC 暴露面。
// 只经 petStore 的 5 个已校验函数;不透出任意文件读、目录列举或原始文件系统路径。
function petdexRoot(): string {
  // E2E 隔离:重定向到临时 fixture 目录,镜像上面 WRAITH_E2E_USERDATA 的写法——
  // 只看这一个变量是否设置,不读真实 ~/.codex/pets,也不读写真实用户 profile。
  // 未设置时(生产环境恒未设置)行为完全不变。
  return process.env['WRAITH_E2E_PETDEX_ROOT'] || path.join(os.homedir(), '.codex', 'pets')
}

// 只放行 petStore 自己抛出的、已确认不含文件系统路径的校验文案;其余一切
// (尤其是 Node fs 原生错误,如 ENOENT/ELOOP/EACCES——message 里会带 userData
// 下的绝对路径)一律折叠成通用文案。不透传原始 error.message,不把路径带进 renderer。
const SAFE_PET_IMPORT_ERRORS = new Set([
  '非法宠物 ID', '非法精灵图路径', '非法图片路径', '非法宠物路径',
  '宠物资源必须是普通文件', '宠物资源过大', 'pet.json 过大', '精灵图过大', '图片过大',
  '无效精灵布局', '不支持的图片格式', '无法读取图片尺寸', '图片尺寸超限',
  '缺少或无效 pet.json', '无效 pet.json', '无效宠物描述', '缺少精灵图',
  '精灵图与静态图片配置冲突', '精灵布局超出图片尺寸', '非法压缩包路径',
  '压缩包文件过多', '压缩包解压后过大', '压缩包包含不支持的文件',
  '仅支持宠物文件夹或 ZIP 包', '宠物包文件过多', '宠物包包含不支持的文件',
])
const PET_IMPORT_FALLBACK_ERROR = '导入失败:文件无效或过大'

function describePetImportError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return SAFE_PET_IMPORT_ERRORS.has(message) ? message : PET_IMPORT_FALLBACK_ERROR
}

async function importPetImageFromDialog(win: BrowserWindow | null, userDataDir: string): Promise<PetImportResult> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return { pet: null, error: null }
  try {
    const pet = await importStaticImage({ userDataDir, sourcePath: result.filePaths[0]! })
    return { pet, error: null }
  } catch (error) {
    return { pet: null, error: describePetImportError(error) }
  }
}

async function importPetPackageFromDialog(win: BrowserWindow | null, userDataDir: string): Promise<PetImportResult> {
  const zipOptions: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: 'ZIP 宠物包', extensions: ['zip'] }],
  }
  let result = win ? await dialog.showOpenDialog(win, zipOptions) : await dialog.showOpenDialog(zipOptions)
  if (result.canceled || result.filePaths.length === 0) {
    // ZIP 选择器被取消 → 回落到目录选择器(文件夹形态的宠物包无扩展名可过滤)。
    const dirOptions: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    result = win ? await dialog.showOpenDialog(win, dirOptions) : await dialog.showOpenDialog(dirOptions)
  }
  if (result.canceled || result.filePaths.length === 0) return { pet: null, error: null }
  try {
    const pet = await importPackage({ userDataDir, sourcePath: result.filePaths[0]! })
    return { pet, error: null }
  } catch (error) {
    return { pet: null, error: describePetImportError(error) }
  }
}

ipcMain.handle('wraith:petsList', async () => ({
  pets: await listPets({ userDataDir: app.getPath('userData'), petdexRoot: petdexRoot() }),
}))
// 导入/删除成功后桌宠窗可能需要现身/消失/换预览——统一在既有校验结果算出之后
// 追加同步,不改动 petStore 的任何校验逻辑。syncPetWindow/pushCurrentPetPreview
// 都是 best-effort(内部自吞异常),无条件调用即可,失败/取消(pet:null)时是
// 一次无害的重复检查。
ipcMain.handle('wraith:petsImportImage', async () => {
  const result = await importPetImageFromDialog(mainWindow, app.getPath('userData'))
  const cfg = readPetConfig(app.getPath('userData'))
  void syncPetWindow(cfg)
  pushCurrentPetPreview(cfg)
  return result
})
ipcMain.handle('wraith:petsImportPackage', async () => {
  const result = await importPetPackageFromDialog(mainWindow, app.getPath('userData'))
  const cfg = readPetConfig(app.getPath('userData'))
  void syncPetWindow(cfg)
  pushCurrentPetPreview(cfg)
  return result
})
ipcMain.handle('wraith:petsRemove', async (_e, id: string) => {
  await removeImportedPet({ userDataDir: app.getPath('userData'), id })
  const cfg = readPetConfig(app.getPath('userData'))
  void syncPetWindow(cfg)
  pushCurrentPetPreview(cfg)
  return { ok: true }
})
ipcMain.handle('wraith:petsPreview', (_e, id: string) =>
  previewDataUrl({ userDataDir: app.getPath('userData'), petdexRoot: petdexRoot(), id })
)

// 桌宠配置:主窗与全局宠物窗共用同一份 settings.json 'pets' 键。
// 广播到 BrowserWindow.getAllWindows() 而非单一 mainWindow/petWin 引用,
// 因为发起变更的可能是主窗设置面板,也可能是宠物窗自己的右键菜单——
// 两边都要拿到最新配置,且窗口可能已销毁(try/catch 逐个吞掉)。
function broadcastPetConfig(config: PetConfig): void {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.webContents.send('pet:config', config)
    } catch {
      // 窗口已销毁
    }
  }
}

/**
 * 组装当前应展示的宠物 preview payload:优先 config.selectedId(须仍可用),
 * 否则回退第一个可用宠物——与 shouldShowPet(config, hasAvailablePet) 的
 * "只看是否存在任意可用宠物"口径一致,保证宠物窗一旦显示就总能配到一个 preview,
 * 不会因为 selectedId 恰好指向内置(恒不可用)而落空。无可用宠物时返回 null。
 */
async function assemblePetPreview(config: PetConfig): Promise<PetPreviewPayload | null> {
  const userDataDir = app.getPath('userData')
  const root = petdexRoot()
  const pets = await listPets({ userDataDir, petdexRoot: root })
  const pet = pets.find(p => p.id === config.selectedId && p.available) ?? pets.find(p => p.available) ?? null
  if (!pet) return null
  const previewUrl = await previewDataUrl({ userDataDir, petdexRoot: root, id: pet.id })
  return { id: pet.id, previewUrl, sprite: pet.sprite }
}

/** best-effort:组装失败(读盘/校验异常)不影响宠物窗其余状态,静默降级为无 preview。 */
function pushCurrentPetPreview(config: PetConfig): void {
  assemblePetPreview(config).then(pushPetPreview).catch(() => { /* best-effort */ })
}

// 宠物窗 ready 握手:渲染层挂载后经 window.wraithPet.ready() 发一次,主进程按当前
// 配置回推 config + preview,让宠物窗首帧就有得画(不必等下一次配置变更/事件)。
ipcMain.on('pet:ready', () => {
  const config = readPetConfig(app.getPath('userData'))
  pushPetConfig(config)
  pushCurrentPetPreview(config)
})

// 点击穿透(Task 8):renderer 侧逐像素 alpha 命中测试后,只在"穿透⇄捕获"翻转的
// 那一刻发这条 IPC——转手调 setIgnoreMouseEvents(ignore,{forward:true}),forward
// 保持为 true 才能在 ignore=true 时仍把 mousemove 转发给 renderer(否则下一次翻转
// 判定就没了输入)。getPetWindow() 可能是 null(窗口已关闭/尚未建好),?. 静默跳过。
ipcMain.on('pet:setIgnoreMouse', (_e, ignore: boolean) => {
  getPetWindow()?.setIgnoreMouseEvents(!!ignore, { forward: true })
})

ipcMain.handle('pet:getConfig', () => readPetConfig(app.getPath('userData')))
ipcMain.handle('pet:setConfig', (_e, patch: Partial<PetConfig>) => {
  const prev = readPetConfig(app.getPath('userData'))
  const next = writePetConfig(app.getPath('userData'), patch)
  broadcastPetConfig(next)
  void syncPetWindow(next)
  if (next.selectedId !== prev.selectedId) pushCurrentPetPreview(next)
  return next
})

// 全身拖动(Task 9):renderer 按 grabDX/DY 算好目标屏幕原点后只发 x/y,真正的
// "夹到目标屏工作区 + setBounds" 全部留给 petWindow.ts 的 petWindowMoveTo——
// 拖动期间不落盘,落盘由 renderer pointerup 时另发一次 pet:setConfig({ position }) 完成。
ipcMain.on('pet:moveTo', (_e, x: number, y: number) => petWindowMoveTo(x, y))

// 滚轮缩放(Task 9):与 pet:setConfig 的通用路径分开,因为还要立刻 resize 窗口本身
// (setConfig 只管配置落盘 + 通知,不知道"缩放"还需要联动 setBounds)。
ipcMain.on('pet:setScale', (_e, scale: number) => {
  const c = writePetConfig(app.getPath('userData'), { scale })
  petWindowResizeToScale(c.scale)
  broadcastPetConfig(c)
  pushPetConfig(c)
})

/**
 * 右键菜单(Task 9)统一改配置入口:写盘 + 广播 + 推送 config + 按需增删窗口
 * + (selectedId 变化时)重推 preview——与 pet:setConfig handler 同一套动作,
 * 单独抽出来是因为菜单侧的多个 action(select/scale/close)都要复用它,
 * 而 pet:setConfig 是渲染层通用 invoke 入口,两边各自的调用点不适合硬耦合。
 */
function applyConfigChange(patch: Partial<PetConfig>): PetConfig {
  const userDataDir = app.getPath('userData')
  const prev = readPetConfig(userDataDir)
  const next = writePetConfig(userDataDir, patch)
  broadcastPetConfig(next)
  pushPetConfig(next)
  void syncPetWindow(next)
  if (next.selectedId !== prev.selectedId) pushCurrentPetPreview(next)
  return next
}

/** 右键菜单(Task 9)各叶子 action 的落地:id 形如 `pet:select:<id>` / `pet:scale:<s>`
 * / `pet:reset-position` / `pet:close`,与 buildPetMenuTemplate(shared/petWindow.ts)
 * 产出的 PetMenuItem.id 一一对应。 */
function handlePetMenu(id: string): void {
  if (id.startsWith('pet:select:')) {
    applyConfigChange({ selectedId: id.slice('pet:select:'.length) })
    return
  }
  if (id.startsWith('pet:scale:')) {
    const next = applyConfigChange({ scale: Number(id.slice('pet:scale:'.length)) })
    petWindowResizeToScale(next.scale) // 与滚轮路径一致:改配置之外还要联动 resize
    return
  }
  if (id === 'pet:reset-position') {
    const userDataDir = app.getPath('userData')
    const cfg = readPetConfig(userDataDir)
    petWindowResetPosition(cfg.scale) // 物理挪窗到默认位;返回值不落盘(见下)
    // 落盘写 null 而不是这一刻算出的具体夹紧坐标——对齐 brief 语义:null 代表
    // "跟随默认位"这件事本身,换了台显示器/分辨率后应当重新按新工作区推导默认位,
    // 而不是把这一次刚好算出的坐标当成"用户手动摆放过"的固定位置钉死。
    const next = writePetConfig(userDataDir, { position: null })
    broadcastPetConfig(next)
    pushPetConfig(next)
    return
  }
  if (id === 'pet:close') {
    applyConfigChange({ enabled: false }) // syncPetWindow 据此销毁窗口
    return
  }
}

// 原生右键菜单(Task 9):现查一次可用宠物列表 + 当前配置组模板,交给
// toElectronMenu 映射成 Electron 菜单项后 popup 到宠物窗上。窗口不存在时
// popup({ window: undefined }) 仍能弹出(退化为不依附特定窗口)。
ipcMain.on('pet:contextMenu', () => {
  void (async () => {
    try {
      const userDataDir = app.getPath('userData')
      const pets = await listPets({ userDataDir, petdexRoot: petdexRoot() })
      const cfg = readPetConfig(userDataDir)
      const template = toElectronMenu(buildPetMenuTemplate(pets, cfg), handlePetMenu)
      Menu.buildFromTemplate(template).popup({ window: getPetWindow() ?? undefined })
    } catch {
      // best-effort(与本文件其余风格一致):listPets 读盘失败等场景下菜单弹不出来,
      // 但绝不能让一次未捕获的 promise rejection 冒出去砸崩主进程。
    }
  })()
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

// 上下文状态快照(启动/切会话时拉一次,修"发消息前空白")
ipcMain.handle('wraith:contextState', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('context.state.get', {})
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

ipcMain.handle('wraith:qqPending', async () => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.qqPending', {})
})
ipcMain.handle('wraith:qqPendingClear', async (_e, id?: string) => {
  if (!client) throw new Error('Backend not connected')
  return client.request('automations.qqPendingClear', id ? { id } : {})
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

ipcMain.handle('wraith:ptyCreate', (_e, opts?: { cwd?: string; cols?: number; rows?: number; theme?: 'light' | 'dark' }) => ptyManager?.create(opts ?? {}) ?? { id: '' })
ipcMain.handle('wraith:ptyInput', (_e, id: string, data: string) => { ptyManager?.write(id, data) })
ipcMain.handle('wraith:ptyResize', (_e, id: string, cols: number, rows: number) => { ptyManager?.resize(id, cols, rows) })
ipcMain.handle('wraith:ptyKill', (_e, id: string) => { ptyManager?.kill(id) })

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

  ptyManager = new PtyManager(
    (id, data) => { try { mainWindow?.webContents.send('wraith:pty-data', { id, data }) } catch { /* window destroyed — 静默降级 */ } },
    (id, code) => { try { mainWindow?.webContents.send('wraith:pty-exit', { id, code }) } catch { /* window destroyed — 静默降级 */ } },
    process.env,
    os.homedir(),
  )

  // 仅放行麦克风(媒体)权限,供语音听写用
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  // 内嵌浏览器(BrowserPane)的独立 partition:默认拒绝所有权限请求(地理位置/摄像头/通知等)——
  // 它是可访问任意站点的用户浏览器,不应默认放权。
  session.fromPartition('persist:wraith-browser').setPermissionRequestHandler((_wc, _permission, cb) => cb(false))

  // webview 客体禁止 window.open / target=_blank 弹新窗(兜底,不依赖单个 allowpopups 属性)
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    }
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

  // 桌宠:全局常驻窗口装配 + 首次按当前配置同步(E2E 下也走,以便 Task 10 e2e 断言第二窗出现;
  // reduced-motion/穿透等手工眼验覆盖)。initPetWindow 只记依赖,syncPetWindow 异步查可用宠物再决定增删。
  initPetWindow({
    userDataDir: () => app.getPath('userData'),
    petdexRoot: () => petdexRoot(),
    preloadPath: path.join(__dirname, '../preload/pet.cjs'),
    primaryWorkArea: () => screen.getPrimaryDisplay().workArea,
  })
  void syncPetWindow(readPetConfig(app.getPath('userData')))
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
  try {
    ptyManager?.killAll()
  } catch {
    // best-effort
  }
  try {
    destroyPetWindow()
  } catch {
    // best-effort
  }
})
