import { describe, it, expect } from 'vitest'
import { resolveWorkspacePath } from '../src/renderer/lib/paths'

// resolveWorkspacePath 供 OpenWithMenu(打开方式)与 App.handleUndo(撤销写回)拼绝对路径用。
// 此前覆盖误随 fileType.test.ts(fileTypeLabel 已随统一卡移除而删)一起删掉,单独保留。
describe('resolveWorkspacePath', () => {
  it('相对 + workspace 拼绝对', () => expect(resolveWorkspacePath('a/b.ts', '/proj')).toBe('/proj/a/b.ts'))
  it('workspace 尾斜杠归一', () => expect(resolveWorkspacePath('b.ts', '/proj/')).toBe('/proj/b.ts'))
  it('绝对路径原样', () => expect(resolveWorkspacePath('/abs/x', '/proj')).toBe('/abs/x'))
  it('无 workspace → 原样', () => expect(resolveWorkspacePath('b.ts', null)).toBe('b.ts'))
})
