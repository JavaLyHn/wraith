import { describe, it, expect } from 'vitest'
import { staleIndexWarning } from '../src/renderer/lib/ragView'
import type { RagStatus } from '../src/shared/types'

/**
 * 换了 embedding 模型却没重建索引 → 检索会安静地返回一堆 0 分结果
 * （实测:768 维索引 + 1024 维查询 = 3 条结果、相关度全 0.0000、不报错）。
 *
 * 检索时抛错是兜底,但那已经晚了 —— 雷是在「保存 Embedding 配置」那一刻埋下的,
 * 面板本该在那时就提示。这里是那条提示的判定。
 *
 * 判据只有一条:**索引记录的模型 ≠ 当前配置的模型**。老索引没记过模型时不提示 ——
 * 不知道就说不知道,宁可漏报也不要对着一份可能没问题的索引喊「快重建」。
 */

const status = (over: Partial<RagStatus> = {}): RagStatus => ({
  indexed: true, chunkCount: 42, relationCount: 10, embeddingModel: 'nomic-embed-text:latest',
  embeddingDim: 768, ...over,
})

describe('staleIndexWarning', () => {
  it('模型变了 → 提示,并把新旧两个模型名都说出来', () => {
    const w = staleIndexWarning(status(), 'bge-m3:latest')
    expect(w).not.toBeNull()
    expect(w!).toContain('nomic-embed-text:latest')
    expect(w!).toContain('bge-m3:latest')
    expect(w!).toContain('重建')
  })

  it('模型没变 → 不提示', () => {
    expect(staleIndexWarning(status(), 'nomic-embed-text:latest')).toBeNull()
  })

  it('还没建索引 → 不提示（没有可重建的东西）', () => {
    expect(staleIndexWarning(status({ indexed: false, chunkCount: 0 }), 'bge-m3:latest')).toBeNull()
  })

  it('老索引没记过模型 → 不提示（宁可漏报,也不对着可能没问题的索引喊重建）', () => {
    expect(staleIndexWarning(status({ embeddingModel: undefined }), 'bge-m3:latest')).toBeNull()
  })

  it('当前配置的 model 为空(用后端默认)→ 不提示,因为无从比较', () => {
    expect(staleIndexWarning(status(), '')).toBeNull()
    expect(staleIndexWarning(status(), '   ')).toBeNull()
  })

  it('只是首尾空格差异不算变 —— 别为一个空格逼人重建整库', () => {
    expect(staleIndexWarning(status(), '  nomic-embed-text:latest  ')).toBeNull()
  })

  it('大小写不同算同一个模型 —— ollama 的 tag 不区分大小写', () => {
    expect(staleIndexWarning(status(), 'NOMIC-embed-text:LATEST')).toBeNull()
  })

  it('status 为 null（还没拉到）→ 不提示', () => {
    expect(staleIndexWarning(null, 'bge-m3:latest')).toBeNull()
  })

  it('提示里要点明后果 —— 不然用户不知道为什么非重建不可', () => {
    const w = staleIndexWarning(status(), 'bge-m3:latest')!
    expect(w).toMatch(/0|相关度|搜不/)
  })
})
