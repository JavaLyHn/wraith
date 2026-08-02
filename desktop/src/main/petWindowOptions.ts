import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * 桌宠窗口的 BrowserWindow 构造选项(纯函数,便于按平台单测)。
 * darwin 用 NSPanel(type:'panel',nonactivating:点击/拖动不抢焦);其余平台不传
 * type(避免落到未知窗口类型)。focusable:false + 调用方的 setIgnoreMouseEvents 提供
 * 跨平台的"点击穿透/不抢焦"近似;Windows 的完全对等(WS_EX_NOACTIVATE + 跨虚拟桌面)
 * 留给块 5 的原生插件。
 *
 * <b>movable / resizable 都必须是 true</b>,尽管这是一个无边框、用户拖不到窗框的窗:
 * Electron 把这两个标记同时当成**程序化 setBounds 的闸门**——
 * `resizable:false` 会静默吞掉尺寸变更(滚轮缩放失灵),
 * `movable:false` 在 **Windows** 上会静默吞掉位置变更(桌宠完全拖不动;
 * mac 不受影响,所以这半边一直没被发现)。桌宠的位置与尺寸 100% 由
 * pointermove → IPC → setBounds 驱动,渲染层没有任何 `-webkit-app-region: drag`,
 * 所以这两个 false 从来没挡住过用户,只挡住了我们自己。
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
    resizable: true, movable: true, skipTaskbar: true, focusable: false, fullscreenable: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: preloadPath },
  }
}
