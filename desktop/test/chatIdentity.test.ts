import { describe, it, expect } from 'vitest'
import { userAvatarGlyph } from '../src/renderer/lib/chatIdentity'

describe('userAvatarGlyph', () => {
  it('有 avatar(emoji)优先取首个 code point', () => {
    expect(userAvatarGlyph({ name: '阿豪', avatar: '🦊' })).toBe('🦊')
  })
  it('avatar 空则取昵称首字符', () => {
    expect(userAvatarGlyph({ name: 'Lyhn', avatar: '' })).toBe('L')
  })
  it('avatar 与昵称皆空 → 我', () => {
    expect(userAvatarGlyph({ name: '   ', avatar: '  ' })).toBe('我')
  })
})
