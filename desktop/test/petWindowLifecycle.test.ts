import { describe, it, expect, vi } from 'vitest'
import { petHtmlTarget, toElectronMenu } from '../src/main/petWindow'
import type { PetMenuItem } from '../src/shared/petWindow'

describe('petHtmlTarget', () => {
  it('dev 用 ELECTRON_RENDERER_URL/pet.html,prod 用 file', () => {
    expect(petHtmlTarget('http://localhost:5873', '/x/out/main')).toEqual({ url: 'http://localhost:5873/pet.html' })
    expect(petHtmlTarget(undefined, '/x/out/main')).toEqual({ file: '/x/out/renderer/pet.html' })
  })

  it('去掉 URL 尾部斜杠再拼接,不产生双斜杠', () => {
    expect(petHtmlTarget('http://localhost:5873/', '/x/out/main')).toEqual({ url: 'http://localhost:5873/pet.html' })
  })
})

describe('toElectronMenu', () => {
  const items: PetMenuItem[] = [
    { id: 'pet:select', label: '选择宠物', type: 'submenu', submenu: [
      { id: 'pet:select:a', label: 'A', type: 'checkbox', checked: true },
      { id: 'pet:select:b', label: 'B', type: 'checkbox', checked: false },
    ] },
    { id: 'sep', label: '', type: 'separator' },
    { id: 'pet:close', label: '关闭宠物' },
  ]

  it('submenu 递归映射为 submenu 数组', () => {
    const [select] = toElectronMenu(items, () => {})
    expect(select!.label).toBe('选择宠物')
    expect(Array.isArray(select!.submenu)).toBe(true)
    expect(select!.submenu).toHaveLength(2)
  })

  it('checkbox 映射 type:checkbox + checked', () => {
    const [select] = toElectronMenu(items, () => {})
    const [a, b] = select!.submenu as Electron.MenuItemConstructorOptions[]
    expect(a!.type).toBe('checkbox')
    expect(a!.checked).toBe(true)
    expect(b!.type).toBe('checkbox')
    expect(b!.checked).toBe(false)
  })

  it('separator 映射为 type:separator', () => {
    const [, sep] = toElectronMenu(items, () => {})
    expect(sep!.type).toBe('separator')
  })

  it('叶子节点的 click 回调携带正确的 item.id', () => {
    const onClick = vi.fn()
    const [, , close] = toElectronMenu(items, onClick)
    expect(typeof close!.click).toBe('function')
    ;(close!.click as () => void)()
    expect(onClick).toHaveBeenCalledWith('pet:close')
  })

  it('checkbox 叶子的 click 回调也携带正确的 item.id', () => {
    const onClick = vi.fn()
    const [select] = toElectronMenu(items, onClick)
    const [a] = select!.submenu as Electron.MenuItemConstructorOptions[]
    ;(a!.click as () => void)()
    expect(onClick).toHaveBeenCalledWith('pet:select:a')
  })
})
