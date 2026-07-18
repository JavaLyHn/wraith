/**
 * Task 7: Exercise Settings, Layout and Reduced Motion End-to-End
 *
 * Covers the desktop pet system through the real settings UI + chat overlay,
 * on top of an isolated Electron instance (WRAITH_E2E_USERDATA) and an isolated
 * Petdex root (WRAITH_E2E_PETDEX_ROOT, Task 7 Step 1) — never the real
 * ~/.codex/pets directory or a real user profile.
 *
 * Test 1: enabling the detected Noir Webling pet in settings and returning to
 *   chat shows the floating overlay without breaking chat layout (composer
 *   stays interactive, transcript still renders the sent message).
 * Test 2: under prefers-reduced-motion, the overlay's sprite element carries no
 *   active pet-* animation class (motionFor returns '' when reduced).
 * Test 3: a broken package sitting in the imported-pets directory (simulating
 *   a failed/corrupted prior import) must not take down discovery of the
 *   already-selected, working Petdex pet — petStore.listDirectory's per-package
 *   try/catch has to hold end-to-end through IPC + renderer, not just at the
 *   Node-only petStore.test.ts layer.
 *
 * Note on Test 3's fixture placement: the pet-import buttons open a real native
 * OS dialog (Electron `dialog.showOpenDialog`) and this task's Step 1 only adds
 * an E2E override for the single petsList/petsPreview call site (petdexRoot()) —
 * no dialog-injection hook exists for wraith:petsImportImage/petsImportPackage.
 * So "an invalid fixture was imported" is exercised by writing a malformed
 * package directly into <userData>/pets/imported (the exact directory a real
 * import would have populated) before launch, rather than driving the OS
 * dialog — same production code path (listDirectory over the imported root),
 * no unrelated main-process changes.
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

// Minimal PNG stand-in: real magic bytes + IHDR width/height only (no pixel data).
// petStore.validateImageBuffer only reads the signature + IHDR-declared dimensions
// (see test/petStore.test.ts's own `png()` helper) — sufficient for discovery/
// preview-URL plumbing; the renderer never needs to actually decode the pixels for
// visibility/layout assertions since the spritesheet is shown via CSS background on
// an explicitly-sized div, not an <img> whose failed decode would collapse it.
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

/** Simulates a broken import left behind in <userData>/pets/imported: a directory
 *  with unparseable pet.json. petStore.listDirectory's readPackage() must catch and
 *  drop it (return null) without throwing, per petStore.test.ts's own coverage —
 *  this exercises the same behavior through main + IPC + renderer. */
function writeBrokenImportedFixture(userData: string): void {
  const dir = path.join(userData, 'pets', 'imported', 'broken-import')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'pet.json'), '{ not valid json')
}

async function launchApp(env: Record<string, string>): Promise<{ app: Awaited<ReturnType<typeof electron.launch>>; win: Page }> {
  const app = await electron.launch({
    args: [mainPath],
    env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath, WRAITH_E2E: '1', ...env },
  })
  const win = await app.firstWindow()
  await expect(win.locator('[data-testid="input"]')).toBeVisible({ timeout: 15000 })
  return { app, win }
}

// ---------------------------------------------------------------------------
// Test 1: enabling detected Noir in settings preserves chat geometry
// ---------------------------------------------------------------------------

test('pets settings enables detected Noir and preserves chat geometry', async () => {
  const petdexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-petdex-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-pets-'))
  writeNoirFixture(petdexRoot)

  const { app, win } = await launchApp({ WRAITH_E2E_USERDATA: userData, WRAITH_E2E_PETDEX_ROOT: petdexRoot })

  await win.locator('[data-testid="nav-settings"]').click()
  await win.locator('[data-testid="settings-nav-pets"]').click()
  await expect(win.locator('[data-testid="pet-card-noir-webling"]')).toBeEnabled()
  await win.locator('[data-testid="pet-card-noir-webling"]').click()
  await win.locator('[data-testid="settings-back"]').click()
  await expect(win.locator('[data-testid="chat-pet"]')).toBeVisible()
  await expect(win.locator('[data-testid="input"]')).toBeVisible()

  // Chat geometry not broken by the floating overlay: the composer still takes real
  // keyboard input (not obscured/blocked) and the transcript renders the sent turn —
  // not just "chat-pet is present somewhere in the DOM".
  const input = win.locator('[data-testid="input"]')
  await input.fill('hi there')
  await input.press('Enter')
  await expect(win.locator('[data-testid="user-msg"]')).toHaveText('hi there', { timeout: 10000 })
  const transcript = win.locator('[data-testid="transcript"]')
  await expect(transcript).toBeVisible({ timeout: 10000 })
  const transcriptBox = await transcript.boundingBox()
  const inputBox = await input.boundingBox()
  expect(transcriptBox, 'transcript 应有实际尺寸,未被浮件压塌').not.toBeNull()
  expect(inputBox, 'composer 输入框应有实际尺寸,未被浮件压塌').not.toBeNull()
  expect(transcriptBox!.height).toBeGreaterThan(20)
  expect(inputBox!.height).toBeGreaterThan(0)

  await app.close()
  fs.rmSync(petdexRoot, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Test 2: prefers-reduced-motion → overlay has no active animation class
// ---------------------------------------------------------------------------

test('prefers-reduced-motion 下浮件没有 active 动效 class', async () => {
  const petdexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-petdex-rm-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-pets-rm-'))
  writeNoirFixture(petdexRoot)

  const { app, win } = await launchApp({ WRAITH_E2E_USERDATA: userData, WRAITH_E2E_PETDEX_ROOT: petdexRoot })

  // PetAvatar reads window.matchMedia('(prefers-reduced-motion: reduce)').matches fresh
  // on every render (no memoization, no change listener) — setting this before the
  // overlay mounts is enough; every render after selecting/returning-to-chat re-reads it.
  await win.emulateMedia({ reducedMotion: 'reduce' })

  await win.locator('[data-testid="nav-settings"]').click()
  await win.locator('[data-testid="settings-nav-pets"]').click()
  await win.locator('[data-testid="pet-card-noir-webling"]').click()
  await win.locator('[data-testid="settings-back"]').click()

  await expect(win.locator('[data-testid="chat-pet"]')).toBeVisible()
  // motionFor(..., reduced=true) always returns className: '' — the sprite element's
  // class must therefore contain none of the pet-* animation classes it would carry
  // under normal motion (pet-idle/-thinking/-tool/-approval/-success/-error).
  const sprite = win.locator('[data-testid="chat-pet"] [aria-hidden="true"]')
  await expect(sprite).toBeVisible()
  const className = (await sprite.getAttribute('class')) ?? ''
  expect(className).not.toMatch(/pet-(idle|thinking|tool|approval|success|error)/)

  await app.close()
  fs.rmSync(petdexRoot, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Test 3: an invalid imported package must not take down the selected pet
// ---------------------------------------------------------------------------

test('导入目录存在无效宠物包时,已选中的可用宠物仍可见', async () => {
  const petdexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-petdex-bad-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ud-pets-bad-'))
  writeNoirFixture(petdexRoot)
  writeBrokenImportedFixture(userData) // 落盘的坏 fixture,模拟失败/损坏的既往导入残留

  const { app, win } = await launchApp({ WRAITH_E2E_USERDATA: userData, WRAITH_E2E_PETDEX_ROOT: petdexRoot })

  await win.locator('[data-testid="nav-settings"]').click()
  await win.locator('[data-testid="settings-nav-pets"]').click()
  // 宠物库里混了一个坏包,但整表不能崩:noir-webling 仍可选中
  await expect(win.locator('[data-testid="pet-card-noir-webling"]')).toBeEnabled()
  await win.locator('[data-testid="pet-card-noir-webling"]').click()
  await win.locator('[data-testid="settings-back"]').click()

  // 选中且可用的宠物在聊天视图里仍然可见——坏 fixture 不会让浮件消失或让页面崩掉
  await expect(win.locator('[data-testid="chat-pet"]')).toBeVisible()
  await expect(win.locator('[data-testid="input"]')).toBeVisible()

  await app.close()
  fs.rmSync(petdexRoot, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
})
