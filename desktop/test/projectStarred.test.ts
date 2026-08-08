import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSettings, writeSettings, setProjectStarred, projectViews } from '../src/main/settings'

let ud: string

beforeEach(() => {
  ud = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-settings-'))
})

afterEach(() => {
  fs.rmSync(ud, { recursive: true, force: true })
})

describe('setProjectStarred', () => {
  it('把指定项目标为重点', () => {
    writeSettings(ud, { projects: [{ path: '/a', lastUsedAt: 1 }, { path: '/b', lastUsedAt: 2 }] })

    setProjectStarred(ud, '/a', true)

    const projects = readSettings(ud).projects ?? []
    expect(projects.find(p => p.path === '/a')?.starred).toBe(true)
    expect(projects.find(p => p.path === '/b')?.starred).toBeUndefined()
  })

  it('取消重点时删掉这个键,不写 false', () => {
    writeSettings(ud, { projects: [{ path: '/a', lastUsedAt: 1, starred: true }] })

    setProjectStarred(ud, '/a', false)

    const entry = (readSettings(ud).projects ?? [])[0]!
    expect('starred' in entry).toBe(false)
  })

  it('路径不匹配时不改任何条目', () => {
    writeSettings(ud, { projects: [{ path: '/a', lastUsedAt: 1 }] })

    setProjectStarred(ud, '/nope', true)

    expect((readSettings(ud).projects ?? [])[0]?.starred).toBeUndefined()
  })

  it('projectViews 带出 starred', () => {
    writeSettings(ud, { projects: [{ path: ud, lastUsedAt: 1, starred: true }] })

    const views = projectViews(ud)

    expect(views[0]?.starred).toBe(true)
    expect(views[0]?.exists).toBe(true)
  })
})
