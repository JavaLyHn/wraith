import { describe, it, expect } from 'vitest'
import { previewKind, MAX_TEXT_BYTES } from '../src/renderer/lib/filePreviewKind'

describe('previewKind 扩展名识别', () => {
  it('代码类扩展名', () => {
    expect(previewKind('Foo.java')).toBe('code')
    expect(previewKind('bar.ts')).toBe('code')
    expect(previewKind('ui.tsx')).toBe('code')
    expect(previewKind('app.py')).toBe('code')
    expect(previewKind('go.mod')).toBe('code')
    expect(previewKind('Cargo.toml')).toBe('code')
    expect(previewKind('db.sql')).toBe('code')
  })
  it('大小写不敏感', () => {
    expect(previewKind('PHOTO.JPG')).toBe('image')
    expect(previewKind('ReadMe.MD')).toBe('markdown')
  })
  it('Markdown 类', () => {
    expect(previewKind('README.md')).toBe('markdown')
    expect(previewKind('notes.markdown')).toBe('markdown')
  })
  it('图片类', () => {
    expect(previewKind('a.png')).toBe('image')
    expect(previewKind('a.jpeg')).toBe('image')
    expect(previewKind('a.gif')).toBe('image')
    expect(previewKind('a.svg')).toBe('image')
    expect(previewKind('a.webp')).toBe('image')
  })
  it('PDF', () => {
    expect(previewKind('report.pdf')).toBe('pdf')
  })
  it('未知扩展名一律 binary', () => {
    expect(previewKind('archive.zip')).toBe('binary')
    expect(previewKind('app.exe')).toBe('binary')
    expect(previewKind('data')).toBe('binary')   // 无扩展名
  })
  it('MAX_TEXT_BYTES = 1.5MB', () => {
    expect(MAX_TEXT_BYTES).toBe(1024 * 1024 * 1.5)
  })
})
