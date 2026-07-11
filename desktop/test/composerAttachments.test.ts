import { describe, it, expect } from 'vitest'
import { imageExtFromMime, isImageMime, pathsToAttachments } from '../src/renderer/lib/composerAttachments'

describe('imageExtFromMime', () => {
  it('png', () => expect(imageExtFromMime('image/png')).toBe('png'))
  it('jpeg → jpg', () => expect(imageExtFromMime('image/jpeg')).toBe('jpg'))
  it('gif', () => expect(imageExtFromMime('image/gif')).toBe('gif'))
  it('webp', () => expect(imageExtFromMime('image/webp')).toBe('webp'))
  it('大小写不敏感', () => expect(imageExtFromMime('IMAGE/PNG')).toBe('png'))
  it('未知 → null', () => expect(imageExtFromMime('image/bmp')).toBeNull())
  it('空 → null', () => expect(imageExtFromMime('')).toBeNull())
})

describe('isImageMime', () => {
  it('image/* → true', () => expect(isImageMime('image/png')).toBe(true))
  it('大小写', () => expect(isImageMime('Image/JPEG')).toBe(true))
  it('text → false', () => expect(isImageMime('text/plain')).toBe(false))
  it('空 → false', () => expect(isImageMime('')).toBe(false))
})

describe('pathsToAttachments', () => {
  it('图片路径 → kind image + basename', () => {
    expect(pathsToAttachments(['/tmp/shot.png'])).toEqual([
      { path: '/tmp/shot.png', name: 'shot.png', kind: 'image' },
    ])
  })
  it('文本文件 → kind text', () => {
    expect(pathsToAttachments(['/a/b/notes.md'])[0]).toMatchObject({ name: 'notes.md', kind: 'text' })
  })
  it('Windows 反斜杠 basename', () => {
    expect(pathsToAttachments(['C:\\x\\y\\pic.jpg'])[0]).toMatchObject({ name: 'pic.jpg', kind: 'image' })
  })
  it('跳过空路径', () => {
    expect(pathsToAttachments(['', '   ', '/tmp/a.png'])).toHaveLength(1)
  })
  it('多路径保序', () => {
    const r = pathsToAttachments(['/a.png', '/b.txt'])
    expect(r.map(x => x.name)).toEqual(['a.png', 'b.txt'])
  })
})
