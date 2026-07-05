import { describe, it, expect } from 'vitest'
import { resolveIconKind } from '../src/renderer/components/ProviderIcon'

describe('resolveIconKind', () => {
  it('已知 lobeIcon → lobe', () => {
    expect(resolveIconKind('openai')).toEqual({ kind: 'lobe', name: 'OpenAI' })
  })
  it('alias 命中 → 用 canonical 的 lobeIcon', () => {
    // zhipu is an alias for glm, which has lobeIcon: 'Zhipu'
    expect(resolveIconKind('zhipu')).toEqual({ kind: 'lobe', name: 'Zhipu' })
  })
  it('无 lobeIcon/未知 → 回落首字母', () => {
    expect(resolveIconKind('xfyun')).toEqual({ kind: 'fallback', letter: '讯' })   // displayName 首字
    expect(resolveIconKind('不存在-provider')).toEqual({ kind: 'fallback', letter: '不' })
  })
})
