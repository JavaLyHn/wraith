import { describe, it, expect } from 'vitest'
import { configuredProviders } from '../src/renderer/lib/modelSwitcher'
import type { ProviderView } from '../src/shared/types'

const mk = (name: string, hasKey: boolean): ProviderView => ({ name, model: 'm', hasKey })

describe('configuredProviders', () => {
  it('只保留已配置(hasKey)的 provider,滤掉未配置的旧 provider', () => {
    const list = [mk('deepseek', false), mk('openai', true), mk('glm', false), mk('anthropic', true)]
    expect(configuredProviders(list).map(p => p.name)).toEqual(['openai', 'anthropic'])
  })
  it('全部未配置时返回空数组', () => {
    expect(configuredProviders([mk('glm', false), mk('kimi', false), mk('freellmapi', false)])).toEqual([])
  })
  it('保持原有顺序', () => {
    const list = [mk('a', true), mk('b', false), mk('c', true)]
    expect(configuredProviders(list).map(p => p.name)).toEqual(['a', 'c'])
  })
})
