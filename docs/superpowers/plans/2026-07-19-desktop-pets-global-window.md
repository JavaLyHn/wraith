# 全局桌面宠物窗口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Wraith 桌面宠物从"聊天视图内的浮件 `<div>`"改造为独立于应用窗口、浮在整个桌面之上的全局桌宠(无边框透明置顶窗口):全局常驻、全身可拖、身上滚轮缩放、右键菜单开关、透明区点击穿透、跟随 Wraith 运行状态。

**Architecture:** 新增一个独立 `BrowserWindow`(`petWindow`,以现有 splash 窗为蓝本),加载一个独立轻量 renderer 入口 `pet.html`(不加载聊天 app/Monaco),用独立最小 preload `window.wraithPet`。宠物运行态配置迁到主进程持有为单一事实源(存在既有 `settings.json`),设置面板与桌宠窗都经 IPC 读写。点击穿透用 `setIgnoreMouseEvents(true,{forward:true})` + renderer 逐像素 alpha 命中测试动态切换。宠物状态由主进程在既有事件中转点跑 `petStateFromEvent` 派生后经 IPC 推送。复用现有 `petStore`/`petMotion`/`petState`/精灵帧检测。

**Tech Stack:** Electron 32、React 18、TypeScript、electron-vite(多 renderer/preload 入口)、Vitest(单测,`--cache=false`)、Playwright(E2E)。

## Global Constraints

- 平台仅 macOS(应用只分发 `dist:mac`);置顶/透明/穿透/跨 Space/原生菜单按 macOS 设计。
- 缩放范围 **[0.5, 2.0]**;滚轮步进 0.1。
- 三条安全红线所在文件 `src/main/petStore.ts` 与 `src/preload/index.ts` 的既有校验逻辑**不动**;新窗口同样 `contextIsolation:true`、`nodeIntegration:false`、preload 白名单;renderer 不获得任何文件系统/路径能力;`toPetView` 出边界 strip 绝对 `assetPath` 不变。
- 精灵网格 Petdex 8×9、192×208;每行真实帧数由 `detectFrameCounts`(已实现)从解码 alpha 推出。
- 不自动下载 Petdex、不跑 `npx`、不执行第三方代码。
- 聚焦测试用 `npx vitest run <file> --cache=false`(该 worktree 的 Vitest 缓存有权限问题)。
- 全程只在 worktree `/Users/aa00945/Desktop/wraith/.worktrees/feat-desktop-pets` 工作,不碰 main 工作目录。
- 本分支未发布,无真实用户旧配置:pet 配置以主进程默认值起步,**不做** localStorage 迁移。
- 所有 Bash 命令在 `desktop/` 目录下跑(`cd .../feat-desktop-pets/desktop`);文档/spec 在 worktree 根的 `docs/` 下。

---

## 文件结构

**移动:**
- `src/renderer/lib/petState.ts` → `src/shared/petState.ts`(纯逻辑,main 与 renderer 共用)

**新增:**
- `src/shared/petWindow.ts` — 纯交互/布局工具:`isOpaqueAt` / `stepScale` / `clampToDisplay` / `defaultPetPosition` / `buildPetMenuTemplate`(无 Electron 依赖)
- `src/main/petConfig.ts` — 主进程持有的 pet 配置(读/写/normalize,基于既有 `settings.json`)
- `src/main/petWindow.ts` — `petWindow` 生命周期(create/destroy/sync/move/resize/setIgnoreMouse/popupMenu)
- `src/renderer/pet.html` + `src/renderer/pet.tsx` — 桌宠窗 renderer 入口与引导
- `src/renderer/components/PetWindowApp.tsx` — 桌宠根组件(订阅 config/preview/signal,渲染,命中/拖/滚/右键)
- `src/renderer/components/PetSprite.tsx` — 从 `PetAvatar` 抽出的纯展示精灵/单图渲染(供桌宠窗用)
- `src/preload/pet.ts` — 桌宠窗最小 preload,暴露 `window.wraithPet`

**修改:**
- `electron.vite.config.ts` — renderer 与 preload 各改多入口
- `src/main/index.ts` — 装配 petWindow 生命周期、pet 配置 IPC、`sendEvent` 处推 pet 信号
- `src/preload/index.ts` — 主窗 `window.wraith` 增 `petGetConfig`/`petSetConfig`/`onPetConfig`
- `src/renderer/lib/petMotion.ts` — `TRANSIENT_MS` import 改自 `../../shared/petState`
- `src/renderer/settings/prefs.ts` + `prefs.test.ts` + `SettingsContext.tsx` — 移除 `pets` 字段(改主进程持有)
- `src/renderer/components/PetsSettings.tsx` — 改经 IPC 读写 pet 配置;缩放范围 0.5–2.0
- `src/renderer/App.tsx` — 移除聊天内 `PetAvatar` 挂载与相关 App 级 pet 状态
- `desktop/test/e2e/pets.e2e.ts` — 重写到新表面
- `README.md` / `AGENTS.md` / spec 状态

**删除:**
- `src/renderer/components/PetAvatar.tsx`(渲染逻辑迁入 `PetSprite`)—— 在 Task 10 删

---

### Task 1: 把 petState 迁 shared + 主进程 pet 配置(读/写/normalize)

**Files:**
- Move: `src/renderer/lib/petState.ts` → `src/shared/petState.ts`
- Modify: `src/renderer/lib/petMotion.ts`(import 路径)
- Modify: `src/renderer/App.tsx`(import 路径,保持编译通过)
- Modify: `src/main/settings.ts`(加 `PetConfig` + 读写)
- Create/Modify test: `desktop/test/petConfig.test.ts`

**Interfaces:**
- Produces:
  - `src/shared/petState.ts`: `PetStateSignal`、`TRANSIENT_MS`、`petStateFromEvent(event: BackendEvent): PetStateSignal | null`、`nextPetState(signal, now): PetState`(内容不变,仅换位置)
  - `src/main/settings.ts`:
    ```ts
    export interface PetConfig {
      enabled: boolean
      selectedId: string | null
      motion: PetMotionStyle          // from '../shared/pets'
      scale: number                   // [0.5, 2.0]
      position: { x: number; y: number } | null  // 屏幕全局坐标;null=未放置,首次显示落默认位
    }
    export const DEFAULT_PET_CONFIG: PetConfig
    export function normalizePetConfig(value: unknown): PetConfig
    export function readPetConfig(userDataDir: string): PetConfig
    export function writePetConfig(userDataDir: string, patch: Partial<PetConfig>): PetConfig  // 合并+normalize+持久化(settings.json 的 pets 键),返回结果
    ```

- [ ] **Step 1: 移动 petState 到 shared**

```bash
cd /Users/aa00945/Desktop/wraith/.worktrees/feat-desktop-pets/desktop
git mv src/renderer/lib/petState.ts src/shared/petState.ts
```
`src/shared/petState.ts` 内容不变(它只 import `../../shared/...` 会变成 `./...`:把 `import type { PetState } from '../../shared/pets'` 改成 `'./pets'`,`import type { BackendEvent } from '../../shared/types'` 改成 `'./types'`)。

- [ ] **Step 2: 修好引用方 import,先让编译过**

`src/renderer/lib/petMotion.ts` 第 2 行 `import { TRANSIENT_MS } from './petState'` → `import { TRANSIENT_MS } from '../../shared/petState'`。
`src/renderer/App.tsx` 第 36 行 `from './lib/petState'` → `from '../shared/petState'`。
`desktop/test/petMotion.test.ts` 若 import petState 无需改(它 import petMotion)。运行 `npm run typecheck` 应 0。

- [ ] **Step 3: 写 pet 配置失败测试**

`desktop/test/petConfig.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PET_CONFIG, normalizePetConfig, readPetConfig, writePetConfig } from '../src/main/settings'

describe('normalizePetConfig', () => {
  it('缺失/非法字段回落默认', () => {
    expect(normalizePetConfig({})).toEqual(DEFAULT_PET_CONFIG)
    expect(normalizePetConfig({ scale: 9, motion: 'nope', enabled: 'x', selectedId: 1, position: { x: 'a', y: 2 } }))
      .toEqual(DEFAULT_PET_CONFIG)
  })
  it('缩放夹到 [0.5,2.0],合法值保留', () => {
    expect(normalizePetConfig({ scale: 0.4 }).scale).toBe(DEFAULT_PET_CONFIG.scale)
    expect(normalizePetConfig({ scale: 2.5 }).scale).toBe(DEFAULT_PET_CONFIG.scale)
    expect(normalizePetConfig({ scale: 1.75 }).scale).toBe(1.75)
  })
  it('position 接受有限屏幕坐标或 null', () => {
    expect(normalizePetConfig({ position: { x: 1200, y: 40 } }).position).toEqual({ x: 1200, y: 40 })
    expect(normalizePetConfig({ position: { x: Infinity, y: 0 } }).position).toBeNull()
  })
})

describe('readPetConfig / writePetConfig', () => {
  it('写入后读回一致,patch 合并保留其余键', () => {
    const dir = mkdtempSync(join(tmpdir(), 'petcfg-'))
    writePetConfig(dir, { selectedId: 'noir-webling', scale: 1.5 })
    const after = writePetConfig(dir, { enabled: false })
    expect(after).toMatchObject({ enabled: false, selectedId: 'noir-webling', scale: 1.5 })
    expect(readPetConfig(dir)).toEqual(after)
  })
  it('无文件时返回默认', () => {
    const dir = mkdtempSync(join(tmpdir(), 'petcfg-'))
    expect(readPetConfig(dir)).toEqual(DEFAULT_PET_CONFIG)
  })
})
```

- [ ] **Step 4: 运行确认失败**

Run: `npx vitest run test/petConfig.test.ts --cache=false`
Expected: FAIL(`normalizePetConfig` 等未导出)。

- [ ] **Step 5: 实现 pet 配置(settings.ts)**

在 `src/main/settings.ts`:
```ts
import type { PetMotionStyle } from '../shared/pets'

export interface PetConfig {
  enabled: boolean
  selectedId: string | null
  motion: PetMotionStyle
  scale: number
  position: { x: number; y: number } | null
}
export const DEFAULT_PET_CONFIG: PetConfig = { enabled: true, selectedId: null, motion: 'calm', scale: 1, position: null }
const MOTION: PetMotionStyle[] = ['calm', 'float', 'lively', 'static']

export function normalizePetConfig(value: unknown): PetConfig {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const pos = v['position']
  const posOk = !!pos && typeof pos === 'object'
    && Number.isFinite((pos as any).x) && Number.isFinite((pos as any).y)
  return {
    enabled: typeof v['enabled'] === 'boolean' ? v['enabled'] as boolean : DEFAULT_PET_CONFIG.enabled,
    selectedId: typeof v['selectedId'] === 'string' ? v['selectedId'] as string : null,
    motion: MOTION.includes(v['motion'] as PetMotionStyle) ? v['motion'] as PetMotionStyle : DEFAULT_PET_CONFIG.motion,
    scale: typeof v['scale'] === 'number' && Number.isFinite(v['scale']) && (v['scale'] as number) >= 0.5 && (v['scale'] as number) <= 2.0
      ? v['scale'] as number : DEFAULT_PET_CONFIG.scale,
    position: posOk ? { x: (pos as any).x as number, y: (pos as any).y as number } : null,
  }
}
export function readPetConfig(userDataDir: string): PetConfig {
  return normalizePetConfig((readSettings(userDataDir) as { pets?: unknown }).pets)
}
export function writePetConfig(userDataDir: string, patch: Partial<PetConfig>): PetConfig {
  const next = normalizePetConfig({ ...readPetConfig(userDataDir), ...patch })
  writeSettings(userDataDir, { ...readSettings(userDataDir), pets: next } as Settings)
  return next
}
```
在 `Settings` 接口加 `pets?: PetConfig`。

- [ ] **Step 6: 运行确认通过 + typecheck**

Run: `npx vitest run test/petConfig.test.ts test/petMotion.test.ts --cache=false && npm run typecheck`
Expected: PASS,typecheck 0。

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "refactor(desktop): petState 迁 shared + 主进程 pet 配置基元"
```

---

### Task 2: 桌宠纯交互/布局工具(shared)

**Files:**
- Create: `src/shared/petWindow.ts`
- Create test: `desktop/test/petWindow.test.ts`

**Interfaces:**
- Consumes: `PetView` from `./pets`;`PetConfig` from `../main/settings`(仅类型)。为避免 shared 依赖 main,`buildPetMenuTemplate` 的第二参用**局部结构类型** `{ selectedId: string | null; scale: number }`,不 import main。
- Produces:
  ```ts
  export interface Box { x: number; y: number; width: number; height: number }
  export function isOpaqueAt(data: Uint8ClampedArray | number[], sheetWidth: number, px: number, py: number, threshold?: number): boolean
  export function stepScale(current: number, deltaY: number, min?: number, max?: number, step?: number): number
  export function clampToDisplay(box: Box, workArea: Box): Box
  export function defaultPetPosition(workArea: Box, size: { width: number; height: number }, margin?: number): { x: number; y: number }
  export interface PetMenuItem { id: string; label: string; type?: 'separator' | 'checkbox' | 'submenu'; checked?: boolean; submenu?: PetMenuItem[] }
  export function buildPetMenuTemplate(pets: PetView[], config: { selectedId: string | null; scale: number }): PetMenuItem[]
  ```

- [ ] **Step 1: 写失败测试**

`desktop/test/petWindow.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isOpaqueAt, stepScale, clampToDisplay, defaultPetPosition, buildPetMenuTemplate } from '../src/shared/petWindow'
import type { PetView } from '../src/shared/pets'

describe('isOpaqueAt', () => {
  const w = 2 // 2x2 RGBA;像素(1,0)不透明,其余透明
  const data = new Uint8ClampedArray([0,0,0,0, 9,9,9,200, 0,0,0,0, 0,0,0,10])
  it('阈值上判命中', () => {
    expect(isOpaqueAt(data, w, 1, 0, 16)).toBe(true)
    expect(isOpaqueAt(data, w, 0, 0, 16)).toBe(false)
    expect(isOpaqueAt(data, w, 1, 1, 16)).toBe(false) // alpha 10 < 16
  })
  it('越界安全返回 false', () => {
    expect(isOpaqueAt(data, w, 5, 5, 16)).toBe(false)
    expect(isOpaqueAt(data, w, -1, 0, 16)).toBe(false)
  })
})

describe('stepScale', () => {
  it('deltaY>0 缩小、<0 放大,夹到 [0.5,2.0]', () => {
    expect(stepScale(1, -100)).toBeCloseTo(1.1)
    expect(stepScale(1, 100)).toBeCloseTo(0.9)
    expect(stepScale(0.5, 100)).toBe(0.5)
    expect(stepScale(2.0, -100)).toBe(2.0)
  })
})

describe('clampToDisplay', () => {
  const wa = { x: 0, y: 0, width: 1000, height: 800 }
  it('夹进工作区', () => {
    expect(clampToDisplay({ x: -50, y: -50, width: 100, height: 100 }, wa)).toMatchObject({ x: 0, y: 0 })
    expect(clampToDisplay({ x: 2000, y: 2000, width: 100, height: 100 }, wa)).toMatchObject({ x: 900, y: 700 })
  })
  it('多屏偏移工作区(x/y 非 0)也正确', () => {
    expect(clampToDisplay({ x: 100, y: 100, width: 100, height: 100 }, { x: 1000, y: 0, width: 1000, height: 800 }))
      .toMatchObject({ x: 1000, y: 100 })
  })
})

describe('defaultPetPosition', () => {
  it('落工作区右下角内(留 margin)', () => {
    expect(defaultPetPosition({ x: 0, y: 0, width: 1000, height: 800 }, { width: 200, height: 220 }, 24))
      .toEqual({ x: 1000 - 200 - 24, y: 800 - 220 - 24 })
  })
})

describe('buildPetMenuTemplate', () => {
  const pets: PetView[] = [
    { id: 'a', displayName: 'A', description: '', source: 'built-in', kind: 'static', available: true, removable: false, previewUrl: null, sprite: null },
    { id: 'b', displayName: 'B', description: '', source: 'imported', kind: 'static', available: false, removable: true, previewUrl: null, sprite: null },
  ]
  it('含选择宠物(仅可用打勾)/缩放/重置/关闭', () => {
    const t = buildPetMenuTemplate(pets, { selectedId: 'a', scale: 1 })
    const flat = JSON.stringify(t)
    expect(flat).toContain('pet:close')
    expect(flat).toContain('pet:reset-position')
    const select = t.find(i => i.id === 'pet:select')!
    expect(select.submenu!.find(s => s.id === 'pet:select:a')!.checked).toBe(true)
    // 不可用的 b 不打勾
    expect(select.submenu!.find(s => s.id === 'pet:select:b')!.checked).toBe(false)
    const scale = t.find(i => i.id === 'pet:scale')!
    expect(scale.submenu!.some(s => s.id === 'pet:scale:1')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/petWindow.test.ts --cache=false` → FAIL(模块不存在)。

- [ ] **Step 3: 实现 `src/shared/petWindow.ts`**

```ts
import type { PetView } from './pets'

export interface Box { x: number; y: number; width: number; height: number }

export function isOpaqueAt(data: Uint8ClampedArray | number[], sheetWidth: number, px: number, py: number, threshold = 16): boolean {
  if (px < 0 || py < 0) return false
  const idx = (py * sheetWidth + px) * 4 + 3
  return idx >= 0 && idx < data.length && (data[idx] as number) > threshold
}

export function stepScale(current: number, deltaY: number, min = 0.5, max = 2.0, step = 0.1): number {
  const next = current + (deltaY < 0 ? step : -step)
  return Math.min(max, Math.max(min, Math.round(next * 100) / 100))
}

export function clampToDisplay(box: Box, workArea: Box): Box {
  const x = Math.min(Math.max(box.x, workArea.x), workArea.x + Math.max(0, workArea.width - box.width))
  const y = Math.min(Math.max(box.y, workArea.y), workArea.y + Math.max(0, workArea.height - box.height))
  return { x, y, width: box.width, height: box.height }
}

export function defaultPetPosition(workArea: Box, size: { width: number; height: number }, margin = 24): { x: number; y: number } {
  return { x: workArea.x + workArea.width - size.width - margin, y: workArea.y + workArea.height - size.height - margin }
}

export interface PetMenuItem { id: string; label: string; type?: 'separator' | 'checkbox' | 'submenu'; checked?: boolean; submenu?: PetMenuItem[] }

export function buildPetMenuTemplate(pets: PetView[], config: { selectedId: string | null; scale: number }): PetMenuItem[] {
  const selectable = pets.filter(p => p.available)
  return [
    { id: 'pet:select', label: '选择宠物', type: 'submenu', submenu: selectable.map(p => ({
      id: `pet:select:${p.id}`, label: p.displayName, type: 'checkbox', checked: p.available && config.selectedId === p.id,
    })) },
    { id: 'pet:scale', label: '缩放', type: 'submenu', submenu: [0.5, 1, 1.5, 2].map(s => ({
      id: `pet:scale:${s}`, label: `${Math.round(s * 100)}%`, type: 'checkbox', checked: Math.abs(config.scale - s) < 0.001,
    })) },
    { id: 'pet:reset-position', label: '重置位置' },
    { id: 'sep', label: '', type: 'separator' },
    { id: 'pet:close', label: '关闭宠物' },
  ]
}
```

- [ ] **Step 4: 运行确认通过 + typecheck**

Run: `npx vitest run test/petWindow.test.ts --cache=false && npm run typecheck` → PASS,0。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(desktop): 桌宠纯交互/布局工具(命中/缩放/夹取/菜单模板)"
```

---

### Task 3: 构建多入口 + 桌宠窗骨架(pet.html / pet.tsx / pet preload)

**Files:**
- Modify: `electron.vite.config.ts`
- Create: `src/renderer/pet.html`、`src/renderer/pet.tsx`
- Create: `src/preload/pet.ts`
- Create: `src/renderer/components/PetWindowApp.tsx`(本任务占位:渲染一个空的透明根,后续任务填充)

**Interfaces:**
- Produces:
  - `window.wraithPet`(preload,先声明全量类型,本任务只接线到 ipc,后续任务在主进程实现对端):
    ```ts
    export interface WraithPetApi {
      ready(): void
      getConfig(): Promise<PetConfig>
      setConfig(patch: Partial<PetConfig>): Promise<PetConfig>
      onConfig(cb: (c: PetConfig) => void): () => void
      onPreview(cb: (p: { id: string; previewUrl: string | null; sprite: PetSprite | null } | null) => void): () => void
      onSignal(cb: (s: PetStateSignal) => void): () => void
      setIgnoreMouse(ignore: boolean): void
      moveTo(x: number, y: number): void
      setScale(scale: number): void
      contextMenu(): void
    }
    ```
    (`PetConfig` 从 `../main/settings` 仅取类型;`PetSprite`/`PetStateSignal` 从 shared。)

- [ ] **Step 1: electron.vite 多入口**

`electron.vite.config.ts`:renderer 的 `build.rollupOptions.input` 改为:
```ts
input: {
  index: 'src/renderer/index.html',
  pet: 'src/renderer/pet.html',
}
```
preload 的 `build.rollupOptions.input` 改为:
```ts
input: {
  index: 'src/preload/index.ts',
  pet: 'src/preload/pet.ts',
}
```
(preload 已有 `output.entryFileNames: '[name].cjs'`,故会产出 `index.cjs` 与 `pet.cjs`。)

- [ ] **Step 2: pet.html + pet.tsx**

`src/renderer/pet.html`(仿 index.html,但透明、无滚动):
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Wraith Pet</title>
    <style>html,body{margin:0;height:100vh;background:transparent;overflow:hidden;-webkit-user-select:none;user-select:none}</style>
  </head>
  <body>
    <div id="pet-root"></div>
    <script type="module" src="./pet.tsx"></script>
  </body>
</html>
```
`src/renderer/pet.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import PetWindowApp from './components/PetWindowApp'

const el = document.getElementById('pet-root')
if (!el) throw new Error('pet-root missing')
createRoot(el).render(<StrictMode><PetWindowApp /></StrictMode>)
```

- [ ] **Step 3: PetWindowApp 占位**

`src/renderer/components/PetWindowApp.tsx`:
```tsx
export default function PetWindowApp(): JSX.Element {
  // 占位:后续任务填充 config/preview/signal 订阅与渲染。
  return <div data-testid="pet-window-root" />
}
```

- [ ] **Step 4: pet preload**

`src/preload/pet.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { PetSprite } from '../shared/pets'
import type { PetStateSignal } from '../shared/petState'
import type { PetConfig } from '../main/settings'

const api = {
  ready: () => ipcRenderer.send('pet:ready'),
  getConfig: () => ipcRenderer.invoke('pet:getConfig') as Promise<PetConfig>,
  setConfig: (patch: Partial<PetConfig>) => ipcRenderer.invoke('pet:setConfig', patch) as Promise<PetConfig>,
  onConfig: (cb: (c: PetConfig) => void) => {
    const h = (_e: unknown, c: PetConfig) => cb(c); ipcRenderer.on('pet:config', h)
    return () => ipcRenderer.removeListener('pet:config', h)
  },
  onPreview: (cb: (p: { id: string; previewUrl: string | null; sprite: PetSprite | null } | null) => void) => {
    const h = (_e: unknown, p: any) => cb(p); ipcRenderer.on('pet:preview', h)
    return () => ipcRenderer.removeListener('pet:preview', h)
  },
  onSignal: (cb: (s: PetStateSignal) => void) => {
    const h = (_e: unknown, s: PetStateSignal) => cb(s); ipcRenderer.on('pet:signal', h)
    return () => ipcRenderer.removeListener('pet:signal', h)
  },
  setIgnoreMouse: (ignore: boolean) => ipcRenderer.send('pet:setIgnoreMouse', ignore),
  moveTo: (x: number, y: number) => ipcRenderer.send('pet:moveTo', x, y),
  setScale: (scale: number) => ipcRenderer.send('pet:setScale', scale),
  contextMenu: () => ipcRenderer.send('pet:contextMenu'),
}
contextBridge.exposeInMainWorld('wraithPet', api)
export type WraithPetApi = typeof api
declare global { interface Window { wraithPet: WraithPetApi } }
```

- [ ] **Step 5: 构建验证产物**

Run: `npm run build && ls out/renderer/pet.html out/preload/pet.cjs`
Expected: 两文件都存在,build exit 0。

- [ ] **Step 6: typecheck + 提交**

Run: `npm run typecheck`(0)。
```bash
git add -A && git commit -m "feat(desktop): 桌宠窗构建多入口 + pet.html/preload 骨架"
```

---

### Task 4: pet 配置 IPC(主进程 + 主窗 preload)

**Files:**
- Modify: `src/main/index.ts`(ipc 处理 + 广播 helper)
- Modify: `src/preload/index.ts`(`window.wraith` 增 3 方法)
- Create test: `desktop/test/petConfigIpc.test.ts`(测可抽出的纯广播/同步决策)

**Interfaces:**
- Consumes: `readPetConfig`/`writePetConfig`(Task 1)。
- Produces:
  - ipcMain:`pet:getConfig`(→ readPetConfig)、`pet:setConfig`(→ writePetConfig,然后广播 + 见 Task 6 的 syncPetWindow)
  - `broadcastPetConfig(config: PetConfig)`:向所有 `BrowserWindow.getAllWindows()` `webContents.send('pet:config', config)`
  - `window.wraith`:`petGetConfig(): Promise<PetConfig>`、`petSetConfig(patch): Promise<PetConfig>`、`onPetConfig(cb): () => void`

- [ ] **Step 1: 主窗 preload 增方法**

`src/preload/index.ts`:接口与实现各加(仿现有 `petsList` 等):
```ts
petGetConfig(): Promise<PetConfig>
petSetConfig(patch: Partial<PetConfig>): Promise<PetConfig>
onPetConfig(cb: (c: PetConfig) => void): () => void
```
实现:
```ts
petGetConfig: () => ipcRenderer.invoke('pet:getConfig'),
petSetConfig: (patch) => ipcRenderer.invoke('pet:setConfig', patch),
onPetConfig: (cb) => { const h = (_e, c) => cb(c); ipcRenderer.on('pet:config', h); return () => ipcRenderer.removeListener('pet:config', h) },
```
(`PetConfig` 从 `../main/settings` import type。)

- [ ] **Step 2: 主进程 ipc + 广播**

`src/main/index.ts`(pet handlers 附近,~529 行后):
```ts
import { readPetConfig, writePetConfig, type PetConfig } from './settings'

function broadcastPetConfig(config: PetConfig): void {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('pet:config', config) } catch { /* 窗口已销毁 */ }
  }
}
ipcMain.handle('pet:getConfig', () => readPetConfig(app.getPath('userData')))
ipcMain.handle('pet:setConfig', (_e, patch: Partial<PetConfig>) => {
  const next = writePetConfig(app.getPath('userData'), patch)
  broadcastPetConfig(next)
  syncPetWindow(next)   // Task 6 提供;本任务先留 TODO 注释,Task 6 接上
  return next
})
```
(本任务 `syncPetWindow` 尚不存在——先注释掉该行并留 `// TODO(Task6): syncPetWindow(next)`,Task 6 再启用,保证每任务可编译。)

- [ ] **Step 3: 测试(纯决策)**

`desktop/test/petConfigIpc.test.ts` 测一个可抽出的纯函数 `shouldShowPet(config, hasAvailable)`(供 Task 6 用,先放 `src/shared/petWindow.ts` 更合适——移到 Task 2?)。**决策**:把 `shouldShowPet` 放 `src/shared/petWindow.ts`,在 Task 2 时其实未加,这里补测并补实现:
```ts
// 追加到 src/shared/petWindow.ts
export function shouldShowPet(config: { enabled: boolean }, hasAvailablePet: boolean): boolean {
  return config.enabled && hasAvailablePet
}
```
测试:
```ts
import { shouldShowPet } from '../src/shared/petWindow'
it('enabled 且有可用宠物才显示', () => {
  expect(shouldShowPet({ enabled: true }, true)).toBe(true)
  expect(shouldShowPet({ enabled: true }, false)).toBe(false)
  expect(shouldShowPet({ enabled: false }, true)).toBe(false)
})
```

- [ ] **Step 4: 运行 + typecheck**

Run: `npx vitest run test/petConfigIpc.test.ts --cache=false && npm run typecheck` → PASS,0。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(desktop): pet 配置跨进程 IPC + 广播 + shouldShowPet"
```

---

### Task 5: 设置面板改经 IPC + 移除 renderer 侧 pets 偏好

**Files:**
- Modify: `src/renderer/settings/prefs.ts`(移除 `PetPrefs`/`pets` 相关)
- Modify: `src/renderer/settings/prefs.test.ts`(移除 pet 断言)
- Modify: `src/renderer/settings/SettingsContext.tsx`(移除 `setPets`)
- Modify: `src/renderer/components/PetsSettings.tsx`(改用 IPC hook;缩放 0.5–2.0)
- Create: `src/renderer/lib/usePetConfig.ts`(IPC-backed hook)
- Modify test: `desktop/test/settings.test.ts` 或新增 `desktop/test/petsSettings.test.tsx`

**Interfaces:**
- Consumes: `window.wraith.petGetConfig/petSetConfig/onPetConfig`(Task 4)、`petsList/petsImportImage/...`(既有)。
- Produces: `usePetConfig(): { config: PetConfig; setConfig(patch): void }`(挂载拉 getConfig + 订阅 onConfig;setConfig 调 petSetConfig)。

- [ ] **Step 1: 写 hook 与组件测试(失败)**

`desktop/test/petsSettings.test.tsx`:mock `window.wraith`(petGetConfig 返固定 config、petsList 返两只、petSetConfig 记录调用),渲染 `PetsSettings`,断言:开关调 `petSetConfig({enabled})`、缩放滑块 min=0.5 max=2、点某宠物调 `petSetConfig({selectedId})`。(参照既有组件测试风格 `providerIcon.test.tsx`。)

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/petsSettings.test.tsx --cache=false` → FAIL。

- [ ] **Step 3: 实现 usePetConfig + 改 PetsSettings**

`src/renderer/lib/usePetConfig.ts`:
```ts
import { useEffect, useState } from 'react'
import type { PetConfig } from '../../main/settings'
export function usePetConfig(): { config: PetConfig | null; setConfig: (p: Partial<PetConfig>) => void } {
  const [config, setState] = useState<PetConfig | null>(null)
  useEffect(() => {
    let alive = true
    void window.wraith.petGetConfig().then(c => { if (alive) setState(c) })
    const off = window.wraith.onPetConfig(c => setState(c))
    return () => { alive = false; off() }
  }, [])
  const setConfig = (p: Partial<PetConfig>): void => { void window.wraith.petSetConfig(p).then(setState) }
  return { config, setConfig }
}
```
`PetsSettings.tsx`:把所有 `prefs.pets` / `setPets` 换成 `usePetConfig()` 的 `config` / `setConfig`;缩放 `<input type=range min={0.5} max={2} step={0.05}>`;`config` 为 null 时渲染骨架/禁用。保留全部 data-testid。

- [ ] **Step 4: 移除 renderer 侧 pets 偏好**

`prefs.ts`:删 `PetPrefs`、`Prefs.pets`、`DEFAULT_PREFS.pets`、`normalizePetPrefs`、`normalizedPosition`、`MAX_POSITION_OFFSET`、`loadPrefs`/`savePrefs` 中 pets 分支。`SettingsContext.tsx`:删 `setPets` 及接口成员。`prefs.test.ts`:删所有 pets 相关 `it`(Task 1 已把 petState 挪走;pet 配置测试在 petConfig.test.ts)。

- [ ] **Step 5: 运行 + typecheck**

Run: `npx vitest run test/petsSettings.test.tsx test/prefs.test.ts --cache=false && npm run typecheck` → PASS,0。
(注:`App.tsx` 此时仍 import `appPrefs.pets`——Task 10 才移除挂载。为保编译:本任务在 App.tsx 里**临时**把聊天内 PetAvatar 段落用 `false &&` 短路并去掉对 `appPrefs.pets`/`setPets` 的引用;或直接在本任务顺手删该段(提前做 Task 10 的移除动作)。**决策**:本任务直接移除 App.tsx 里聊天内 PetAvatar 挂载与 `petSignal`/`petPreviewUrl`/`applyPetSignal`/相关 effect,因为它们全依赖已删的 `appPrefs.pets`;Task 10 只剩删文件 + e2e + 文档。)

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat(desktop): 设置面板改经 IPC 读写 pet 配置 + 移除 renderer pets 偏好 + 摘除聊天内挂载"
```

---

### Task 6: petWindow 生命周期(主进程)

**Files:**
- Create: `src/main/petWindow.ts`
- Modify: `src/main/index.ts`(whenReady 装配、启用 `syncPetWindow`、will-quit 销毁)
- Create test: `desktop/test/petWindowLifecycle.test.ts`(纯决策已在 Task 4 的 shouldShowPet;此处补 dev/prod URL 解析纯函数)

**Interfaces:**
- Consumes: `shouldShowPet`、`readPetConfig`、`listPets`、`defaultPetPosition`、`clampToDisplay`。
- Produces:
  ```ts
  export function petHtmlTarget(rendererUrlEnv: string | undefined, dirname: string): { url?: string; file?: string }
  export function initPetWindow(deps: { userDataDir(): string; petdexRoot(): string; preloadPath: string; primaryWorkArea(): Box }): void
  export function syncPetWindow(config: PetConfig): void   // create if shouldShow else destroy
  export function destroyPetWindow(): void
  export function getPetWindow(): BrowserWindow | null
  ```

- [ ] **Step 1: URL 解析纯函数测试**

`desktop/test/petWindowLifecycle.test.ts`:
```ts
import { petHtmlTarget } from '../src/main/petWindow'
it('dev 用 ELECTRON_RENDERER_URL/pet.html,prod 用 file', () => {
  expect(petHtmlTarget('http://localhost:5873', '/x/out/main')).toEqual({ url: 'http://localhost:5873/pet.html' })
  expect(petHtmlTarget(undefined, '/x/out/main')).toEqual({ file: '/x/out/renderer/pet.html' })
})
```

- [ ] **Step 2: 运行失败**

Run: `npx vitest run test/petWindowLifecycle.test.ts --cache=false` → FAIL。

- [ ] **Step 3: 实现 petWindow.ts**

关键点(实现者按此写):
- 模块级 `let petWindow: BrowserWindow | null`。
- `petHtmlTarget`:`rendererUrlEnv ? { url: rendererUrlEnv.replace(/\/$/, '') + '/pet.html' } : { file: path.join(dirname, '../renderer/pet.html') }`。
- `createPetWindow(config)`:以 splash 选项为蓝本:
  ```ts
  const size = scaledPetSize(config.scale) // 见下
  const wa = deps.primaryWorkArea()
  const pos = config.position ?? defaultPetPosition(wa, size)
  const b = clampToDisplay({ ...pos, ...size }, wa)
  petWindow = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, skipTaskbar: true, focusable: false, fullscreenable: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: deps.petPreloadPath },
  })
  petWindow.setAlwaysOnTop(true, 'floating')
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  petWindow.setIgnoreMouseEvents(true, { forward: true })
  const t = petHtmlTarget(process.env['ELECTRON_RENDERER_URL'], __dirname)
  t.url ? petWindow.loadURL(t.url) : petWindow.loadFile(t.file!)
  petWindow.once('ready-to-show', () => petWindow?.show())
  petWindow.on('closed', () => { petWindow = null })
  ```
  `scaledPetSize(scale)`:桌宠窗尺寸 = `Math.ceil(192*scale)+PAD` × `Math.ceil(208*scale)+PAD`(PAD 小留白,如 8;单图另在 renderer 内 object-contain,窗口给 208 上限量级即可)。**决策**:窗口按精灵 cell 192×208 × scale 计算;单图宠物也用同尺寸框(renderer 内居中)。
- `syncPetWindow(config)`:异步查 `listPets` 得 hasAvailable;`shouldShowPet(config, hasAvailable)` 为真且无窗→create;为假且有窗→`destroyPetWindow()`;已存在且 scale 变→resize(见 Task 9 复用)。为避免频繁重建,selectedId/scale 变化不重建窗口,只经 IPC 推 config/preview(Task 7)。
- `destroyPetWindow()`:`petWindow?.close(); petWindow = null`。
- 全程 try/catch 吞异常,失败即无桌宠,绝不抛。

- [ ] **Step 4: 装配 index.ts**

- import `initPetWindow, syncPetWindow, destroyPetWindow, getPetWindow` from './petWindow';`petPreloadPath = path.join(__dirname, '../preload/pet.cjs')`。
- `app.whenReady().then(...)` 末尾:`initPetWindow({...}); syncPetWindow(readPetConfig(ud))`(E2E 下也走,除非用 `WRAITH_E2E` 想跳过——**决策**:E2E 保留创建以便断言第二窗;但 reduced-motion/穿透靠手工)。
- Task 4 里注释的 `syncPetWindow(next)` 现在启用。
- `will-quit`:`destroyPetWindow()`。
- `window-all-closed` 的 darwin 守卫**不改**(桌宠窗存活会让 app 继续活,符合预期)。

- [ ] **Step 5: 运行 + typecheck + build**

Run: `npx vitest run test/petWindowLifecycle.test.ts --cache=false && npm run typecheck && npm run build` → PASS,0,build 0。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat(desktop): petWindow 生命周期(无边框透明置顶,跨 Space,随配置增删)"
```

---

### Task 7: 桌宠渲染 + 状态联动(config/preview/signal)

**Files:**
- Create: `src/renderer/components/PetSprite.tsx`(从 PetAvatar 抽纯展示:精灵/单图 + 帧检测 + motion)
- Modify: `src/renderer/components/PetWindowApp.tsx`(订阅三路 + 渲染 + 瞬态计时)
- Modify: `src/main/index.ts`(`sendEvent` 处推 pet:signal;petWindow ready 后推 config+preview;selectedId 变推 preview)
- Modify: `src/main/petWindow.ts`(`pushPetPreview`/`pushPetConfig`/`pushPetSignal` helper)
- Test: `desktop/test/petSprite.test.tsx`(帧检测/motion 已有;此处测 PetSprite 在 reduced-motion 无 active class、精灵 backgroundPosition)

**Interfaces:**
- Consumes: `window.wraithPet.onConfig/onPreview/onSignal/ready`、`motionFor`/`spriteRowFor`/`detectFrameCounts`、`petStateFromEvent`(main 侧)、`nextPetState`/`TRANSIENT_MS`。
- Produces: `PetSprite` props `{ previewUrl: string | null; sprite: PetSprite | null; state: PetState; motion: PetMotionStyle; scale: number }`。

- [ ] **Step 1: 抽 PetSprite(从 PetAvatar 内层复制精灵/单图渲染 + frameCounts 检测 + motion),写渲染测试(失败)**

测试断言:给静态图 previewUrl + motion='static' → 无 `pet-*` class;给精灵 + state='tool' → backgroundPosition 的 row 用 `spriteRowFor('tool', rows)`。（参照 PetAvatar 既有逻辑;帧检测 canvas 在 jsdom 不可用会回退 columns,测试聚焦 class 与 row。）

- [ ] **Step 2: 运行失败** → `npx vitest run test/petSprite.test.tsx --cache=false`

- [ ] **Step 3: 实现 PetSprite + PetWindowApp**

- `PetSprite`:即 PetAvatar 当前"内层渲染 + frameCounts 检测 effect + 动画 effect",去掉拖拽/定位/testid,纯按 props 渲染,`data-testid="pet-sprite"`。整只铺满窗口(窗口尺寸即精灵尺寸)。
- `PetWindowApp`:
  ```tsx
  const [config, setConfig] = useState<PetConfig | null>(null)
  const [preview, setPreview] = useState<{previewUrl:string|null; sprite:PetSprite|null}|null>(null)
  const [signal, setSignal] = useState<{state:PetState; expiresAt:number|null}>({state:'idle',expiresAt:null})
  // onConfig/onPreview/onSignal 订阅;onSignal 里复用 applyPetSignal 式瞬态计时(TRANSIENT_MS)
  // mount 调 window.wraithPet.ready()
  const state = nextPetState(signal, Date.now())
  return <PetSprite previewUrl={preview?.previewUrl ?? null} sprite={preview?.sprite ?? null} state={state} motion={config?.motion ?? 'calm'} scale={config?.scale ?? 1} />
  ```

- [ ] **Step 4: 主进程推送**

- `petWindow.ts` 加 `pushPetConfig(c)`/`pushPetPreview(p)`/`pushPetSignal(s)`:`petWindow?.webContents.send('pet:config'|'pet:preview'|'pet:signal', ...)`。
- `index.ts`:新增 ipc `pet:ready`(收到后推当前 config + 当前选中宠物 preview:`previewDataUrl` + 该宠物 sprite 元数据)。
- `syncPetWindow`/`setConfig` 变更 selectedId 时 → 重算 preview 并 `pushPetPreview`。
- `sendEvent(evt)`(index.ts:154)末尾加:
  ```ts
  const sig = petStateFromEvent(evt)   // import from '../shared/petState'
  if (sig) pushPetSignal(sig)
  ```

- [ ] **Step 5: 运行 + typecheck + build**

Run: `npx vitest run test/petSprite.test.tsx --cache=false && npm run typecheck && npm run build` → PASS,0,0。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat(desktop): 桌宠渲染 + 状态联动(config/preview/signal 经 IPC)"
```

---

### Task 8: 点击穿透(逐像素 alpha 命中测试)

**Files:**
- Modify: `src/renderer/components/PetWindowApp.tsx`(mousemove 命中 → setIgnoreMouse)
- Modify: `src/renderer/components/PetSprite.tsx`(暴露当前帧 alpha 查询,或把解码的 ImageData 提升到 PetWindowApp)
- Modify: `src/main/index.ts`(`pet:setIgnoreMouse` handler)
- 复用测试: `isOpaqueAt`(Task 2 已测)

**Interfaces:**
- Consumes: `isOpaqueAt`、`window.wraithPet.setIgnoreMouse`。
- 决策:把精灵/单图的**解码 ImageData 提升到 PetWindowApp**(一次解码,既给 PetSprite 帧检测,又给命中测试),或在 PetWindowApp 独立解码一份 alpha。为简单,PetWindowApp 独立解码 previewUrl 到 alpha `Uint8ClampedArray` + sheetWidth,存 ref。

- [ ] **Step 1: 实现命中 → 穿透切换**

`PetWindowApp`:
```ts
const alphaRef = useRef<{ data: Uint8ClampedArray; sheetW: number } | null>(null)
// previewUrl 变时解码整表 alpha 存 alphaRef(与 PetSprite 同法;单图则整图 alpha)
const ignoringRef = useRef(true)
useEffect(() => {
  const onMove = (e: MouseEvent) => {
    const s = config?.scale ?? 1
    const a = alphaRef.current
    let opaque = false
    if (a) {
      // 当前帧 cell 偏移 + 指针(除以 scale)反算像素
      const col = currentFrameRef.current, rowPx = currentRowRef.current
      const px = Math.floor(cellX*fw + e.clientX / s)  // 单图:px=floor(e.clientX/s), py=floor(e.clientY/s)
      const py = Math.floor(rowY*fh + e.clientY / s)
      opaque = isOpaqueAt(a.data, a.sheetW, px, py)
    }
    if (opaque === ignoringRef.current) { // 需要翻转
      ignoringRef.current = !opaque
      window.wraithPet.setIgnoreMouse(!opaque)
    }
  }
  window.addEventListener('mousemove', onMove)
  return () => window.removeEventListener('mousemove', onMove)
}, [config?.scale])
```
(currentFrame/currentRow 由 PetSprite 经 callback 或共享 ref 提供;可让 PetSprite 接受 `onFrame(cell,row)` 回调。)

- [ ] **Step 2: 主进程 handler**

`index.ts`:`ipcMain.on('pet:setIgnoreMouse', (_e, ignore: boolean) => getPetWindow()?.setIgnoreMouseEvents(!!ignore, { forward: true }))`。

- [ ] **Step 3: typecheck + build + 复跑既有单测**

Run: `npm run typecheck && npm run build && npx vitest run test/petWindow.test.ts --cache=false` → 0,0,PASS。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat(desktop): 桌宠点击穿透(逐像素 alpha 命中动态切 setIgnoreMouseEvents)"
```

---

### Task 9: 全身拖动 + 滚轮缩放 + 右键菜单

**Files:**
- Modify: `src/renderer/components/PetWindowApp.tsx`(pointer 拖 / wheel / contextmenu)
- Modify: `src/main/index.ts`(`pet:moveTo`/`pet:setScale`/`pet:contextMenu` handlers + 菜单 action)
- Modify: `src/main/petWindow.ts`(`moveTo`/`resizeToScale`)
- 复用测试:`stepScale`/`clampToDisplay`/`buildPetMenuTemplate`(Task 2)

**Interfaces:**
- Consumes: `stepScale`、`clampToDisplay`、`buildPetMenuTemplate`、`defaultPetPosition`、`window.wraithPet.moveTo/setScale/contextMenu`。

- [ ] **Step 1: renderer 交互**

`PetWindowApp`(命中即窗口捕获鼠标,故直接在根 div 上挂):
- 拖动:`onPointerDown` 记 `e.screenX/screenY` + 记窗口当前屏幕原点(第一次 down 时用 `window.screenX/screenY`?——**决策**:主进程按增量移窗更稳:renderer 只发 `moveTo(screenX - grabDX, screenY - grabDY)`,其中 grabDX/DY = 按下时指针相对窗口左上的偏移 = `e.screenX - window.screenX`。故 `moveTo(e.screenX - grabDX, e.screenY - grabDY)` on move。)
- 缩放:`onWheel` → `window.wraithPet.setScale(stepScale(config.scale, e.deltaY))`(节流每帧一次)。
- 右键:`onContextMenu` → `e.preventDefault(); window.wraithPet.contextMenu()`。

- [ ] **Step 2: 主进程 handlers**

`index.ts`:
```ts
import { Menu } from 'electron'
ipcMain.on('pet:moveTo', (_e, x: number, y: number) => petWindowMoveTo(x, y)) // petWindow.ts:clampToDisplay 到目标屏后 setBounds;pointerup 端另发 setConfig({position})
ipcMain.on('pet:setScale', (_e, scale: number) => {
  const c = writePetConfig(app.getPath('userData'), { scale })
  petWindowResizeToScale(c.scale); broadcastPetConfig(c); pushPetConfig(c)
})
ipcMain.on('pet:contextMenu', async () => {
  const pets = await listPets({ userDataDir: app.getPath('userData'), petdexRoot: petdexRoot() })
  const cfg = readPetConfig(app.getPath('userData'))
  const template = toElectronMenu(buildPetMenuTemplate(pets, cfg), (id) => handlePetMenu(id))
  Menu.buildFromTemplate(template).popup({ window: getPetWindow() ?? undefined })
})
```
`toElectronMenu(items, onClick)`:把 `PetMenuItem[]` 映射为 `MenuItemConstructorOptions[]`,`type:'submenu'`→`submenu`,`checkbox`→`type:'checkbox'`+`checked`,`separator`→`type:'separator'`,叶子 `click: () => onClick(item.id)`。
`handlePetMenu(id)`:
- `pet:select:<petId>` → `setConfig({ selectedId })` 路径(writePetConfig+broadcast+pushConfig+pushPreview)
- `pet:scale:<s>` → 同 setScale
- `pet:reset-position` → `writePetConfig({ position: null })` 然后 petWindow 移到 `defaultPetPosition`
- `pet:close` → `writePetConfig({ enabled: false })` + broadcast + `syncPetWindow`(销毁窗)

拖动落盘:renderer `onPointerUp` → `window.wraithPet.setConfig({ position: 当前窗口屏幕原点 })`(经 `pet:setConfig`,已 broadcast)。

- [ ] **Step 3: petWindow.ts move/resize**

```ts
export function petWindowMoveTo(x: number, y: number): void {
  if (!petWindow) return
  const b = petWindow.getBounds()
  const wa = screen.getDisplayMatching(b).workArea
  const c = clampToDisplay({ x, y, width: b.width, height: b.height }, wa)
  petWindow.setBounds(c)
}
export function petWindowResizeToScale(scale: number): void {
  if (!petWindow) return
  const b = petWindow.getBounds(); const size = scaledPetSize(scale)
  petWindow.setBounds({ x: b.x, y: b.y, ...size }) // 保左上角;可选:按中心锚点微调
}
```

- [ ] **Step 4: typecheck + build + 复跑单测**

Run: `npm run typecheck && npm run build && npx vitest run test/petWindow.test.ts --cache=false` → 0,0,PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(desktop): 桌宠全身拖动 + 滚轮缩放 + 原生右键菜单"
```

---

### Task 10: 移除旧浮件 + 重写 E2E + 文档 + 全量验证

**Files:**
- Delete: `src/renderer/components/PetAvatar.tsx`
- Modify: `desktop/test/e2e/pets.e2e.ts`(重写)
- Modify: `desktop/test/petMotion.test.ts`(移除 dragBounds/clampPoint 若不再用——**决策**:`clampPoint`/`dragBounds` 旧浮件专用,删函数与测试;`detectFrameCounts`/`spriteRowFor`/`motionFor`/`selectedPet` 保留)
- Modify: `src/renderer/lib/petMotion.ts`(删 `dragBounds`/`clampPoint`/`DragBounds`)
- Modify: `README.md`、`AGENTS.md`、两份 spec 状态
- 验证:全量 gate

- [ ] **Step 1: 删旧浮件与其残余**

确认 App.tsx 已在 Task 5 摘除挂载后,`git rm src/renderer/components/PetAvatar.tsx`。删 `petMotion.ts` 的 `dragBounds`/`clampPoint`/`DragBounds` 及 `petMotion.test.ts` 对应 describe(它们是聊天内拖动专用,桌宠拖动在主进程 clampToDisplay)。`grep -rn "PetAvatar\|dragBounds\|clampPoint" src` 应只余无关命中。

- [ ] **Step 2: 重写 pets.e2e.ts**

保留 fixture 注入(`WRAITH_E2E_USERDATA` + `WRAITH_E2E_PETDEX_ROOT`)。新用例:
```ts
test('开启宠物后出现第二个无边框透明窗口', async () => {
  // 经设置面板开启(或注入 settings.json 的 pets.enabled=true 让 whenReady 建窗)
  // electronApp.windows() 长度变 2;第二窗 evaluate: !win.isMenuBarVisible? 用 browserWindow API 断 frameless/transparent
})
test('关闭宠物后第二窗销毁', async () => { /* setConfig enabled=false → windows() 回 1 */ })
test('reduced-motion 下 pet-sprite 无 active 动效 class', async () => { /* 注入 prefers-reduced-motion,查 pet 窗 DOM */ })
```
用 Playwright `_electron` 的 `electronApp.windows()` / `electronApp.browserWindow(page)` + `evaluate` 读 `BrowserWindow` 属性(`isMovable()`/`getBackgroundColor()`/`isAlwaysOnTop()`)断言。**诚实标注**:置顶生效、跨 Space、穿透、原生右键菜单**无法断言**,写进 spec 手工验收。

- [ ] **Step 3: 文档**

- `README.md` 桌面段:宠物现为全局桌面挂件(独立置顶窗),全身拖动/滚轮缩放/右键菜单;仍只接受用户图片与本地 Petdex 包、不自动下载。
- `AGENTS.md` 导航:加 `src/main/petWindow.ts`、`src/renderer/pet.{html,tsx}`、`src/preload/pet.ts`、`src/shared/petWindow.ts`、pet 配置在 `settings.ts`;标注 pet 窗 IPC 边界。
- `docs/superpowers/specs/2026-07-19-...md` 状态 `规格评审中`→`已实施`;`2026-07-18-...md` 顶部加一行"展示表面已被 2026-07-19 全局桌宠窗替换"。

- [ ] **Step 4: 全量验证 gate**

Run:
```bash
npm run typecheck && npx vitest run --cache=false && npm run build && npx playwright test test/e2e/pets.e2e.ts
```
Expected: typecheck 0;vitest 全绿;build 0;pets.e2e 全绿。
(**注意**:不与其他 E2E 并发跑——见既有 shell.e2e flake 记录。)

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "refactor(desktop): 移除聊天内浮件 + 重写桌宠 E2E + 文档 + 全量验证"
```

---

## Self-Review

**Spec coverage(逐条对 2026-07-19 spec):**
- 独立无边框透明置顶跨 Space 不抢焦点窗 → Task 6 ✓
- 逐像素 alpha 命中穿透 → Task 2(isOpaqueAt)+ Task 8 ✓
- 全身拖动 → Task 9 ✓
- 滚轮缩放 0.5–2.0 → Task 2(stepScale)+ Task 9 ✓
- 原生右键菜单(选择/缩放/重置/关闭)→ Task 2(模板)+ Task 9 ✓
- 状态联动(六态,IPC 推派生信号)→ Task 1(petState 迁 shared)+ Task 7 ✓
- 配置迁主进程单一源 + 屏幕坐标 + 默认位 → Task 1 + Task 4 + Task 5 ✓
- 生命周期(随 app 存活、enabled 增删)→ Task 6 ✓
- 复用 petStore/preload/petMotion/petState/精灵渲染 → Task 1/7 ✓
- 移除聊天内 overlay → Task 5(摘挂载)+ Task 10(删文件)✓
- 安全三红线不动 → 全程不改 petStore.ts/preload/index.ts 的校验;新增仅新 IPC + 新 preload 白名单 ✓
- 独立轻量 renderer 入口 + 独立 pet preload → Task 3 ✓
- 测试:纯函数单测(Task 1/2/6)+ 可断言 E2E(Task 10)+ 诚实标注手工验收 ✓
- macOS 专属 / 不自动下载 → Global Constraints ✓

**Placeholder scan:** 无 TBD/TODO 遗留(Task 4 的临时 `// TODO(Task6)` 在 Task 6 Step 4 明确启用)。Electron 胶水任务(6/8/9)给出确切 API 调用、选项、签名与接线点,未留"自行处理"式空洞。

**Type consistency:** `PetConfig`(settings.ts,含 `position: {x,y}|null`)贯穿 Task1/3/4/5/6/9;`PetStateSignal`/`TRANSIENT_MS`/`petStateFromEvent`/`nextPetState`(shared/petState)贯穿 Task1/7;`isOpaqueAt`/`stepScale`/`clampToDisplay`/`defaultPetPosition`/`buildPetMenuTemplate`/`shouldShowPet`(shared/petWindow)签名在 Task2/4 定义、Task6/8/9 消费一致;`window.wraithPet` API(pet preload)Task3 定义、Task7/8/9 消费一致;`petGetConfig/petSetConfig/onPetConfig`(window.wraith)Task4 定义、Task5 消费一致。
