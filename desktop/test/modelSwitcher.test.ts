import { describe, it, expect } from 'vitest'
import { configuredProviders, providerOptionLabel } from '../src/renderer/lib/modelSwitcher'
import type { ProviderView } from '../src/shared/types'

const mk = (name: string, hasKey: boolean, label?: string): ProviderView => ({ name, model: 'm', hasKey, label })

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

describe('providerOptionLabel', () => {
  it('有 label 时显示「名称 · label」(用户配置的备注名)', () => {
    expect(providerOptionLabel(mk('freellmapi', true, 'Sophnet'))).toBe('FreeLLMAPI · Sophnet')
    expect(providerOptionLabel(mk('freellmapi-2', true, 'newapi'))).toBe('FreeLLMAPI · newapi')
  })
  it('无 label 时回落 catalog 名 / 实例编号,而非原始 id', () => {
    expect(providerOptionLabel(mk('freellmapi', true))).toBe('FreeLLMAPI')
    expect(providerOptionLabel(mk('freellmapi-2', true))).toBe('FreeLLMAPI #2')
    expect(providerOptionLabel(mk('openai', true))).toBe('OpenAI')
  })
  it('未知 id 回落到 id 本身', () => {
    expect(providerOptionLabel(mk('some-unknown-x', true))).toBe('some-unknown-x')
  })
})
