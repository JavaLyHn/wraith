/**
 * Unit tests for main/settings.ts closeMode 读写 —— 纯 fs,无 Electron。
 * 用临时目录作为 fake userData。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readCloseMode,
  writeCloseMode,
  readSettings,
  writeSettings,
  settingsPath,
} from '../src/main/settings'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-closemode-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('readCloseMode', () => {
  it('缺失 closeMode 时回落 ask', () => {
    expect(readCloseMode(dir)).toBe('ask')
  })

  it('非法值回落 ask', () => {
    writeSettings(dir, { closeMode: 'whatever' as never })
    expect(readCloseMode(dir)).toBe('ask')
  })

  it('非字符串值回落 ask', () => {
    writeSettings(dir, { closeMode: 42 as never })
    expect(readCloseMode(dir)).toBe('ask')
  })

  it('合法值原样返回', () => {
    writeSettings(dir, { closeMode: 'background' })
    expect(readCloseMode(dir)).toBe('background')
    writeSettings(dir, { closeMode: 'quit' })
    expect(readCloseMode(dir)).toBe('quit')
    writeSettings(dir, { closeMode: 'ask' })
    expect(readCloseMode(dir)).toBe('ask')
  })

  it('坏 JSON 回落 ask', () => {
    fs.writeFileSync(settingsPath(dir), 'not json', 'utf8')
    expect(readCloseMode(dir)).toBe('ask')
  })
})

describe('writeCloseMode', () => {
  it('写入后可读回', () => {
    writeCloseMode(dir, 'background')
    expect(readCloseMode(dir)).toBe('background')
    writeCloseMode(dir, 'quit')
    expect(readCloseMode(dir)).toBe('quit')
    writeCloseMode(dir, 'ask')
    expect(readCloseMode(dir)).toBe('ask')
  })

  it('非法值落回 ask', () => {
    writeCloseMode(dir, 'nonsense' as never)
    expect(readCloseMode(dir)).toBe('ask')
  })

  it('保留其他 settings 键', () => {
    writeSettings(dir, { workspace: '/my/ws', projects: [{ path: '/p', lastUsedAt: 1 }] })
    writeCloseMode(dir, 'background')
    const s = readSettings(dir)
    expect(s.workspace).toBe('/my/ws')
    expect(s.projects).toEqual([{ path: '/p', lastUsedAt: 1 }])
    expect(s.closeMode).toBe('background')
  })

  it('覆盖已有 closeMode', () => {
    writeCloseMode(dir, 'background')
    expect(readCloseMode(dir)).toBe('background')
    writeCloseMode(dir, 'quit')
    expect(readCloseMode(dir)).toBe('quit')
    // 重置回 ask
    writeCloseMode(dir, 'ask')
    expect(readCloseMode(dir)).toBe('ask')
  })
})
