# Wraith Desktop 宠物系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Wraith Desktop 中交付可配置的宠物系统，支持官方默认角色、用户单图、Wraith/Petdex 兼容精灵包，以及本地 Petdex Noir Webling 发现。

**Architecture:** Renderer 保持所有视觉状态与动画；main process 负责宠物资产的发现、导入、验证、复制与 data URL 读取，preload 只暴露经过类型约束的 IPC。`PetRegistry` 由 main 端把内置元数据、Wraith 管理的导入副本和 `~/.codex/pets` 发现结果标准化，renderer 以纯函数把现有后端事件映射为宠物状态。

**Tech Stack:** Electron 32、React 18、TypeScript、Tailwind、Vitest、Playwright、`yauzl`（仅 ZIP 读取）。

---

## File Structure

- Create: `desktop/src/shared/pets.ts` — renderer/preload/main 共享的宠物记录、状态和 IPC payload 类型。
- Create: `desktop/src/renderer/lib/petState.ts` — 从现有 `BackendEvent` 派生宠物状态的纯函数。
- Create: `desktop/src/renderer/lib/petMotion.ts` — 单图宠物的 CSS motion profile 纯函数。
- Create: `desktop/src/main/petStore.ts` — 本地发现、包校验、导入、复制、删除和预览读取。
- Create: `desktop/src/renderer/components/PetAvatar.tsx` — 聊天区浮件与帧/单图渲染。
- Create: `desktop/src/renderer/components/PetsSettings.tsx` — 宠物设置内容。
- Create: `desktop/test/petState.test.ts` — Agent 事件到宠物状态测试。
- Create: `desktop/test/petMotion.test.ts` — 单图动态化 profile 测试。
- Create: `desktop/test/petStore.test.ts` — 文件边界、包校验、发现、导入原子性测试。
- Create: `desktop/test/pets.e2e.ts` — 设置与浮件端到端验收。
- Modify: `desktop/package.json`、`desktop/package-lock.json` — 添加 `yauzl` 与类型声明。
- Modify: `desktop/src/renderer/settings/prefs.ts`、`desktop/src/renderer/settings/SettingsContext.tsx` — 宠物偏好和更新方法。
- Modify: `desktop/src/renderer/components/SettingsPanel.tsx` — 新增“宠物”设置导航项。
- Modify: `desktop/src/main/index.ts`、`desktop/src/preload/index.ts` — 宠物 IPC handlers 与白名单桥接。
- Modify: `desktop/src/renderer/App.tsx` — 加载目录、订阅状态、渲染浮件。
- Modify: `desktop/test/prefs.test.ts`、`README.md`、`AGENTS.md` — 回归、用户说明和项目导航。

### Task 1: Define Shared Pet Contracts and Event Mapping

**Files:**
- Create: `desktop/src/shared/pets.ts`
- Create: `desktop/src/renderer/lib/petState.ts`
- Test: `desktop/test/petState.test.ts`

- [ ] **Step 1: Write failing event-to-state tests**

```ts
import { describe, expect, it } from 'vitest'
import { petStateFromEvent } from '../src/renderer/lib/petState'

describe('petStateFromEvent', () => {
  it('maps tool calls and approval requests without exposing payload text', () => {
    expect(petStateFromEvent({ kind: 'notification', method: 'tool.call', params: { name: 'read_file', argsJson: '/secret' } })).toEqual({ state: 'tool', transient: false })
    expect(petStateFromEvent({ kind: 'notification', method: 'approval.requested', params: { argsJson: '/secret' } })).toEqual({ state: 'approval', transient: false })
  })

  it('maps completed and failed turns to transient states', () => {
    expect(petStateFromEvent({ kind: 'notification', method: 'turn.completed', params: {} })).toEqual({ state: 'success', transient: true })
    expect(petStateFromEvent({ kind: 'notification', method: 'turn.failed', params: { error: 'private text' } })).toEqual({ state: 'error', transient: true })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && npm test -- petState.test.ts`

Expected: FAIL because `petState.ts` does not exist.

- [ ] **Step 3: Add shared types and the minimal event mapper**

```ts
// desktop/src/shared/pets.ts
export type PetSource = 'built-in' | 'petdex' | 'imported'
export type PetKind = 'static' | 'spritesheet'
export type PetState = 'idle' | 'thinking' | 'tool' | 'approval' | 'success' | 'error'
export type PetMotionStyle = 'calm' | 'float' | 'lively' | 'static'

export interface PetView {
  id: string
  displayName: string
  description: string
  source: PetSource
  kind: PetKind
  available: boolean
  removable: boolean
  previewUrl: string | null
  sprite: null | { columns: number; rows: number; frameWidth: number; frameHeight: number }
}

export interface PetImportResult { pet: PetView | null; error: string | null }
```

```ts
// desktop/src/renderer/lib/petState.ts
import type { BackendEvent } from '../../shared/types'
import type { PetState } from '../../shared/pets'

export interface PetStateSignal { state: PetState; transient: boolean }

export function petStateFromEvent(evt: BackendEvent): PetStateSignal | null {
  if (evt.kind !== 'notification') return null
  switch (evt.method) {
    case 'turn.started':
    case 'thinking.begin': return { state: 'thinking', transient: false }
    case 'tool.call': return { state: 'tool', transient: false }
    case 'approval.requested':
    case 'plan.review.requested': return { state: 'approval', transient: false }
    case 'turn.completed': return { state: 'success', transient: true }
    case 'turn.failed': return { state: 'error', transient: true }
    default: return null
  }
}

export function nextPetState(signal: { state: PetState; expiresAt: number | null }, now: number): PetState {
  return signal.expiresAt !== null && now >= signal.expiresAt ? 'idle' : signal.state
}
```

- [ ] **Step 4: Run the focused tests**

Run: `cd desktop && npm test -- petState.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the completed contract task**

```bash
git add desktop/src/shared/pets.ts desktop/src/renderer/lib/petState.ts desktop/test/petState.test.ts
git commit -m "feat(desktop): define pet contracts and state mapping"
```

### Task 2: Persist Pet Preferences and Derive Static-Image Motion

**Files:**
- Create: `desktop/src/renderer/lib/petMotion.ts`
- Modify: `desktop/src/renderer/settings/prefs.ts`
- Modify: `desktop/src/renderer/settings/SettingsContext.tsx`
- Modify: `desktop/test/prefs.test.ts`
- Test: `desktop/test/petMotion.test.ts`

- [ ] **Step 1: Write failing preference and motion tests**

```ts
expect(loadPrefs(() => JSON.stringify({ pets: { enabled: true, selectedId: 'noir-webling', motion: 'float', scale: 1.2 } })).pets)
  .toEqual({ enabled: true, selectedId: 'noir-webling', motion: 'float', scale: 1.2, position: { x: 0, y: 0 } })
expect(motionFor('tool', 'static', false)).toEqual({ className: '', durationMs: 0 })
expect(motionFor('success', 'calm', false).className).toContain('pet-success')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd desktop && npm test -- prefs.test.ts petMotion.test.ts`

Expected: FAIL because `pets` and `motionFor` are not defined.

- [ ] **Step 3: Extend preferences with a fully normalized pet section**

```ts
export interface PetPrefs {
  enabled: boolean
  selectedId: string | null
  motion: PetMotionStyle
  scale: number
  position: { x: number; y: number }
}

export interface Prefs { profile: ProfilePrefs; ui: UiPrefs; update: UpdatePrefs; pets: PetPrefs }

export const DEFAULT_PREFS: Prefs = {
  profile: { name: '我', avatar: '' },
  ui: { theme: 'system', accent: 'teal', fontSize: 'md', fontFamily: 'system' },
  update: { autoCheck: true, beta: false },
  pets: { enabled: true, selectedId: null, motion: 'calm', scale: 1, position: { x: 0, y: 0 } },
}
```

Accept only `0.75 <= scale <= 1.5` and finite `x/y` values in `[-160, 160]`; otherwise fall back to defaults. Add `setPets(patch: Partial<PetPrefs>)` to `SettingsCtx`, implemented with the same `persist` function as `setUi`.

- [ ] **Step 4: Implement deterministic CSS motion profiles**

```ts
export function motionFor(state: PetState, style: PetMotionStyle, reduced: boolean): { className: string; durationMs: number } {
  if (reduced || style === 'static') return { className: '', durationMs: 0 }
  if (state === 'success') return { className: 'pet-success', durationMs: 560 }
  if (state === 'error') return { className: 'pet-error', durationMs: 420 }
  if (state === 'tool') return { className: 'pet-tool', durationMs: 900 }
  if (state === 'thinking') return { className: style === 'lively' ? 'pet-thinking-lively' : 'pet-thinking', durationMs: 1400 }
  if (state === 'approval') return { className: 'pet-approval', durationMs: 1800 }
  return { className: style === 'float' ? 'pet-idle-float' : 'pet-idle', durationMs: 2200 }
}
```

- [ ] **Step 5: Run focused tests and typecheck**

Run: `cd desktop && npm test -- prefs.test.ts petMotion.test.ts && npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit preference and motion work**

```bash
git add desktop/src/renderer/settings/prefs.ts desktop/src/renderer/settings/SettingsContext.tsx desktop/src/renderer/lib/petMotion.ts desktop/test/prefs.test.ts desktop/test/petMotion.test.ts
git commit -m "feat(desktop): persist pet preferences and static motion"
```

### Task 3: Add the Safe Main-Process Pet Store

**Files:**
- Create: `desktop/src/main/petStore.ts`
- Create: `desktop/test/petStore.test.ts`
- Modify: `desktop/package.json`
- Modify: `desktop/package-lock.json`

- [ ] **Step 1: Add the ZIP reader dependency**

Run: `cd desktop && npm install yauzl && npm install -D @types/yauzl`

Expected: `package.json` records `yauzl` in `dependencies`, `@types/yauzl` in `devDependencies`, and the lockfile changes only for those packages.

- [ ] **Step 2: Write failing store tests with a temporary Wraith userData root**

```ts
it('lists an installed Noir Webling without copying or deleting the Petdex source', async () => {
  await writePet(petdexRoot, 'noir-webling', validManifest, validPng)
  const pets = await listPets({ userDataDir, petdexRoot })
  expect(pets.find(p => p.id === 'noir-webling')).toMatchObject({ source: 'petdex', available: true, removable: false })
  expect(fs.existsSync(path.join(petdexRoot, 'noir-webling', 'spritesheet.png'))).toBe(true)
})

it('rejects an SVG disguised as a PNG and leaves the active import directory unchanged', async () => {
  await expect(importStaticImage({ userDataDir, sourcePath: fakePng })).rejects.toThrow('不支持的图片格式')
  expect(await fs.promises.readdir(path.join(userDataDir, 'pets', 'imported'))).toEqual([])
})
```

- [ ] **Step 3: Implement storage paths, manifest validation, and asset probes**

Create an injected-dependency API so tests do not require a BrowserWindow:

```ts
export const MAX_STATIC_BYTES = 8 * 1024 * 1024
export const MAX_SPRITE_BYTES = 16 * 1024 * 1024
export const MAX_DIMENSION = 4096
export const MAX_ARCHIVE_FILES = 64
export const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024

export function petRoot(userDataDir: string): string { return path.join(userDataDir, 'pets') }
export function importedRoot(userDataDir: string): string { return path.join(petRoot(userDataDir), 'imported') }
function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)
}
export async function listPets(args: { userDataDir: string; petdexRoot: string }): Promise<PetView[]> {
  return mergeById([await listBuiltIns(), await listImported(importedRoot(args.userDataDir)), await listPetdex(args.petdexRoot)])
}
export async function importStaticImage(args: { userDataDir: string; sourcePath: string }): Promise<PetView> {
  const asset = await validateImage(args.sourcePath, MAX_STATIC_BYTES)
  const target = await createImportDirectory(importedRoot(args.userDataDir), asset.id)
  await fs.promises.copyFile(args.sourcePath, path.join(target, asset.fileName))
  await writeImportedManifest(target, { ...asset, kind: 'static' })
  return readImportedPet(target)
}
export async function importPackage(args: { userDataDir: string; sourcePath: string }): Promise<PetView> {
  const staging = await extractOrCopyPackage(args.sourcePath, importedRoot(args.userDataDir), MAX_ARCHIVE_FILES, MAX_ARCHIVE_BYTES)
  const manifest = await validatePetManifest(staging)
  await validateImage(path.join(staging, manifest.spritesheetPath), MAX_SPRITE_BYTES)
  return finalizeImportedPackage(staging, importedRoot(args.userDataDir), manifest.id)
}
export async function removeImportedPet(args: { userDataDir: string; id: string }): Promise<void> {
  assertPetId(args.id); const target = path.join(importedRoot(args.userDataDir), args.id)
  if (!isWithin(importedRoot(args.userDataDir), target)) throw new Error('非法宠物路径')
  await fs.promises.rm(target, { recursive: true, force: true })
}
export async function previewDataUrl(args: { userDataDir: string; petdexRoot: string; id: string }): Promise<string | null> {
  const pet = (await listPets(args)).find(item => item.id === args.id && item.available)
  return pet ? dataUrlForResolvedPet(pet) : null
}
```

Implement the referenced helpers in this same file: `listBuiltIns`, `listImported`, `listPetdex`, `mergeById`, `validateImage`, `createImportDirectory`, `writeImportedManifest`, `readImportedPet`, `extractOrCopyPackage`, `validatePetManifest`, `finalizeImportedPackage`, `assertPetId`, and `dataUrlForResolvedPet`. Use `path.resolve` plus `isWithin` before every read/copy/delete. Validate PNG, JPEG and WebP signatures before calling Electron `nativeImage.createFromPath`; reject zero-size, dimension-overflow and byte-overflow assets. Manifest ids must match `/^[a-z0-9][a-z0-9-]{0,63}$/`; resource paths must be plain basenames. ZIP extraction rejects absolute paths, `..` components, more than 64 files and more than 24 MiB uncompressed bytes. `finalizeImportedPackage` performs the only rename from staging into the imported root, after every validation succeeds.

- [ ] **Step 4: Expand tests for fallback and atomicity**

Add cases for an incomplete sprite pack, a 17 MiB spritesheet, `4097×1` PNG, a ZIP member named `../escape.png`, an imported id collision, and deleting an imported record while a matching Petdex directory remains discoverable. Assert invalid records become unavailable or reject with a Chinese actionable error; they must not throw during listing.

- [ ] **Step 5: Run the store tests**

Run: `cd desktop && npm test -- petStore.test.ts`

Expected: PASS. The test cleanup removes only temporary directories created by the test.

- [ ] **Step 6: Commit the pet-store boundary**

```bash
git add desktop/package.json desktop/package-lock.json desktop/src/main/petStore.ts desktop/test/petStore.test.ts
git commit -m "feat(desktop): add safe local pet storage"
```

### Task 4: Expose Only Pet-Specific IPC Methods

**Files:**
- Modify: `desktop/src/main/index.ts:383-454`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/shared/pets.ts`
- Test: `desktop/test/petStore.test.ts`

- [ ] **Step 1: Add IPC contract tests at the store boundary**

```ts
it('returns null rather than a filesystem path when preview id is unknown', async () => {
  await expect(previewDataUrl({ userDataDir, petdexRoot, id: 'not-installed' })).resolves.toBeNull()
})
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `cd desktop && npm test -- petStore.test.ts`

Expected: FAIL until `previewDataUrl` performs allowlisted lookup.

- [ ] **Step 3: Register narrow handlers and bridge methods**

```ts
// desktop/src/main/index.ts
ipcMain.handle('wraith:petsList', () => listPets({ userDataDir: app.getPath('userData'), petdexRoot: path.join(os.homedir(), '.codex', 'pets') }))
ipcMain.handle('wraith:petsImportImage', async () => importPetImageFromDialog(mainWindow, app.getPath('userData')))
ipcMain.handle('wraith:petsImportPackage', async () => importPetPackageFromDialog(mainWindow, app.getPath('userData')))
ipcMain.handle('wraith:petsRemove', (_e, id: string) => removeImportedPet({ userDataDir: app.getPath('userData'), id }))
ipcMain.handle('wraith:petsPreview', (_e, id: string) => previewDataUrl({ userDataDir: app.getPath('userData'), petdexRoot: path.join(os.homedir(), '.codex', 'pets'), id }))
```

```ts
// desktop/src/preload/index.ts
petsList(): Promise<{ pets: PetView[] }>
petsImportImage(): Promise<PetImportResult>
petsImportPackage(): Promise<PetImportResult>
petsRemove(id: string): Promise<{ ok: boolean }>
petsPreview(id: string): Promise<string | null>
```

Use two explicit dialogs: image picker restricted to png/jpg/jpeg/webp, package picker restricted to zip plus a separate directory picker fallback. Do not expose arbitrary file reads, directory listing, shell commands, or `npx` through this contract.

- [ ] **Step 4: Run store tests and desktop typecheck**

Run: `cd desktop && npm test -- petStore.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit IPC work**

```bash
git add desktop/src/main/index.ts desktop/src/preload/index.ts desktop/src/shared/pets.ts desktop/src/main/petStore.ts desktop/test/petStore.test.ts
git commit -m "feat(desktop): expose pet library IPC"
```

### Task 5: Build the Pets Settings Panel

**Files:**
- Create: `desktop/src/renderer/components/PetsSettings.tsx`
- Modify: `desktop/src/renderer/components/SettingsPanel.tsx`
- Modify: `desktop/src/renderer/settings/SettingsContext.tsx`
- Test: `desktop/test/petMotion.test.ts`

- [ ] **Step 1: Add a testable selected-pet resolver**

```ts
export function selectedPet(pets: PetView[], selectedId: string | null): PetView | null {
  return pets.find(p => p.id === selectedId && p.available) ?? pets.find(p => p.source === 'built-in' && p.available) ?? null
}
```

Test that unavailable Noir does not become selected, while a detected Noir selection is retained across a refresh.

- [ ] **Step 2: Implement the settings view**

Add `type Section = 'me' | 'interface' | 'pets' | 'about'` and a `Bot` Lucide icon nav entry. `PetsSettings` must:

```tsx
<button data-testid="pet-enabled" role="switch" aria-checked={prefs.pets.enabled} onClick={() => setPets({ enabled: !prefs.pets.enabled })} />
<button data-testid="pet-import-image" onClick={() => void importImage()}>导入图片</button>
<button data-testid="pet-import-package" onClick={() => void importPackage()}>导入精灵包</button>
<div data-testid="pet-library">{pets.map(pet => <button data-testid={`pet-card-${pet.id}`} disabled={!pet.available} />)}</div>
```

Fetch the library on mount and after every import/delete. While awaiting IPC, preserve the existing list; show a local text error from `PetImportResult.error`. For a missing Noir entry, show its title, source “Petdex”, and “未安装” instead of a false install action.

- [ ] **Step 3: Add selector, switch, scale and motion controls**

Use existing `ui/switch.tsx` for the binary enable setting; use buttons with `aria-pressed` for the four motion styles; use a native range input with `min="0.75"`, `max="1.5"`, `step="0.05"` for scale. Persist every change through `setPets`; do not keep a second component-local configuration source.

- [ ] **Step 4: Run typecheck and focused unit tests**

Run: `cd desktop && npm test -- prefs.test.ts petMotion.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit settings UI**

```bash
git add desktop/src/renderer/components/PetsSettings.tsx desktop/src/renderer/components/SettingsPanel.tsx desktop/src/renderer/settings/SettingsContext.tsx desktop/src/renderer/lib/petMotion.ts desktop/test/petMotion.test.ts
git commit -m "feat(desktop): add pet settings panel"
```

### Task 6: Render the Chat Pet Without Changing Layout Flow

**Files:**
- Create: `desktop/src/renderer/components/PetAvatar.tsx`
- Modify: `desktop/src/renderer/App.tsx:200-235`
- Modify: `desktop/src/renderer/App.tsx:870-1040`
- Modify: `desktop/src/renderer/styles/tokens.css`
- Test: `desktop/test/petState.test.ts`

- [ ] **Step 1: Add a transient state timer test**

```ts
it('returns to idle after a success transient expires', () => {
  expect(nextPetState({ state: 'success', expiresAt: 500 }, 499)).toBe('success')
  expect(nextPetState({ state: 'success', expiresAt: 500 }, 500)).toBe('idle')
})
```

- [ ] **Step 2: Implement a self-contained `PetAvatar`**

```tsx
export default function PetAvatar({ pet, state, prefs }: { pet: PetView; state: PetState; prefs: PetPrefs }): JSX.Element | null {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const motion = motionFor(state, prefs.motion, reduced)
  if (!prefs.enabled || !pet.available || !pet.previewUrl) return null
  return <div data-testid="chat-pet" className={'pointer-events-none absolute bottom-3 right-4 z-20 ' + motion.className} style={{ transform: `translate(${prefs.position.x}px, ${prefs.position.y}px) scale(${prefs.scale})` }}><img alt="" src={pet.previewUrl} /></div>
}
```

For spritesheets, use an inner element with `backgroundImage`, `backgroundSize` and a calculated `backgroundPosition`; advance only the currently selected row with `requestAnimationFrame` while motion is allowed. For static images, render `<img>` and use the container profile. Implement `pet-success`, `pet-error`, `pet-tool`, `pet-thinking`, `pet-idle` and `pet-approval` keyframes in `tokens.css`; include a `@media (prefers-reduced-motion: reduce)` rule that disables them.

- [ ] **Step 3: Wire App state without modifying the transcript reducer**

In the existing `onEvent` callback, call `petStateFromEvent(evt)` before `dispatch(evt)`. Store only `{ state, expiresAt }` in App local state: non-transient signals persist until superseded; `success` expires after 560 ms and `error` after 420 ms. Fetch the selected pet preview through `window.wraith.petsPreview(id)` only when the selected id changes; never pass a renderer-provided filesystem path to IPC.

Render `<PetAvatar>` inside the existing `relative flex min-w-0 flex-1 flex-col` chat column only when `view === 'chat'`. It must be an absolutely positioned sibling of transcript/composer, so `Transcript` and `Composer` retain their current flex dimensions.

- [ ] **Step 4: Add drag behavior with bounded persisted offsets**

On pointer drag, update local CSS offset immediately and call `setPets({ position })` on pointer-up. Clamp each axis to `[-160, 160]`. Ignore drag starts originating from the image because the floating pet is presentation-only; do not add click commands or a modal.

- [ ] **Step 5: Run state/motion tests and typecheck**

Run: `cd desktop && npm test -- petState.test.ts petMotion.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the chat overlay**

```bash
git add desktop/src/renderer/components/PetAvatar.tsx desktop/src/renderer/App.tsx desktop/src/renderer/styles/tokens.css desktop/src/renderer/lib/petState.ts desktop/test/petState.test.ts
git commit -m "feat(desktop): render stateful chat pet"
```

### Task 7: Exercise Settings, Layout and Reduced Motion End-to-End

**Files:**
- Create: `desktop/test/e2e/pets.e2e.ts`
- Modify: `desktop/src/main/index.ts`

- [ ] **Step 1: Add E2E-only fixture injection for a detected Noir package**

Add a `WRAITH_E2E_PETDEX_ROOT` environment override at the single `petsList`/`petsPreview` call site. Production continues to use `path.join(os.homedir(), '.codex', 'pets')`; tests can point to a temporary fixture directory without reading a real user profile.

- [ ] **Step 2: Write the E2E test**

```ts
test('pets settings enables detected Noir and preserves chat geometry', async () => {
  await win.locator('[data-testid="nav-settings"]').click()
  await win.locator('[data-testid="settings-nav-pets"]').click()
  await expect(win.locator('[data-testid="pet-card-noir-webling"]')).toBeEnabled()
  await win.locator('[data-testid="pet-card-noir-webling"]').click()
  await win.locator('[data-testid="settings-back"]').click()
  await expect(win.locator('[data-testid="chat-pet"]')).toBeVisible()
  await expect(win.locator('[data-testid="input"]')).toBeVisible()
})
```

Create the fixture package in the test's temporary user-data directory before launching Electron. Add a second test that sets `prefers-reduced-motion` and asserts the pet has no active animation class; add a third that imports an invalid fixture and asserts the selected, working pet remains visible.

- [ ] **Step 3: Run the targeted E2E suite**

Run: `cd desktop && npm run build && npx playwright test test/e2e/pets.e2e.ts`

Expected: PASS. The app starts with isolated `WRAITH_E2E_USERDATA` and never writes to the real Petdex directory.

- [ ] **Step 4: Commit end-to-end coverage**

```bash
git add desktop/src/main/index.ts desktop/test/e2e/pets.e2e.ts
git commit -m "test(desktop): cover pet settings and overlay"
```

### Task 8: Document, Verify and Review the Feature

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-07-18-desktop-pets-design.md`

- [ ] **Step 1: Update product documentation**

Add a short Desktop section to `README.md` explaining that Pets accepts user images and local Wraith/Petdex-compatible packages, and that Petdex assets must be installed or imported by the user. Add the desktop pet files and IPC boundary to `AGENTS.md` navigation, plus the no-auto-download/no-third-party-code rule. Update the spec status from “待规格审阅” to “已实施” only after all verification below passes.

- [ ] **Step 2: Run the full desktop verification gate**

Run: `cd desktop && npm run typecheck && npm test && npm run build && npx playwright test`

Expected: every command exits 0.

- [ ] **Step 3: Run manual visual acceptance**

Use `npm run dev` and verify all of the following: light and dark themes; sidebar expanded/collapsed; narrow window; transcript plus Composer remain unobscured; Noir uses its unmodified source sprite; static transparent and opaque images animate only through the container; invalid source keeps prior pet; reduced motion freezes the character; pet disable survives app restart.

- [ ] **Step 4: Request code review before merge**

Run the repository's review workflow with focus on path traversal, asset validation, Electron context isolation, animation cleanup, and layout overlap.

- [ ] **Step 5: Commit documentation after verification**

```bash
git add README.md AGENTS.md docs/superpowers/specs/2026-07-18-desktop-pets-design.md
git commit -m "docs: document desktop pet support"
```

## Plan Self-Review

- Spec coverage: Tasks 1-2 cover state mapping, single-image motion and preferences; Tasks 3-4 cover local Petdex discovery, import, validation, atomic storage and IPC; Tasks 5-6 cover settings and non-intrusive chat display; Task 7 covers real Electron interaction; Task 8 covers docs and manual acceptance.
- Placeholder scan: no deferred decisions or implicit validation steps remain; concrete byte, pixel, archive and position limits match the approved specification.
- Type consistency: `PetView`, `PetPrefs`, `PetState`, `PetMotionStyle`, `PetImportResult`, `listPets`, `previewDataUrl`, `motionFor`, and `petStateFromEvent` retain the same names and ownership throughout the plan.
