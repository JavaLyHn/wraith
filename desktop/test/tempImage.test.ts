import { describe, it, expect } from 'vitest'
import { validImageExt, tempImageName } from '../src/main/tempImage'

describe('validImageExt', () => {
  it('png/jpg/jpeg/gif/webp 合法', () => {
    for (const e of ['png', 'jpg', 'jpeg', 'gif', 'webp']) expect(validImageExt(e)).toBe(e)
  })
  it('带点前缀归一', () => expect(validImageExt('.PNG')).toBe('png'))
  it('大小写归一', () => expect(validImageExt('JPG')).toBe('jpg'))
  it('非图扩展 → null', () => expect(validImageExt('exe')).toBeNull())
  it('空 → null', () => expect(validImageExt('')).toBeNull())
})

describe('tempImageName', () => {
  it('格式 paste-<ms>-<seq>.<ext>', () =>
    expect(tempImageName('png', 3, 1_000)).toBe('paste-1000-3.png'))
  it('不同 seq 不重名', () =>
    expect(tempImageName('jpg', 0, 5) === tempImageName('jpg', 1, 5)).toBe(false))
})
