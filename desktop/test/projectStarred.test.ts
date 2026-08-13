import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSettings, writeSettings, setProjectStarred, projectViews, reorderProject } from '../src/main/settings'

let ud: string

beforeEach(() => {
  ud = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-settings-'))
})

afterEach(() => {
  fs.rmSync(ud, { recursive: true, force: true })
})

describe('setProjectStarred', () => {
  it('marks the selected project', () => {
    writeSettings(ud, { projects: [{ path: '/a', lastUsedAt: 1 }, { path: '/b', lastUsedAt: 2 }] })
    setProjectStarred(ud, '/a', true)
    expect(readSettings(ud).projects?.find(p => p.path === '/a')?.starred).toBe(true)
    expect(readSettings(ud).projects?.find(p => p.path === '/b')?.starred).toBeUndefined()
  })

  it('removes starred instead of persisting false', () => {
    writeSettings(ud, { projects: [{ path: '/a', lastUsedAt: 1, starred: true }] })
    setProjectStarred(ud, '/a', false)
    expect('starred' in (readSettings(ud).projects ?? [])[0]!).toBe(false)
  })

  it('does not change an unmatched project', () => {
    writeSettings(ud, { projects: [{ path: '/a', lastUsedAt: 1 }] })
    setProjectStarred(ud, '/nope', true)
    expect(readSettings(ud).projects).toEqual([{ path: '/a', lastUsedAt: 1 }])
  })

  it('projectViews includes starred and exists', () => {
    writeSettings(ud, { projects: [{ path: ud, lastUsedAt: 1, starred: true }] })
    expect(projectViews(ud)[0]).toMatchObject({ starred: true, exists: true })
  })

  it('starring appends to starred group and un-starring appends to rest group', () => {
    writeSettings(ud, { projects: [
      { path: '/a', lastUsedAt: 1, order: 0 },
      { path: '/b', lastUsedAt: 2, order: 1, starred: true },
      { path: '/c', lastUsedAt: 3, order: 2, starred: true },
    ] })
    setProjectStarred(ud, '/a', true)
    expect(readSettings(ud).projects?.find(p => p.path === '/a')?.order).toBe(2)
    setProjectStarred(ud, '/b', false)
    expect(readSettings(ud).projects?.find(p => p.path === '/b')?.order).toBe(0)
  })

  it('reorderProject only reorders one group and preserves other fields', () => {
    writeSettings(ud, { projects: [
      { path: '/a', lastUsedAt: 1, order: 0 },
      { path: '/b', lastUsedAt: 2, order: 1 },
      { path: '/s', lastUsedAt: 3, order: 0, starred: true, name: '重点' },
    ] })
    reorderProject(ud, '/a', 1)
    const ps = readSettings(ud).projects ?? []
    expect(ps.find(p => p.path === '/a')?.order).toBe(1)
    expect(ps.find(p => p.path === '/b')?.order).toBe(0)
    expect(ps.find(p => p.path === '/s')).toEqual({ path: '/s', lastUsedAt: 3, order: 0, starred: true, name: '重点' })
  })
})
