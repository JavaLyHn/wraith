import { describe, it, expect } from 'vitest'
import { detectEditors, uniqueDownloadName } from '../src/main/fileOpen'

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
