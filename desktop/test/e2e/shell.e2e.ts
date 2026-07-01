import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Resolve paths relative to this test file
const mainPath = path.resolve(__dirname, '../../out/main/index.js')
const mockPath = path.resolve(__dirname, '../fixtures/mock-appserver.mjs')

// ---------------------------------------------------------------------------
// Test 1: happy path — full turn with approval
// ---------------------------------------------------------------------------

test('happy path: submit turn, see markdown+thinking+tool+approval, approve, see output', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1'
    }
  })

  const win = await app.firstWindow()

  // Wait for the app to finish startup (initialize + startSession)
  // The input should be enabled and we can type
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  // Submit a turn
  await input.fill('hi')
  await input.press('Enter')

  // 1. Markdown bold renders: **world** → <strong>world</strong>
  await expect(
    win.locator('[data-testid="transcript"] strong')
  ).toHaveText('world', { timeout: 15000 })

  // 2. Thinking block present
  await expect(
    win.locator('[data-testid="thinking"]')
  ).toBeVisible({ timeout: 10000 })

  // 3. Tool card present with the command
  await expect(
    win.locator('[data-testid="tool-card"]')
  ).toContainText('echo hi', { timeout: 10000 })

  // 4. Approval modal appears
  const approveBtn = win.locator('[data-testid="approve"]')
  await expect(approveBtn).toBeVisible({ timeout: 10000 })

  // Click approve
  await approveBtn.click()

  // 5. Tool output shows 'hi'
  await expect(
    win.locator('[data-testid="tool-output"]')
  ).toContainText('hi', { timeout: 10000 })

  // 6. Exit-0 badge is visible on the tool card
  await expect(
    win.locator('[data-testid="tool-card"]')
  ).toContainText('exit 0', { timeout: 10000 })

  await app.close()
})

// ---------------------------------------------------------------------------
// Test 2: backend crash after init → disconnected banner appears
// ---------------------------------------------------------------------------

test('disconnect: backend crash after init shows disconnected banner', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      MOCK_EXIT_AFTER_INIT: '1'
    }
  })

  const win = await app.firstWindow()

  // After the mock crashes (after replying to initialize), the disconnected banner
  // should appear with data-testid="restart"
  await expect(
    win.locator('[data-testid="restart"]')
  ).toBeVisible({ timeout: 15000 })

  await app.close()
})

// ---------------------------------------------------------------------------
// Test 3: approval toggle — sends session.setApprovalMode with correct auto flag
// ---------------------------------------------------------------------------

test('approval toggle sends session.setApprovalMode with correct auto flag', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}.jsonl`)
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile
    }
  })
  const win = await app.firstWindow()
  const toggle = win.locator('[data-testid="approval-toggle"]')
  await expect(toggle).toBeVisible({ timeout: 15000 })

  await toggle.click() // ask → auto
  await expect
    .poll(() => {
      if (!fs.existsSync(recordFile)) return null
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const last = [...lines].reverse().find(l => l.method === 'session.setApprovalMode')
      return last ? last.params.auto : null
    }, { timeout: 10000 })
    .toBe(true)

  await toggle.click() // auto → ask
  await expect
    .poll(() => {
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const last = [...lines].reverse().find(l => l.method === 'session.setApprovalMode')
      return last ? last.params.auto : null
    }, { timeout: 10000 })
    .toBe(false)

  await app.close()
  fs.rmSync(recordFile, { force: true })
})

// ---------------------------------------------------------------------------
// Test 4: workspace switch re-picks dir → second session.start + transcript reset
// ---------------------------------------------------------------------------

test('workspace switch re-picks dir → second session.start + transcript reset', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-ws.jsonl`)
  const injectedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ws-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_WORKSPACE: injectedDir
    }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  // go to conversation state
  await input.fill('hi')
  await input.press('Enter')
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 15000 })

  // re-pick
  await win.locator('[data-testid="workspace-switch"]').click()

  // second session.start carrying the injected workspaceDir
  await expect
    .poll(() => {
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const starts = lines.filter(l => l.method === 'session.start')
      return starts.length >= 2 && starts[starts.length - 1].params?.workspaceDir === injectedDir
    }, { timeout: 10000 })
    .toBe(true)

  // TODO(Task 6): uncomment after WelcomeEmptyState exists
  // await expect(win.locator('text=今天做点什么？')).toBeVisible({ timeout: 10000 })

  await app.close()
  fs.rmSync(recordFile, { force: true })
  fs.rmSync(injectedDir, { recursive: true, force: true })
})
