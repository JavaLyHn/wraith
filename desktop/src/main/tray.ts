/**
 * tray — 系统托盘(主进程)。
 *
 * 仅在用户选「挂后台」时动态创建,真正退出或显示主窗时销毁。
 * 设计与 petWindow 一致:全程 try/catch 吞异常,失败即"无托盘",绝不阻塞应用。
 *
 * 只做三件事:
 *   1. createTray(getWindow): 创建托盘 + 菜单(显示主窗 / 退出)
 *   2. destroyTray(): 销毁托盘
 *   3. 左键单击 = 切换主窗显隐
 *
 * 不持有任何业务状态,不监听后端事件;托盘菜单的"退出"直接 app.quit()。
 */

import { Tray, Menu, app, nativeImage, type BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let tray: Tray | null = null

/** 渲染进程加载完毕后注入主窗引用,用于菜单/左键点击切换显隐。 */
function toggleWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isVisible() && win.isFocused()) {
    win.hide()
  } else {
    win.show()
    win.focus()
  }
}

/** 创建托盘;若已存在则先销毁再创建(配置/图标变化时复用)。 */
export function createTray(getWindow: () => BrowserWindow | null): void {
  if (tray && !tray.isDestroyed()) return
  try {
    const iconPath = resolveTrayIcon()
    const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
    tray = new Tray(icon)
    tray.setToolTip('Wraith')

    const menu = Menu.buildFromTemplate([
      {
        label: '显示主窗',
        click: (): void => {
          const win = getWindow()
          if (!win || win.isDestroyed()) return
          win.show()
          win.focus()
        },
      },
      { type: 'separator' },
      {
        label: '退出 Wraith',
        click: (): void => { app.quit() },
      },
    ])
    tray.setContextMenu(menu)

    tray.on('click', () => { toggleWindow(getWindow()) })
  } catch {
    tray = null
  }
}

/** 销毁托盘(幂等);app.quit 前调用避免残留。 */
export function destroyTray(): void {
  try {
    if (tray && !tray.isDestroyed()) tray.destroy()
  } catch {
    // best-effort
  }
  tray = null
}

/** 返回当前托盘是否存活;用于 will-quit 时判断是否需要清理。 */
export function trayAlive(): boolean {
  return !!tray && !tray.isDestroyed()
}

/** 选托盘图标:优先 16x16 png,失败返回空字符串(让 Tray 用空图标占位)。 */
function resolveTrayIcon(): string {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'tray-icon.png'),
    path.join(__dirname, '..', 'resources', 'tray-icon.png'),
    path.join(__dirname, '..', '..', 'resources', 'tray-icon.png'),
  ]
  // 仅返回第一个存在的;fs 不引入避免循环依赖(主进程已有)
  for (const p of candidates) {
    try {
      // 用 Electron 的 fs 不方便;这里直接 try createFromPath,失败返回空图像
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return p
    } catch {
      // continue
    }
  }
  return ''
}
