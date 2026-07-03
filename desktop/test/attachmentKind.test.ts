import { describe, it, expect } from 'vitest'
import { attachmentKind } from '../src/shared/attachmentKind'

describe('attachmentKind', () => {
  it('图片扩展→image;其余含无扩展→text;大小写不敏感', () => {
    // image extensions
    expect(attachmentKind('photo.png')).toBe('image')
    expect(attachmentKind('photo.jpg')).toBe('image')
    expect(attachmentKind('photo.jpeg')).toBe('image')
    expect(attachmentKind('anim.gif')).toBe('image')
    expect(attachmentKind('img.webp')).toBe('image')
    // case-insensitive
    expect(attachmentKind('PHOTO.PNG')).toBe('image')
    expect(attachmentKind('PHOTO.JPG')).toBe('image')
    expect(attachmentKind('img.WEBP')).toBe('image')
    // text / other
    expect(attachmentKind('notes.txt')).toBe('text')
    expect(attachmentKind('index.ts')).toBe('text')
    expect(attachmentKind('report.pdf')).toBe('text')
    // no extension
    expect(attachmentKind('Makefile')).toBe('text')
    expect(attachmentKind('.bashrc')).toBe('text')
    // full paths
    expect(attachmentKind('/home/user/screenshots/cap.webp')).toBe('image')
    expect(attachmentKind('/home/user/docs/readme.md')).toBe('text')
  })
})
