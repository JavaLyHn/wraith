import { describe, it, expect } from 'vitest'
// withinWorkspace 会被 fileExplorer.ts 导出;我们只测纯逻辑,所以直接 import named
import { withinWorkspace } from '../src/main/fileExplorer'

/** path.sep 的跨平台结果通过动态 import node:path。 */
import path from 'node:path'

const ROOT_WIN = 'd:\\wraith'
const getWin = () => ROOT_WIN
const ROOT_POSIX = '/home/user/project'
const getPosix = () => ROOT_POSIX

describe('withinWorkspace 路径守卫', () => {
  // Windows 系列
  if (path.sep === '\\') {
    it('正常工作区内文件放行并 normalize', () => {
      expect(withinWorkspace('d:\\wraith\\src\\Foo.java', getWin)).toBe('d:\\wraith\\src\\Foo.java')
      expect(withinWorkspace('d:\\wraith\\src\\.\\Foo.java', getWin)).toBe('d:\\wraith\\src\\Foo.java')
    })
    it('.. 逃逸被拒', () => {
      expect(() => withinWorkspace('d:\\wraith\\..\\other\\x.txt', getWin)).toThrow(/工作区/)
    })
    it('工作区外路径直接拒', () => {
      expect(() => withinWorkspace('d:\\other\\secret.txt', getWin)).toThrow(/工作区/)
    })
    it('root 自身也允许', () => {
      expect(withinWorkspace(ROOT_WIN, getWin)).toBe(ROOT_WIN)
    })
    it('相对路径不允许', () => {
      expect(() => withinWorkspace('src\\Foo.java', getWin)).toThrow(/绝对路径/)
    })
  }

  // POSIX 系列(Windows 上也跑——函数不依赖真实 fs,只依赖 path.normalize 行为)
  it('POSIX 正常路径', () => {
    const input = '/home/user/project/src/a.ts'
    expect(withinWorkspace(input, getPosix)).toBe(path.normalize(input))
  })
  it('POSIX .. 逃逸', () => {
    expect(() => withinWorkspace('/home/user/project/../shadow/x', getPosix)).toThrow(/工作区/)
  })
  it('POSIX 相对路径', () => {
    expect(() => withinWorkspace('src/a.ts', getPosix)).toThrow(/绝对路径/)
  })
})
