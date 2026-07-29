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
    expect(o.focusable).toBe(false)
    expect(o.skipTaskbar).toBe(true)
    expect(o.show).toBe(false)
    expect(o.webPreferences.preload).toBe('/p/preload.js')
    expect(o.webPreferences.contextIsolation).toBe(true)
    expect(o.webPreferences.nodeIntegration).toBe(false)
  })
})
