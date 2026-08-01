/**
 * 真后端全量检验(手动跑,不进 CI)。
 *
 *   cd desktop && npm run build && node test/manual/real-backend-sweep.mjs [截图目录]
 *
 * 与 test/e2e/*.e2e.ts 的根本区别:**不设 WRAITH_APPSERVER_CMD**,于是 backend.ts
 * 回落到 `java -jar ~/.wraith/wraith.jar app-server` —— 真 Java、真 LLM、真工具。
 * 仓库自带的 e2e 全走 mock-appserver,只能证明 UI↔RPC 对接上了,证不了后端做得对
 * (reasoning_content 那个 400 就是 mock 一辈子抓不到的)。
 *
 * 前置:~/.wraith/wraith.jar 是最新的(mvn package 后 cp 过去);config 里有一个
 * 带余额的 provider(脚本会按 label 含 "newapi" 做会话级切换,不写你的 config)。
 *
 * 刻意不做(有外部副作用,须人工点头):启动 IM 网关、触发微信扫码绑定。
 */
import { _electron as electron } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import fs from 'node:fs'

const DESKTOP = path.resolve(fileURLToPath(import.meta.url), '../../..')  // desktop/
const shots = process.argv[2] || path.join(os.tmpdir(), 'wraith-sweep')
fs.mkdirSync(shots, { recursive: true })
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-full-'))
const LOG = path.join(os.homedir(), '.wraith/logs/wraith.log')
const count400 = () => {
  try { return (fs.readFileSync(LOG, 'utf8').match(/API请求失败: 400/g) || []).length } catch { return -1 }
}
const before400 = count400()

const results = []
const log = (...a) => console.log(...a)
async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ ok: true, name, detail })
    log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`)
  } catch (e) {
    const msg = (e?.message || String(e)).split('\n')[0].slice(0, 160)
    results.push({ ok: false, name, detail: msg })
    log(`  ❌ ${name} — ${msg}`)
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg) }

const app = await electron.launch({
  args: [path.join(DESKTOP, 'out/main/index.js')],
  env: { ...process.env, WRAITH_E2E_USERDATA: userData },
  timeout: 60000,
})
const errLog = fs.createWriteStream(path.join(shots, 'main.log'))
app.process().stdout?.on('data', d => errLog.write(d))
app.process().stderr?.on('data', d => errLog.write(d))

async function mainWindow() {
  for (let i = 0; i < 120; i++) {
    for (const w of app.windows()) {
      if (!w.url().startsWith('data:')) { try { await w.locator('body').count(); return w } catch { /* 销毁中 */ } }
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('主窗口未出现')
}
const win = await mainWindow()

const idle = (ms = 240000) =>
  win.locator('[data-testid="interrupt"]').waitFor({ state: 'detached', timeout: ms }).catch(() => {})
async function ask(text) {
  await idle()
  const input = win.locator('[data-testid="input"]')
  await input.fill(text)
  await input.press('Enter')
}
const txt = async (sel) => ((await win.locator(sel).first().textContent()) || '').trim()

try {
  // ───────────────────────── A 外壳 ─────────────────────────
  log('\n▶ A 应用外壳')
  await check('A1 主窗口就绪、输入框可见', async () => {
    await win.locator('[data-testid="input"]').waitFor({ state: 'visible', timeout: 60000 })
  })
  await check('A2 新建会话(后端 session.start)', async () => {
    await win.locator('[data-testid="new-conversation"]').click()
    await win.waitForTimeout(2500)
  })
  await check('A3 侧栏「工具」组可展开', async () => {
    const toggle = win.locator('[data-testid="nav-tools-toggle"]')
    await toggle.waitFor({ timeout: 15000 })
    if (!(await win.locator('[data-testid="nav-plugins"]').isVisible())) await toggle.click()
    await win.locator('[data-testid="nav-plugins"]').waitFor({ timeout: 5000 })
  })

  // ───────────────────────── B 模型下拉(本次改动) ─────────────────────────
  log('\n▶ B 模型下拉「设为默认」(commit 67728f4)')
  await win.locator('[data-testid="model-chip"]').click()
  await win.locator('[data-testid="model-option"]').first().waitFor({ timeout: 15000 })
  await check('B1 「设为默认」未悬停即可见', async () => {
    const b = win.locator('[data-testid="model-set-default"]')
    must(await b.count() > 0, '一个按钮都没有')
    must(await b.first().isVisible(), '存在但不可见(仍被 hidden 门控?)')
    return `${await b.count()} 个`
  })
  await check('B2 文案为「设为默认」而非与徽章撞车的「默认」', async () => {
    const t = await txt('[data-testid="model-set-default"]')
    must(t === '设为默认', `实际为 ${JSON.stringify(t)}`)
  })
  await check('B3 当前默认项不给该按钮', async () => {
    const rows = await win.locator('[data-testid="model-option"]').count()
    const btns = await win.locator('[data-testid="model-set-default"]').count()
    must(btns === rows - 1, `${rows} 行 / ${btns} 按钮,应差 1`)
    return `${rows} 行 → ${btns} 按钮`
  })
  await check('B4 弹层已加宽到 320px(补偿常驻按钮)', async () => {
    const box = await win.locator('[data-testid="model-option"]').first()
      .evaluate(el => el.closest('[class*="w-80"]') ? 'w-80' : el.parentElement?.className || '?')
    must(String(box).includes('w-80'), `实际 ${box}`)
  })
  await win.screenshot({ path: path.join(shots, 'B-model.png') })
  await check('B5 切到有余额的 provider(会话级,不写 config)', async () => {
    await win.locator('[data-testid="model-option"]').filter({ hasText: 'newapi' }).first().click()
    await win.waitForTimeout(1500)
  })

  // ───────────────────────── C 面板可达性 ─────────────────────────
  log('\n▶ C 11 个功能面板可达')
  const PANELS = [
    ['nav-plugins', 'plugins-back', 'MCP 插件'], ['nav-automations', 'automations-back', '自动化'],
    ['nav-im-gateway', 'im-back', 'IM 网关'], ['nav-providers', 'providers-back', 'Provider'],
    ['nav-skills', 'skills-back', '技能'], ['nav-memory', 'memory-back', '记忆'],
    ['nav-snapshots', 'snapshot-back', '快照'], ['nav-tasks', 'task-back', '后台任务'],
    ['nav-policy', 'policy-back', '安全'], ['nav-browser', 'browser-back', '浏览器'],
    ['nav-rag', 'rag-back', '代码检索'],
  ]
  for (const [nav, back, label] of PANELS) {
    await check(`C:${label}`, async () => {
      if (!(await win.locator(`[data-testid="${nav}"]`).isVisible())) {
        await win.locator('[data-testid="nav-tools-toggle"]').click()
      }
      await win.locator(`[data-testid="${nav}"]`).click()
      await win.locator(`[data-testid="${back}"]`).waitFor({ timeout: 12000 })
      await win.locator(`[data-testid="${back}"]`).click()
      await win.locator('[data-testid="input"]').waitFor({ state: 'visible', timeout: 12000 })
    })
  }

  // ───────────────────────── D 浏览器面板(本次改动) ─────────────────────────
  log('\n▶ D 浏览器面板提示文案 (commit 9ad87a3)')
  await win.locator('[data-testid="nav-browser"]').click()
  await win.locator('[data-testid="browser-back"]').waitFor({ timeout: 12000 })
  await check('D1 面板顶部说明已改写(首推 chrome://inspect + 连接(自动))', async () => {
    const body = await txt('.panel-content')
    must(body.includes('chrome://inspect'), '未提 chrome://inspect')
    must(body.includes('连接(自动)'), '未推荐「连接(自动)」')
  })
  await check('D2 「按端口连接」新文案:不再谎称端口没开', async () => {
    await win.getByRole('button', { name: '按端口连接' }).click()   // 顶部说明里也有这四个字,用 role 消歧
    await win.waitForTimeout(6000)
    const body = await txt('.panel-content')
    must(body.includes('有服务在监听'), '没说清端口是通的')
    must(!body.includes('未检测到 Chrome 调试端口'), '仍在说「未检测到」')
    must(body.includes('HTTP 404'), '丢了原始状态码')
    return 'HTTP 404 → 正确归因为协议不匹配'
  })
  await check('D3 提到 --user-data-dir 必带「无登录态」警告', async () => {
    const body = await txt('.panel-content')
    if (body.includes('--user-data-dir')) must(body.includes('登录态'), '给了独立 profile 却不提醒没登录态')
  })
  await win.screenshot({ path: path.join(shots, 'D-browser.png') })
  await win.locator('[data-testid="browser-back"]').click()

  // ───────────────────────── E IM 网关面板 ─────────────────────────
  log('\n▶ E IM 网关面板平台卡状态 (commit bd17945)')
  await win.locator('[data-testid="nav-im-gateway"]').click()
  await win.locator('[data-testid="im-back"]').waitFor({ timeout: 12000 })
  await win.waitForTimeout(2500)
  for (const [id, name, want] of [['qq', 'QQ', '已配置'], ['feishu', '飞书', '已配置'],
                                  ['weixin', '微信', '已配置'], ['wecom', '企业微信', '可配置']]) {
    await check(`E:${name} 卡显示「${want}」(不依赖是否选中)`, async () => {
      const t = await txt(`[data-testid="im-platform-${id}"]`)
      must(t.includes(want), `实际 ${JSON.stringify(t)}`)
    })
  }
  await win.screenshot({ path: path.join(shots, 'E-im.png') })
  await win.locator('[data-testid="im-back"]').click()

  // ───────────────────────── F 自动化面板(本次改动) ─────────────────────────
  log('\n▶ F 自动化「下次」门控 (commit 451f374 / 99665d6)')
  await win.locator('[data-testid="nav-automations"]').click()
  await win.locator('[data-testid="automations-back"]').waitFor({ timeout: 12000 })
  await win.waitForTimeout(2500)
  await check('F1 网关未运行 → 列表副标签不含任何时刻', async () => {
    const body = await txt('.panel-content')
    const hasClock = /下次 \d{2}-\d{2} \d{2}:\d{2}/.test(body)
    must(!hasClock, '网关没跑却报了具体时刻(旧 bug)')
  })
  await check('F2 直说「未排期 · 网关未运行」', async () => {
    await win.getByText('未排期 · 网关未运行').first().waitFor({ timeout: 8000 })
  })
  await check('F3 头部胶囊显示网关状态', async () => {
    const t = await txt('[data-testid="gateway-pill"]')
    must(t.includes('网关'), `实际 ${JSON.stringify(t)}`)
    return t
  })
  await win.screenshot({ path: path.join(shots, 'F-automations.png') })
  await win.locator('[data-testid="automations-back"]').click()

  // ───────────────────────── G 聊天 × 真 LLM ─────────────────────────
  log('\n▶ G 聊天链路(真 LLM + 真工具)')
  await check('G1 im_status:回答与真实配置一致', async () => {
    await ask('你当前配置了哪些 im?')
    await win.locator('[data-testid="transcript"]').getByText('im_status').first().waitFor({ timeout: 240000 })
    await idle()
    const body = await txt('[data-testid="transcript"]')
    must(body.includes('企业微信'), '没提到企业微信')
    must(/未配置|没配|还没/.test(body), '没指出企微未配置')
    return '真调用 im_status'
  })
  await check('G2 open_panel:动作卡出现且点击真的切面板', async () => {
    const before = await win.locator('[data-testid="action-card"]').count()
    await ask('帮我打开 MCP 插件面板')
    await win.locator('[data-testid="action-card"]').nth(before).waitFor({ timeout: 240000 })
    await idle()
    const label = await win.locator('[data-testid="action-card"]').last().textContent()
    await win.locator('[data-testid="action-card"]').last().click()
    await win.locator('[data-testid="plugins-back"]').waitFor({ timeout: 10000 })
    await win.locator('[data-testid="plugins-back"]').click()
    await win.locator('[data-testid="input"]').waitFor({ state: 'visible', timeout: 12000 })
    return (label || '').trim()
  })
  await check('G3 im_connect:卡片出现,且未点击前不启动绑定', async () => {
    await ask('我想把你接到微信上,怎么弄?')
    await win.locator('[data-testid="im-connect-card"]').first().waitFor({ timeout: 240000 })
    await idle()
    const card = await txt('[data-testid="im-connect-card"]')
    must(card.includes('扫码绑定微信'), `卡片没有启动按钮:${card}`)
    must(!card.includes('请用目标微信扫描二维码'), '未点击就进了扫码态(点击门控失效)')
    must(!card.includes('已配置好'), '未点击就宣称已绑定')
    return '点击门控生效,未擅自发起绑定'
  })
  await win.screenshot({ path: path.join(shots, 'G-chat.png') })

  await check('G4 多轮工具调用无 reasoning_content 400 (commit 2d32dfe)', async () => {
    const after = count400()
    must(after === before400, `新增 ${after - before400} 次 400`)
    return `累计 ${after},本轮零新增`
  })

} catch (e) {
  log('\n💥 未捕获:', (e?.message || e).toString().slice(0, 300))
  await win.screenshot({ path: path.join(shots, 'FATAL.png') }).catch(() => {})
} finally {
  const pass = results.filter(r => r.ok).length
  log(`\n${'='.repeat(60)}\n合计 ${pass}/${results.length} 通过`)
  const bad = results.filter(r => !r.ok)
  if (bad.length) { log('失败项:'); bad.forEach(b => log(`  ✗ ${b.name} — ${b.detail}`)) }
  fs.writeFileSync(path.join(shots, 'results.json'), JSON.stringify(results, null, 2))
  await app.close().catch(() => {})
  fs.rmSync(userData, { recursive: true, force: true })
  log('截图/结果:', shots)
}
