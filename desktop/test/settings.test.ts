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
  upsertProject,
  removeProject,
  renameProject,
  projectViews,
  seedProjectsIfEmpty,
  seedProjectsFromJson,
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

describe('projects', () => {
  it('upsertProject appends new entry with lastUsedAt', () => {
    upsertProject(dir, '/proj/a', 1000)
    expect(readSettings(dir).projects).toEqual([{ path: '/proj/a', lastUsedAt: 1000 }])
  })

  it('upsertProject dedupes by path, refreshes lastUsedAt, keeps name', () => {
    upsertProject(dir, '/proj/a', 1000)
    renameProject(dir, '/proj/a', '别名')
    upsertProject(dir, '/proj/a', 2000)
    expect(readSettings(dir).projects).toEqual([{ path: '/proj/a', name: '别名', lastUsedAt: 2000 }])
  })

  it('upsertProject preserves other settings keys', () => {
    persistWorkspace(dir, '/ws')
    upsertProject(dir, '/proj/a', 1000)
    expect(readSettings(dir).workspace).toBe('/ws')
  })

  it('removeProject removes only the matching path', () => {
    upsertProject(dir, '/proj/a', 1000)
    upsertProject(dir, '/proj/b', 2000)
    removeProject(dir, '/proj/a')
    expect(readSettings(dir).projects).toEqual([{ path: '/proj/b', lastUsedAt: 2000 }])
  })

  it('renameProject trims; empty string clears the alias', () => {
    upsertProject(dir, '/proj/a', 1000)
    renameProject(dir, '/proj/a', '  博客  ')
    expect(readSettings(dir).projects![0]!.name).toBe('博客')
    renameProject(dir, '/proj/a', '   ')
    expect(readSettings(dir).projects![0]!.name).toBeUndefined()
  })

  it('projectViews sorts by lastUsedAt desc and marks exists', () => {
    upsertProject(dir, path.join(dir, 'gone'), 1000) // 不存在
    upsertProject(dir, dir, 500) // 存在(临时目录本身)
    const views = projectViews(dir)
    expect(views.map(v => v.path)).toEqual([path.join(dir, 'gone'), dir])
    expect(views[0]!.exists).toBe(false)
    expect(views[1]!.exists).toBe(true)
  })

  it('seedProjectsIfEmpty seeds from valid persisted workspace once', () => {
    persistWorkspace(dir, dir)
    seedProjectsIfEmpty(dir, 1000)
    expect(readSettings(dir).projects).toEqual([{ path: dir, lastUsedAt: 1000 }])
    seedProjectsIfEmpty(dir, 2000) // 已非空 → 不重播
    expect(readSettings(dir).projects![0]!.lastUsedAt).toBe(1000)
  })

  it('seedProjectsIfEmpty does nothing when workspace invalid or absent', () => {
    seedProjectsIfEmpty(dir, 1000)
    expect(readSettings(dir).projects ?? []).toEqual([])
    persistWorkspace(dir, path.join(dir, 'gone'))
    seedProjectsIfEmpty(dir, 1000)
    expect(readSettings(dir).projects ?? []).toEqual([])
  })

  it('seedProjectsFromJson overwrites projects; bad JSON / non-array is a no-op', () => {
    upsertProject(dir, '/old', 1)
    seedProjectsFromJson(dir, JSON.stringify([{ path: '/a', lastUsedAt: 9 }, { path: '/b', name: 'B' }]), 100)
    const ps = readSettings(dir).projects!
    expect(ps[0]).toEqual({ path: '/a', lastUsedAt: 9 })
    expect(ps[1]!.path).toBe('/b')
    expect(ps[1]!.name).toBe('B')
    expect(typeof ps[1]!.lastUsedAt).toBe('number')
    seedProjectsFromJson(dir, 'not json', 200)
    expect(readSettings(dir).projects!.length).toBe(2) // 未被清掉
    seedProjectsFromJson(dir, '{"x":1}', 300)
    expect(readSettings(dir).projects!.length).toBe(2)
  })
})
