/**
 * E2E: Session resume restores provider/model and shows fallback banner (I-1 fix)
 *
 * Test T-R1: resuming a normal session (sess_a) updates the model chip to the
 *   session's model ('deepseek-chat') — discriminating because startup sets the
 *   chip to 'mock-model' (from initialize reply) so we can observe a real change.
 *
 * Test T-R2: resuming the fallback session (sess_fallback) shows the
 *   model-fallback-banner AND updates the chip to the fallback (default) model;
 *   clicking dismiss removes the banner.
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
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
    }
  })

  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })

  // On startup, initialize returns model:'mock-model', chip should show that.
  // This confirms the chip is live and gives us a pre-resume baseline to compare against.
  const chip = win.locator('[data-testid="model-chip"]')
  await expect(chip).toBeVisible({ timeout: 10000 })
  await expect(chip).toHaveText('mock-model', { timeout: 10000 })

  // Session list has 3 items; first is sess_a (deepseek/deepseek-chat).
  // Pre-fix: chip stays 'mock-model' after click → assertion below would FAIL.
  // Post-fix: handleSelectSession dispatches setModel('deepseek-chat') → chip updates.
  await win.locator('[data-testid="conversation-item"]').first().click()
  await expect(win.locator('[data-testid="user-msg"]')).toContainText('之前问的问题', { timeout: 10000 })

  // Chip must now reflect the resumed session's model, not the stale startup model.
  await expect(chip).toHaveText('deepseek-chat', { timeout: 10000 })

  // No fallback banner should appear for a normal resume.
  await expect(win.locator('[data-testid="model-fallback-banner"]')).toHaveCount(0)

  await app.close()
  fs.rmSync(userData, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T-R2: fallback session shows banner + correct chip; dismiss clears banner
// ---------------------------------------------------------------------------

test('T-R2 resume 回退会话:横幅可见+chip 显示默认模型+dismiss 清除横幅', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-tr2-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
    }
  })

  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })

  // Session list has 3 items: sess_a, sess_b, sess_fallback (third, index 2).
  await expect(win.locator('[data-testid="conversation-item"]')).toHaveCount(3, { timeout: 10000 })

  // Click the fallback session (third item = sess_fallback).
  // Pre-fix: banner never appears (modelFallback not consumed) → T-R2 would FAIL.
  // Post-fix: setModelFallbackNotice(true) renders ModelFallbackBanner.
  await win.locator('[data-testid="conversation-item"]').nth(2).click()
  await expect(win.locator('[data-testid="user-msg"]')).toContainText('之前问的问题', { timeout: 10000 })

  // Banner must be visible.
  const banner = win.locator('[data-testid="model-fallback-banner"]')
  await expect(banner).toBeVisible({ timeout: 10000 })

  // Chip must show the fallback (default) model = deepseek-chat.
  await expect(win.locator('[data-testid="model-chip"]')).toHaveText('deepseek-chat', { timeout: 10000 })

  // Dismiss → banner gone.
  await win.locator('[data-testid="model-fallback-dismiss"]').click()
  await expect(banner).toHaveCount(0, { timeout: 5000 })

  await app.close()
  fs.rmSync(userData, { recursive: true, force: true })
})
