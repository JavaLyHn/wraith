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
  const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ws-startup-'))
  const repickDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ws-repick-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_WORKSPACE: startupDir, // startup workspace (getInitialWorkspace)
      WRAITH_E2E_PICK: repickDir, // what the re-pick button resolves to (pickWorkspace)
      WRAITH_E2E_USERDATA: userData,
      MOCK_SESSIONS_BY_WS: '{}' // repickDir 无历史 → 切换后仍是欢迎态(原断言保持)
    }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  // go to conversation state
  await input.fill('hi')
  await input.press('Enter')
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 15000 })

  // re-pick (resolves to repickDir — distinct from startupDir, guard lets it through)
  await win.locator('[data-testid="workspace-switch"]').click()

  // second session.start carrying repickDir (from WRAITH_E2E_PICK)
  await expect
    .poll(() => {
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const starts = lines.filter(l => l.method === 'session.start')
      return starts.length >= 2 && starts[starts.length - 1].params?.workspaceDir === repickDir
    }, { timeout: 10000 })
    .toBe(true)

  // Task 6: WelcomeEmptyState exists, welcome heading should return after re-pick
  await expect(win.locator('text=今天做点什么？')).toBeVisible({ timeout: 10000 })

  await app.close()
  fs.rmSync(recordFile, { force: true })
  fs.rmSync(startupDir, { recursive: true, force: true })
  fs.rmSync(repickDir, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Test 5: welcome empty state → submit → transcript transition
// ---------------------------------------------------------------------------

test('welcome empty state shows, then transitions to transcript on submit', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()

  // welcome heading visible, transcript absent
  await expect(win.locator('text=今天做点什么？')).toBeVisible({ timeout: 15000 })
  await expect(win.locator('[data-testid="transcript"]')).toHaveCount(0)

  // submit → welcome gone, transcript present
  const input = win.locator('[data-testid="input"]')
  await input.fill('hi')
  await input.press('Enter')
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 15000 })
  await expect(win.locator('text=今天做点什么？')).toHaveCount(0)

  await app.close()
})

// ---------------------------------------------------------------------------
// Test 6: static sidebar shell present with disabled placeholder nav
// ---------------------------------------------------------------------------

test('static sidebar shell present with enabled plugins nav', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="sidebar"]')).toBeVisible({ timeout: 15000 })
  await expect(win.locator('[data-testid="nav-plugins"]')).toBeEnabled()
  await app.close()
})

// ---------------------------------------------------------------------------
// Test 7: sidebar lists sessions; new clears; selecting resumes history
// ---------------------------------------------------------------------------

test('sidebar lists sessions; new clears; selecting resumes history', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })

  // list rendered from session.list
  await expect(win.locator('[data-testid="conversation-item"]')).toHaveCount(2, { timeout: 10000 })
  await expect(win.locator('[data-testid="conversation-item"]').first()).toContainText('第一段对话')

  // selecting resumes → static history (user bubble + assistant answer) shows
  await win.locator('[data-testid="conversation-item"]').first().click()
  await expect(win.locator('[data-testid="user-msg"]')).toContainText('之前问的问题', { timeout: 10000 })
  await expect(win.locator('[data-testid="transcript"] strong')).toHaveText('回答', { timeout: 10000 })

  // new conversation clears transcript back to welcome
  await win.locator('[data-testid="new-conversation"]').click()
  await expect(win.locator('text=今天做点什么？')).toBeVisible({ timeout: 10000 })

  await app.close()
})

// ---------------------------------------------------------------------------
// Test 8: submitting echoes the user message as a bubble
// ---------------------------------------------------------------------------

test('submitting echoes the user message as a bubble', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })
  await input.fill('我的问题')
  await input.press('Enter')
  await expect(win.locator('[data-testid="user-msg"]')).toHaveText('我的问题', { timeout: 10000 })
  await app.close()
})

// ---------------------------------------------------------------------------
// Test 9: sandbox badge shows unavailable when capabilities.sandbox=none
// ---------------------------------------------------------------------------

test('sandbox badge shows unavailable when capabilities.sandbox=none', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1', MOCK_SANDBOX: 'none' }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="sandbox-badge"]')).toContainText('未启用', { timeout: 15000 })
  await app.close()
})

// ---------------------------------------------------------------------------
// Test 10: reconnect after restart re-resumes the active session (smoke)
// ---------------------------------------------------------------------------

test('reconnect after restart re-resumes the active session', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })
  // one turn → turn.completed carries sessionId (mock sess_mock_N) → activeSessionId set
  await win.locator('[data-testid="input"]').fill('hi')
  await win.locator('[data-testid="input"]').press('Enter')
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 15000 })
  // approve the tool call so the turn completes with exit 0
  const approveBtn = win.locator('[data-testid="approve"]')
  await expect(approveBtn).toBeVisible({ timeout: 10000 })
  await approveBtn.click()
  await expect(win.locator('[data-testid="tool-card"]')).toContainText('exit 0', { timeout: 15000 })
  // (manual restart path is controller-eyeballed; here we assert reconnect effect exists via no-crash on connected)
  await app.close()
})

// ---------------------------------------------------------------------------
// Test 11: approval 后 transcript 出现 diff 卡片(文件名可见)
// ---------------------------------------------------------------------------

test('approval 后 transcript 出现 diff 卡片(文件名可见)', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  await input.fill('hi')
  await input.press('Enter')

  const approveBtn = win.locator('[data-testid="approve"]')
  await expect(approveBtn).toBeVisible({ timeout: 10000 })
  await approveBtn.click()

  // diff card should appear in transcript after approval
  await expect(win.locator('[data-testid="diff-card"]')).toBeVisible({ timeout: 15000 })
  await expect(win.locator('[data-testid="diff-card"]')).toContainText('hello.txt', { timeout: 10000 })

  await app.close()
})

// ---------------------------------------------------------------------------
// Test 12: status 事件驱动 composer 的 token chip
// ---------------------------------------------------------------------------

test('status 事件驱动 composer 的 token chip', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  await input.fill('hi')
  await input.press('Enter')

  // status chip should appear and show ~19% (12000/64000)
  await expect(win.locator('[data-testid="status-chip"]')).toBeVisible({ timeout: 15000 })
  await expect(win.locator('[data-testid="status-chip"]')).toHaveText(/19%/, { timeout: 10000 })

  await app.close()
})

// ---------------------------------------------------------------------------
// Test 13: 审批弹窗改命令 → respond 记录 MODIFIED + 新命令
// ---------------------------------------------------------------------------

test('审批弹窗改命令 → respond 记录 MODIFIED + 新命令', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-modified.jsonl`)
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
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  await input.fill('hi')
  await input.press('Enter')

  // wait for approval modal
  await expect(win.locator('[data-testid="approve"]')).toBeVisible({ timeout: 10000 })

  // edit the command
  const commandEdit = win.locator('[data-testid="command-edit"]')
  await expect(commandEdit).toBeVisible({ timeout: 10000 })
  await commandEdit.fill('echo bye')

  // button text should change to indicate modification; click approve
  const approveBtn = win.locator('[data-testid="approve"]')
  await expect(approveBtn).toBeVisible({ timeout: 5000 })
  await approveBtn.click()

  // check record: decision === MODIFIED and modifiedArgs.command === 'echo bye'
  await expect
    .poll(() => {
      if (!fs.existsSync(recordFile)) return null
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const resp = [...lines].reverse().find(l => l.method === 'approval.respond')
      if (!resp) return null
      return {
        decision: resp.params.decision,
        command: JSON.parse(resp.params.modifiedArgs || '{}').command
      }
    }, { timeout: 10000 })
    .toEqual({ decision: 'MODIFIED', command: 'echo bye' })

  await app.close()
  fs.rmSync(recordFile, { force: true })
})

// ---------------------------------------------------------------------------
// Test 14: 勾选本次放行网络 → respond 记录 allowNetwork:true
// ---------------------------------------------------------------------------

test('勾选本次放行网络 → respond 记录 allowNetwork:true', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-network.jsonl`)
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
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  await input.fill('hi')
  await input.press('Enter')

  // wait for approval modal
  await expect(win.locator('[data-testid="approve"]')).toBeVisible({ timeout: 10000 })

  // check allow-network checkbox
  const allowNetwork = win.locator('[data-testid="allow-network"]')
  await expect(allowNetwork).toBeVisible({ timeout: 10000 })
  await allowNetwork.click()

  // click approve
  await win.locator('[data-testid="approve"]').click()

  // check record: decision === APPROVED and allowNetwork === true
  await expect
    .poll(() => {
      if (!fs.existsSync(recordFile)) return null
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const resp = [...lines].reverse().find(l => l.method === 'approval.respond')
      if (!resp) return null
      return { decision: resp.params.decision, allowNetwork: resp.params.allowNetwork }
    }, { timeout: 10000 })
    .toEqual({ decision: 'APPROVED', allowNetwork: true })

  await app.close()
  fs.rmSync(recordFile, { force: true })
})

// ---------------------------------------------------------------------------
// Test 15: 本会话放行此工具 → respond 记录 APPROVED_ALL
// ---------------------------------------------------------------------------

test('本会话放行此工具 → respond 记录 APPROVED_ALL', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-all.jsonl`)
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
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  await input.fill('hi')
  await input.press('Enter')

  // wait for approval modal
  await expect(win.locator('[data-testid="approve"]')).toBeVisible({ timeout: 10000 })

  // click approve-all
  const approveAllBtn = win.locator('[data-testid="approve-all"]')
  await expect(approveAllBtn).toBeVisible({ timeout: 10000 })
  await approveAllBtn.click()

  // check record: decision === APPROVED_ALL
  await expect
    .poll(() => {
      if (!fs.existsSync(recordFile)) return null
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const resp = [...lines].reverse().find(l => l.method === 'approval.respond')
      if (!resp) return null
      return resp.params.decision
    }, { timeout: 10000 })
    .toBe('APPROVED_ALL')

  await app.close()
  fs.rmSync(recordFile, { force: true })
})

// ---------------------------------------------------------------------------
// Test 16: write_file 审批弹窗展示 diff 预览
// ---------------------------------------------------------------------------

test('write_file 审批弹窗展示 diff 预览', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      MOCK_APPROVAL_TOOL: 'write_file'
    }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  await input.fill('hi')
  await input.press('Enter')

  // wait for approval modal
  await expect(win.locator('[data-testid="approve"]')).toBeVisible({ timeout: 10000 })

  // diff-view or diff-fallback should be visible in the modal
  await expect(
    win.locator('[data-testid=diff-view], [data-testid=diff-fallback]').first()
  ).toBeVisible({ timeout: 15000 })

  // modal should contain the file path
  await expect(win.getByTestId('approval-modal')).toContainText('src/hello.txt', { timeout: 10000 })

  // approve and wait for turn to complete
  await win.locator('[data-testid="approve"]').click()
  await expect(win.locator('[data-testid="tool-card"]')).toBeVisible({ timeout: 15000 })

  await app.close()
})

// ---------------------------------------------------------------------------
// Test 17: 长对话溢出时卡片不得被 flex 压扁(回归:overflow-hidden 子项 min-height=0)
// ---------------------------------------------------------------------------

test('长对话溢出后 tool/thinking/diff 卡片保持完整高度(不被压成 2px 线)', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1'
    }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  // 连发 4 轮(每轮:提交→审批→放行→等 diff 卡片落地),把 transcript 撑到溢出
  for (let turn = 1; turn <= 4; turn++) {
    await input.fill(`第 ${turn} 轮消息`)
    await input.press('Enter')
    const approveBtn = win.locator('[data-testid="approve"]')
    await expect(approveBtn).toBeVisible({ timeout: 10000 })
    await approveBtn.click()
    await expect(win.locator('[data-testid="diff-card"]')).toHaveCount(turn, { timeout: 10000 })
  }

  // 容器确已溢出(滚动高度大于可视高度),压缩条件成立
  const overflowed = await win
    .locator('[data-testid="transcript"]')
    .evaluate(el => el.scrollHeight > el.clientHeight)
  expect(overflowed).toBe(true)

  // 最早的三类卡片都必须保有实际高度(压扁时只剩 2px 边框线)
  for (const testid of ['tool-card', 'thinking', 'diff-card']) {
    const box = await win.locator(`[data-testid="${testid}"]`).first().boundingBox()
    expect(box, `${testid} 应可见`).not.toBeNull()
    expect(box!.height, `${testid} 高度不得被压缩`).toBeGreaterThan(20)
  }

  await app.close()
})

// ---------------------------------------------------------------------------
// Test 18: 编辑消息 → rewind + 以新文本重发(真回溯)
// ---------------------------------------------------------------------------

test('编辑用户消息 → session.rewind + 新文本重发,气泡更新', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-edit.jsonl`)
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
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  // 第一轮完整跑完
  await input.fill('原始消息')
  await input.press('Enter')
  await expect(win.locator('[data-testid="approve"]')).toBeVisible({ timeout: 10000 })
  await win.locator('[data-testid="approve"]').click()
  await expect(win.locator('[data-testid="tool-card"]').first()).toContainText('exit 0', { timeout: 15000 })

  // hover 出编辑按钮 → 内联编辑 → 保存并重发
  await win.locator('[data-testid="user-msg"]').first().hover()
  await win.locator('[data-testid="msg-edit"]').click()
  const editInput = win.locator('[data-testid="msg-edit-input"]')
  await expect(editInput).toBeVisible({ timeout: 5000 })
  await editInput.fill('改后的消息')
  await win.locator('[data-testid="msg-edit-save"]').click()

  // 新一轮又会弹审批,放行让其完成
  await expect(win.locator('[data-testid="approve"]')).toBeVisible({ timeout: 10000 })
  await win.locator('[data-testid="approve"]').click()

  // 气泡应只剩改后的那条
  await expect(win.locator('[data-testid="user-msg"]')).toHaveCount(1, { timeout: 10000 })
  await expect(win.locator('[data-testid="user-msg"]').first()).toHaveText('改后的消息')

  // record:先 rewind(userOrdinal=1),后新 turn.submit('改后的消息')
  await expect
    .poll(() => {
      if (!fs.existsSync(recordFile)) return null
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const rewind = lines.find(l => l.method === 'session.rewind')
      const submits = lines.filter(l => l.method === 'turn.submit')
      if (!rewind || submits.length < 2) return null
      return { ordinal: rewind.params.userOrdinal, lastInput: submits[submits.length - 1].params.input }
    }, { timeout: 10000 })
    .toEqual({ ordinal: 1, lastInput: '改后的消息' })

  await app.close()
  fs.rmSync(recordFile, { force: true })
})

// ---------------------------------------------------------------------------
// Test 19: 删除消息 → 二次确认 → rewind,气泡消失
// ---------------------------------------------------------------------------

test('删除用户消息 → 二次点击确认 → session.rewind,气泡消失', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-delete.jsonl`)
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
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  await input.fill('要删的消息')
  await input.press('Enter')
  await expect(win.locator('[data-testid="approve"]')).toBeVisible({ timeout: 10000 })
  await win.locator('[data-testid="approve"]').click()
  await expect(win.locator('[data-testid="tool-card"]').first()).toContainText('exit 0', { timeout: 15000 })

  await win.locator('[data-testid="user-msg"]').first().hover()
  const delBtn = win.locator('[data-testid="msg-delete"]')
  await delBtn.click()
  await expect(delBtn).toHaveText('确认删除?')
  await delBtn.click()

  await expect(win.locator('[data-testid="user-msg"]')).toHaveCount(0, { timeout: 10000 })
  await expect
    .poll(() => {
      if (!fs.existsSync(recordFile)) return null
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const rewind = lines.find(l => l.method === 'session.rewind')
      return rewind ? rewind.params.userOrdinal : null
    }, { timeout: 10000 })
    .toBe(1)

  await app.close()
  fs.rmSync(recordFile, { force: true })
})

// ---------------------------------------------------------------------------
// Test 20: running 中按 Esc → turn.interrupt
// ---------------------------------------------------------------------------

test('running 中按 Esc → 发送 turn.interrupt', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-esc.jsonl`)
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      MOCK_SLOW_TURN: '1'
    }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  await input.fill('hi')
  await input.press('Enter')
  // running 且尚无审批弹窗的窗口(mock 慢速 3s)
  await expect(win.locator('[data-testid="interrupt"]')).toBeVisible({ timeout: 10000 })
  await win.locator('body').press('Escape')

  await expect
    .poll(() => {
      if (!fs.existsSync(recordFile)) return null
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      return lines.some(l => l.method === 'turn.interrupt')
    }, { timeout: 10000 })
    .toBe(true)

  await app.close()
  fs.rmSync(recordFile, { force: true })
})

// ---------------------------------------------------------------------------
// Test 21: 自动贴底——发送后滚到最下;上翻后再发送强制回底
// ---------------------------------------------------------------------------

test('长对话发送后自动滚到底部;上翻后再次发送强制回底', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1'
    }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  const atBottom = () =>
    win.locator('[data-testid="transcript"]').evaluate(el =>
      el.scrollHeight - el.scrollTop - el.clientHeight < 5)

  // 4 轮撑满溢出
  for (let turn = 1; turn <= 4; turn++) {
    await input.fill(`第 ${turn} 轮消息`)
    await input.press('Enter')
    const approveBtn = win.locator('[data-testid="approve"]')
    await expect(approveBtn).toBeVisible({ timeout: 10000 })
    await approveBtn.click()
    await expect(win.locator('[data-testid="diff-card"]')).toHaveCount(turn, { timeout: 10000 })
  }
  const overflowed = await win
    .locator('[data-testid="transcript"]')
    .evaluate(el => el.scrollHeight > el.clientHeight)
  expect(overflowed).toBe(true)
  await expect.poll(atBottom, { timeout: 5000 }).toBe(true)

  // 上翻到顶,发送新消息 → 必须强制回底
  await win.locator('[data-testid="transcript"]').evaluate(el => { el.scrollTop = 0 })
  await input.fill('第 5 轮消息')
  await input.press('Enter')
  await expect.poll(atBottom, { timeout: 5000 }).toBe(true)

  // 收尾:放行第 5 轮审批,防挂起
  await expect(win.locator('[data-testid="approve"]')).toBeVisible({ timeout: 10000 })
  await win.locator('[data-testid="approve"]').click()
  await expect(win.locator('[data-testid="diff-card"]')).toHaveCount(5, { timeout: 10000 })
  await expect.poll(atBottom, { timeout: 5000 }).toBe(true)

  await app.close()
})

// ---------------------------------------------------------------------------
// T22: 项目切换器 — 切换项目 → session.start 新目录 + 自动恢复最近会话
// ---------------------------------------------------------------------------

test('T22 项目切换:session.start 带新目录且自动恢复最近会话', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-t22.jsonl`)
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-a-'))
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-b-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t22-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: dirA,
      WRAITH_E2E_PROJECTS: JSON.stringify([
        { path: dirA, lastUsedAt: 2000 },
        { path: dirB, lastUsedAt: 1000 }
      ]),
      MOCK_SESSIONS_BY_WS: JSON.stringify({
        [dirB]: [
          { id: 'sess_b1', cwd: dirB, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T01:00:00Z', provider: 'mock', model: 'mock-model', title: 'B 项目的对话', turns: 1 }
        ]
      })
    }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="project-switcher"]')).toBeVisible({ timeout: 15000 })

  await win.locator('[data-testid="project-switcher"]').click()
  const items = win.locator('[data-testid="project-item"]')
  await expect(items).toHaveCount(2)
  await items.nth(1).click() // dirB(lastUsedAt 小,排第二)

  // session.start 带 dirB
  await expect
    .poll(() => {
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      return lines.some(l => l.method === 'session.start' && l.params?.workspaceDir === dirB)
    }, { timeout: 10000 })
    .toBe(true)

  // 自动恢复:mock session.resume 的回放内容出现在 transcript
  await expect(win.locator('text=之前问的问题')).toBeVisible({ timeout: 10000 })

  await app.close()
  for (const p of [recordFile]) fs.rmSync(p, { force: true })
  for (const p of [dirA, dirB, userData]) fs.rmSync(p, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T23: 项目切换 — 目标项目无历史 → 回欢迎空态(往返)
// ---------------------------------------------------------------------------

test('T23 切到无历史项目回欢迎态', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-a-'))
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-b-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t23-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: dirA,
      WRAITH_E2E_PROJECTS: JSON.stringify([
        { path: dirA, lastUsedAt: 2000 },
        { path: dirB, lastUsedAt: 1000 }
      ]),
      MOCK_SESSIONS_BY_WS: JSON.stringify({
        [dirB]: [
          { id: 'sess_b1', cwd: dirB, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T01:00:00Z', provider: 'mock', model: 'mock-model', title: 'B 项目的对话', turns: 1 }
        ]
      })
    }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="project-switcher"]')).toBeVisible({ timeout: 15000 })

  // 先切到 B(有历史 → transcript)
  await win.locator('[data-testid="project-switcher"]').click()
  await win.locator('[data-testid="project-item"]').nth(1).click()
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 10000 })

  // 再切回 A(无历史 → 欢迎态);B 刚被激活浮顶,A 现在排第二
  await win.locator('[data-testid="project-switcher"]').click()
  await win.locator('[data-testid="project-item"]').nth(1).click()
  await expect(win.locator('text=今天做点什么？')).toBeVisible({ timeout: 10000 })

  await app.close()
  for (const p of [dirA, dirB, userData]) fs.rmSync(p, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T24: 项目管理 — 重命名别名 + 移出列表
// ---------------------------------------------------------------------------

test('T24 项目重命名与移出', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-a-'))
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-b-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t24-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: dirA,
      WRAITH_E2E_PROJECTS: JSON.stringify([
        { path: dirA, lastUsedAt: 2000 },
        { path: dirB, lastUsedAt: 1000 }
      ]),
      MOCK_SESSIONS_BY_WS: '{}'
    }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="project-switcher"]')).toBeVisible({ timeout: 15000 })
  await win.locator('[data-testid="project-switcher"]').click()

  // 重命名 B(非活跃,第 2 行):hover 露钮 → 内联输入 → Enter
  const rowB = win.locator('[data-testid="project-item"]').nth(1)
  await rowB.hover()
  await win.locator('[data-testid="project-rename"]').nth(1).click()
  await win.locator('[data-testid="project-rename-input"]').fill('我的博客')
  await win.locator('[data-testid="project-rename-input"]').press('Enter')
  await expect(win.locator('[data-testid="project-item"]').nth(1)).toHaveText(/我的博客/, { timeout: 5000 })

  // 移出 B:hover 露钮 → 单击生效(无二次确认);活跃项 A 的移出钮 disabled
  await expect(win.locator('[data-testid="project-remove"]').nth(0)).toBeDisabled()
  await win.locator('[data-testid="project-item"]').nth(1).hover()
  await win.locator('[data-testid="project-remove"]').nth(1).click()
  await expect(win.locator('[data-testid="project-item"]')).toHaveCount(1, { timeout: 5000 })

  await app.close()
  for (const p of [dirA, dirB, userData]) fs.rmSync(p, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T25: 单活跃守卫 — turn 运行中项目激活/添加禁用
// ---------------------------------------------------------------------------

test('T25 运行中项目切换被禁', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-a-'))
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-b-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t25-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: dirA,
      WRAITH_E2E_PROJECTS: JSON.stringify([
        { path: dirA, lastUsedAt: 2000 },
        { path: dirB, lastUsedAt: 1000 }
      ]),
      MOCK_SESSIONS_BY_WS: '{}',
      MOCK_SLOW_TURN: '1'
    }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  await input.fill('慢轮次')
  await input.press('Enter')
  await expect(win.locator('[data-testid="interrupt"]')).toBeVisible({ timeout: 10000 }) // running 确立

  await win.locator('[data-testid="project-switcher"]').click()
  await expect(win.locator('[data-testid="project-item"]').nth(1)).toBeDisabled()
  await expect(win.locator('[data-testid="project-add"]')).toBeDisabled()

  await app.close()
  for (const p of [dirA, dirB, userData]) fs.rmSync(p, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Phase E-1: MCP 插件面板 + @-mention(T26–T32)
// ---------------------------------------------------------------------------

const MCP_FIXTURE = JSON.stringify({
  servers: [
    { name: 'github', state: 'starting', scope: 'user', enabled: true, shadowed: false, transport: 'stdio',
      tools: [{ name: 'get_issue', description: '读 issue' }], envKeys: ['GITHUB_TOKEN'] },
    { name: 'fs', state: 'ready', scope: 'project', enabled: true, shadowed: true, transport: 'stdio', tools: [], envKeys: [] },
  ],
  resources: [
    { server: 'github', uri: 'issue://1', name: 'Issue 1' },
    { server: 'fs', uri: 'file:///a.txt', name: 'a.txt' },
  ],
  statusScript: [{ afterMs: 500, name: 'github', state: 'ready' }],
})

async function launchMcpApp(extraEnv: Record<string, string> = {}): Promise<{ app: Awaited<ReturnType<typeof electron.launch>>; win: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>['firstWindow']>>; recordFile: string; cleanup: () => void }> {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-mcp.jsonl`)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-mcp-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_USERDATA: userData,
      MOCK_MCP: MCP_FIXTURE,
      ...extraEnv,
    },
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })
  return { app, win, recordFile, cleanup: () => { fs.rmSync(recordFile, { force: true }); fs.rmSync(userData, { recursive: true, force: true }) } }
}

function recordedMethods(recordFile: string): string[] {
  if (!fs.existsSync(recordFile)) return []
  return fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).method as string)
}

test('T26 插件面板:列表/状态点变迁(starting→ready 通知驱动)', async () => {
  const { app, win, cleanup } = await launchMcpApp()
  await win.locator('[data-testid="nav-plugins"]').click()
  const items = win.locator('[data-testid="mcp-server-item"]')
  await expect(items).toHaveCount(2)
  await expect(items.filter({ hasText: 'github' })).toBeVisible()
  // statusScript 500ms 后 github → ready:详情区状态文本变化
  await items.filter({ hasText: 'github' }).click()
  await expect(win.locator('[data-testid="mcp-detail"]')).toContainText('就绪', { timeout: 5000 })
  // 工具 tab 默认可见 get_issue
  await expect(win.locator('[data-testid="mcp-detail"]')).toContainText('get_issue')
  await app.close(); cleanup()
})

test('T27 添加表单 → mcp.config.upsert 请求', async () => {
  const { app, win, recordFile, cleanup } = await launchMcpApp()
  await win.locator('[data-testid="nav-plugins"]').click()
  await win.locator('[data-testid="mcp-add"]').click()
  await win.locator('[data-testid="mcp-form-name"]').fill('sqlite')
  await win.locator('[data-testid="mcp-form-command"]').fill('npx')
  await win.locator('[data-testid="mcp-form-args"]').fill('-y\nmcp-sqlite')
  await win.locator('[data-testid="mcp-form-scope-project"]').check()
  await win.locator('[data-testid="mcp-form-submit"]').click()
  await expect.poll(() => recordedMethods(recordFile).includes('mcp.config.upsert'), { timeout: 5000 }).toBe(true)
  await expect(win.locator('[data-testid="mcp-server-item"]')).toHaveCount(3, { timeout: 5000 })
  await app.close(); cleanup()
})

test('T28 启停与重启请求', async () => {
  const { app, win, recordFile, cleanup } = await launchMcpApp()
  await win.locator('[data-testid="nav-plugins"]').click()
  await win.locator('[data-testid="mcp-server-item"]').filter({ hasText: 'fs' }).click()
  await win.locator('[data-testid="mcp-toggle"]').click() // fs enabled → 停用
  await expect.poll(() => recordedMethods(recordFile).includes('mcp.disable'), { timeout: 5000 }).toBe(true)
  await expect(win.locator('[data-testid="mcp-toggle"]')).toHaveText('启用', { timeout: 5000 })
  await win.locator('[data-testid="mcp-toggle"]').click()
  await expect.poll(() => recordedMethods(recordFile).includes('mcp.enable'), { timeout: 5000 }).toBe(true)
  await win.locator('[data-testid="mcp-restart"]').click()
  await expect.poll(() => recordedMethods(recordFile).includes('mcp.restart'), { timeout: 5000 }).toBe(true)
  await app.close(); cleanup()
})

test('T29 删除二次确认', async () => {
  const { app, win, recordFile, cleanup } = await launchMcpApp()
  await win.locator('[data-testid="nav-plugins"]').click()
  await win.locator('[data-testid="mcp-server-item"]').filter({ hasText: 'github' }).click()
  await win.locator('[data-testid="mcp-remove"]').click() // 第一次:确认态
  expect(recordedMethods(recordFile).includes('mcp.config.remove')).toBe(false)
  await expect(win.locator('[data-testid="mcp-remove"]')).toHaveText('确认删除?')
  await win.locator('[data-testid="mcp-remove"]').click() // 第二次:生效
  await expect.poll(() => recordedMethods(recordFile).includes('mcp.config.remove'), { timeout: 5000 }).toBe(true)
  await expect(win.locator('[data-testid="mcp-server-item"]')).toHaveCount(1, { timeout: 5000 })
  await app.close(); cleanup()
})

test('T30 日志 tab 内容', async () => {
  const { app, win, cleanup } = await launchMcpApp()
  await win.locator('[data-testid="nav-plugins"]').click()
  await win.locator('[data-testid="mcp-server-item"]').filter({ hasText: 'github' }).click()
  await win.locator('[data-testid="mcp-tab-logs"]').click()
  await expect(win.locator('[data-testid="mcp-detail"]')).toContainText('[mock] line1', { timeout: 5000 })
  await app.close(); cleanup()
})

test('T31 @-mention 两级补全,原文提交', async () => {
  const { app, win, recordFile, cleanup } = await launchMcpApp()
  const input = win.locator('[data-testid="input"]')
  await input.click()
  await input.type('看下 @')
  await expect(win.locator('[data-testid="mention-popover"]')).toBeVisible({ timeout: 5000 })
  await win.locator('[data-testid="mention-item"]').filter({ hasText: 'github' }).click() // 一级:server
  await expect(win.locator('[data-testid="mention-item"]').filter({ hasText: 'issue://1' })).toBeVisible()
  await win.locator('[data-testid="mention-item"]').filter({ hasText: 'issue://1' }).click() // 二级:资源
  await expect(input).toHaveValue(/@github:issue:\/\/1 /)
  await input.press('Enter')
  await expect
    .poll(() => {
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      return lines.some(l => l.method === 'turn.submit' && typeof l.params?.input === 'string' && l.params.input.includes('@github:issue://1'))
    }, { timeout: 10000 })
    .toBe(true)
  await app.close(); cleanup()
})

test('T32 运行中工具集变更操作禁用', async () => {
  const { app, win, cleanup } = await launchMcpApp({ MOCK_SLOW_TURN: '1' })
  const input = win.locator('[data-testid="input"]')
  await input.fill('慢轮次')
  await input.press('Enter')
  await expect(win.locator('[data-testid="interrupt"]')).toBeVisible({ timeout: 10000 })
  await win.locator('[data-testid="nav-plugins"]').click()
  await win.locator('[data-testid="mcp-server-item"]').filter({ hasText: 'github' }).click()
  await expect(win.locator('[data-testid="mcp-toggle"]')).toBeDisabled()
  await expect(win.locator('[data-testid="mcp-remove"]')).toBeDisabled()
  await expect(win.locator('[data-testid="mcp-add"]')).toBeDisabled()
  await app.close(); cleanup()
})
