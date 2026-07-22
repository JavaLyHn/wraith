import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectEditors, uniqueDownloadName, isPathWithinWorkspace, performUndo } from '../src/main/fileOpen'

describe('detectEditors', () => {
  it('只返回已知已装项,按表序,appPath 正确', () => {
    const paths = [
      '/Applications/Visual Studio Code.app',
      '/Applications/Xcode.app',
      '/Applications/Unknown.app',
      '/Users/x/Applications/Zed.app',
    ]
    expect(detectEditors(paths)).toEqual([
      { name: 'VS Code', appPath: '/Applications/Visual Studio Code.app' },
      { name: 'Xcode', appPath: '/Applications/Xcode.app' },
      { name: 'Zed', appPath: '/Users/x/Applications/Zed.app' },
    ])
  })
  it('空列表 → 空', () => expect(detectEditors([])).toEqual([]))
  it('同名多份取首个(去重)', () => {
    expect(detectEditors(['/Applications/Terminal.app', '/Users/x/Applications/Terminal.app']))
      .toEqual([{ name: 'Terminal', appPath: '/Applications/Terminal.app' }])
  })
})

describe('uniqueDownloadName', () => {
  it('无冲突原样', () => expect(uniqueDownloadName(new Set(), 'a.md')).toBe('a.md'))
  it('冲突 → (2)', () => expect(uniqueDownloadName(new Set(['a.md']), 'a.md')).toBe('a (2).md'))
  it('多次冲突递增', () => expect(uniqueDownloadName(new Set(['a.md', 'a (2).md']), 'a.md')).toBe('a (3).md'))
  it('无扩展名也正确', () => expect(uniqueDownloadName(new Set(['README']), 'README')).toBe('README (2)'))
})

describe('isPathWithinWorkspace', () => {
  it('工作区内文件 → true', () => {
    expect(isPathWithinWorkspace('/proj/src/a.ts', '/proj')).toBe(true)
  })
  it('工作区自身 → true', () => {
    expect(isPathWithinWorkspace('/proj', '/proj')).toBe(true)
  })
  it('../ 逃逸 → false', () => {
    expect(isPathWithinWorkspace('/proj/../etc/passwd', '/proj')).toBe(false)
  })
  it('完全在外 → false', () => {
    expect(isPathWithinWorkspace('/other/x', '/proj')).toBe(false)
  })
  it('workspace 为空 → false', () => {
    expect(isPathWithinWorkspace('/proj/a', '')).toBe(false)
  })
})

describe('performUndo', () => {
  const mk = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-undo-'))

  it('modified → 写回 before', async () => {
    const ws = mk(); const f = path.join(ws, 'a.md')
    fs.writeFileSync(f, '新内容')
    const r = await performUndo({ workspace: ws, path: f, before: '旧内容', kind: 'modified' })
    expect(r.ok).toBe(true)
    expect(fs.readFileSync(f, 'utf8')).toBe('旧内容')
  })

  it('created → 删除文件', async () => {
    const ws = mk(); const f = path.join(ws, 'new.md')
    fs.writeFileSync(f, 'x')
    const r = await performUndo({ workspace: ws, path: f, before: '', kind: 'created' })
    expect(r.ok).toBe(true)
    expect(fs.existsSync(f)).toBe(false)
  })

  it('越界路径 → ok:false 且不动手', async () => {
    const ws = mk()
    const outside = path.join(os.tmpdir(), 'wraith-outside.md')
    fs.writeFileSync(outside, 'keep')
    const r = await performUndo({ workspace: ws, path: outside, before: 'x', kind: 'modified' })
    expect(r.ok).toBe(false)
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep')
  })

  it('workspace 为空 → ok:false', async () => {
    const r = await performUndo({ workspace: null, path: '/x', before: '', kind: 'modified' })
    expect(r.ok).toBe(false)
  })

  it('before 超 5MB → ok:false', async () => {
    const ws = mk(); const f = path.join(ws, 'big.txt')
    fs.writeFileSync(f, 'small')
    const r = await performUndo({ workspace: ws, path: f, before: 'a'.repeat(5 * 1024 * 1024 + 1), kind: 'modified' })
    expect(r.ok).toBe(false)
  })
})
