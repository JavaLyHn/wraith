import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * 主窗的平台相关 BrowserWindow 选项片段(纯函数,便于按平台单测)。
 * darwin:隐藏标题栏 + 交通灯 + vibrancy(与原内联字面量逐字段等价,勿改)。
 * win32:无边框(frame:false),窗控由渲染层 WindowControls 自绘。不设 transparent——
 *   Windows 无 vibrancy,且窗本就 show:false + ready-to-show + splash 兜白闪。
 * 其它平台(linux 等):空,保持系统标准窗框。
 */
export function mainWindowChrome(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 11 },
      vibrancy: 'fullscreen-ui',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    }
  }
  if (platform === 'win32') return { frame: false }
  return {}
}
