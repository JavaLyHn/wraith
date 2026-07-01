import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import readline from 'readline'
import { JsonRpcClient } from '../shared/jsonRpcClient'
import { resolveBackendCommand, defaultJarPath } from './backend'
import { resolvePersistedWorkspace, persistWorkspace } from './settings'
import type { BackendEvent } from '../shared/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendEvent(evt: BackendEvent): void {
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
  rpcClient.onNotification((method, params) => {
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

ipcMain.handle('wraith:submitTurn', async (_e, input: string) => {
  if (!client) throw new Error('Backend not connected')
  const result = await client.request('turn.submit', {
    sessionId: currentSessionId,
    input
  })
  const r = result as { turnId: string; status: string }
  currentTurnId = r.turnId
  return r
})

ipcMain.handle(
  'wraith:respondApproval',
  async (_e, approvalId: string, decision: 'APPROVED' | 'REJECTED') => {
    if (!client) throw new Error('Backend not connected')
    await client.request('approval.respond', { approvalId, decision })
  }
)

ipcMain.handle('wraith:interrupt', async () => {
  if (!client) throw new Error('Backend not connected')
  // Best-effort: use tracked ids; may be null if turn not started yet.
  await client.request('turn.interrupt', {
    sessionId: currentSessionId,
    turnId: currentTurnId
  })
})

/**
 * Startup workspace — NO dialog. Returns the persisted workspace (if it still
 * exists and is a directory), else the home directory. The user changes it via
 * the composer's "重选目录" button (wraith:pickWorkspace), which is the only
 * place a native dialog appears.
 */
ipcMain.handle('wraith:getInitialWorkspace', async () => {
  // E2E: startup workspace is injected directly (unset → null → backend default).
  if (process.env['WRAITH_E2E'] === '1') {
    return process.env['WRAITH_E2E_WORKSPACE'] ?? null
  }
  return resolvePersistedWorkspace(app.getPath('userData')) ?? os.homedir()
})

ipcMain.handle('wraith:pickWorkspace', async () => {
  // E2E: what a button-driven pick resolves to (unset → null → cancel/no-op).
  if (process.env['WRAITH_E2E'] === '1') {
    return process.env['WRAITH_E2E_PICK'] ?? null
  }
  // Open the native picker at the current workspace (or home), not wherever the
  // OS last remembered.
  const current = resolvePersistedWorkspace(app.getPath('userData')) ?? os.homedir()
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    defaultPath: current
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const picked = result.filePaths[0]!
  persistWorkspace(app.getPath('userData'), picked) // remember for next launch
  return picked
})

ipcMain.handle('wraith:restartBackend', async () => {
  currentSessionId = null
  currentTurnId = null
  spawnBackend()
  // Renderer is responsible for re-running initialize/startSession after restart.
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

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
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
})
