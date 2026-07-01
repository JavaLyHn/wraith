import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
