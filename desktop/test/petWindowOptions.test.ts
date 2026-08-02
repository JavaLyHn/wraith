import { describe, it, expect } from 'vitest'
import { petWindowOptions } from '../src/main/petWindowOptions'

const B = { x: 10, y: 20, width: 200, height: 200 }

describe('petWindowOptions', () => {
  it('darwin 含 type:panel', () => {
    const o = petWindowOptions('darwin', B, '/p/preload.js') as Record<string, unknown>
    expect(o.type).toBe('panel')
  })
  it('win32 不含 type', () => {
    const o = petWindowOptions('win32', B, '/p/preload.js') as Record<string, unknown>
    expect('type' in o).toBe(false)
  })
  it('linux 不含 type', () => {
    const o = petWindowOptions('linux', B, '/p/preload.js') as Record<string, unknown>
    expect('type' in o).toBe(false)
  })
  it('公共字段与 bounds/preload 恒定', () => {
    const o = petWindowOptions('win32', B, '/p/preload.js') as any
    expect(o.x).toBe(10); expect(o.width).toBe(200)
    expect(o.frame).toBe(false)
    expect(o.transparent).toBe(true)
    expect(o.backgroundColor).toBe('#00000000')
    expect(o.hasShadow).toBe(false)
    expect(o.focusable).toBe(false)
    expect(o.skipTaskbar).toBe(true)
    expect(o.show).toBe(false)
    expect(o.webPreferences.preload).toBe('/p/preload.js')
    expect(o.webPreferences.contextIsolation).toBe(true)
    expect(o.webPreferences.nodeIntegration).toBe(false)
  })
})

/**
 * 桌宠在 Windows 上**完全拖不动**(右键菜单正常 → 说明鼠标事件收得到、渲染层
 * 的 pointer 链路是通的,断在最后一步 setBounds)。
 *
 * 根因是构造选项里的 `movable: false`,以及旁边那句注释:
 *
 *   > movable 维持 false 不受影响(setBounds 移动窗口本就不受 movable 限制)
 *
 * **那句只在 macOS 上成立。** Windows 上 Electron 会在 `WM_WINDOWPOSCHANGING`
 * 里对不可移动的窗口补 `SWP_NOMOVE`,于是**每一次程序化移动都被静默吞掉** ——
 * 不报错、不抛异常,窗口就是不动。
 *
 * 佐证就在同一个文件里:`resizable` 已经被迫从 false 改成 true,理由是
 * 「resizable:false 会让 setBounds 的**尺寸**变更被静默 no-op」。同一个闸门的
 * 两半,尺寸那半在 mac 上也咬人所以早修了,位置这半 mac 不咬,就留到了 Windows。
 *
 * 桌宠窗是无边框 + 透明的,渲染层也没有任何 `-webkit-app-region: drag` 区域,
 * 位置**全部**由 pointermove → IPC → setBounds 驱动。所以 `movable:false`
 * 从来没提供过任何保护,只挡住了自己人。
 */
describe('movable —— Windows 拖不动的根因', () => {
  it('三个平台一律 movable:true', () => {
    for (const p of ['darwin', 'win32', 'linux'] as const) {
      const o = petWindowOptions(p, B, '/p/preload.js') as Record<string, unknown>
      expect(o.movable, `${p} 上 movable:false 会让 setBounds 的移动被静默吞掉`).toBe(true)
    }
  })

  it('resizable 也保持 true —— 同一个闸门的另一半(滚轮缩放靠它)', () => {
    for (const p of ['darwin', 'win32', 'linux'] as const) {
      const o = petWindowOptions(p, B, '/p/preload.js') as Record<string, unknown>
      expect(o.resizable).toBe(true)
    }
  })

  it('仍然无边框 —— movable:true 不会给用户多出一块可拖的窗框', () => {
    const o = petWindowOptions('win32', B, '/p/preload.js') as Record<string, unknown>
    expect(o.frame).toBe(false)
    expect(o.transparent).toBe(true)
  })
})
