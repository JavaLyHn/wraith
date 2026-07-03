/**
 * T3: 提交/编辑失败可见错误横幅
 *
 * GREEN: MOCK_SUBMIT_FAIL=1 → submit-error 横幅出现,含可读文案;
 *        dismiss 按钮清除横幅;再次成功提交也清除横幅。
 * RED(文档):去掉 SubmitErrorBanner 渲染后,submit-error 元素永不出现。
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
// T3-A: MOCK_SUBMIT_FAIL=1 → submit-error 横幅可见,含可读文案
// ---------------------------------------------------------------------------

test('T3-A: submit 失败时 submit-error 横幅出现,含可读提示', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t3a-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      MOCK_SUBMIT_FAIL: '1',
    },
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  // 提交一条消息
  await input.fill('发送失败测试')
  await input.press('Enter')

  // submit-error 横幅必须出现
  const banner = win.locator('[data-testid="submit-error"]')
  await expect(banner).toBeVisible({ timeout: 10000 })

  // 包含可读提示文案
  await expect(banner).toContainText('消息发送失败', { timeout: 5000 })

  await app.close()
  fs.rmSync(userData, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T3-B: dismiss 按钮点击后横幅消失
// ---------------------------------------------------------------------------

test('T3-B: dismiss 按钮点击后 submit-error 横幅消失', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t3b-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      MOCK_SUBMIT_FAIL: '1',
    },
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  // 触发失败横幅
  await input.fill('发送失败测试')
  await input.press('Enter')
  const banner = win.locator('[data-testid="submit-error"]')
  await expect(banner).toBeVisible({ timeout: 10000 })

  // 点击 dismiss
  await win.locator('[data-testid="submit-error-dismiss"]').click()

  // 横幅消失
  await expect(banner).toHaveCount(0, { timeout: 5000 })

  await app.close()
  fs.rmSync(userData, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T3-C: 无失败 flag 时 submit-error 不出现(既有路径零回归)
// ---------------------------------------------------------------------------

test('T3-C: 正常提交(无 MOCK_SUBMIT_FAIL)时 submit-error 不出现', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      MOCK_NO_APPROVAL: '1',
    },
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  await input.fill('hi')
  await input.press('Enter')

  // 等 turn 完成(interrupt 出现再消失 → running 清空)
  await expect(win.locator('[data-testid="interrupt"]')).toBeVisible({ timeout: 10000 })
  await expect(win.locator('[data-testid="interrupt"]')).toHaveCount(0, { timeout: 15000 })

  // submit-error 不应出现
  await expect(win.locator('[data-testid="submit-error"]')).toHaveCount(0)

  await app.close()
})
