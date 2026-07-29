import type { BrowserWindow } from 'electron'

/** WS_EX_NOACTIVATE:窗口不因点击而被激活(不抢焦)。GWL_EXSTYLE:扩展样式索引。 */
export const WS_EX_NOACTIVATE = 0x08000000
export const GWL_EXSTYLE = -20

/** 在既有扩展样式上置 WS_EX_NOACTIVATE(幂等、保留其它位;>>>0 归一为无符号 32 位)。纯函数。 */
export function withNoActivate(exStyle: number): number {
  return (exStyle | WS_EX_NOACTIVATE) >>> 0
}

/**
 * Windows:给桌宠窗 HWND 加 WS_EX_NOACTIVATE,精确实现"点击不抢焦"。
 * 仅 win32;非 win32 直接 no-op。全程 try/catch:koffi 缺失/加载失败/FFI 出错都静默降级
 * (退回 petWindowOptions 的 focusable:false 兜底),绝不抛、不阻塞桌宠。
 * ⚠ koffi 类型声明/HWND 读法为最佳努力、未在 Windows 实测;实机若不符按 koffi 当前 API 微调。
 * 仅 x64 精确;32 位 Windows(ia32)上 GetWindowLongPtrW 符号/8 字节 HWND 读法不适用,会被 try/catch 兜住、自动降级 focusable:false(不崩)。
 */
export function applyNoActivate(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  try {
    // lazy:只在 win32 加载,避免 mac 加载 + 缺失时被 catch。electron-vite 为 ESM 主进程注入 createRequire(import.meta.url) 垫片,故 require 可用(非 CJS)。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    // LONG_PTR/HWND 在 x64 为 64 位;用 uintptr_t/intptr_t 承载,BigInt 传递。
    const GetWindowLongPtrW = user32.func('__stdcall', 'GetWindowLongPtrW', 'intptr_t', ['uintptr_t', 'int'])
    const SetWindowLongPtrW = user32.func('__stdcall', 'SetWindowLongPtrW', 'intptr_t', ['uintptr_t', 'int', 'intptr_t'])
    const buf = win.getNativeWindowHandle()
    const hwnd = buf.readBigUInt64LE(0) // x64:Buffer 的 8 字节即 HWND 指针值
    const cur = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE))
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, BigInt(withNoActivate(cur)))
  } catch (e) {
    // 降级:保留 focusable:false 兜底,不抛。
    console.warn('[pet] applyNoActivate 失败,降级 focusable:false:', (e as Error)?.message)
  }
}
