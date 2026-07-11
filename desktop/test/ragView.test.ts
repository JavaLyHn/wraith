import { describe, it, expect } from 'vitest'
import { embeddingDefaults } from '../src/renderer/lib/ragView'

describe('embeddingDefaults', () => {
  it('ollama → nomic-embed-text + 本地 11434', () => {
    expect(embeddingDefaults('ollama')).toEqual({ model: 'nomic-embed-text:latest', baseUrl: 'http://localhost:11434' })
  })
  it('zhipu → embedding-2 + bigmodel', () => {
    expect(embeddingDefaults('zhipu')).toEqual({ model: 'embedding-2', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' })
  })
  it('glm 同 zhipu', () => {
    expect(embeddingDefaults('glm')).toEqual(embeddingDefaults('zhipu'))
  })
  it('openai → text-embedding-3-small', () => {
    expect(embeddingDefaults('openai').model).toBe('text-embedding-3-small')
  })
  it('未知 → 回退 ollama 默认', () => {
    expect(embeddingDefaults('weird')).toEqual(embeddingDefaults('ollama'))
  })
})
