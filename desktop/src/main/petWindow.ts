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

import { BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { shouldShowPet, defaultPetPosition, clampToDisplay, type Box } from '../shared/petWindow'
import { listPets } from './petStore'
import type { PetConfig } from './settings'

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
  try {
    const size = scaledPetSize(config.scale)
    const wa = deps.primaryWorkArea()
    const pos = config.position ?? defaultPetPosition(wa, size)
    const b = clampToDisplay({ ...pos, ...size }, wa)
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, skipTaskbar: true, focusable: false, fullscreenable: false,
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
      if (!win.isDestroyed()) win.show()
    })
    win.on('closed', () => {
      petWindow = null
    })
  } catch {
    // 建窗失败:降级为无桌宠,绝不阻塞应用其余部分
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
