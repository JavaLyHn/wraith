/**
 * Unit tests for main/settings.ts — pure fs helpers, no Electron.
 * Uses a temp dir as the fake userData directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readSettings,
  writeSettings,
  settingsPath,
  resolvePersistedWorkspace,
  persistWorkspace,
} from '../src/main/settings'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-settings-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('settings', () => {
  it('readSettings returns {} when file missing', () => {
    expect(readSettings(dir)).toEqual({})
  })

  it('readSettings returns {} on malformed JSON', () => {
    fs.writeFileSync(settingsPath(dir), 'not json', 'utf8')
    expect(readSettings(dir)).toEqual({})
  })

  it('write then read round-trips', () => {
    writeSettings(dir, { workspace: '/some/dir' })
    expect(readSettings(dir)).toEqual({ workspace: '/some/dir' })
  })

  it('persistWorkspace preserves other keys', () => {
    writeSettings(dir, { workspace: '/old' })
    persistWorkspace(dir, '/new')
    expect(readSettings(dir).workspace).toBe('/new')
  })

  it('resolvePersistedWorkspace returns the dir when it exists and is a directory', () => {
    persistWorkspace(dir, dir) // dir itself is a valid directory
    expect(resolvePersistedWorkspace(dir)).toBe(dir)
  })

  it('resolvePersistedWorkspace returns null when persisted path does not exist', () => {
    persistWorkspace(dir, path.join(dir, 'gone'))
    expect(resolvePersistedWorkspace(dir)).toBeNull()
  })

  it('resolvePersistedWorkspace returns null when persisted path is a file, not a dir', () => {
    const file = path.join(dir, 'afile')
    fs.writeFileSync(file, 'x', 'utf8')
    persistWorkspace(dir, file)
    expect(resolvePersistedWorkspace(dir)).toBeNull()
  })

  it('resolvePersistedWorkspace returns null when no workspace persisted', () => {
    writeSettings(dir, {})
    expect(resolvePersistedWorkspace(dir)).toBeNull()
  })
})
