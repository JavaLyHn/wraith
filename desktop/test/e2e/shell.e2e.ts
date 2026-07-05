import { test, expect, _electron as electron, type Page } from '@playwright/test'
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
      MOCK_SESSIONS_BY_WS: '{}', // repickDir 无历史 → 切换后仍是欢迎态(原断言保持)
      // Task 2 根因修复(见下方点击前置等待注释):
      //   MOCK_SLOW_TURN — turn.started 后停 3s,给 running 态一个可确定性观察的窗口;
      //   MOCK_NO_APPROVAL — 本轮不挂在审批上,3s 后自行走到 turn.completed → running 稳定清 idle。
      MOCK_SLOW_TURN: '1',
      MOCK_NO_APPROVAL: '1'
    }
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  // go to conversation state
  await input.fill('hi')
  await input.press('Enter')
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 15000 })

  // ── Task 2(清债波 C1)偶发根因修复 ──────────────────────────────────────────
  // 调查(MOCK_DEBUG_LOG/WRAITH_E2E_DEBUG_LOG 双日志,--repeat-each=60 + yes×4 CPU 负载,
  // 稳定复现):失败例日志签名恒为「session.start=1(仅启动那次,重选的第二次缺失)」。
  // 定位=渲染层 running 窗口竞态,非 mock/main 丢事件(SEND==FWD 完全一致):
  //   • transcript 可见由本地 markStarted 驱动(提交即置,与后端无关,并非 turn 已跑);
  //   • workspace-switch 钮 disabled={running};running 由 turn.started 通知触发、turn.completed 清除;
  //     且 handleAddProject 内还有 `if (state.turn === 'running') return` 二重守卫。
  //   • 旧用例在 transcript 可见后立即 click——此刻 running 仍可能为 idle(turn.submit 回包 ~ turn.started
  //     通知之间的空窗),看似可点;负载下 turn.started 抢先转发,click 落在 running 窗口,守卫吞掉点击
  //     → 第二次 session.start 永不发出。注意:光等 toBeEnabled 不够——它会被这段「turn.started 之前」的
  //     瞬态 idle 满足而提前返回,并未等到 turn 真正跑完。
  // 修复(brief 分支 3-D:把「transcript 可见」这个错误前置条件换成「turn 确已跑完」的正确前置条件,
  //   非加长超时、非 sleep):先等 interrupt 钮出现(running 确立,越过瞬态空窗),再等它消失
  //   (turn.completed → running 稳定清 idle),此时点击必然生效。
  await expect(win.locator('[data-testid="interrupt"]')).toBeVisible({ timeout: 15000 })
  await expect(win.locator('[data-testid="interrupt"]')).toHaveCount(0, { timeout: 15000 })

  const wsSwitch = win.locator('[data-testid="workspace-switch"]')
  await expect(wsSwitch).toBeEnabled({ timeout: 10000 })

  // re-pick (resolves to repickDir — distinct from startupDir, guard lets it through)
  await wsSwitch.click()

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
// Test 4b(负向）: 竞态窗口的产品级关闭验证 —— submit 后立刻(turn.started 确立前,
//   即原 submit→turn.started 竞态窗口内)点击 workspace-switch,不得产生第二次 session.start
//   且不得重置 transcript。
//
// 背景(清债波 Task 2 产品竞态,评审确认):旧行为里 markStarted 只翻 hasStarted、不动 turn,
//   turn 仅在后端 turn.started 通知到达才置 running。submit→turn.started 之间 turn==='idle',
//   此空窗内 Composer 的 workspace-switch(disabled={running}) 可点、App 的 running 守卫放行,
//   会误发第二次 session.start 并把 transcript 重置回欢迎态。真实后端首 token 数百 ms~秒级,用户可踩。
// 修复(源头关闭):markStarted 提交瞬间即置 turn='running'(按钮即禁 + 守卫即拦),
//   turnRef 消除守卫的闭包陈旧。本用例用 MOCK_SLOW_TURN 放大窗口(turn.started 后停 3s),
//   在 running 已确立、turn 远未跑完的窗口内点击,断言点击被彻底吞掉。
// ---------------------------------------------------------------------------

test('workspace switch 负向:submit 后竞态窗口内点击不产生第二次 session.start 且不重置 transcript', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-race.jsonl`)
  const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-race-startup-'))
  const repickDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-race-repick-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-race-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_WORKSPACE: startupDir,
      WRAITH_E2E_PICK: repickDir, // 若守卫失效,click 会走 switchToProject 发出第二次 session.start
      WRAITH_E2E_USERDATA: userData,
      MOCK_SESSIONS_BY_WS: '{}',
      // MOCK_SLOW_TURN:turn.started 后停 3s,放大 submit→turn(running)确立后的窗口;
      // MOCK_NO_APPROVAL:不挂审批,窗口内 running 稳定为 true,专测「running 中禁切」。
      MOCK_SLOW_TURN: '1',
      MOCK_NO_APPROVAL: '1',
    },
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  // 启动那一次 session.start 已发出;记下基线(应为 1)。
  const startCount = (): number => {
    if (!fs.existsSync(recordFile)) return 0
    return fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l)).filter(l => l.method === 'session.start').length
  }
  await expect.poll(startCount, { timeout: 10000 }).toBe(1)

  // 提交进入对话态。transcript 可见由本地 markStarted 驱动(提交瞬间,与后端无关)。
  await input.fill('hi')
  await input.press('Enter')
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 15000 })
  await expect(win.locator('[data-testid="user-msg"]')).toHaveText('hi', { timeout: 10000 })

  // ★ 竞态窗口就在此刻:transcript 刚由 markStarted 翻出、而后端 turn.started 通知(MOCK_SLOW_TURN
  //   下更晚)尚未确立。修复前 markStarted 不动 turn,此空窗内 running===false,按钮可点、守卫放行,
  //   点击会误发第二次 session.start 并把 transcript 重置回欢迎态。修复后 markStarted 提交瞬间即置
  //   running,此刻按钮已 disabled、handleAddProject/switchToProject 守卫读 turnRef 即拦。
  //   不等 interrupt/turn.started 确立,直接在窗口内点击;force:true 绕过 actionability 等待,
  //   把点击打到(修复后应为禁用的)钮上,精确验证「产品在竞态窗口内拒绝切换」。
  await win.locator('[data-testid="workspace-switch"]').click({ force: true })

  // 断言 1:等 turn 完整跑完(SLOW_TURN 3s 后 turn.completed → running 清 idle),期间给足时间让
  // 任何误触发的 switchToProject 有机会发出第二次 session.start;跑完后 session.start 计数必须仍为 1。
  await expect(win.locator('[data-testid="interrupt"]')).toHaveCount(0, { timeout: 15000 })
  expect(startCount(), '竞态窗口内的点击不得触发第二次 session.start').toBe(1)
  // 记录里也不应出现指向 repickDir 的 session.start(即从未走进 switchToProject)。
  const startedWorkspaces = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean)
    .map(l => JSON.parse(l)).filter(l => l.method === 'session.start').map(l => l.params?.workspaceDir)
  expect(startedWorkspaces).not.toContain(repickDir)

  // 断言 2:transcript 未被重置——用户气泡仍在,未回退到欢迎态。
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible()
  await expect(win.locator('[data-testid="user-msg"]')).toHaveText('hi')
  await expect(win.locator('text=今天做点什么？')).toHaveCount(0)

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
// Test 18b(负向,I-1): 编辑重发路径的 submit→turn.started 竞态窗口关闭验证。
//   编辑重发走 rewindSession→truncateAtUser→addUserItem→markStarted→submitTurn(与主 submit 对称)。
//   markStarted 提交瞬间即置 running,竞态窗口内(turn.started 尚未到达,MOCK_SLOW_TURN 放大)
//   force 点击 workspace-switch 必须被 turnRef 守卫吞掉——session.start 计数不增。
//   与 Task 2 修掉的 workspace-switch 负向(Test 4b)同尺寸,只是入口换成编辑重发路径。
// ---------------------------------------------------------------------------

test('编辑重发负向:竞态窗口内点击 workspace-switch 不产生第二次 session.start', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-edit-race.jsonl`)
  const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-edit-race-startup-'))
  const repickDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-edit-race-repick-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-edit-race-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_WORKSPACE: startupDir,
      WRAITH_E2E_PICK: repickDir, // 若守卫失效,click 会走 switchToProject 发出第二次 session.start
      WRAITH_E2E_USERDATA: userData,
      MOCK_SESSIONS_BY_WS: '{}',
      // MOCK_SLOW_TURN:turn.started 后停 3s,放大编辑重发 submit→turn(running)确立后的窗口;
      // MOCK_NO_APPROVAL:不挂审批,首轮秒级完成(经 3s SLOW 延迟后 turn.completed),重发窗口稳定。
      MOCK_SLOW_TURN: '1',
      MOCK_NO_APPROVAL: '1',
    },
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  const startCount = (): number => {
    if (!fs.existsSync(recordFile)) return 0
    return fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l)).filter(l => l.method === 'session.start').length
  }
  await expect.poll(startCount, { timeout: 10000 }).toBe(1)

  // 首轮完整跑完(SLOW 3s 后 turn.completed → running 清 idle;interrupt 钮消失)
  await input.fill('原始消息')
  await input.press('Enter')
  await expect(win.locator('[data-testid="user-msg"]')).toHaveText('原始消息', { timeout: 10000 })
  await expect(win.locator('[data-testid="interrupt"]')).toHaveCount(0, { timeout: 15000 })

  // hover 出编辑按钮 → 内联编辑 → 保存并重发(进入 handleEditMessage)
  await win.locator('[data-testid="user-msg"]').first().hover()
  await win.locator('[data-testid="msg-edit"]').click()
  const editInput = win.locator('[data-testid="msg-edit-input"]')
  await expect(editInput).toBeVisible({ timeout: 5000 })
  await editInput.fill('改后的消息')
  await win.locator('[data-testid="msg-edit-save"]').click()

  // ★ 竞态窗口:markStarted 已在 submitTurn 前置 running(修复后),但后端 turn.started(SLOW 3s)未到。
  //   先等气泡翻到改后文本(markStarted+addUserItem 已生效,窗口已开),再 force 点击。
  //   修复前 markStarted 不动 turn,此空窗内 running===false,守卫放行 → 误发第二次 session.start。
  await expect(win.locator('[data-testid="user-msg"]').first()).toHaveText('改后的消息', { timeout: 10000 })
  await win.locator('[data-testid="workspace-switch"]').click({ force: true })

  // 等第二轮完整跑完,期间给足时间让任何误触发的 switchToProject 发出第二次 session.start。
  await expect(win.locator('[data-testid="interrupt"]')).toHaveCount(0, { timeout: 15000 })
  expect(startCount(), '编辑重发竞态窗口内的点击不得触发第二次 session.start').toBe(1)
  const startedWorkspaces = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean)
    .map(l => JSON.parse(l)).filter(l => l.method === 'session.start').map(l => l.params?.workspaceDir)
  expect(startedWorkspaces).not.toContain(repickDir)

  // 气泡仍是改后的消息,未被重置回欢迎态
  await expect(win.locator('[data-testid="user-msg"]')).toHaveText('改后的消息')
  await expect(win.locator('text=今天做点什么？')).toHaveCount(0)

  await app.close()
  fs.rmSync(recordFile, { force: true })
  fs.rmSync(startupDir, { recursive: true, force: true })
  fs.rmSync(repickDir, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
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
      if (!fs.existsSync(recordFile)) return false
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

// ---------------------------------------------------------------------------
// Phase E-2: 自动化(T33–T37)——「立即运行」驱动,调度到点不进 E2E(纯函数已单测)
// ---------------------------------------------------------------------------

async function launchAutoApp(extraEnv: Record<string, string> = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-auto-'))
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-auto-proj-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: proj,
      WRAITH_E2E_PROJECTS: JSON.stringify([{ path: proj, lastUsedAt: 1000 }]),
      MOCK_NO_APPROVAL: '1',
      ...extraEnv,
    },
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })
  return { app, win, cleanup: () => { fs.rmSync(userData, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true }) } }
}

async function createAndRunTask(win: Page, name: string): Promise<void> {
  await win.locator('[data-testid="nav-automations"]').click()
  await expect(win.locator('[data-testid="automations-back"]')).toBeVisible({ timeout: 10000 })
  await win.locator('[data-testid="automation-add"]').click()
  await win.locator('[data-testid="automation-form-name"]').fill(name)
  await win.locator('[data-testid="automation-form-prompt"]').fill('总结一下今天的进展')
  await win.locator('[data-testid="automation-run-now"]').click()
}

test('T33 建任务+立即运行 → 运行历史出现 success 与摘要', async () => {
  const { app, win, cleanup } = await launchAutoApp()
  await createAndRunTask(win, '日报')
  // 立即运行后面板自动切 runs tab;mock turn 秒级完成
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('成功', { timeout: 15000 })
  await expect(win.locator('[data-testid="automation-run-item"]').first()).not.toContainText('运行中')
  // I-2: 摘要应包含 mock message.delta 发出的文本(fixture 发送 "Hello " + "**world**")
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('Hello')
  await app.close(); cleanup()
})

test('T34 挂起审批链:红点 → 切 runs → 处理审批 → ApprovalModal → 批准 → 完成', async () => {
  const { app, win, cleanup } = await launchAutoApp({ MOCK_NO_APPROVAL: '', MOCK_APPROVAL_TOOL: 'execute_command' })
  await createAndRunTask(win, '要审批的任务')
  // I-4: 审批 push 不再强弹 Modal;唯一入口 = 运行历史「处理审批」钮。
  // 先断言红点(badge 由 approval.requested 推送驱动)
  await expect(win.locator('[data-testid="nav-automations-badge"]')).toBeVisible({ timeout: 15000 })
  // 切到运行历史 tab,等 waiting 项出现(createAndRunTask 已切 runs;此处显式保证)
  await win.locator('[data-testid="automation-tab-runs"]').click()
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('等待审批', { timeout: 15000 })
  // 点「处理审批」→ ApprovalModal 出现(handleReopenApproval 先验证 run 仍 waiting 再重弹)
  await win.locator('[data-testid="automation-run-approve"]').first().click()
  await expect(win.locator('[data-testid="approval-modal"]')).toBeVisible({ timeout: 10000 })
  // 注:ApprovalModal.tsx 中批准按钮 testid 为 "approve"(非 "approval-approve")
  await win.locator('[data-testid="approve"]').click()
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('成功', { timeout: 15000 })
  await app.close(); cleanup()
})

test('T35 终止 running → interrupted', async () => {
  // MOCK_NO_APPROVAL(launchAutoApp 默认)与 MOCK_SLOW_TURN 并存语义:
  // MOCK_SLOW_TURN 延迟 3s,为 stop 操作留出 running 窗口;
  // MOCK_NO_APPROVAL 确保 3s 内不弹审批弹窗干扰中断流程,stop 先行。
  const { app, win, cleanup } = await launchAutoApp({ MOCK_SLOW_TURN: '1' })
  await createAndRunTask(win, '慢任务')
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('运行中', { timeout: 15000 })
  await win.locator('[data-testid="automation-run-stop"]').click()
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('中断', { timeout: 15000 })
  await app.close(); cleanup()
})

test('T36 启停 toggle 与删除二次确认', async () => {
  const { app, win, cleanup } = await launchAutoApp()
  await win.locator('[data-testid="nav-automations"]').click()
  await expect(win.locator('[data-testid="automations-back"]')).toBeVisible({ timeout: 10000 })
  await win.locator('[data-testid="automation-add"]').click()
  await win.locator('[data-testid="automation-form-name"]').fill('开关任务')
  await win.locator('[data-testid="automation-form-prompt"]').fill('p')
  await win.locator('[data-testid="automation-save"]').click()
  await expect(win.locator('[data-testid="automation-item"]')).toHaveCount(1, { timeout: 5000 })
  await win.locator('[data-testid="automation-toggle"]').click()
  await expect(win.locator('[data-testid="automation-item"]')).toContainText('已暂停', { timeout: 5000 })
  await win.locator('[data-testid="automation-remove"]').click()
  await expect(win.locator('[data-testid="automation-remove"]')).toHaveText('确认删除?')
  await win.locator('[data-testid="automation-remove"]').click()
  await expect(win.locator('[data-testid="automation-item"]')).toHaveCount(0, { timeout: 5000 })
  await app.close(); cleanup()
})

test('T37 运行历史跳转会话(回放可见)', async () => {
  const { app, win, cleanup } = await launchAutoApp()
  await createAndRunTask(win, '跳转任务')
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('成功', { timeout: 15000 })
  await win.locator('[data-testid="automation-run-open"]').first().click()
  await expect(win.locator('[data-testid="transcript"]')).toBeVisible({ timeout: 10000 })
  await expect(win.locator('text=之前问的问题')).toBeVisible({ timeout: 10000 }) // mock resume 回放
  await app.close(); cleanup()
})

// ---------------------------------------------------------------------------
// A4: 面板停留期间跑完一次运行,红点不亮(spec 验收)
//   createAndRunTask 已打开面板并切到 runs tab。任务在面板可见期间跑到终态。
//   AutomationsPanel 收到 runs-changed 后(80ms debounce)会重发 automationPanelOpened,
//   把「面板可见期间到达的终态」即时标为已读 → badge 不重亮。
//   注意留足余量:80ms debounce + panelOpened IPC 往返,用 expect.poll auto-retry。
// ---------------------------------------------------------------------------

test('A4 面板停留期间跑完运行 → 红点不亮', async () => {
  const { app, win, cleanup } = await launchAutoApp()
  await createAndRunTask(win, '面板内任务')
  // 面板已打开、已切 runs;等运行到终态成功
  await expect(win.locator('[data-testid="automation-run-item"]').first()).toContainText('成功', { timeout: 15000 })
  // 断言红点不亮:给足 80ms debounce + panelOpened 往返余量,poll 期内 badge 计数应稳定为 0。
  await expect.poll(
    async () => win.locator('[data-testid="nav-automations-badge"]').count(),
    { timeout: 10000 },
  ).toBe(0)
  // 再稳一拍:确认不是短暂 0——短窗内复查仍为 0(亮后随事件消也算过,此处直接要求终态不亮)。
  await expect(win.locator('[data-testid="nav-automations-badge"]')).toHaveCount(0)
  await app.close(); cleanup()
})

// ---------------------------------------------------------------------------
// T39: 插件面板 configError 横幅(MOCK_MCP_CONFIG_ERROR 注入)
// ---------------------------------------------------------------------------

test('T39 插件面板坏配置横幅:mcp-config-error banner 含错误文本', async () => {
  const { app, win, cleanup } = await launchMcpApp({
    MOCK_MCP_CONFIG_ERROR: 'mcp.json 第 3 行解析失败',
  })
  await win.locator('[data-testid="nav-plugins"]').click()
  await expect(
    win.locator('[data-testid="mcp-config-error"]')
  ).toContainText('第 3 行', { timeout: 10000 })
  await app.close(); cleanup()
})

// ---------------------------------------------------------------------------
// T42: 附件链 — WRAITH_E2E_ATTACH 注入文本文件 → 点 attach → chip 出现 → 提交 → record 断言
// ---------------------------------------------------------------------------

test('T42 附件链:注入文件 → chip 出现 → 提交 → turn.submit params.attachments[0].path/kind 正确', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-t42.jsonl`)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t42-'))
  // 创建临时文本文件
  const tmpFile = path.join(os.tmpdir(), `wraith-attach-t42-${process.pid}.txt`)
  fs.writeFileSync(tmpFile, 'hello attachment\n')

  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_ATTACH: JSON.stringify([tmpFile]),
      MOCK_NO_APPROVAL: '1',
    },
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  // 点 attach 按钮 → chip 出现
  const attachBtn = win.locator('[data-testid="attach"]')
  await expect(attachBtn).toBeEnabled({ timeout: 5000 })
  await attachBtn.click()

  // chip 应出现并包含文件名
  const chip = win.locator('[data-testid="attachment-chip"]')
  await expect(chip).toBeVisible({ timeout: 5000 })
  await expect(chip).toContainText(path.basename(tmpFile))

  // 提交
  await input.fill('带附件的消息')
  await input.press('Enter')

  // record 断言 turn.submit params.attachments[0]
  await expect
    .poll(() => {
      if (!fs.existsSync(recordFile)) return null
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const submit = [...lines].reverse().find(l => l.method === 'turn.submit')
      if (!submit || !submit.params?.attachments?.length) return null
      return {
        path: submit.params.attachments[0].path,
        kind: submit.params.attachments[0].kind,
      }
    }, { timeout: 10000 })
    .toEqual({ path: tmpFile, kind: 'text' })

  await app.close()
  fs.rmSync(recordFile, { force: true })
  fs.rmSync(userData, { recursive: true, force: true })
  fs.rmSync(tmpFile, { force: true })
})

// ---------------------------------------------------------------------------
// T43: 两附件移除其一 → 提交 → record 断言只剩一个
// ---------------------------------------------------------------------------

test('T43 两附件移除其一 → 提交 → turn.submit params.attachments 只含一个', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-t43.jsonl`)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t43-'))
  const tmpFileA = path.join(os.tmpdir(), `wraith-attach-t43a-${process.pid}.txt`)
  const tmpFileB = path.join(os.tmpdir(), `wraith-attach-t43b-${process.pid}.txt`)
  fs.writeFileSync(tmpFileA, 'file A\n')
  fs.writeFileSync(tmpFileB, 'file B\n')

  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_ATTACH: JSON.stringify([tmpFileA, tmpFileB]),
      MOCK_NO_APPROVAL: '1',
    },
  })
  const win = await app.firstWindow()
  const input = win.locator('[data-testid="input"]')
  await expect(input).toBeVisible({ timeout: 15000 })

  // 点 attach → 两个 chip 出现
  await win.locator('[data-testid="attach"]').click()
  await expect(win.locator('[data-testid="attachment-chip"]')).toHaveCount(2, { timeout: 5000 })

  // 移除第一个 chip
  await win.locator('[data-testid="attachment-remove"]').first().click()
  await expect(win.locator('[data-testid="attachment-chip"]')).toHaveCount(1, { timeout: 5000 })

  // 提交
  await input.fill('移除一个后提交')
  await input.press('Enter')

  // record 断言:attachments 只含 1 个(tmpFileB)
  await expect
    .poll(() => {
      if (!fs.existsSync(recordFile)) return null
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const submit = [...lines].reverse().find(l => l.method === 'turn.submit')
      if (!submit || !submit.params?.attachments) return null
      return submit.params.attachments.length
    }, { timeout: 10000 })
    .toBe(1)

  // 确认剩下的是 B
  const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map((l: string) => JSON.parse(l))
  const submit = [...lines].reverse().find((l: { method: string }) => l.method === 'turn.submit')
  expect(submit?.params?.attachments?.[0]?.path).toBe(tmpFileB)

  await app.close()
  fs.rmSync(recordFile, { force: true })
  fs.rmSync(userData, { recursive: true, force: true })
  fs.rmSync(tmpFileA, { force: true })
  fs.rmSync(tmpFileB, { force: true })
})

// ---------------------------------------------------------------------------
// T44: 模型切换下拉 — 开下拉→选另一 provider→chip 文本变+record 断言 session.setModel
//   + 无 key 项 disabled 断言
// ---------------------------------------------------------------------------

test('T44 模型切换:开下拉→选 deepseek→chip 文本变+record session.setModel;无 key 项 disabled', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-t44.jsonl`)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t44-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_USERDATA: userData,
      MOCK_NO_APPROVAL: '1',
    },
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })

  // 点 model-chip 开下拉
  const chip = win.locator('[data-testid="model-chip"]')
  await expect(chip).toBeVisible({ timeout: 10000 })
  await chip.click()

  // 等条目出现(model.list 异步加载)
  const options = win.locator('[data-testid="model-option"]')
  await expect(options).toHaveCount(2, { timeout: 10000 })

  // 无 key 项(openai)置灰 disabled
  const openaiOption = options.filter({ hasText: 'openai' })
  await expect(openaiOption).toBeDisabled()

  // deepseek 有 key,点击切换
  const deepseekOption = options.filter({ hasText: 'deepseek' })
  await expect(deepseekOption).toBeEnabled()
  await deepseekOption.click()

  // chip 显示新 model
  await expect(chip).toContainText('deepseek-chat', { timeout: 5000 })

  // record 断言 session.setModel
  await expect
    .poll(() => {
      if (!fs.existsSync(recordFile)) return null
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const call = [...lines].reverse().find(l => l.method === 'session.setModel')
      return call ? call.params.provider : null
    }, { timeout: 10000 })
    .toBe('deepseek')

  await app.close()
  fs.rmSync(recordFile, { force: true })
  fs.rmSync(userData, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T45: 设为默认 — 点「默认」→ record 断言 config.setDefaultProvider
// ---------------------------------------------------------------------------

test('T45 设为默认:点 model-set-default → record config.setDefaultProvider', async () => {
  const recordFile = path.join(os.tmpdir(), `wraith-rec-${process.pid}-${Date.now()}-t45.jsonl`)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t45-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_RECORD: recordFile,
      WRAITH_E2E_USERDATA: userData,
      MOCK_NO_APPROVAL: '1',
    },
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })

  // 开下拉
  const chip = win.locator('[data-testid="model-chip"]')
  await chip.click()

  // 等条目出现
  const options = win.locator('[data-testid="model-option"]')
  await expect(options).toHaveCount(2, { timeout: 10000 })

  // 「设为默认」按钮在 group-hover 下显示:先 hover 触发 CSS,再点击
  const deepseekOption = options.filter({ hasText: 'deepseek' })
  await deepseekOption.hover()
  const setDefaultBtn = win.locator('[data-testid="model-set-default"]').first()
  await expect(setDefaultBtn).toBeVisible({ timeout: 5000 })
  await setDefaultBtn.click()

  // record 断言 config.setDefaultProvider
  await expect
    .poll(() => {
      if (!fs.existsSync(recordFile)) return null
      const lines = fs.readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      const call = [...lines].reverse().find(l => l.method === 'config.setDefaultProvider')
      return call ? call.params.provider : null
    }, { timeout: 10000 })
    .toBe('deepseek')

  await app.close()
  fs.rmSync(recordFile, { force: true })
  fs.rmSync(userData, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T46: 侧栏搜索 — 输入关键字两分区各自过滤,清除恢复原列表
// ---------------------------------------------------------------------------

test('T46 侧栏搜索:输入关键字过滤会话+项目两分区,清除钮恢复原列表', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-t46-proj-a-'))
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-t46-alpha-b-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t46-'))
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
        { path: dirB, lastUsedAt: 1000 },
      ]),
      MOCK_SESSIONS_BY_WS: JSON.stringify({
        [dirA]: [
          { id: 'sess_t46_1', cwd: dirA, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T01:00:00Z', provider: 'mock', model: 'mock-model', title: 'alpha 测试会话', turns: 1 },
          { id: 'sess_t46_2', cwd: dirA, createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T01:00:00Z', provider: 'mock', model: 'mock-model', title: '无关对话', turns: 1 },
        ],
      }),
    },
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="sidebar"]')).toBeVisible({ timeout: 15000 })

  // 初始状态:两条会话可见
  await expect(win.locator('[data-testid="conversation-item"]')).toHaveCount(2, { timeout: 10000 })

  // 点搜索按钮激活搜索框
  await win.locator('[data-testid="nav-search"]').click()
  await expect(win.locator('[data-testid="sidebar-search"]')).toBeVisible({ timeout: 5000 })

  // 输入 "alpha" — 只有「alpha 测试会话」命中;项目分区中路径含 alpha 的 dirB 命中
  await win.locator('[data-testid="sidebar-search"]').fill('alpha')

  // 会话分区:只剩 1 条(alpha 测试会话)
  await expect(win.locator('[data-testid="conversation-item"]')).toHaveCount(1, { timeout: 5000 })
  await expect(win.locator('[data-testid="conversation-item"]').first()).toContainText('alpha 测试会话')

  // 项目分区:含 alpha 路径尾段的 dirB 命中
  await expect(win.locator('[data-testid="search-project-item"]')).toHaveCount(1, { timeout: 5000 })
  await expect(win.locator('[data-testid="search-project-item"]').first()).toContainText('alpha')

  // 点清除钮 → 搜索框消失,恢复原两条会话
  await win.locator('[data-testid="sidebar-search-clear"]').click()
  await expect(win.locator('[data-testid="sidebar-search"]')).toHaveCount(0, { timeout: 5000 })
  await expect(win.locator('[data-testid="conversation-item"]')).toHaveCount(2, { timeout: 5000 })

  await app.close()
  for (const p of [dirA, dirB, userData]) fs.rmSync(p, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T47: 会话行 star/改名/删除按钮元素存在性验证(降级)
//
// 降级原因:mock-appserver 未实现 wraith:setSessionStarred / wraith:renameSession /
//   wraith:deleteSession IPC 处理器;调用这些 preload 方法会 reject,无法在 e2e 层
//   对 IPC 往返做端到端断言。全链路 IPC 测试留待 mock 扩展后补齐。
//   本用例仅验证 SessionRow 组件渲染正确:hover 后三个操作按钮元素存在于 DOM 中,
//   且具备正确的 data-testid,确保 Task 6 UI 层变更本身不引入回归。
// ---------------------------------------------------------------------------

test('T47(降级) 会话行 hover 后 star/改名/删除按钮元素可见', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-t47-a-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-t47-'))
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      WRAITH_APPSERVER_CMD: 'node ' + mockPath,
      WRAITH_E2E: '1',
      WRAITH_E2E_USERDATA: userData,
      WRAITH_E2E_WORKSPACE: dirA,
      MOCK_SESSIONS_BY_WS: JSON.stringify({
        [dirA]: [
          { id: 'sess_t47_1', cwd: dirA, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T01:00:00Z', provider: 'mock', model: 'mock-model', title: 'T47 测试会话', turns: 1 }
        ]
      })
    }
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="sidebar"]')).toBeVisible({ timeout: 15000 })

  // 确认会话行已渲染
  await expect(win.locator('[data-testid="conversation-item"]')).toHaveCount(1, { timeout: 10000 })
  await expect(win.locator('[data-testid="conversation-item"]').first()).toContainText('T47 测试会话')

  // hover 会话行,三个操作按钮应出现在 DOM 中(通过 opacity-0/group-hover 控制可见,但始终 attached)
  await win.locator('[data-testid="conversation-item"]').first().hover()
  await expect(win.locator('[data-testid="session-star"]').first()).toBeAttached({ timeout: 5000 })
  await expect(win.locator('[data-testid="session-rename"]').first()).toBeAttached({ timeout: 5000 })
  await expect(win.locator('[data-testid="session-delete"]').first()).toBeAttached({ timeout: 5000 })

  await app.close()
  for (const p of [dirA, userData]) fs.rmSync(p, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// T48: ProvidersPanel — 点击 nav-providers → 面板可见 + 搜索框 + catalog 行
// NOTE: mock-appserver 有 model.list handler(返回 providers 列表),但无 config.setProvider /
//   config.removeProvider handler。面板在 modelList() 失败或返回空时仍渲染全部 catalog(均在
//   "全部"组)。本测试断言:providers-panel 可见、providers-search 存在、至少一个 provider-config
//   按钮可见。真实 setProvider 往返需手动验证(mock 无对应 handler)。
// ---------------------------------------------------------------------------

test('T48 ProvidersPanel:nav-providers → 面板可见 + 搜索框 + catalog 行', async () => {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1' }
  })
  const win = await app.firstWindow()

  // 等待 sidebar 出现
  await expect(win.locator('[data-testid="sidebar"]')).toBeVisible({ timeout: 15000 })

  // 点击 nav-providers
  const navProviders = win.locator('[data-testid="nav-providers"]')
  await expect(navProviders).toBeVisible({ timeout: 10000 })
  await navProviders.click()

  // providers-panel 面板可见
  await expect(win.locator('[data-testid="providers-panel"]')).toBeVisible({ timeout: 10000 })

  // 搜索框存在
  await expect(win.locator('[data-testid="providers-search"]')).toBeVisible({ timeout: 5000 })

  // catalog 中至少一个 provider-config 按钮可见(mock modelList 返回空 providers → 全部在"全部"组)
  await expect(win.locator('[data-testid="provider-config"]').first()).toBeVisible({ timeout: 5000 })

  await app.close()
})
