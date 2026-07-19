import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PET_CONFIG, normalizePetConfig, readPetConfig, writePetConfig } from '../src/main/settings'

describe('normalizePetConfig', () => {
  it('缺失/非法字段回落默认', () => {
    expect(normalizePetConfig({})).toEqual(DEFAULT_PET_CONFIG)
    expect(normalizePetConfig({ scale: 9, motion: 'nope', enabled: 'x', selectedId: 1, position: { x: 'a', y: 2 } }))
      .toEqual(DEFAULT_PET_CONFIG)
  })
  it('缩放夹到 [0.5,2.0],合法值保留', () => {
    expect(normalizePetConfig({ scale: 0.4 }).scale).toBe(DEFAULT_PET_CONFIG.scale)
    expect(normalizePetConfig({ scale: 2.5 }).scale).toBe(DEFAULT_PET_CONFIG.scale)
    expect(normalizePetConfig({ scale: 1.75 }).scale).toBe(1.75)
  })
  it('position 接受有限屏幕坐标或 null', () => {
    expect(normalizePetConfig({ position: { x: 1200, y: 40 } }).position).toEqual({ x: 1200, y: 40 })
    expect(normalizePetConfig({ position: { x: Infinity, y: 0 } }).position).toBeNull()
  })
})

describe('readPetConfig / writePetConfig', () => {
  it('写入后读回一致,patch 合并保留其余键', () => {
    const dir = mkdtempSync(join(tmpdir(), 'petcfg-'))
    writePetConfig(dir, { selectedId: 'noir-webling', scale: 1.5 })
    const after = writePetConfig(dir, { enabled: false })
    expect(after).toMatchObject({ enabled: false, selectedId: 'noir-webling', scale: 1.5 })
    expect(readPetConfig(dir)).toEqual(after)
  })
  it('无文件时返回默认', () => {
    const dir = mkdtempSync(join(tmpdir(), 'petcfg-'))
    expect(readPetConfig(dir)).toEqual(DEFAULT_PET_CONFIG)
  })
})
