import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * 桌宠窗口的 BrowserWindow 构造选项(纯函数,便于按平台单测)。
 * darwin 用 NSPanel(type:'panel',nonactivating:点击/拖动不抢焦);其余平台不传
 * type(避免落到未知窗口类型)。focusable:false + 调用方的 setIgnoreMouseEvents 提供
 * 跨平台的"点击穿透/不抢焦"近似;Windows 的完全对等(WS_EX_NOACTIVATE + 跨虚拟桌面)
 * 留给块 5 的原生插件。
 */
export function petWindowOptions(
  platform: NodeJS.Platform,
  bounds: { x: number; y: number; width: number; height: number },
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    ...(platform === 'darwin' ? { type: 'panel' as const } : {}),
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: true, movable: false, skipTaskbar: true, focusable: false, fullscreenable: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: preloadPath },
  }
}
