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
  it('Coding Plan 复用母 provider 图标', () => {
    expect(resolveIconKind('zhipu-coding')).toEqual({ kind: 'lobe', name: 'Zhipu' })
    expect(resolveIconKind('dashscope-coding')).toEqual({ kind: 'lobe', name: 'Qwen' })
    expect(resolveIconKind('kimi-coding')).toEqual({ kind: 'lobe', name: 'Moonshot' })
    expect(resolveIconKind('volcengine-coding')).toEqual({ kind: 'lobe', name: 'Volcengine' })
  })
  it('infini/mimo/xfyun 显示品牌图标', () => {
    expect(resolveIconKind('infini')).toEqual({ kind: 'lobe', name: 'Infinigence' })
    expect(resolveIconKind('mimo')).toEqual({ kind: 'lobe', name: 'XiaomiMiMo' })
    expect(resolveIconKind('xfyun')).toEqual({ kind: 'lobe', name: 'Spark' })
  })
  it('无 lobeIcon/未知 → 回落首字母', () => {
    expect(resolveIconKind('agnes')).toEqual({ kind: 'fallback', letter: 'A' })   // displayName 'Agnes AI'
    expect(resolveIconKind('不存在-provider')).toEqual({ kind: 'fallback', letter: '不' })
  })
})
