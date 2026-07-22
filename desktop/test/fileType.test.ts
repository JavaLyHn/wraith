import { describe, it, expect } from 'vitest'
import { fileTypeLabel } from '../src/renderer/lib/fileType'
import { resolveWorkspacePath } from '../src/renderer/lib/paths'

describe('fileTypeLabel', () => {
  it('文档', () => { expect(fileTypeLabel('a/README.md')).toBe('文档 · MD'); expect(fileTypeLabel('x.txt')).toBe('文档 · TXT') })
  it('代码', () => { expect(fileTypeLabel('src/a.ts')).toBe('代码 · TS'); expect(fileTypeLabel('m.py')).toBe('代码 · PY') })
  it('配置', () => expect(fileTypeLabel('pkg.json')).toBe('配置 · JSON'))
  it('样式', () => expect(fileTypeLabel('a.css')).toBe('样式 · CSS'))
  it('未知扩展 → 文件 · EXT', () => expect(fileTypeLabel('a.xyz')).toBe('文件 · XYZ'))
  it('无扩展 → 文件', () => { expect(fileTypeLabel('Makefile')).toBe('文件'); expect(fileTypeLabel('.env')).toBe('文件') })
})

describe('resolveWorkspacePath', () => {
  it('相对 + workspace 拼绝对', () => expect(resolveWorkspacePath('a/b.ts', '/proj')).toBe('/proj/a/b.ts'))
  it('workspace 尾斜杠归一', () => expect(resolveWorkspacePath('b.ts', '/proj/')).toBe('/proj/b.ts'))
  it('绝对路径原样', () => expect(resolveWorkspacePath('/abs/x', '/proj')).toBe('/abs/x'))
  it('无 workspace → 原样', () => expect(resolveWorkspacePath('b.ts', null)).toBe('b.ts'))
})
