import { describe, it, expect } from 'vitest'
// withinWorkspace 会被 fileExplorer.ts 导出;我们只测纯逻辑,所以直接 import named
import { withinWorkspace, assertRealWithin, resolveRealWithin, estimateNodeBytes } from '../src/main/fileExplorer'
import type { FsNode } from '../src/shared/types'

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

describe('assertRealWithin realpath 二次断言', () => {
  if (path.sep === '\\') {
    it('Windows 大小写不敏感: realpath 返回真实大小写仍放行', () => {
      // 用户绑定 root 是小写盘符,realpath 返回大写真实盘符
      expect(assertRealWithin('D:\\Wraith\\src\\A.ts', getWin, true)).toBe('D:\\Wraith\\src\\A.ts')
    })
    it('Windows: symlink 解析到工作区外被拒', () => {
      expect(() => assertRealWithin('C:\\Windows\\system32\\config', getWin, true)).toThrow(/工作区/)
    })
    it('Windows 大小写不影响逃逸判定', () => {
      expect(() => assertRealWithin('D:\\WRAITH_OUTSIDE\\x.txt', getWin, true)).toThrow(/工作区/)
    })
  }
  it('POSIX 严格大小写: 前缀相同但大小写不同视为不同路径', () => {
    expect(() => assertRealWithin('/Home/User/project/x', getPosix, false)).toThrow(/工作区/)
    expect(assertRealWithin('/home/user/project/x', getPosix, false)).toBe(path.normalize('/home/user/project/x'))
  })
  it('POSIX: 深层路径放行', () => {
    expect(assertRealWithin('/home/user/project/a/b/c.txt', getPosix, false)).toBe(path.normalize('/home/user/project/a/b/c.txt'))
  })
})

describe('resolveRealWithin 双道守卫(symlink 逃逸防护)', () => {
  it('realpath 解析回工作区内: 放行并返回真实路径', async () => {
    const fakeReal = async (p: string) => p // 无 symlink 场景: realpath 恒等
    await expect(resolveRealWithin('/home/user/project/src/a.ts', getPosix, fakeReal))
      .resolves.toBe(path.normalize('/home/user/project/src/a.ts'))
  })
  it('realpath 解析到工作区外(symlink 指向外部): 拒绝', async () => {
    // workspace 内的合法静态路径,realpath 揭示它其实指向 /etc/passwd
    const fakeReal = async () => '/etc/passwd'
    await expect(resolveRealWithin('/home/user/project/link.txt', getPosix, fakeReal))
      .rejects.toThrow(/工作区/)
  })
  it('realpath 返回 workspace 根自身(symlink 指回根): 放行', async () => {
    // fs.realpath 一次调用即解析完整条链,这里模拟链最终落点 === root
    const fakeReal = async () => '/home/user/project'
    await expect(resolveRealWithin('/home/user/project/self-link', getPosix, fakeReal))
      .resolves.toBe(path.normalize('/home/user/project'))
  })
  it('静态校验先行: 相对路径在 realpath 之前就被拒', async () => {
    const fakeReal = async (p: string) => p
    await expect(resolveRealWithin('project/a.ts', getPosix, fakeReal))
      .rejects.toThrow(/绝对路径/)
  })
})

describe('estimateNodeBytes 节点体积估算', () => {
  const mk = (p: string, parent: string, name: string): FsNode =>
    ({ path: p, parentPath: parent, name, kind: 'file' })
  it('path/name/parentPath 三个字符串都计入', () => {
    const n = mk('/home/user/project/src/a.ts', '/home/user/project/src', 'a.ts')
    // (26 + 23 + 4) * 2 + 96 = 176
    expect(estimateNodeBytes(n)).toBe((26 + 23 + 4) * 2 + 96)
  })
  it('envelope 覆盖 JSON 结构 + V8 对象头(mtime/size 数字序列化)', () => {
    const n = mk('x', '', 'x')
    expect(estimateNodeBytes(n)).toBeGreaterThanOrEqual(96)
  })
  it('长 parentPath 与长 path 同等计费(之前漏算 parentPath 的回归守卫)', () => {
    const shortParent = mk('/a/b/c.txt', '', 'c.txt')
    const longParent = mk('/a/b/c.txt', '/very/long/parent/directory/path/here', 'c.txt')
    expect(estimateNodeBytes(longParent)).toBeGreaterThan(estimateNodeBytes(shortParent))
  })
})
