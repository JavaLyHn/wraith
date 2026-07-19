/**
 * Task 10: End-to-End for the Global Desktop Pet Window
 *
 * The desktop pet was rebuilt (2026-07-19 spec) from an in-chat floating overlay
 * (the old `chat-pet` div, gone since Task 5's unmount + Task 10's deletion of
 * PetAvatar.tsx) into an independent, always-on-top, frameless/transparent
 * `BrowserWindow` managed entirely by the main process (`petWindow.ts`). These
 * tests exercise that new surface through a real Electron instance launched by
 * Playwright's `_electron`, on top of an isolated userData dir
 * (WRAITH_E2E_USERDATA) and an isolated Petdex root (WRAITH_E2E_PETDEX_ROOT) —
 * never the real ~/.codex/pets directory or a real user profile.
 *
 * `PetConfig.enabled` defaults to `true` (DEFAULT_PET_CONFIG, settings.ts), so as
 * long as the isolated Petdex root has at least one available pet, main's
 * `app.whenReady()` handler calls `syncPetWindow(readPetConfig(...))` and the pet
 * window is created without any UI interaction — see index.ts's comment on that
 * call site ("E2E 下也走,以便 Task 10 e2e 断言第二窗出现").
 *
 * Test 1: launching with a fixture pet available produces a SECOND Electron
 *   window whose URL contains `pet.html`; that window's underlying
 *   `BrowserWindow` reports the always-on-top/non-focusable/
 *   non-movable-by-title-bar/no-native-shadow properties it was constructed
 *   with (createPetWindow in petWindow.ts: setAlwaysOnTop(true),
 *   focusable:false, movable:false, hasShadow:false). NOT asserted:
 *   `getBackgroundColor()` — empirically verified (see task-10-report.md) that
 *   on this macOS/Electron 32 build it always strips the alpha channel and
 *   returns a plain 6-digit `#RRGGBB`, even for windows constructed with an
 *   explicit alpha byte (`#8055FF00` round-trips as `#55FF00`) or with
 *   `transparent: true`. It therefore cannot discriminate "genuinely
 *   transparent" from "opaque black background" on this platform, so
 *   asserting it here would be a decorative check masquerading as a real one.
 * Test 2: flipping the `pet-enabled` switch off in the main window's Settings →
 *   Pets panel makes the pet window disappear from `electronApp.windows()`
 *   (writePetConfig → broadcastPetConfig + syncPetWindow → shouldShowPet false →
 *   destroyPetWindow).
 * Test 3: under `prefers-reduced-motion: reduce` (emulated on the pet window's
 *   own Page, then a reload to force PetSprite's un-memoized
 *   `window.matchMedia(...).matches` read to pick it up on first render), the
 *   `pet-sprite` element's animated child carries none of the `pet-*` animation
 *   classes it would otherwise carry for the active state (motionFor returns
 *   `className: ''` whenever `reduced` is true, regardless of state/style).
 *
 * 手工验收项(headless E2E 无法断言,诚实标注,不伪造):
 * - 置顶效果在真实合成器/多 App 场景下的实际视觉层序(z-order 相对其他真实窗口);
 * - 跨 Space/全屏切换时宠物窗是否真的跟随可见(setVisibleOnAllWorkspaces 的实际
 *   窗口管理器行为,而非我们设置的那个布尔值本身);
 * - 透明区域点击穿透到桌面/其他应用(需要真实合成器 hit-test,不是 DOM 事件);
 * - 原生右键菜单(Menu.popup 弹出的是原生 NSMenu,不在 DOM/Playwright Page 内);
 * - 真实鼠标全身拖动 / 真实滚轮缩放手势的端到端体验(可注入 PointerEvent/wheel
 *   触发内部 handler,但那只是驱动同一段逻辑,不是验证"用户真的能拖得动")。
 * 这些需要真机人工验收,已记录进 spec,不在此文件里用假断言充数。
 */

import { test, expect, _electron as electron, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const mainPath = path.resolve(__dirname, '../../out/main/index.js')
const mockPath = path.resolve(__dirname, '../fixtures/mock-appserver.mjs')

type ElectronApp = Awaited<ReturnType<typeof electron.launch>>

// Minimal PNG stand-in: real magic bytes + IHDR width/height only (no pixel data).
// petStore.validateImageBuffer only reads the signature + IHDR-declared dimensions
// (see test/petStore.test.ts's own `png()` helper) — sufficient for discovery/
// preview-URL plumbing; the renderer never needs to actually decode the pixels for
// window-appearance/reduced-motion assertions since the spritesheet is shown via
// CSS background on an explicitly-sized div, not an <img> whose failed decode
// would collapse it.
function fakePng(width = 1536, height = 1872): Buffer {
  const bytes = Buffer.alloc(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

/** Writes a valid Noir Webling Petdex package: <petdexRoot>/noir-webling/{pet.json,spritesheet.png}.
 *  1536x1872 matches petStore's DEFAULT_SPRITE (8 cols x192, 9 rows x208) since the
 *  manifest below omits an explicit `sprite`. */
function writeNoirFixture(petdexRoot: string): void {
  const dir = path.join(petdexRoot, 'noir-webling')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify({
    id: 'noir-webling',
    displayName: 'Noir Webling',
    description: 'E2E fixture pet',
    spritesheetPath: 'spritesheet.png',
  }))
  fs.writeFileSync(path.join(dir, 'spritesheet.png'), fakePng())
}

async function launchApp(env: Record<string, string>): Promise<{ app: ElectronApp; win: Page }> {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1', ...env },
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })
  return { app, win }
}

/** Polls electronApp.windows() (no event-listener race: a 'window' event fired
 *  before we call waitForEvent would be missed, so we just poll the live list)
 *  until a page matching `predicate` shows up, or throws past `timeoutMs`. */
async function waitForWindow(app: ElectronApp, predicate: (p: Page) => boolean, timeoutMs = 10000): Promise<Page> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = app.windows().find(predicate)
    if (found) return found
    if (Date.now() > deadline) throw new Error('等待匹配窗口超时(' + timeoutMs + 'ms)')
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** Polls until electronApp.windows().length === count, or throws past timeoutMs. */
async function waitForWindowCount(app: ElectronApp, count: number, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (app.windows().length === count) return
    if (Date.now() > deadline) {
      throw new Error('windows().length 未在 ' + timeoutMs + 'ms 内变为 ' + count + ',实际 ' + app.windows().length)
    }
    await new Promise((r) => setTimeout(r, 100))
  }
}

function findPetWindow(app: ElectronApp): Promise<Page> {
  return waitForWindow(app, (p) => p.url().includes('pet.html'))
}

// ---------------------------------------------------------------------------
// Test 1: default-enabled pet + available fixture → a second frameless/
// transparent/always-on-top window appears without any UI interaction
// ---------------------------------------------------------------------------

test('宠物默认启用且有可用宠物时,启动后出现第二个透明置顶宠物窗口', async () => {
  const petdexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-petdex-win-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-pets-win-'))
  writeNoirFixture(petdexRoot)

  const { app, win } = await launchApp({ WRAITH_E2E_USERDATA: userData, WRAITH_E2E_PETDEX_ROOT: petdexRoot })

  // 主窗之外多出一个 URL 含 pet.html 的窗口——不经任何设置面板点击,纯粹是
  // pets.enabled 默认 true + petdexRoot 提供了可用宠物,whenReady 时 syncPetWindow
  // 自动建窗(见 index.ts 该调用点的注释)。
  const petPage = await findPetWindow(app)
  expect(petPage.url()).toContain('pet.html')
  await waitForWindowCount(app, 2)

  // BrowserWindow 的构造期属性(petWindow.ts createPetWindow):setAlwaysOnTop(true) +
  // focusable:false + movable:false(全身拖动改走 setBounds,不依赖标题栏可拖)+
  // hasShadow:false(无边框窗不该带原生投影)+ resizable:true(仅供程序化 setBounds
  // 改尺寸用,见 Task 9 滚轮缩放的坑)。这些都是可经 BrowserWindow API 直接读出的
  // 确定性状态,不依赖合成器的实际视觉渲染——"看起来是否真的透明/置顶/无边框"是手工
  // 验收项(见文件顶部注释);getBackgroundColor() 在本平台/Electron 版本上不可靠
  // (同上,已实测排除)。
  const bw = await app.browserWindow(petPage)
  const props = await bw.evaluate((w: any) => ({
    alwaysOnTop: w.isAlwaysOnTop(),
    focusable: w.isFocusable(),
    movable: w.isMovable(),
    hasShadow: w.hasShadow(),
    resizable: w.isResizable(),
  }))
  expect(props.alwaysOnTop).toBe(true)
  expect(props.focusable).toBe(false)
  expect(props.movable).toBe(false)
  expect(props.hasShadow).toBe(false)
  expect(props.resizable).toBe(true)

  await expect(win.locator('[data-testid="input"]')).toBeVisible()

  await app.close()
  fs.rmSync(petdexRoot, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Test 2: disabling pets in Settings destroys the pet window
// ---------------------------------------------------------------------------

test('设置里关闭桌面宠物后,宠物窗口被销毁', async () => {
  const petdexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-petdex-off-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-pets-off-'))
  writeNoirFixture(petdexRoot)

  const { app, win } = await launchApp({ WRAITH_E2E_USERDATA: userData, WRAITH_E2E_PETDEX_ROOT: petdexRoot })

  await findPetWindow(app)
  await waitForWindowCount(app, 2)

  await win.locator('[data-testid="nav-settings"]').click()
  await win.locator('[data-testid="settings-nav-pets"]').click()
  await expect(win.locator('[data-testid="pet-enabled"]')).toBeVisible()
  await win.locator('[data-testid="pet-enabled"]').click()

  // pet:setConfig({enabled:false}) → writePetConfig + broadcastPetConfig +
  // syncPetWindow(next):shouldShowPet(next, hasAvailablePet) 变 false → destroyPetWindow。
  await waitForWindowCount(app, 1)
  expect(app.windows().some((p) => p.url().includes('pet.html'))).toBe(false)

  await app.close()
  fs.rmSync(petdexRoot, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Test 3: prefers-reduced-motion → pet-sprite carries no active pet-* class
// ---------------------------------------------------------------------------

test('prefers-reduced-motion 下宠物窗 pet-sprite 无 active 动效 class', async () => {
  const petdexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-petdex-rm-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-pets-rm-'))
  writeNoirFixture(petdexRoot)

  const { app } = await launchApp({ WRAITH_E2E_USERDATA: userData, WRAITH_E2E_PETDEX_ROOT: petdexRoot })

  const petPage = await findPetWindow(app)

  // PetSprite reads window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // fresh on every render (no memoization, no change listener, same as the old
  // PetAvatar it was extracted from) — emulateMedia alone doesn't retroactively
  // re-render an already-mounted tree, so reload to force a fresh first render
  // under the emulated media state. The reload re-triggers PetWindowApp's mount
  // effect (window.wraithPet.ready()), which makes main re-push the current
  // config + preview over IPC (see index.ts's 'pet:ready' handler) — so the
  // spritesheet preview (and therefore the pet-sprite element) comes back after
  // reload without needing to touch Settings again.
  await petPage.emulateMedia({ reducedMotion: 'reduce' })
  await petPage.reload()

  const sprite = petPage.locator('[data-testid="pet-sprite"] [aria-hidden="true"]')
  await expect(sprite).toBeVisible({ timeout: 10000 })
  const className = (await sprite.getAttribute('class')) ?? ''
  // motionFor(..., reduced=true) always returns className: '' — whatever state
  // the pet is actually in (idle by default here), none of the pet-* animation
  // classes it would otherwise carry may be present.
  expect(className).not.toMatch(/pet-(idle|thinking|tool|approval|success|error)/)

  await app.close()
  fs.rmSync(petdexRoot, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
})
