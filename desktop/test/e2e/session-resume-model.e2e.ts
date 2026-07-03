/**
 * E2E: Session resume restores provider/model and shows fallback banner (I-1 fix)
 *
 * Sessions are injected per-test via MOCK_SESSIONS_BY_WS (the established fixture
 * mechanism, mirroring the T46 search test) so this spec is isolated from the
 * mock's DEFAULT session list — the default stays 2 sessions and shell.e2e.ts's
 * `toHaveCount(2)` is unaffected.
 *
 * Test T-R1: resuming a normal session updates the model chip to the session's
 *   effective model ('deepseek-chat') — discriminating because startup sets the
 *   chip to 'mock-model' (from the initialize reply) so we observe a real change.
 *
 * Test T-R2: resuming the fallback session (id 'sess_fallback', which triggers the
 *   mock's modelFallback:true resume branch) shows the model-fallback-banner AND
 *   updates the chip to the fallback (default) model; clicking dismiss removes it.
 *
 * RED behaviour (pre-fix):
 *   T-R1 — chip stays 'mock-model' (handleSelectSession never dispatches setModel).
 *   T-R2 — banner never appears (modelFallback field dropped; state flag never set).
 */

import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const mainPath = path.resolve(__dirname, '../../out/main/index.js')
const mockPath = path.resolve(__dirname, '../fixtures/mock-appserver.mjs')

// ---------------------------------------------------------------------------
// T-R1: normal resume updates model chip
// ---------------------------------------------------------------------------

test('T-R1 resume 正常会话:model-chip 更新为会话模型(deepseek-chat)', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-tr1-'))
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ws-tr1-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: ws,
      WRAITH_E2E_PROJECTS: JSON.stringify([{ path: ws, lastUsedAt: 2000 }]),
      MOCK_SESSIONS_BY_WS: JSON.stringify({
        [ws]: [
          { id: 'sess_normal', cwd: ws, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T01:00:00Z', provider: 'deepseek', model: 'deepseek-chat', title: '正常会话', turns: 2 },
        ],
      }),
    },
  })

  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })

  // Startup initialize returns model:'mock-model' → chip baseline, distinct from the
  // resumed model so the post-resume assertion has discriminating power.
  const chip = win.locator('[data-testid="model-chip"]')
  await expect(chip).toBeVisible({ timeout: 10000 })
  await expect(chip).toHaveText('mock-model', { timeout: 10000 })

  // Resume the (only) session. Pre-fix: chip stays 'mock-model'. Post-fix:
  // handleSelectSession dispatches setModel → ModelSwitcher effect syncs the chip.
  await expect(win.locator('[data-testid="conversation-item"]')).toHaveCount(1, { timeout: 10000 })
  await win.locator('[data-testid="conversation-item"]').first().click()
  await expect(win.locator('[data-testid="user-msg"]')).toContainText('之前问的问题', { timeout: 10000 })

  // Chip must now reflect the resumed session's effective model.
  await expect(chip).toHaveText('deepseek-chat', { timeout: 10000 })

  // No fallback banner for a normal resume.
  await expect(win.locator('[data-testid="model-fallback-banner"]')).toHaveCount(0)

  await app.close()
  fs.rmSync(userData, { recursive: true, force: true })
  fs.rmSync(ws, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T-R2: fallback session shows banner + correct chip; dismiss clears banner
// ---------------------------------------------------------------------------

test('T-R2 resume 回退会话:横幅可见+chip 显示默认模型+dismiss 清除横幅', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-tr2-'))
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ws-tr2-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: ws,
      WRAITH_E2E_PROJECTS: JSON.stringify([{ path: ws, lastUsedAt: 2000 }]),
      MOCK_SESSIONS_BY_WS: JSON.stringify({
        [ws]: [
          // id 'sess_fallback' triggers the mock's modelFallback:true resume branch.
          { id: 'sess_fallback', cwd: ws, createdAt: '2026-06-29T00:00:00Z', updatedAt: '2026-06-29T01:00:00Z', provider: 'deepseek', model: 'deepseek-chat', title: '回退测试对话', turns: 1 },
        ],
      }),
    },
  })

  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })

  await expect(win.locator('[data-testid="conversation-item"]')).toHaveCount(1, { timeout: 10000 })

  // Resume the fallback session. Pre-fix: banner never appears (field dropped).
  // Post-fix: setModelFallbackNotice(true) renders ModelFallbackBanner.
  await win.locator('[data-testid="conversation-item"]').first().click()
  await expect(win.locator('[data-testid="user-msg"]')).toContainText('之前问的问题', { timeout: 10000 })

  const banner = win.locator('[data-testid="model-fallback-banner"]')
  await expect(banner).toBeVisible({ timeout: 10000 })

  // Chip shows the fallback (default) model.
  await expect(win.locator('[data-testid="model-chip"]')).toHaveText('deepseek-chat', { timeout: 10000 })

  // Dismiss → banner gone.
  await win.locator('[data-testid="model-fallback-dismiss"]').click()
  await expect(banner).toHaveCount(0, { timeout: 5000 })

  await app.close()
  fs.rmSync(userData, { recursive: true, force: true })
  fs.rmSync(ws, { recursive: true, force: true })
})
