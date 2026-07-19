/**
 * petWindow — 全局桌宠窗口生命周期(主进程)。
 *
 * 无边框/透明/置顶/跨 Space/点击穿透的独立 BrowserWindow,与主窗解耦,
 * 依配置(enabled + 是否存在可用宠物)增删。建模自 index.ts 的 createSplash():
 * 全程 try/catch 吞异常,失败即"无桌宠",绝不阻塞应用启动/退出。
 *
 * 只做创建/销毁两件事;selectedId/scale 等配置变化不重建窗口(避免频繁重建),
 * 由 Task 7 的 IPC 推送(pet:config / pet:preview)驱动 renderer 侧视觉更新。
 * 尺寸随 scale 的实际 resize 复用点留给 Task 9。
 */

import { BrowserWindow, screen } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { shouldShowPet, defaultPetPosition, clampToDisplay, type Box, type PetMenuItem } from '../shared/petWindow'
import { listPets } from './petStore'
import type { PetConfig } from './settings'
import type { PetSprite } from '../shared/pets'
import type { PetStateSignal } from '../shared/petState'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** 精灵单帧尺寸(cell),单图宠物也用同一尺寸的窗口框(renderer 内居中/object-contain)。 */
const PET_FRAME_WIDTH = 192
const PET_FRAME_HEIGHT = 208
/** 窗口相对精灵帧的小留白,避免边缘裁切。 */
const PET_WINDOW_PAD = 8

export interface PetWindowDeps {
  userDataDir(): string
  petdexRoot(): string
  preloadPath: string
  primaryWorkArea(): Box
}

let deps: PetWindowDeps | null = null
let petWindow: BrowserWindow | null = null

/**
 * dev 用 `${ELECTRON_RENDERER_URL}/pet.html`(去掉尾部斜杠再拼接),
 * prod 用 `path.join(dirname, '../renderer/pet.html')`(dirname 即 out/main)。
 * 纯函数,不触碰 Electron API,便于单测。
 */
export function petHtmlTarget(rendererUrlEnv: string | undefined, dirname: string): { url?: string; file?: string } {
  return rendererUrlEnv
    ? { url: `${rendererUrlEnv.replace(/\/$/, '')}/pet.html` }
    : { file: path.join(dirname, '../renderer/pet.html') }
}

/** 桌宠窗尺寸 = 精灵 cell(192×208)× scale,向上取整 + 小留白。 */
function scaledPetSize(scale: number): { width: number; height: number } {
  return {
    width: Math.ceil(PET_FRAME_WIDTH * scale) + PET_WINDOW_PAD,
    height: Math.ceil(PET_FRAME_HEIGHT * scale) + PET_WINDOW_PAD,
  }
}

/** 记住装配依赖(userData/petdex 根路径解析、preload 路径、主显示器工作区取值)。 */
export function initPetWindow(d: PetWindowDeps): void {
  deps = d
}

/** 建窗:以 createSplash() 为蓝本,失败(任何异常)即吞掉、保持无桌宠,绝不抛出。 */
function createPetWindow(config: PetConfig): void {
  if (!deps) return
  // win 提到 try 外层声明,使 catch 块在"已构造出原生窗、后续某个 setter 才抛"的
  // 中途失败场景下也拿得到引用去 destroy() 它,避免泄漏一个既不在 petWindow 里、
  // 也再没人能关掉的原生窗口。
  let win: BrowserWindow | null = null
  try {
    const size = scaledPetSize(config.scale)
    const wa = deps.primaryWorkArea()
    const pos = config.position ?? defaultPetPosition(wa, size)
    const b = clampToDisplay({ ...pos, ...size }, wa)
    win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      // frameless 无边框窗本就没有用户可拖拽的缩放手柄,这里的 resizable 只影响
      // Electron 是否接受程序化 setBounds 改尺寸——resizable:false 会让 setBounds
      // 的尺寸变更被静默 no-op(Task 9 滚轮缩放的已知坑),必须开 true 才能生效;
      // movable 维持 false 不受影响(setBounds 移动窗口本就不受 movable 限制)。
      resizable: true, movable: false, skipTaskbar: true, focusable: false, fullscreenable: false,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, preload: deps.preloadPath },
    })
    petWindow = win
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setIgnoreMouseEvents(true, { forward: true })

    const target = petHtmlTarget(process.env['ELECTRON_RENDERER_URL'], __dirname)
    if (target.url) {
      void win.loadURL(target.url)
    } else {
      void win.loadFile(target.file!)
    }

    win.once('ready-to-show', () => {
      if (win && !win.isDestroyed()) win.show()
    })
    win.on('closed', () => {
      // 身份校验:destroy→create 快速切换时,Electron close() 是异步的,旧窗(win)
      // 迟到的 closed 事件不能无条件清空——此时 petWindow 可能已经指向新窗了。
      // 只有"我(win)仍是当前那扇窗"时才清空,否则会把新窗的引用误清成 null,
      // 造成新窗变孤儿(destroyPetWindow 关不到它,syncPetWindow 又误判无窗再建)。
      if (petWindow === win) petWindow = null
    })
  } catch {
    // 建窗失败(含构造成功但后续 setter 抛异常的中途失败):降级为无桌宠,
    // 绝不阻塞应用其余部分。若原生窗已经构造出来,必须显式 destroy() 掉,
    // 否则会在 petWindow 引用之外泄漏一个再也管不到的 OS 级窗口。
    if (win) {
      try { win.destroy() } catch { /* best-effort */ }
    }
    petWindow = null
  }
}

/** 销毁窗口(幂等);失败静默吞掉。 */
export function destroyPetWindow(): void {
  try {
    petWindow?.close()
  } catch {
    // best-effort
  }
  petWindow = null
}

/**
 * 依配置增删桌宠窗:异步查 listPets 得到"是否存在可用宠物",
 * 与 shouldShowPet(config, hasAvailable) 一起决定 create / destroy / no-op。
 * 全程 try/catch,任何失败都降级为"无桌宠",绝不抛出(调用方以 `void syncPetWindow(...)` 触发)。
 */
export async function syncPetWindow(config: PetConfig): Promise<void> {
  if (!deps) return
  try {
    const pets = await listPets({ userDataDir: deps.userDataDir(), petdexRoot: deps.petdexRoot() })
    const hasAvailablePet = pets.some(p => p.available)
    const show = shouldShowPet(config, hasAvailablePet)
    if (show && !petWindow) {
      createPetWindow(config)
    } else if (!show && petWindow) {
      destroyPetWindow()
    }
  } catch {
    // best-effort:查询/建窗失败绝不影响应用其余部分
  }
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow
}

/**
 * 全身拖动(Task 9)落点:renderer 侧按 `screenX/screenY - grabDX/DY` 算出窗口应处的
 * 新左上角,主进程只做"夹到目标屏工作区 + setBounds"这一步——目标屏用
 * `screen.getDisplayMatching(当前 bounds)`,允许拖跨屏时夹到指针实际所在的那块屏,
 * 而不是永远夹在窗口拖动前所在的屏。窗口不存在(已被关闭/尚未建好)时静默 no-op。
 */
export function petWindowMoveTo(x: number, y: number): void {
  if (!petWindow) return
  const b = petWindow.getBounds()
  const wa = screen.getDisplayMatching(b).workArea
  const c = clampToDisplay({ x, y, width: b.width, height: b.height }, wa)
  petWindow.setBounds(c)
}

/**
 * 滚轮缩放(Task 9)落点:按新 scale 重新算窗口尺寸,保持当前左上角不动地 resize。
 * resize 后再夹一次目标屏工作区(与 petWindowMoveTo 同一份 clampToDisplay)——
 * 靠近屏幕边缘时放大,右/下边可能因为尺寸变大而越出工作区,需要再夹一次左上角,
 * 否则窗口会被裁到屏外(视觉上像是"放大后卡在边缘")。
 */
export function petWindowResizeToScale(scale: number): void {
  if (!petWindow) return
  const b = petWindow.getBounds()
  const size = scaledPetSize(scale)
  const wa = screen.getDisplayMatching(b).workArea
  const c = clampToDisplay({ x: b.x, y: b.y, ...size }, wa)
  petWindow.setBounds(c)
}

/**
 * 右键菜单"重置位置"(Task 9):按当前 scale 复用 scaledPetSize + defaultPetPosition
 * 算出工作区右下角默认位置(与建窗时首次落位同一套逻辑),夹入工作区后若窗口存在则
 * 立即挪过去。始终返回夹紧后的坐标(即便窗口当前不存在),让调用方可以无条件把它
 * 落盘——避免"宠物窗当前不存在,重置位置就什么都不算"的空转,下次建窗直接读到
 * 这个新默认位置。deps 未装配(理论上不会发生,initPetWindow 总在 app ready 时调用)
 * 时工作区退化为全 0,与其余本文件降级风格一致,不抛异常。
 */
export function petWindowResetPosition(scale: number): { x: number; y: number } {
  const size = scaledPetSize(scale)
  const wa = deps ? deps.primaryWorkArea() : { x: 0, y: 0, width: 0, height: 0 }
  const clamped = clampToDisplay({ ...defaultPetPosition(wa, size), ...size }, wa)
  if (petWindow) petWindow.setBounds(clamped)
  return { x: clamped.x, y: clamped.y }
}

/**
 * `PetMenuItem[]`(shared 纯描述,Task 2)→ Electron `MenuItemConstructorOptions[]`。
 * 纯映射函数,不触碰任何 Electron 运行期 API,只用其类型——可在 vitest 下直接单测
 * (调用返回项的 .click() 断言 onClick 收到的 id)。映射表:
 * `type:'submenu'` → 递归映射 submenu;`type:'checkbox'` → `type:'checkbox'`+`checked`
 * (仍是叶子,也要挂 click);`type:'separator'` → `type:'separator'`(无 click/checked);
 * 其余(无 type)是普通叶子 → 只挂 `click: () => onClick(item.id)`。
 */
export function toElectronMenu(
  items: PetMenuItem[],
  onClick: (id: string) => void
): Electron.MenuItemConstructorOptions[] {
  return items.map((item): Electron.MenuItemConstructorOptions => {
    if (item.type === 'separator') return { type: 'separator' }
    if (item.type === 'submenu') return { label: item.label, submenu: toElectronMenu(item.submenu ?? [], onClick) }
    if (item.type === 'checkbox') {
      return { label: item.label, type: 'checkbox', checked: !!item.checked, click: () => onClick(item.id) }
    }
    return { label: item.label, click: () => onClick(item.id) }
  })
}

/** 推给宠物窗渲染层的 preview payload——与 preload/pet.ts 的 onPreview 回调形状一致。 */
export interface PetPreviewPayload {
  id: string
  previewUrl: string | null
  sprite: PetSprite | null
}

/** 经 pet:config/preview/signal 三个 IPC 频道向宠物窗渲染层推送状态(Task 7)。
 * 全部经同一守卫:窗口存在且未销毁才发,任何异常(含窗口正在被销毁的竞态)静默吞掉——
 * 建模自 pushGateway/pushAutomation(index.ts)的 best-effort 风格,绝不让推送失败影响主进程。 */
function sendToPetWindow(channel: string, payload: unknown): void {
  try {
    const win = getPetWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  } catch {
    // best-effort:窗口可能在发送途中被销毁
  }
}

export function pushPetConfig(config: PetConfig): void {
  sendToPetWindow('pet:config', config)
}

export function pushPetPreview(preview: PetPreviewPayload | null): void {
  sendToPetWindow('pet:preview', preview)
}

export function pushPetSignal(signal: PetStateSignal): void {
  sendToPetWindow('pet:signal', signal)
}
